import { EventEmitter } from 'events';
import { SFTPConfig, SFTPOperations } from '../interfaces';
import { LocalCacheManager } from '../cache/LocalCacheManager';
import { NetworkErrorHandler } from '../network/NetworkErrorHandler';
import { NetworkMonitor, NetworkStatus } from '../network/NetworkMonitor';
import { PerformanceManager } from '../performance/PerformanceManager';
import { FileIntegrityChecker } from '../security/FileIntegrityChecker';
import { TransferEncryption } from '../security/TransferEncryption';
import { ResumableTransfer, TransferSession } from '../transfer/ResumableTransfer';
import { getTempFilePath } from '../runtime';
import { SFTPRuntimeFactory } from './SFTPRuntimeFactory';
import { SystemSFTPClient, SystemSFTPConfig } from './SystemSFTPClient';

export enum ConnectionStatus {
  DISCONNECTED = 'disconnected',
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  ERROR = 'error'
}

interface PooledConnection {
  id: string;
  client: SystemSFTPClient;
  status: ConnectionStatus;
  lastUsed: Date;
  inUse: boolean;
  retryCount: number;
}

export class SFTPConnectionManager extends EventEmitter implements SFTPOperations {
  private config: SFTPConfig;
  private connectionPool: Map<string, PooledConnection> = new Map();
  private maxPoolSize = 5;
  private connectionTimeout = 30000;
  private retryDelay = 1000;
  private maxRetryDelay = 30000;
  private errorHandler: NetworkErrorHandler;
  private networkMonitor: NetworkMonitor;
  private cacheManager: LocalCacheManager;
  private integrityChecker: FileIntegrityChecker;
  private performanceManager: PerformanceManager;
  private resumableTransfer: ResumableTransfer;
  private transferEncryption: TransferEncryption;
  private degradedMode = false;
  private encryptionEnabled = false;
  private encryptionPassword?: string;

  constructor(config: SFTPConfig) {
    super();
    this.config = config;
    this.connectionTimeout = config.timeout || 30000;

    const services = SFTPRuntimeFactory.create(config);
    this.errorHandler = services.errorHandler;
    this.networkMonitor = services.networkMonitor;
    this.cacheManager = services.cacheManager;
    this.integrityChecker = services.integrityChecker;
    this.performanceManager = services.performanceManager;
    this.resumableTransfer = services.resumableTransfer;
    this.transferEncryption = services.transferEncryption;

    this.setupEventHandlers();
  }

  async connect(config?: SFTPConfig): Promise<void> {
    if (config) {
      this.config = config;
    }

    this.networkMonitor.startMonitoring();
    this.performanceManager.start();

    const connection = await this.errorHandler.executeWithRetry(
      () => this.createConnection(),
      'sftp-connect'
    );

    this.emit('connected', connection.id);
  }

  async disconnect(): Promise<void> {
    this.networkMonitor.stopMonitoring();
    this.performanceManager.stop();

    const disconnectPromises = Array.from(this.connectionPool.values()).map(async (connection) => {
      try {
        connection.client.disconnect();
      } catch (error) {
        console.warn(`Error disconnecting connection ${connection.id}:`, error);
      }
    });

    await Promise.all(disconnectPromises);
    this.connectionPool.clear();
    this.cacheManager.destroy();

    this.emit('disconnected');
  }

