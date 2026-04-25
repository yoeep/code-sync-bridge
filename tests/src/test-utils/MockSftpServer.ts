import * as fs from 'fs/promises';
import * as path from 'path';
import { EventEmitter } from 'events';

/**
 * 模拟SFTP服务器，用于测试网络异常场景
 */
export class MockSftpServer extends EventEmitter {
  private baseDir: string;
  private isConnected: boolean = false;
  private shouldFailConnection: boolean = false;
  private shouldFailUpload: boolean = false;
  private shouldFailDownload: boolean = false;
  private connectionDelay: number = 0;
  private uploadDelay: number = 0;
  private downloadDelay: number = 0;

  constructor(baseDir: string) {
    super();
    this.baseDir = baseDir;
  }

  /**
   * 模拟连接到SFTP服务器
   */
  async connect(config: any): Promise<void> {
    if (this.shouldFailConnection) {
      throw new Error('Mock SFTP connection failed');
    }

    if (this.connectionDelay > 0) {
      await this.delay(this.connectionDelay);
    }

    this.isConnected = true;
    this.emit('connect');
  }

  /**
   * 模拟断开连接
   */
  async end(): Promise<void> {
    this.isConnected = false;
    this.emit('disconnect');
  }

  /**
   * 模拟上传文件
   */
  async put(localPath: string, remotePath: string): Promise<void> {
    if (!this.isConnected) {
      throw new Error('Not connected to SFTP server');
    }

    if (this.shouldFailUpload) {
      throw new Error('Mock SFTP upload failed');
    }

    if (this.uploadDelay > 0) {
      await this.delay(this.uploadDelay);
    }

    const fullRemotePath = path.join(this.baseDir, remotePath);
    await fs.mkdir(path.dirname(fullRemotePath), { recursive: true });
    await fs.copyFile(localPath, fullRemotePath);

    this.emit('upload', { localPath, remotePath });
  }

  /**
   * 模拟下载文件
   */
  async get(remotePath: string, localPath: string): Promise<void> {
    if (!this.isConnected) {
      throw new Error('Not connected to SFTP server');
    }

    if (this.shouldFailDownload) {
      throw new Error('Mock SFTP download failed');
    }

    if (this.downloadDelay > 0) {
      await this.delay(this.downloadDelay);
    }

    const fullRemotePath = path.join(this.baseDir, remotePath);
    await fs.mkdir(path.dirname(localPath), { recursive: true });
    await fs.copyFile(fullRemotePath, localPath);

    this.emit('download', { remotePath, localPath });
  }

  /**
   * 模拟列出目录内容
   */
  async list(remotePath: string): Promise<any[]> {
    if (!this.isConnected) {
      throw new Error('Not connected to SFTP server');
    }

    const fullRemotePath = path.join(this.baseDir, remotePath);
    
    try {
      const entries = await fs.readdir(fullRemotePath, { withFileTypes: true });
      return entries.map(entry => ({
        name: entry.name,
        type: entry.isDirectory() ? 'd' : '-',
        size: 0,
        modifyTime: Date.now(),
      }));
    } catch (error) {
      return [];
    }
  }

  /**
   * 模拟创建目录
   */
  async mkdir(remotePath: string): Promise<void> {
    if (!this.isConnected) {
      throw new Error('Not connected to SFTP server');
    }

    const fullRemotePath = path.join(this.baseDir, remotePath);
    await fs.mkdir(fullRemotePath, { recursive: true });
  }

  /**
   * 模拟删除文件
   */
  async delete(remotePath: string): Promise<void> {
    if (!this.isConnected) {
      throw new Error('Not connected to SFTP server');
    }

    const fullRemotePath = path.join(this.baseDir, remotePath);
    await fs.unlink(fullRemotePath);
  }

  /**
   * 设置连接失败模式
   */
  setConnectionFailure(shouldFail: boolean): void {
    this.shouldFailConnection = shouldFail;
  }

  /**
   * 设置上传失败模式
   */
  setUploadFailure(shouldFail: boolean): void {
    this.shouldFailUpload = shouldFail;
  }

  /**
   * 设置下载失败模式
   */
  setDownloadFailure(shouldFail: boolean): void {
    this.shouldFailDownload = shouldFail;
  }

  /**
   * 设置连接延迟
   */
  setConnectionDelay(delay: number): void {
    this.connectionDelay = delay;
  }

  /**
   * 设置上传延迟
   */
  setUploadDelay(delay: number): void {
    this.uploadDelay = delay;
  }

  /**
   * 设置下载延迟
   */
  setDownloadDelay(delay: number): void {
    this.downloadDelay = delay;
  }

  /**
   * 检查是否已连接
   */
  isConnectedToServer(): boolean {
    return this.isConnected;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}