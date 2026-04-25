import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { EventEmitter } from 'events';

/**
 * 缓存项元数据
 */
export interface CacheMetadata {
  key: string;
  size: number;
  createdAt: Date;
  lastAccessed: Date;
  expiresAt?: Date;
  checksum: string;
  tags?: string[];
}

/**
 * 缓存配置
 */
export interface CacheConfig {
  cacheDir: string;
  maxSize: number; // 最大缓存大小（字节）
  maxAge: number; // 最大缓存时间（毫秒）
  cleanupInterval: number; // 清理间隔（毫秒）
  compressionEnabled: boolean;
}

/**
 * 缓存统计信息
 */
export interface CacheStats {
  totalItems: number;
  totalSize: number;
  hitRate: number;
  missRate: number;
  oldestItem?: Date;
  newestItem?: Date;
}

/**
 * 本地缓存管理器
 * 提供文件级别的本地缓存功能，支持过期策略和容量管理
 */
export class LocalCacheManager extends EventEmitter {
  private config: CacheConfig;
  private metadata: Map<string, CacheMetadata> = new Map();
  private metadataFile: string;
  private cleanupTimer: NodeJS.Timeout | null = null;
  private stats = {
    hits: 0,
    misses: 0
  };

  constructor(config: Partial<CacheConfig>) {
    super();
    
    this.config = {
      cacheDir: path.join(process.cwd(), '.cache'),
      maxSize: 100 * 1024 * 1024, // 100MB
      maxAge: 24 * 60 * 60 * 1000, // 24小时
      cleanupInterval: 60 * 60 * 1000, // 1小时
      compressionEnabled: false, // 禁用压缩
      ...config
    };

    this.metadataFile = path.join(this.config.cacheDir, 'metadata.json');
    this.initializeCache();
  }

  /**
   * 初始化缓存
   */
  private async initializeCache(): Promise<void> {
    try {
      // 确保缓存目录存在
      if (!fs.existsSync(this.config.cacheDir)) {
        fs.mkdirSync(this.config.cacheDir, { recursive: true });
      }

      // 加载元数据
      await this.loadMetadata();

      // 启动清理任务
      this.startCleanupTask();

      this.emit('initialized');
    } catch (error) {
      this.emit('error', error);
    }
  }