  async uploadFile(localPath: string, remotePath: string, options?: {
    enableIntegrityCheck?: boolean;
    enableResumable?: boolean;
    enableEncryption?: boolean;
  }): Promise<void> {
    const opts = {
      enableIntegrityCheck: true,
      enableResumable: false,
      enableEncryption: this.encryptionEnabled,
      ...options
    };

    if (opts.enableResumable) {
      await this.uploadFileResumable(localPath, remotePath, opts);
      return;
    }

    await this.performanceManager.optimizedUpload(
      localPath,
      async (chunk: Buffer, chunkIndex: number) => {
        await this.errorHandler.executeWithRetry(async () => {
          let finalData = chunk;
          let checksum: string | undefined;

          if (opts.enableIntegrityCheck) {
            checksum = require('crypto').createHash('sha256').update(chunk).digest('hex');
          }

          if (opts.enableEncryption && this.encryptionPassword) {
            const encryptionResult = await this.transferEncryption.encryptData(chunk, this.encryptionPassword);
            finalData = encryptionResult.encryptedData;
          }

          const connection = await this.getConnection();
          try {
            const tempRemotePath = chunkIndex === 0 ? remotePath : `${remotePath}.chunk.${chunkIndex}`;
            const fs = await import('fs');
            const tempLocalPath = `${localPath}.temp.${chunkIndex}`;
            fs.writeFileSync(tempLocalPath, finalData, { encoding: null });

            await connection.client.uploadFile(tempLocalPath, tempRemotePath);

            if (opts.enableIntegrityCheck && checksum) {
              const uploadedChecksum = await this.calculateRemoteFileChecksum(tempRemotePath);
              if (uploadedChecksum !== checksum) {
                throw new Error(`Chunk ${chunkIndex} integrity verification failed after upload`);
              }
            }

            if (fs.existsSync(tempLocalPath)) {
              fs.unlinkSync(tempLocalPath);
            }
          } finally {
            this.releaseConnection(connection);
          }
        }, 'upload-chunk');
      },
      {
        onProgress: (progress) => {
          this.emit('uploadProgress', {
            localPath,
            remotePath,
            progress: progress.progress,
            speed: progress.speed,
            remainingTime: progress.remainingTime
          });
        }
      }
    );

    this.emit('fileUploaded', {
      localPath,
      remotePath,
      encrypted: opts.enableEncryption
    });
  }

  async downloadFile(remotePath: string, localPath: string): Promise<void> {
    const cacheKey = `download:${remotePath}`;
    const cachedData = await this.cacheManager.get(cacheKey);

    if (cachedData && !this.degradedMode) {
      const fs = await import('fs');
      fs.writeFileSync(localPath, cachedData, { encoding: null });
      this.emit('fileDownloaded', { remotePath, localPath, fromCache: true });
      return;
    }

    if (this.networkMonitor.getCurrentStatus() === NetworkStatus.OFFLINE && cachedData) {
      const fs = await import('fs');
      fs.writeFileSync(localPath, cachedData, { encoding: null });
      this.emit('fileDownloaded', { remotePath, localPath, fromCache: true, degraded: true });
      return;
    }

    await this.errorHandler.executeWithRetry(async () => {
      const connection = await this.getConnection();
      try {
        await connection.client.downloadFile(remotePath, localPath);

        const fs = await import('fs');
        const data = fs.readFileSync(localPath, { encoding: null });
        await this.cacheManager.set(cacheKey, data, {
          ttl: 60 * 60 * 1000,
          tags: ['download']
        });

        this.emit('fileDownloaded', { remotePath, localPath });
      } finally {
        this.releaseConnection(connection);
      }
    }, 'download-file');
  }

  async listDirectory(remotePath: string): Promise<string[]> {
    const connection = await this.getConnection();
    try {
      const fileList = await connection.client.listDirectory(remotePath);
      return fileList.map((file) => file.filename || file.name);
    } finally {
      this.releaseConnection(connection);
    }
  }

  async fileExists(remotePath: string): Promise<boolean> {
    const connection = await this.getConnection();
    try {
      return await connection.client.fileExists(remotePath);
    } finally {
      this.releaseConnection(connection);
    }
  }

