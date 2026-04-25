import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

/**
 * 文件块信息
 */
export interface FileChunk {
  /** 块索引 */
  index: number;
  /** 块大小 */
  size: number;
  /** 块偏移量 */
  offset: number;
  /** 块校验和 */
  checksum: string;
  /** 是否已传输 */
  transferred: boolean;
}

/**
 * 大文件传输配置
 */
export interface LargeFileConfig {
  /** 块大小 (字节) */
  chunkSize: number;
  /** 并发传输数 */
  maxConcurrency: number;
  /** 大文件阈值 (字节) */
  largeFileThreshold: number;
  /** 启用压缩 */
  enableCompression: boolean;
  /** 压缩级别 (1-9) */
  compressionLevel: number;
  /** 临时目录 */
  tempDir: string;
  /** 重试次数 */
  maxRetries: number;
}

/**
 * 传输进度信息
 */
export interface TransferProgress {
  /** 文件路径 */
  filePath: string;
  /** 总大小 */
  totalSize: number;
  /** 已传输大小 */
  transferredSize: number;
  /** 传输进度 (0-1) */
  progress: number;
  /** 传输速度 (字节/秒) */
  speed: number;
  /** 剩余时间 (毫秒) */
  remainingTime: number;
  /** 已完成块数 */
  completedChunks: number;
  /** 总块数 */
  totalChunks: number;
}

/**
 * 大文件处理器
 * 优化大文件的上传和下载，支持分块传输、断点续传和并发处理
 */
export class LargeFileHandler extends EventEmitter {
  private config: LargeFileConfig;
  private activeTransfers: Map<string, TransferProgress> = new Map();
  private chunkCache: Map<string, FileChunk[]> = new Map();

  constructor(config?: Partial<LargeFileConfig>) {
    super();
    
    this.config = {
      chunkSize: 1024 * 1024 * 100, // 100MB
      maxConcurrency: 3,
      largeFileThreshold: 100 * 1024 * 1024, // 100MB
      enableCompression: false, // 禁用压缩，避免文件损坏
      compressionLevel: 6,
      tempDir: path.join(process.cwd(), '.temp'),
      maxRetries: 3,
      ...config
    };

    this.ensureTempDir();
  }

  /**
   * 检查是否为大文件
   */
  isLargeFile(filePath: string): boolean {
    try {
      const stats = fs.statSync(filePath);
      return stats.size >= this.config.largeFileThreshold;
    } catch {
      return false;
    }
  }

  /**
   * 分析文件并创建块信息
   */
  async analyzeFile(filePath: string): Promise<FileChunk[]> {
    const cacheKey = `${filePath}:${fs.statSync(filePath).mtime.getTime()}`;
    
    // 检查缓存
    if (this.chunkCache.has(cacheKey)) {
      return this.chunkCache.get(cacheKey)!;
    }

    const fileSize = fs.statSync(filePath).size;
    const chunks: FileChunk[] = [];
    const totalChunks = Math.ceil(fileSize / this.config.chunkSize);

    for (let i = 0; i < totalChunks; i++) {
      const offset = i * this.config.chunkSize;
      const size = Math.min(this.config.chunkSize, fileSize - offset);
      
      // 计算块校验和
      const checksum = await this.calculateChunkChecksum(filePath, offset, size);
      
      chunks.push({
        index: i,
        size,
        offset,
        checksum,
        transferred: false
      });
    }

    // 缓存块信息
    this.chunkCache.set(cacheKey, chunks);
    
    return chunks;
  }

  /**
   * 优化文件上传
   */
  async optimizedUpload(
    filePath: string,
    uploadFunction: (chunk: Buffer, chunkIndex: number) => Promise<void>,
    options?: {
      onProgress?: (progress: TransferProgress) => void;
      resumeFrom?: number;
    }
  ): Promise<void> {
    const fileSize = fs.statSync(filePath).size;
    
    // 小文件直接上传
    if (!this.isLargeFile(filePath)) {
      const data = fs.readFileSync(filePath);
      await uploadFunction(data, 0);
      return;
    }

    // 大文件分块上传
    const chunks = await this.analyzeFile(filePath);
    const transferId = this.generateTransferId(filePath);
    
    // 初始化传输进度
    const progress: TransferProgress = {
      filePath,
      totalSize: fileSize,
      transferredSize: options?.resumeFrom || 0,
      progress: (options?.resumeFrom || 0) / fileSize,
      speed: 0,
      remainingTime: 0,
      completedChunks: 0,
      totalChunks: chunks.length
    };

    this.activeTransfers.set(transferId, progress);
    
    try {
      await this.uploadChunks(filePath, chunks, uploadFunction, transferId, options);
      this.emit('uploadCompleted', { filePath, transferId });
    } catch (error) {
      this.emit('uploadFailed', { filePath, transferId, error });
      throw error;
    } finally {
      this.activeTransfers.delete(transferId);
    }
  }

