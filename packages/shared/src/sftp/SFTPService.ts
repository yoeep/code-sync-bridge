/**
 * SFTP服务类
 * 基于调通的SystemSFTPClient实现的高级SFTP服务
 */

import { SystemSFTPClient, SFTPClientFactory, SystemSFTPConfig } from './SystemSFTPClient';
import { EventEmitter } from 'events';
import * as path from 'path';
import * as fs from 'fs';
import { log } from '../utils/Logger';

export interface SFTPServiceConfig extends SystemSFTPConfig {
  // 服务级别的配置
  autoReconnect?: boolean;
  maxReconnectAttempts?: number;
  reconnectDelay?: number;
  enableLogging?: boolean;
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
}

export interface FileTransferResult {
  success: boolean;
  localPath: string;
  remotePath: string;
  size?: number;
  duration?: number;
  error?: string;
}

export interface SFTPSyncResult {
  success: boolean;
  totalFiles: number;
  successfulTransfers: number;
  failedTransfers: number;
  totalSize: number;
  duration: number;
  errors: string[];
}

/**
 * SFTP服务类
 * 提供高级的SFTP操作功能，基于调通的SystemSFTPClient
 */
export class SFTPService extends EventEmitter {
  private client: SystemSFTPClient | null = null;
  private config: SFTPServiceConfig;
  private isConnected: boolean = false;
  private reconnectAttempts: number = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;

  constructor(config: SFTPServiceConfig) {
    super();
    this.config = {
      autoReconnect: true,
      maxReconnectAttempts: 5,
      reconnectDelay: 5000,
      enableLogging: true,
      logLevel: 'info',
      ...config
    };
  }

  /**
   * 连接到SFTP服务器
   */
  async connect(): Promise<void> {
    try {
      this.logMessage('info', '正在连接到SFTP服务器...');
      
      // 验证配置
      SFTPClientFactory.validateConfig(this.config);
      
      // 创建客户端
      this.client = await SFTPClientFactory.createClient(this.config);
      
      // 连接
      await this.client.connectWithRetry();
      
      this.isConnected = true;
      this.reconnectAttempts = 0;
      
      console.log('✅ SFTP连接成功'); // 保留关键进程监控信息
      log.info('SFTPService', 'SFTP连接成功');
      this.emit('connected');
      
    } catch (error) {
      log.error('SFTPService', 'SFTP连接失败', { error: error instanceof Error ? error.message : String(error) });
      this.emit('connectionError', error);
      
      if (this.config.autoReconnect) {
        this.scheduleReconnect();
      }
      
      throw error;
    }
  }

  /**
   * 断开连接
   */
  async disconnect(): Promise<void> {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.client) {
      this.client.disconnect();
      this.client = null;
    }