  async uploadBuffer(buffer: Buffer, remotePath: string, options?: {
    enableIntegrityCheck?: boolean;
    enableEncryption?: boolean;
  }): Promise<void> {
    const opts = {
      enableIntegrityCheck: true,
      enableEncryption: this.encryptionEnabled,
      ...options
    };

    await this.errorHandler.executeWithRetry(async () => {
      let finalBuffer = buffer;
      let checksum: string | undefined;

      if (opts.enableIntegrityCheck) {
        checksum = this.integrityChecker.calculateBufferChecksum(buffer);
      }

      if (opts.enableEncryption && this.encryptionPassword) {
        const encryptionResult = await this.transferEncryption.encryptData(buffer, this.encryptionPassword);
        finalBuffer = Buffer.concat([
          encryptionResult.salt,
          encryptionResult.iv,
          encryptionResult.tag || Buffer.alloc(0),
          encryptionResult.encryptedData
        ]);
      }

      const connection = await this.getConnection();
      try {
        const fs = await import('fs');
        const tempPath = getTempFilePath('buffer-upload');
        fs.writeFileSync(tempPath, finalBuffer, { encoding: null });
        try {
          await connection.client.uploadFile(tempPath, remotePath);
        } finally {
          if (fs.existsSync(tempPath)) {
            fs.unlinkSync(tempPath);
          }
        }

        this.emit('bufferUploaded', {
          remotePath,
          size: buffer.length,
          encryptedSize: finalBuffer.length,
          checksum,
          encrypted: opts.enableEncryption
        });
      } finally {
        this.releaseConnection(connection);
      }
    }, 'upload-buffer');
  }

  async downloadBuffer(remotePath: string): Promise<Buffer> {
    const cacheKey = `buffer:${remotePath}`;
    const cachedData = await this.cacheManager.get(cacheKey);

    if (cachedData && !this.degradedMode) {
      this.emit('bufferDownloaded', { remotePath, fromCache: true });
      return cachedData;
    }

    if (this.networkMonitor.getCurrentStatus() === NetworkStatus.OFFLINE && cachedData) {
      this.emit('bufferDownloaded', { remotePath, fromCache: true, degraded: true });
      return cachedData;
    }

    return await this.errorHandler.executeWithRetry(async () => {
      const connection = await this.getConnection();
      try {
        const fs = await import('fs');
        const tempPath = getTempFilePath('buffer-download');
        await connection.client.downloadFile(remotePath, tempPath);
        const buffer = fs.readFileSync(tempPath, { encoding: null });
        if (fs.existsSync(tempPath)) {
          fs.unlinkSync(tempPath);
        }

        await this.cacheManager.set(cacheKey, buffer, {
          ttl: 60 * 60 * 1000,
          tags: ['buffer']
        });

        this.emit('bufferDownloaded', { remotePath });
        return buffer;
      } finally {
        this.releaseConnection(connection);
      }
    }, 'download-buffer');
  }

  async createDirectory(remotePath: string, _recursive: boolean = true): Promise<void> {
    const connection = await this.getConnection();
    try {
      await connection.client.createDirectory(remotePath);
    } finally {
      this.releaseConnection(connection);
    }
  }

  async deleteFile(remotePath: string): Promise<void> {
    const connection = await this.getConnection();
    try {
      await connection.client.deleteFile(remotePath);
      this.emit('fileDeleted', { remotePath });
    } finally {
      this.releaseConnection(connection);
    }
  }

  getPoolStatus(): {
    totalConnections: number;
    activeConnections: number;
    idleConnections: number;
  } {
    const total = this.connectionPool.size;
    const active = Array.from(this.connectionPool.values()).filter((c) => c.inUse).length;
    const idle = total - active;

    return {
      totalConnections: total,
      activeConnections: active,
      idleConnections: idle
    };
  }

  private async getConnection(): Promise<PooledConnection> {
    for (const connection of this.connectionPool.values()) {
      if (!connection.inUse && connection.status === ConnectionStatus.CONNECTED) {
        connection.inUse = true;
        connection.lastUsed = new Date();
        return connection;
      }
    }

    if (this.connectionPool.size < this.maxPoolSize) {
      return await this.createConnection();
    }

    return new Promise((resolve, reject) => {
      const checkInterval = setInterval(() => {
        for (const connection of this.connectionPool.values()) {
          if (!connection.inUse && connection.status === ConnectionStatus.CONNECTED) {
            connection.inUse = true;
            connection.lastUsed = new Date();
            clearInterval(checkInterval);
            resolve(connection);
            return;
          }
        }
      }, 100);

      setTimeout(() => {
        clearInterval(checkInterval);
        reject(new Error('Connection pool timeout'));
      }, this.connectionTimeout);
    });
  }