  /**
   * 优化文件下载
   */
  async optimizedDownload(
    remotePath: string,
    localPath: string,
    downloadFunction: (chunkIndex: number) => Promise<Buffer>,
    totalSize: number,
    options?: {
      onProgress?: (progress: TransferProgress) => void;
      resumeFrom?: number;
    }
  ): Promise<void> {
    // 小文件直接下载
    if (totalSize < this.config.largeFileThreshold) {
      const data = await downloadFunction(0);
      fs.writeFileSync(localPath, data);
      return;
    }

    // 大文件分块下载
    const transferId = this.generateTransferId(localPath);
    const totalChunks = Math.ceil(totalSize / this.config.chunkSize);
    
    // 初始化传输进度
    const progress: TransferProgress = {
      filePath: localPath,
      totalSize,
      transferredSize: options?.resumeFrom || 0,
      progress: (options?.resumeFrom || 0) / totalSize,
      speed: 0,
      remainingTime: 0,
      completedChunks: 0,
      totalChunks
    };

    this.activeTransfers.set(transferId, progress);
    
    try {
      await this.downloadChunks(remotePath, localPath, downloadFunction, totalChunks, transferId, options);
      this.emit('downloadCompleted', { localPath, transferId });
    } catch (error) {
      this.emit('downloadFailed', { localPath, transferId, error });
      throw error;
    } finally {
      this.activeTransfers.delete(transferId);
    }
  }

  /**
   * 获取传输进度
   */
  getTransferProgress(transferId: string): TransferProgress | undefined {
    return this.activeTransfers.get(transferId);
  }

  /**
   * 获取所有活跃传输
   */
  getActiveTransfers(): Map<string, TransferProgress> {
    return new Map(this.activeTransfers);
  }

  /**
   * 取消传输
   */
  cancelTransfer(transferId: string): boolean {
    if (this.activeTransfers.has(transferId)) {
      this.activeTransfers.delete(transferId);
      this.emit('transferCancelled', { transferId });
      return true;
    }
    return false;
  }

  /**
   * 清理临时文件
   */
  async cleanup(): Promise<void> {
    try {
      if (fs.existsSync(this.config.tempDir)) {
        const files = fs.readdirSync(this.config.tempDir);
        for (const file of files) {
          const filePath = path.join(this.config.tempDir, file);
          fs.unlinkSync(filePath);
        }
      }
      this.emit('cleanupCompleted');
    } catch (error) {
      this.emit('cleanupFailed', error);
    }
  }

  /**
   * 上传文件块
   */
  private async uploadChunks(
    filePath: string,
    chunks: FileChunk[],
    uploadFunction: (chunk: Buffer, chunkIndex: number) => Promise<void>,
    transferId: string,
    options?: {
      onProgress?: (progress: TransferProgress) => void;
      resumeFrom?: number;
    }
  ): Promise<void> {
    const startTime = Date.now();
    let completedSize = options?.resumeFrom || 0;
    
    // 创建并发控制
    const uploadPromises: Promise<void>[] = [];

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      
      // 如果是断点续传，跳过已完成的块
      if (completedSize > chunk.offset) {
        chunk.transferred = true;
        continue;
      }

      const uploadPromise = this.uploadSingleChunk(
        filePath,
        chunk,
        uploadFunction,
        transferId,
        startTime,
        options?.onProgress
      );

      uploadPromises.push(uploadPromise);

      // 控制并发数
      if (uploadPromises.length >= this.config.maxConcurrency) {
        await Promise.race(uploadPromises);
        // 移除已完成的Promise
        for (let j = uploadPromises.length - 1; j >= 0; j--) {
          if (await this.isPromiseResolved(uploadPromises[j])) {
            uploadPromises.splice(j, 1);
          }
        }
      }
    }

