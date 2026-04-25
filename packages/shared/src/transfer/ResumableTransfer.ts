import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';
import { FileIntegrityChecker, ChecksumAlgorithm } from '../security/FileIntegrityChecker';
import { getAppPath } from '../runtime';

/**
 * 传输状态
 */
export enum TransferStatus {
  PENDING = 'pending',
  IN_PROGRESS = 'in_progress',
  PAUSED = 'paused',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled'
}

/**
 * 传输块信息
 */
export interface TransferChunk {
  index: number;
  startOffset: number;
  endOffset: number;
  size: number;
  checksum?: string;
  completed: boolean;
}

/**
 * 传输会话信息
 */
export interface TransferSession {
  id: string;
  localPath: string;
  remotePath: string;
  direction: 'upload' | 'download';
  totalSize: number;
  transferredSize: number;
  chunks: TransferChunk[];
  status: TransferStatus;
  createdAt: Date;
  updatedAt: Date;
  checksum?: string;
  error?: string;
}

/**
 * 传输进度信息
 */
export interface TransferProgress {
  sessionId: string;
  totalSize: number;
  transferredSize: number;
  percentage: number;
  speed: number; // 字节/秒
  remainingTime: number; // 秒
  completedChunks: number;
  totalChunks: number;
}

/**
 * 断点续传配置
 */
export interface ResumableTransferConfig {
  chunkSize: number; // 块大小（字节）
  maxConcurrentChunks: number; // 最大并发块数
  sessionDir: string; // 会话存储目录
  checksumAlgorithm: ChecksumAlgorithm;
  retryAttempts: number;
  retryDelay: number;
}

/**
 * 断点续传管理器
 * 支持大文件的分块传输和断点续传功能
 */
export class ResumableTransfer extends EventEmitter {
  private config: ResumableTransferConfig;
  private sessions: Map<string, TransferSession> = new Map();
  private activeTransfers: Map<string, NodeJS.Timeout> = new Map();
  private integrityChecker: FileIntegrityChecker;
  private sessionFile: string;

  constructor(config: Partial<ResumableTransferConfig>) {
    super();
    
    this.config = {
      chunkSize: 1024 * 1024, // 1MB
      maxConcurrentChunks: 3,
      sessionDir: getAppPath('transfer-sessions'),
      checksumAlgorithm: ChecksumAlgorithm.SHA256,
      retryAttempts: 3,
      retryDelay: 1000,
      ...config
    };

    this.integrityChecker = new FileIntegrityChecker(this.config.checksumAlgorithm);
    this.sessionFile = path.join(this.config.sessionDir, 'sessions.json');
    
    this.initializeSessionStorage();
  }