  /**
   * 存储数据到缓存
   */
  async set(key: string, data: Buffer, options?: {
    ttl?: number;
    tags?: string[];
  }): Promise<void> {
    try {
      const filePath = this.getFilePath(key);
      const checksum = this.calculateChecksum(data);
      const now = new Date();
      
      // 写入文件（禁用压缩）
      fs.writeFileSync(filePath, data);

      // 更新元数据
      const metadata: CacheMetadata = {
        key,
        size: data.length,
        createdAt: now,
        lastAccessed: now,
        checksum,
        tags: options?.tags
      };

      if (options?.ttl) {
        metadata.expiresAt = new Date(now.getTime() + options.ttl);
      } else if (this.config.maxAge > 0) {
        metadata.expiresAt = new Date(now.getTime() + this.config.maxAge);
      }

      this.metadata.set(key, metadata);
      await this.saveMetadata();

      // 检查缓存大小限制
      await this.enforceSize();

      this.emit('itemStored', { key, size: data.length });
    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * 从缓存获取数据
   */
  async get(key: string): Promise<Buffer | null> {
    try {
      const metadata = this.metadata.get(key);
      
      if (!metadata) {
        this.stats.misses++;
        return null;
      }

      // 检查是否过期
      if (metadata.expiresAt && metadata.expiresAt < new Date()) {
        await this.delete(key);
        this.stats.misses++;
        return null;
      }

      const filePath = this.getFilePath(key);
      
      if (!fs.existsSync(filePath)) {
        // 文件不存在，清理元数据
        this.metadata.delete(key);
        await this.saveMetadata();
        this.stats.misses++;
        return null;
      }

      let data = fs.readFileSync(filePath);

      // 解压缩（已禁用）
      // data = data; // 无需解压缩

      // 验证校验和
      const checksum = this.calculateChecksum(data);
      if (checksum !== metadata.checksum) {
        // 数据损坏，删除缓存项
        await this.delete(key);
        this.stats.misses++;
        this.emit('dataCorrupted', { key });
        return null;
      }

      // 更新访问时间
      metadata.lastAccessed = new Date();
      await this.saveMetadata();

      this.stats.hits++;
      this.emit('itemRetrieved', { key, size: data.length });
      
      return data;
    } catch (error) {
      this.stats.misses++;
      this.emit('error', error);
      return null;
    }
  }

  /**
   * 检查缓存项是否存在
   */
  has(key: string): boolean {
    const metadata = this.metadata.get(key);
    
    if (!metadata) {
      return false;
    }

    // 检查是否过期
    if (metadata.expiresAt && metadata.expiresAt < new Date()) {
      this.delete(key); // 异步删除过期项
      return false;
    }

    return fs.existsSync(this.getFilePath(key));
  }

  /**
   * 删除缓存项
   */
  async delete(key: string): Promise<boolean> {
    try {
      const metadata = this.metadata.get(key);
      const filePath = this.getFilePath(key);

      // 删除文件
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }

      // 删除元数据
      const deleted = this.metadata.delete(key);
      await this.saveMetadata();

      if (deleted && metadata) {
        this.emit('itemDeleted', { key, size: metadata.size });
      }

      return deleted;
    } catch (error) {
      this.emit('error', error);
      return false;
    }
  }

  /**
   * 清空所有缓存
   */
  async clear(): Promise<void> {
    try {
      // 删除所有缓存文件
      for (const key of this.metadata.keys()) {
        const filePath = this.getFilePath(key);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      }

      // 清空元数据
      this.metadata.clear();
      await this.saveMetadata();

      // 重置统计
      this.stats.hits = 0;
      this.stats.misses = 0;

      this.emit('cacheCleared');
    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * 根据标签删除缓存项
   */
  async deleteByTag(tag: string): Promise<number> {
    let deletedCount = 0;
    
    for (const [key, metadata] of this.metadata.entries()) {
      if (metadata.tags && metadata.tags.includes(tag)) {
        if (await this.delete(key)) {
          deletedCount++;
        }
      }
    }

    return deletedCount;
  }

  /**
   * 获取缓存统计信息
   */
  getStats(): CacheStats {
    const items = Array.from(this.metadata.values());
    const totalRequests = this.stats.hits + this.stats.misses;
    
    return {
      totalItems: items.length,
      totalSize: items.reduce((sum, item) => sum + item.size, 0),
      hitRate: totalRequests > 0 ? this.stats.hits / totalRequests : 0,
      missRate: totalRequests > 0 ? this.stats.misses / totalRequests : 0,
      oldestItem: items.length > 0 ? new Date(Math.min(...items.map(item => item.createdAt.getTime()))) : undefined,
      newestItem: items.length > 0 ? new Date(Math.max(...items.map(item => item.createdAt.getTime()))) : undefined
    };
  }

  /**
   * 获取所有缓存键
   */
  keys(): string[] {
    return Array.from(this.metadata.keys());
  }

  /**
   * 获取缓存项元数据
   */
  getMetadata(key: string): CacheMetadata | undefined {
    return this.metadata.get(key);
  }

  /**
   * 执行缓存清理
   */
  async cleanup(): Promise<void> {
    const now = new Date();
    const keysToDelete: string[] = [];

    // 查找过期项
    for (const [key, metadata] of this.metadata.entries()) {
      if (metadata.expiresAt && metadata.expiresAt < now) {
        keysToDelete.push(key);
      }
    }

    // 删除过期项
    for (const key of keysToDelete) {
      await this.delete(key);
    }

    // 强制执行大小限制
    await this.enforceSize();

    this.emit('cleanupCompleted', { deletedItems: keysToDelete.length });
  }

  /**
   * 强制执行缓存大小限制
   */
  private async enforceSize(): Promise<void> {
    const stats = this.getStats();
    
    if (stats.totalSize <= this.config.maxSize) {
      return;
    }

    // 按最后访问时间排序，删除最旧的项
    const sortedItems = Array.from(this.metadata.entries())
      .sort(([, a], [, b]) => a.lastAccessed.getTime() - b.lastAccessed.getTime());

    let currentSize = stats.totalSize;
    const targetSize = this.config.maxSize * 0.8; // 删除到80%容量

    for (const [key, metadata] of sortedItems) {
      if (currentSize <= targetSize) {
        break;
      }

      await this.delete(key);
      currentSize -= metadata.size;
    }
  }

  /**
   * 启动清理任务
   */
  private startCleanupTask(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }

    this.cleanupTimer = setInterval(() => {
      this.cleanup().catch(error => this.emit('error', error));
    }, this.config.cleanupInterval);
  }

  /**
   * 停止清理任务
   */
  private stopCleanupTask(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /**
   * 获取文件路径
   */
  private getFilePath(key: string): string {
    const hash = crypto.createHash('sha256').update(key).digest('hex');
    return path.join(this.config.cacheDir, `${hash}.cache`);
  }

  /**
   * 计算数据校验和
   */
  private calculateChecksum(data: Buffer): string {
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  /**
   * 加载元数据
   */
  private async loadMetadata(): Promise<void> {
    try {
      if (fs.existsSync(this.metadataFile)) {
        const data = fs.readFileSync(this.metadataFile, 'utf8');
        const parsed = JSON.parse(data);
        
        // 转换日期字符串回Date对象
        for (const [key, metadata] of Object.entries(parsed)) {
          const meta = metadata as any;
          this.metadata.set(key, {
            ...meta,
            createdAt: new Date(meta.createdAt),
            lastAccessed: new Date(meta.lastAccessed),
            expiresAt: meta.expiresAt ? new Date(meta.expiresAt) : undefined
          });
        }
      }
    } catch (error) {
      // 如果元数据文件损坏，重新开始
      this.metadata.clear();
    }
  }

  /**
   * 保存元数据
   */
  private async saveMetadata(): Promise<void> {
    try {
      const data = Object.fromEntries(this.metadata.entries());
      fs.writeFileSync(this.metadataFile, JSON.stringify(data, null, 2));
    } catch (error) {
      this.emit('error', error);
    }
  }

  /**
   * 销毁缓存管理器
   */
  destroy(): void {
    this.stopCleanupTask();
    this.removeAllListeners();
  }
}