    this.isConnected = false;
    log.info('SFTPService', 'SFTP连接已断开');
    this.emit('disconnected');
  }

  /**
   * 检查连接状态
   */
  isConnectionActive(): boolean {
    return this.isConnected && this.client !== null && this.client.isConnectionActive();
  }

  /**
   * 上传单个文件
   */
  async uploadFile(localPath: string, remotePath: string): Promise<FileTransferResult> {
    const startTime = Date.now();
    
    try {
      await this.ensureConnected();
      
      if (!fs.existsSync(localPath)) {
        throw new Error(`本地文件不存在: ${localPath}`);
      }

      const stats = fs.statSync(localPath);
      const fileSize = stats.size;

      this.logMessage('info', `开始上传文件: ${localPath} -> ${remotePath}`, { size: this.formatBytes(fileSize) });

      await this.client!.uploadFile(localPath, remotePath);

      const duration = Date.now() - startTime;
      const result: FileTransferResult = {
        success: true,
        localPath,
        remotePath,
        size: fileSize,
        duration
      };

      console.log(`✅ 文件上传成功: ${remotePath}`); // 保留关键进程监控信息
      log.info('SFTPService', `文件上传成功: ${remotePath}`, { duration });
      this.emit('fileUploaded', result);

      return result;

    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      const result: FileTransferResult = {
        success: false,
        localPath,
        remotePath,
        duration,
        error: errorMessage
      };

      log.error('SFTPService', `文件上传失败: ${localPath} -> ${remotePath}`, { error: errorMessage });
      this.emit('fileUploadError', result);

      return result;
    }
  }

  /**
   * 下载单个文件
   */
  async downloadFile(remotePath: string, localPath: string): Promise<FileTransferResult> {
    const startTime = Date.now();
    
    try {
      await this.ensureConnected();

      // 确保本地目录存在
      const localDir = path.dirname(localPath);
      if (!fs.existsSync(localDir)) {
        fs.mkdirSync(localDir, { recursive: true });
      }

      this.logMessage('info', `开始下载文件: ${remotePath} -> ${localPath}`);

      await this.client!.downloadFile(remotePath, localPath);

      const stats = fs.statSync(localPath);
      const fileSize = stats.size;
      const duration = Date.now() - startTime;

      const result: FileTransferResult = {
        success: true,
        localPath,
        remotePath,
        size: fileSize,
        duration
      };

      console.log(`✅ 文件下载成功: ${localPath}`); // 保留关键进程监控信息
      log.info('SFTPService', `文件下载成功: ${localPath}`, { size: this.formatBytes(fileSize), duration });
      this.emit('fileDownloaded', result);

      return result;

    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      const result: FileTransferResult = {
        success: false,
        localPath,
        remotePath,
        duration,
        error: errorMessage
      };

      log.error('SFTPService', `文件下载失败: ${remotePath} -> ${localPath}`, { error: errorMessage });
      this.emit('fileDownloadError', result);

      return result;
    }
  }

  /**
   * 批量上传文件
   */
  async uploadFiles(files: Array<{ localPath: string; remotePath: string }>): Promise<SFTPSyncResult> {
    const startTime = Date.now();
    const results: FileTransferResult[] = [];
    const errors: string[] = [];

    this.logMessage('info', `开始批量上传 ${files.length} 个文件`);

    for (const file of files) {
      try {
        const result = await this.uploadFile(file.localPath, file.remotePath);
        results.push(result);
        
        if (!result.success && result.error) {
          errors.push(`${file.localPath}: ${result.error}`);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        errors.push(`${file.localPath}: ${errorMessage}`);
        results.push({
          success: false,
          localPath: file.localPath,
          remotePath: file.remotePath,
          error: errorMessage
        });
      }
    }

    const duration = Date.now() - startTime;
    const successfulTransfers = results.filter(r => r.success).length;
    const totalSize = results.reduce((sum, r) => sum + (r.size || 0), 0);

    const syncResult: SFTPSyncResult = {
      success: errors.length === 0,
      totalFiles: files.length,
      successfulTransfers,
      failedTransfers: files.length - successfulTransfers,
      totalSize,
      duration,
      errors
    };

    console.log(`📊 批量上传完成: ${successfulTransfers}/${files.length} 成功`); // 保留关键进程监控信息
    log.info('SFTPService', `批量上传完成: ${successfulTransfers}/${files.length} 成功`, { 
      totalSize: this.formatBytes(totalSize), 
      duration 
    });
    this.emit('batchUploadCompleted', syncResult);

    return syncResult;
  }

  /**
   * 批量下载文件
   */
  async downloadFiles(files: Array<{ remotePath: string; localPath: string }>): Promise<SFTPSyncResult> {
    const startTime = Date.now();
    const results: FileTransferResult[] = [];
    const errors: string[] = [];

    this.logMessage('info', `开始批量下载 ${files.length} 个文件`);

    for (const file of files) {
      try {
        const result = await this.downloadFile(file.remotePath, file.localPath);
        results.push(result);
        
        if (!result.success && result.error) {
          errors.push(`${file.remotePath}: ${result.error}`);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        errors.push(`${file.remotePath}: ${errorMessage}`);
        results.push({
          success: false,
          localPath: file.localPath,
          remotePath: file.remotePath,
          error: errorMessage
        });
      }
    }

    const duration = Date.now() - startTime;
    const successfulTransfers = results.filter(r => r.success).length;
    const totalSize = results.reduce((sum, r) => sum + (r.size || 0), 0);

    const syncResult: SFTPSyncResult = {
      success: errors.length === 0,
      totalFiles: files.length,
      successfulTransfers,
      failedTransfers: files.length - successfulTransfers,
      totalSize,
      duration,
      errors
    };

    console.log(`📊 批量下载完成: ${successfulTransfers}/${files.length} 成功`); // 保留关键进程监控信息
    log.info('SFTPService', `批量下载完成: ${successfulTransfers}/${files.length} 成功`, { 
      totalSize: this.formatBytes(totalSize), 
      duration 
    });
    this.emit('batchDownloadCompleted', syncResult);

    return syncResult;
  }

  /**
   * 同步目录（上传本地目录到远程）
   */
  async syncDirectoryUp(localDir: string, remoteDir: string, options?: {
    recursive?: boolean;
    excludePatterns?: string[];
  }): Promise<SFTPSyncResult> {
    const opts = {
      recursive: true,
      excludePatterns: ['.git', 'node_modules', '*.log', '.DS_Store'],
      ...options
    };

    this.logMessage('info', `开始同步目录: ${localDir} -> ${remoteDir}`);

    try {
      await this.ensureConnected();

      // 确保远程目录存在
      const remoteExists = await this.client!.directoryExists(remoteDir);
      if (!remoteExists) {
        await this.client!.createDirectory(remoteDir);
      }

      // 收集需要上传的文件
      const filesToUpload = this.collectFiles(localDir, remoteDir, opts.excludePatterns, opts.recursive);
      
      // 批量上传
      return await this.uploadFiles(filesToUpload);

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error('SFTPService', '目录同步失败', { error: errorMessage });
      
      return {
        success: false,
        totalFiles: 0,
        successfulTransfers: 0,
        failedTransfers: 0,
        totalSize: 0,
        duration: 0,
        errors: [errorMessage]
      };
    }
  }

  /**
   * 列出远程目录内容
   */
  async listRemoteDirectory(remotePath: string): Promise<any[]> {
    await this.ensureConnected();
    return await this.client!.listDirectory(remotePath);
  }

  /**
   * 检查远程文件是否存在
   */
  async remoteFileExists(remotePath: string): Promise<boolean> {
    await this.ensureConnected();
    return await this.client!.fileExists(remotePath);
  }

  /**
   * 删除远程文件
   */
  async deleteRemoteFile(remotePath: string): Promise<void> {
    await this.ensureConnected();
    await this.client!.deleteFile(remotePath);
    this.logMessage('info', `删除远程文件: ${remotePath}`);
  }

  /**
   * 创建远程目录
   */
  async createRemoteDirectory(remotePath: string): Promise<void> {
    await this.ensureConnected();
    await this.client!.createDirectory(remotePath);
    this.logMessage('info', `创建远程目录: ${remotePath}`);
  }

  /**
   * 获取服务状态
   */
  getStatus(): {
    connected: boolean;
    reconnectAttempts: number;
    config: SFTPServiceConfig;
  } {
    return {
      connected: this.isConnectionActive(),
      reconnectAttempts: this.reconnectAttempts,
      config: this.config
    };
  }

  /**
   * 更新动态令牌
   */
  updateDynamicToken(token: string): void {
    this.config.password = token;
    log.info('SFTPService', '动态令牌已更新');
    this.emit('tokenUpdated', token);
  }

  /**
   * 确保连接可用
   */
  private async ensureConnected(): Promise<void> {
    if (!this.isConnectionActive()) {
      if (this.config.autoReconnect) {
        await this.connect();
      } else {
        throw new Error('SFTP未连接，请先调用connect()方法');
      }
    }
  }

  /**
   * 安排重连
   */
  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.config.maxReconnectAttempts!) {
      log.error('SFTPService', `达到最大重连次数，停止重连`, { maxAttempts: this.config.maxReconnectAttempts });
      this.emit('maxReconnectAttemptsReached');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.config.reconnectDelay! * this.reconnectAttempts;

    this.logMessage('info', `${delay}ms 后尝试第 ${this.reconnectAttempts} 次重连...`);

    this.reconnectTimer = setTimeout(async () => {
      try {
        await this.connect();
      } catch (error) {
        log.error('SFTPService', '重连失败', { error: error instanceof Error ? error.message : String(error) });
      }
    }, delay);
  }

  /**
   * 收集需要传输的文件
   */
  private collectFiles(
    localDir: string, 
    remoteDir: string, 
    excludePatterns: string[], 
    recursive: boolean
  ): Array<{ localPath: string; remotePath: string }> {
    const files: Array<{ localPath: string; remotePath: string }> = [];
    
    const collectFromDir = (currentLocalDir: string, currentRemoteDir: string) => {
      const items = fs.readdirSync(currentLocalDir);
      
      for (const item of items) {
        // 检查是否应该排除
        if (excludePatterns.some(pattern => {
          if (pattern.includes('*')) {
            const regex = new RegExp(pattern.replace(/\*/g, '.*'));
            return regex.test(item);
          }
          return item === pattern;
        })) {
          continue;
        }

        const localItemPath = path.join(currentLocalDir, item);
        const remoteItemPath = path.posix.join(currentRemoteDir, item);
        const stats = fs.statSync(localItemPath);

        if (stats.isFile()) {
          files.push({
            localPath: localItemPath,
            remotePath: remoteItemPath
          });
        } else if (stats.isDirectory() && recursive) {
          collectFromDir(localItemPath, remoteItemPath);
        }
      }
    };

    collectFromDir(localDir, remoteDir);
    return files;
  }

  /**
   * 格式化字节大小
   */
  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  /**
   * 日志记录
   */
  private logMessage(level: 'debug' | 'info' | 'warn' | 'error', message: string, data?: any): void {
    if (!this.config.enableLogging) return;

    const levels = { debug: 0, info: 1, warn: 2, error: 3 };
    const configLevel = levels[this.config.logLevel!];
    const messageLevel = levels[level];

    if (messageLevel >= configLevel) {
      switch (level) {
        case 'debug':
          log.debug('SFTPService', message, data);
          break;
        case 'info':
          log.info('SFTPService', message, data);
          break;
        case 'warn':
          log.warn('SFTPService', message, data);
          break;
        case 'error':
          log.error('SFTPService', message, data);
          break;
      }
    }
  }
}

/**
 * SFTP服务工厂
 */
export class SFTPServiceFactory {
  /**
   * 创建SFTP服务实例
   */
  static async createService(config: SFTPServiceConfig): Promise<SFTPService> {
    // 检查系统环境
    const envTest = await SFTPClientFactory.testEnvironment();
    
    if (!envTest.ssh2Supported) {
      throw new Error('系统不支持SSH2模块，请安装: npm install ssh2');
    }

    return new SFTPService(config);
  }

  /**
   * 创建并连接SFTP服务
   */
  static async createAndConnect(config: SFTPServiceConfig): Promise<SFTPService> {
    const service = await SFTPServiceFactory.createService(config);
    await service.connect();
    return service;
  }
}