  private releaseConnection(connection: PooledConnection): void {
    connection.inUse = false;
    connection.lastUsed = new Date();
  }

  private async createConnection(): Promise<PooledConnection> {
    const connectionId = `sftp_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;

    const systemConfig: SystemSFTPConfig = {
      host: this.config.host,
      port: this.config.port,
      username: this.config.username,
      password: this.config.password,
      privateKey: this.config.privateKeyPath,
      authMethod: this.config.authMethod as 'password' | 'dynamic-token' | 'key',
      timeout: this.config.timeout,
      retries: this.config.retryAttempts || 3,
      retryDelay: 2000,
      qrCodeImagePath: this.config.qrCodeImagePath,
      basePath: this.config.basePath
    };

    const client = new SystemSFTPClient(systemConfig);

    const connection: PooledConnection = {
      id: connectionId,
      client,
      status: ConnectionStatus.CONNECTING,
      lastUsed: new Date(),
      inUse: true,
      retryCount: 0
    };

    this.connectionPool.set(connectionId, connection);

    try {
      await this.connectWithRetry(connection);
      connection.status = ConnectionStatus.CONNECTED;
      this.emit('connectionCreated', connectionId);
      return connection;
    } catch (error) {
      connection.status = ConnectionStatus.ERROR;
      this.connectionPool.delete(connectionId);
      this.emit('connectionError', { connectionId, error });
      throw error;
    }
  }

  private async connectWithRetry(connection: PooledConnection): Promise<void> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.config.retryAttempts; attempt++) {
      try {
        await connection.client.connectWithRetry();
        connection.retryCount = 0;
        return;
      } catch (error) {
        lastError = error as Error;
        connection.retryCount = attempt + 1;

        this.emit('connectionRetry', {
          connectionId: connection.id,
          attempt: attempt + 1,
          maxAttempts: this.config.retryAttempts + 1,
          error
        });

        if (attempt < this.config.retryAttempts) {
          const delay = Math.min(
            this.retryDelay * Math.pow(2, attempt),
            this.maxRetryDelay
          );
          await this.sleep(delay);
        }
      }
    }

    throw new Error(`Failed to connect after ${this.config.retryAttempts + 1} attempts: ${lastError?.message || 'Unknown error'}`);
  }

  private async getDynamicToken(): Promise<string> {
    if (this.config.password) {
      return this.config.password;
    }

    return new Promise((resolve, reject) => {
      this.emit('dynamicTokenRequired', {
        resolve,
        reject,
        host: this.config.host,
        username: this.config.username
      });

      setTimeout(() => {
        reject(new Error('Dynamic token request timeout'));
      }, 60000);
    });
  }

  updateDynamicToken(token: string): void {
    this.config.password = token;
    this.emit('dynamicTokenUpdated', token);
  }

  private cleanupExpiredConnections(): void {
    const now = new Date();
    const maxIdleTime = 5 * 60 * 1000;

    for (const [id, connection] of this.connectionPool.entries()) {
      if (!connection.inUse && now.getTime() - connection.lastUsed.getTime() > maxIdleTime) {
        try {
          connection.client.disconnect();
        } catch (error) {
          console.warn('Error cleaning connection:', error);
        }
        this.connectionPool.delete(id);
        this.emit('connectionCleaned', id);
      }
    }
  }

  startMaintenance(): void {
    setInterval(() => {
      this.cleanupExpiredConnections();
    }, 60000);
  }

  private setupEventHandlers(): void {
    this.networkMonitor.on('statusChanged', ({ currentStatus }) => {
      this.handleNetworkStatusChange(currentStatus);
    });

    this.errorHandler.on('operationFailed', ({ operationName, attempt, error }) => {
      this.emit('operationRetry', { operationName, attempt, error });
    });

    this.errorHandler.on('operationRecovered', ({ operationName, attempt }) => {
      this.emit('operationRecovered', { operationName, attempt });
    });

    this.cacheManager.on('itemStored', ({ key, size }) => {
      this.emit('cacheStored', { key, size });
    });

    this.cacheManager.on('dataCorrupted', ({ key }) => {
      this.emit('cacheCorrupted', { key });
    });

    this.integrityChecker.on('checksumCalculated', (data) => {
      this.emit('checksumCalculated', data);
    });

    this.integrityChecker.on('integrityVerified', (data) => {
      this.emit('integrityVerified', data);
    });

    this.resumableTransfer.on('transferProgress', (progress) => {
      this.emit('transferProgress', progress);
    });

    this.resumableTransfer.on('transferCompleted', ({ sessionId: _sessionId }) => {
      this.emit('transferCompleted', { sessionId: _sessionId });
    });

    this.resumableTransfer.on('transferFailed', ({ sessionId: _sessionId, error }) => {
      this.emit('transferFailed', { sessionId: _sessionId, error });
    });

    this.transferEncryption.on('dataEncrypted', (data) => {
      this.emit('dataEncrypted', data);
    });

    this.transferEncryption.on('dataDecrypted', (data) => {
      this.emit('dataDecrypted', data);
    });

    this.transferEncryption.on('encryptionError', (error) => {
      this.emit('encryptionError', error);
    });
  }

  private handleNetworkStatusChange(status: NetworkStatus): void {
    const wasInDegradedMode = this.degradedMode;

    switch (status) {
      case NetworkStatus.OFFLINE:
        this.degradedMode = true;
        this.emit('networkDegraded', { reason: 'offline' });
        break;
      case NetworkStatus.UNSTABLE:
        this.degradedMode = true;
        this.emit('networkDegraded', { reason: 'unstable' });
        break;
      case NetworkStatus.ONLINE:
        if (wasInDegradedMode) {
          this.degradedMode = false;
          this.emit('networkRecovered');
        }
        break;
    }
  }

  getNetworkStatus(): NetworkStatus {
    return this.networkMonitor.getCurrentStatus();
  }

  getNetworkQuality() {
    return this.networkMonitor.getNetworkQuality();
  }

  getPerformanceMetrics() {
    return this.performanceManager.getPerformanceSummary();
  }

  generatePerformanceReport() {
    return this.performanceManager.generatePerformanceReport();
  }

  async optimizePerformance(): Promise<void> {
    await this.performanceManager.performOptimization();
  }

  getErrorStatistics() {
    return this.errorHandler.getErrorStatistics();
  }

  getCacheStatistics() {
    return this.cacheManager.getStats();
  }

  async clearCache(): Promise<void> {
    await this.cacheManager.clear();
  }

  isDegradedMode(): boolean {
    return this.degradedMode;
  }

  async checkNetworkStatus() {
    return await this.networkMonitor.checkNetworkStatus();
  }

  enableEncryption(password: string): void {
    this.encryptionEnabled = true;
    this.encryptionPassword = password;
    this.emit('encryptionEnabled');
  }

  disableEncryption(): void {
    this.encryptionEnabled = false;
    this.encryptionPassword = undefined;
    this.emit('encryptionDisabled');
  }

  private async uploadFileResumable(
    localPath: string,
    remotePath: string,
    options: { enableIntegrityCheck?: boolean; enableEncryption?: boolean }
  ): Promise<void> {
    const sessionId = await this.resumableTransfer.createTransferSession(localPath, remotePath, 'upload');

    await this.resumableTransfer.startTransfer(sessionId, async (chunk) => {
      const connection = await this.getConnection();
      try {
        const fs = await import('fs');
        const chunkData = Buffer.alloc(chunk.size);
        const fd = fs.openSync(localPath, 'r');
        fs.readSync(fd, chunkData, 0, chunk.size, chunk.startOffset);
        fs.closeSync(fd);

        let finalData = chunkData;
        if (options.enableEncryption && this.encryptionPassword) {
          const encryptionResult = await this.transferEncryption.encryptData(chunkData, this.encryptionPassword);
          finalData = Buffer.concat([
            encryptionResult.salt,
            encryptionResult.iv,
            encryptionResult.tag || Buffer.alloc(0),
            encryptionResult.encryptedData
          ]);
        }

        const chunkRemotePath = `${remotePath}.chunk.${chunk.index}`;
        const chunkTempPath = getTempFilePath(`upload-chunk-${chunk.index}`);
        fs.writeFileSync(chunkTempPath, finalData, { encoding: null });
        try {
          await connection.client.uploadFile(chunkTempPath, chunkRemotePath);
        } finally {
          if (fs.existsSync(chunkTempPath)) {
            fs.unlinkSync(chunkTempPath);
          }
        }

        if (options.enableIntegrityCheck) {
          chunk.checksum = this.integrityChecker.calculateBufferChecksum(chunkData);
        }
      } finally {
        this.releaseConnection(connection);
      }
    });

    await this.mergeUploadedChunks(sessionId, remotePath);
    await this.resumableTransfer.deleteSession(sessionId);
  }

  private async mergeUploadedChunks(sessionId: string, remotePath: string): Promise<void> {
    const session = this.resumableTransfer.getSession(sessionId);
    if (!session) {
      throw new Error(`Transfer session ${sessionId} not found`);
    }

    const connection = await this.getConnection();
    try {
      const chunks: Buffer[] = [];
      for (const chunk of session.chunks) {
        const chunkRemotePath = `${remotePath}.chunk.${chunk.index}`;
        const fs = await import('fs');
        const tempPath = getTempFilePath(`merge-chunk-${chunk.index}`);
        await connection.client.downloadFile(chunkRemotePath, tempPath);
        const chunkData = fs.readFileSync(tempPath, { encoding: null });
        chunks.push(chunkData);

        if (fs.existsSync(tempPath)) {
          fs.unlinkSync(tempPath);
        }

        await connection.client.deleteFile(chunkRemotePath);
      }

      const mergedData = Buffer.concat(chunks);
      const fs = await import('fs');
      const finalTempPath = getTempFilePath('merged-upload');
      fs.writeFileSync(finalTempPath, mergedData, { encoding: null });
      try {
        await connection.client.uploadFile(finalTempPath, remotePath);
      } finally {
        if (fs.existsSync(finalTempPath)) {
          fs.unlinkSync(finalTempPath);
        }
      }
    } finally {
      this.releaseConnection(connection);
    }
  }

  private async calculateRemoteFileChecksum(remotePath: string): Promise<string> {
    const buffer = await this.downloadBuffer(remotePath);
    return this.integrityChecker.calculateBufferChecksum(buffer);
  }

  getTransferSessions(): TransferSession[] {
    return this.resumableTransfer.getAllSessions();
  }

  getTransferProgress(sessionId: string) {
    return this.resumableTransfer.getTransferProgress(sessionId);
  }

  async pauseTransfer(sessionId: string): Promise<void> {
    await this.resumableTransfer.pauseTransfer(sessionId);
  }

  async resumeTransfer(_sessionId: string): Promise<void> {
    throw new Error('Resume transfer not implemented in this context');
  }

  async cancelTransfer(sessionId: string): Promise<void> {
    await this.resumableTransfer.cancelTransfer(sessionId);
  }

  async verifyFileIntegrity(localPath: string, expectedChecksum: string): Promise<boolean> {
    const result = await this.integrityChecker.verifyFileIntegrity(localPath, expectedChecksum);
    return result.valid;
  }

  async generateFileIntegrity(filePath: string) {
    return await this.integrityChecker.generateFileIntegrity(filePath);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