    // 等待所有上传完成
    await Promise.all(uploadPromises);
  }

  /**
   * 下载文件块
   */
  private async downloadChunks(
    remotePath: string,
    localPath: string,
    downloadFunction: (chunkIndex: number) => Promise<Buffer>,
    totalChunks: number,
    transferId: string,
    options?: {
      onProgress?: (progress: TransferProgress) => void;
      resumeFrom?: number;
    }
  ): Promise<void> {
    const startTime = Date.now();
    const tempFile = path.join(this.config.tempDir, `${path.basename(localPath)}.tmp`);
    
    // 创建临时文件
    const writeStream = fs.createWriteStream(tempFile);
    
    try {
      // 创建并发控制
      const downloadPromises: Promise<void>[] = [];

      for (let i = 0; i < totalChunks; i++) {
        const downloadPromise = this.downloadSingleChunk(
          i,
          downloadFunction,
          writeStream,
          transferId,
          startTime,
          options?.onProgress
        );

        downloadPromises.push(downloadPromise);

        // 控制并发数
        if (downloadPromises.length >= this.config.maxConcurrency) {
          await Promise.race(downloadPromises);
          // 移除已完成的Promise
          for (let j = downloadPromises.length - 1; j >= 0; j--) {
            if (await this.isPromiseResolved(downloadPromises[j])) {
              downloadPromises.splice(j, 1);
            }
          }
        }
      }

      // 等待所有下载完成
      await Promise.all(downloadPromises);
      
      // 关闭写入流
      writeStream.end();
      
      // 移动临时文件到目标位置
      fs.renameSync(tempFile, localPath);
      
    } catch (error) {
      writeStream.destroy();
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
      throw error;
    }
  }

  /**
   * 上传单个文件块
   */
  private async uploadSingleChunk(
    filePath: string,
    chunk: FileChunk,
    uploadFunction: (chunk: Buffer, chunkIndex: number) => Promise<void>,
    transferId: string,
    startTime: number,
    onProgress?: (progress: TransferProgress) => void
  ): Promise<void> {
    let retries = 0;
    
    while (retries <= this.config.maxRetries) {
      try {
        // 读取文件块
        const buffer = Buffer.alloc(chunk.size);
        const fd = fs.openSync(filePath, 'r');
        fs.readSync(fd, buffer, 0, chunk.size, chunk.offset);
        fs.closeSync(fd);

        // 验证校验和
        const actualChecksum = crypto.createHash('sha256').update(buffer).digest('hex');
        if (actualChecksum !== chunk.checksum) {
          throw new Error(`Chunk checksum mismatch for chunk ${chunk.index}`);
        }

        // 上传块
        await uploadFunction(buffer, chunk.index);
        
        chunk.transferred = true;
        
        // 更新进度
        this.updateProgress(transferId, chunk.size, startTime, onProgress);
        
        break;
        
      } catch (error) {
        retries++;
        if (retries > this.config.maxRetries) {
          throw error;
        }
        
        // 等待重试
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, retries) * 1000));
      }
    }
  }

  /**
   * 下载单个文件块
   */
  private async downloadSingleChunk(
    chunkIndex: number,
    downloadFunction: (chunkIndex: number) => Promise<Buffer>,
    writeStream: fs.WriteStream,
    transferId: string,
    startTime: number,
    onProgress?: (progress: TransferProgress) => void
  ): Promise<void> {
    let retries = 0;
    
    while (retries <= this.config.maxRetries) {
      try {
        // 下载块
        const data = await downloadFunction(chunkIndex);
        
        // 写入文件
        writeStream.write(data, () => {
          // 更新进度
          this.updateProgress(transferId, data.length, startTime, onProgress);
        });
        
        break;
        
      } catch (error) {
        retries++;
        if (retries > this.config.maxRetries) {
          throw error;
        }
        
        // 等待重试
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, retries) * 1000));
      }
    }
  }

  /**
   * 更新传输进度
   */
  private updateProgress(
    transferId: string,
    chunkSize: number,
    startTime: number,
    onProgress?: (progress: TransferProgress) => void
  ): void {
    const progress = this.activeTransfers.get(transferId);
    if (!progress) return;

    progress.transferredSize += chunkSize;
    progress.completedChunks++;
    progress.progress = progress.transferredSize / progress.totalSize;
    
    // 计算传输速度
    const elapsed = Date.now() - startTime;
    progress.speed = elapsed > 0 ? (progress.transferredSize / elapsed) * 1000 : 0;
    
    // 计算剩余时间
    const remainingSize = progress.totalSize - progress.transferredSize;
    progress.remainingTime = progress.speed > 0 ? (remainingSize / progress.speed) * 1000 : 0;

    this.emit('progressUpdated', progress);
    
    if (onProgress) {
      onProgress(progress);
    }
  }

  /**
   * 计算文件块校验和
   */
  private async calculateChunkChecksum(filePath: string, offset: number, size: number): Promise<string> {
    const buffer = Buffer.alloc(size);
    const fd = fs.openSync(filePath, 'r');
    fs.readSync(fd, buffer, 0, size, offset);
    fs.closeSync(fd);
    
    return crypto.createHash('sha256').update(buffer).digest('hex');
  }

  /**
   * 压缩数据（已禁用）
   */
  private async compressData(data: Buffer): Promise<Buffer> {
    // 压缩功能已禁用，直接返回原数据
    return data;
  }

  /**
   * 解压缩数据（已禁用）
   */
  private async decompressData(data: Buffer): Promise<Buffer> {
    // 压缩功能已禁用，直接返回原数据
    return data;
  }

  /**
   * 生成传输ID
   */
  private generateTransferId(filePath: string): string {
    return crypto.createHash('md5').update(`${filePath}:${Date.now()}`).digest('hex');
  }

  /**
   * 检查Promise是否已解决
   */
  private async isPromiseResolved(promise: Promise<any>): Promise<boolean> {
    try {
      await Promise.race([promise, new Promise(resolve => setTimeout(resolve, 0))]);
      return true;
    } catch {
      return true; // 即使失败也算已解决
    }
  }

  /**
   * 确保临时目录存在
   */
  private ensureTempDir(): void {
    if (!fs.existsSync(this.config.tempDir)) {
      fs.mkdirSync(this.config.tempDir, { recursive: true });
    }
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<LargeFileConfig>): void {
    this.config = { ...this.config, ...config };
    this.ensureTempDir();
    this.emit('configUpdated', this.config);
  }

  /**
   * 销毁处理器
   */
  destroy(): void {
    this.activeTransfers.clear();
    this.chunkCache.clear();
    this.removeAllListeners();
  }
}