  /**
   * 创建传输会话
   */
  async createTransferSession(
    localPath: string,
    remotePath: string,
    direction: 'upload' | 'download'
  ): Promise<string> {
    const sessionId = this.generateSessionId();
    
    // 获取文件大小
    let totalSize: number;
    if (direction === 'upload') {
      const stats = fs.statSync(localPath);
      totalSize = stats.size;
    } else {
      // 对于下载，需要从远程获取文件大小
      // 这里假设调用者会提供文件大小
      totalSize = 0; // 将在开始传输时更新
    }

    // 创建传输块
    const chunks = this.createChunks(totalSize);

    const session: TransferSession = {
      id: sessionId,
      localPath,
      remotePath,
      direction,
      totalSize,
      transferredSize: 0,
      chunks,
      status: TransferStatus.PENDING,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    this.sessions.set(sessionId, session);
    await this.saveSession(session);

    this.emit('sessionCreated', { sessionId, session });
    return sessionId;
  }

  /**
   * 开始传输
   */
  async startTransfer(
    sessionId: string,
    transferFunction: (chunk: TransferChunk, session: TransferSession) => Promise<void>
  ): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Transfer session ${sessionId} not found`);
    }

    if (session.status === TransferStatus.IN_PROGRESS) {
      throw new Error(`Transfer session ${sessionId} is already in progress`);
    }

    session.status = TransferStatus.IN_PROGRESS;
    session.updatedAt = new Date();
    await this.saveSession(session);

    this.emit('transferStarted', { sessionId });

    try {
      await this.executeTransfer(session, transferFunction);
      
      // 验证传输完整性
      if (session.direction === 'download' && session.checksum) {
        const verification = await this.integrityChecker.verifyFileIntegrity(
          session.localPath,
          session.checksum,
          this.config.checksumAlgorithm
        );
        
        if (!verification.valid) {
          throw new Error(`File integrity verification failed: ${verification.error}`);
        }
      }

      session.status = TransferStatus.COMPLETED;
      session.updatedAt = new Date();
      await this.saveSession(session);

      this.emit('transferCompleted', { sessionId });
    } catch (error) {
      session.status = TransferStatus.FAILED;
      session.error = (error as Error).message;
      session.updatedAt = new Date();
      await this.saveSession(session);

      this.emit('transferFailed', { sessionId, error });
      throw error;
    }
  }

  /**
   * 暂停传输
   */
  async pauseTransfer(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Transfer session ${sessionId} not found`);
    }

    if (session.status !== TransferStatus.IN_PROGRESS) {
      throw new Error(`Transfer session ${sessionId} is not in progress`);
    }

    // 取消活动传输
    const timer = this.activeTransfers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      this.activeTransfers.delete(sessionId);
    }

    session.status = TransferStatus.PAUSED;
    session.updatedAt = new Date();
    await this.saveSession(session);

    this.emit('transferPaused', { sessionId });
  }

  /**
   * 恢复传输
   */
  async resumeTransfer(
    sessionId: string,
    transferFunction: (chunk: TransferChunk, session: TransferSession) => Promise<void>
  ): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Transfer session ${sessionId} not found`);
    }

    if (session.status !== TransferStatus.PAUSED) {
      throw new Error(`Transfer session ${sessionId} is not paused`);
    }

    await this.startTransfer(sessionId, transferFunction);
  }

  /**
   * 取消传输
   */
  async cancelTransfer(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Transfer session ${sessionId} not found`);
    }

    // 取消活动传输
    const timer = this.activeTransfers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      this.activeTransfers.delete(sessionId);
    }

    session.status = TransferStatus.CANCELLED;
    session.updatedAt = new Date();
    await this.saveSession(session);

    this.emit('transferCancelled', { sessionId });
  }

  /**
   * 获取传输进度
   */
  getTransferProgress(sessionId: string): TransferProgress | null {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return null;
    }

    const completedChunks = session.chunks.filter(chunk => chunk.completed).length;
    const percentage = session.totalSize > 0 ? (session.transferredSize / session.totalSize) * 100 : 0;
    
    // 计算传输速度（简化实现）
    const elapsedTime = (new Date().getTime() - session.createdAt.getTime()) / 1000;
    const speed = elapsedTime > 0 ? session.transferredSize / elapsedTime : 0;
    
    // 估算剩余时间
    const remainingBytes = session.totalSize - session.transferredSize;
    const remainingTime = speed > 0 ? remainingBytes / speed : 0;

    return {
      sessionId,
      totalSize: session.totalSize,
      transferredSize: session.transferredSize,
      percentage: Math.round(percentage * 100) / 100,
      speed: Math.round(speed),
      remainingTime: Math.round(remainingTime),
      completedChunks,
      totalChunks: session.chunks.length
    };
  }

  /**
   * 获取所有会话
   */
  getAllSessions(): TransferSession[] {
    return Array.from(this.sessions.values());
  }

  /**
   * 获取特定会话
   */
  getSession(sessionId: string): TransferSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * 删除会话
   */
  async deleteSession(sessionId: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }

    // 如果传输正在进行，先取消
    if (session.status === TransferStatus.IN_PROGRESS) {
      await this.cancelTransfer(sessionId);
    }

    this.sessions.delete(sessionId);
    await this.saveSessions();

    this.emit('sessionDeleted', { sessionId });
    return true;
  }

  /**
   * 执行传输
   */
  private async executeTransfer(
    session: TransferSession,
    transferFunction: (chunk: TransferChunk, session: TransferSession) => Promise<void>
  ): Promise<void> {
    const incompleteChunks = session.chunks.filter(chunk => !chunk.completed);

    // 并发处理块
    const concurrentPromises: Promise<void>[] = [];
    let chunkIndex = 0;

    while (chunkIndex < incompleteChunks.length || concurrentPromises.length > 0) {
      // 启动新的并发传输
      while (concurrentPromises.length < this.config.maxConcurrentChunks && 
             chunkIndex < incompleteChunks.length) {
        const chunk = incompleteChunks[chunkIndex++];
        const promise = this.transferChunkWithRetry(chunk, session, transferFunction);
        concurrentPromises.push(promise);
      }

      // 等待至少一个传输完成
      if (concurrentPromises.length > 0) {
        await Promise.race(concurrentPromises);
        
        // 移除已完成的传输
        for (let i = concurrentPromises.length - 1; i >= 0; i--) {
          const promise = concurrentPromises[i];
          if (await this.isPromiseResolved(promise)) {
            concurrentPromises.splice(i, 1);
          }
        }

        // 更新进度
        this.updateTransferProgress(session);
        await this.saveSession(session);

        // 发出进度事件
        const progress = this.getTransferProgress(session.id);
        if (progress) {
          this.emit('transferProgress', progress);
        }
      }
    }

    // 等待所有传输完成
    await Promise.all(concurrentPromises);
  }

  /**
   * 带重试的块传输
   */
  private async transferChunkWithRetry(
    chunk: TransferChunk,
    session: TransferSession,
    transferFunction: (chunk: TransferChunk, session: TransferSession) => Promise<void>
  ): Promise<void> {
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= this.config.retryAttempts; attempt++) {
      try {
        await transferFunction(chunk, session);
        chunk.completed = true;
        return;
      } catch (error) {
        lastError = error as Error;
        
        this.emit('chunkTransferFailed', {
          sessionId: session.id,
          chunkIndex: chunk.index,
          attempt,
          error
        });

        if (attempt < this.config.retryAttempts) {
          await this.sleep(this.config.retryDelay * attempt);
        }
      }
    }

    throw new Error(`Chunk ${chunk.index} transfer failed after ${this.config.retryAttempts} attempts: ${lastError?.message}`);
  }

  /**
   * 更新传输进度
   */
  private updateTransferProgress(session: TransferSession): void {
    const completedChunks = session.chunks.filter(chunk => chunk.completed);
    session.transferredSize = completedChunks.reduce((sum, chunk) => sum + chunk.size, 0);
    session.updatedAt = new Date();
  }

  /**
   * 创建传输块
   */
  private createChunks(totalSize: number): TransferChunk[] {
    const chunks: TransferChunk[] = [];
    const chunkSize = this.config.chunkSize;
    let offset = 0;
    let index = 0;

    while (offset < totalSize) {
      const endOffset = Math.min(offset + chunkSize - 1, totalSize - 1);
      const size = endOffset - offset + 1;

      chunks.push({
        index: index++,
        startOffset: offset,
        endOffset,
        size,
        completed: false
      });

      offset = endOffset + 1;
    }

    return chunks;
  }

  /**
   * 生成会话ID
   */
  private generateSessionId(): string {
    return `transfer_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }

  /**
   * 初始化会话存储
   */
  private initializeSessionStorage(): void {
    if (!fs.existsSync(this.config.sessionDir)) {
      fs.mkdirSync(this.config.sessionDir, { recursive: true });
    }

    this.loadSessions();
  }

  /**
   * 加载会话
   */
  private loadSessions(): void {
    try {
      if (fs.existsSync(this.sessionFile)) {
        const data = fs.readFileSync(this.sessionFile, 'utf8');
        const sessions = JSON.parse(data);
        
        for (const [id, sessionData] of Object.entries(sessions)) {
          const session = sessionData as any;
          this.sessions.set(id, {
            ...session,
            createdAt: new Date(session.createdAt),
            updatedAt: new Date(session.updatedAt)
          });
        }
      }
    } catch (error) {
      // 如果加载失败，从空会话开始
      this.sessions.clear();
    }
  }

  /**
   * 保存所有会话
   */
  private async saveSessions(): Promise<void> {
    try {
      const data = Object.fromEntries(this.sessions.entries());
      fs.writeFileSync(this.sessionFile, JSON.stringify(data, null, 2));
    } catch (error) {
      this.emit('error', error);
    }
  }

  /**
   * 保存单个会话
   */
  private async saveSession(session: TransferSession): Promise<void> {
    this.sessions.set(session.id, session);
    await this.saveSessions();
  }

  /**
   * 检查Promise是否已解决
   */
  private async isPromiseResolved(promise: Promise<any>): Promise<boolean> {
    try {
      await Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 0))
      ]);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 休眠
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
