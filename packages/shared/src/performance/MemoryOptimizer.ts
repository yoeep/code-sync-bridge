import { EventEmitter } from 'events';

/**
 * 内存池配置
 */
export interface MemoryPoolConfig {
  /** 初始池大小 */
  initialSize: number;
  /** 最大池大小 */
  maxSize: number;
  /** 块大小 */
  blockSize: number;
  /** 自动清理间隔 (毫秒) */
  cleanupInterval: number;
  /** 内存使用阈值 */
  memoryThreshold: number;
}

/**
 * 内存使用统计
 */
export interface MemoryStats {
  /** 总分配内存 */
  totalAllocated: number;
  /** 已使用内存 */
  usedMemory: number;
  /** 可用内存 */
  availableMemory: number;
  /** 池中块数量 */
  poolSize: number;
  /** 活跃块数量 */
  activeBlocks: number;
  /** 内存使用率 */
  utilizationRate: number;
}

/**
 * 内存块
 */
class MemoryBlock {
  public buffer: Buffer;
  public inUse: boolean = false;
  public lastUsed: Date = new Date();
  public size: number;

  constructor(size: number) {
    this.buffer = Buffer.alloc(size);
    this.size = size;
  }

  /**
   * 标记为使用中
   */
  markInUse(): void {
    this.inUse = true;
    this.lastUsed = new Date();
  }

  /**
   * 标记为可用
   */
  markAvailable(): void {
    this.inUse = false;
    // 清零缓冲区以释放引用
    this.buffer.fill(0);
  }

  /**
   * 获取使用时长
   */
  getUsageDuration(): number {
    return Date.now() - this.lastUsed.getTime();
  }
}

/**
 * 内存优化器
 * 提供内存池管理、垃圾回收优化和内存使用监控
 */
export class MemoryOptimizer extends EventEmitter {
  private config: MemoryPoolConfig;
  private memoryPool: MemoryBlock[] = [];
  private activeBlocks: Set<MemoryBlock> = new Set();
  private cleanupTimer: NodeJS.Timeout | null = null;
  private gcTimer: NodeJS.Timeout | null = null;
  private isOptimizing: boolean = false;

  constructor(config?: Partial<MemoryPoolConfig>) {
    super();
    
    this.config = {
      initialSize: 10,
      maxSize: 100,
      blockSize: 1024 * 1024, // 1MB
      cleanupInterval: 30000, // 30秒
      memoryThreshold: 0.8, // 80%
      ...config
    };

    this.initializePool();
    this.startOptimization();
  }

  /**
   * 获取内存块
   */
  getMemoryBlock(size?: number): Buffer {
    const requestedSize = size || this.config.blockSize;
    
    // 尝试从池中获取合适的块
    const availableBlock = this.findAvailableBlock(requestedSize);
    
    if (availableBlock) {
      availableBlock.markInUse();
      this.activeBlocks.add(availableBlock);
      this.emit('blockAllocated', { size: availableBlock.size, fromPool: true });
      
      // 如果请求的大小小于块大小，返回切片
      if (requestedSize < availableBlock.size) {
        return availableBlock.buffer.subarray(0, requestedSize);
      }
      
      return availableBlock.buffer;
    }

    // 池中没有合适的块，创建新块
    if (this.memoryPool.length < this.config.maxSize) {
      const newBlock = new MemoryBlock(Math.max(requestedSize, this.config.blockSize));
      newBlock.markInUse();
      
      this.memoryPool.push(newBlock);
      this.activeBlocks.add(newBlock);
      
      this.emit('blockAllocated', { size: newBlock.size, fromPool: false });
      
      if (requestedSize < newBlock.size) {
        return newBlock.buffer.subarray(0, requestedSize);
      }
      
      return newBlock.buffer;
    }

    // 池已满，直接分配内存（不进入池管理）
    this.emit('poolExhausted', { requestedSize });
    return Buffer.alloc(requestedSize);
  }

  /**
   * 释放内存块
   */
  releaseMemoryBlock(buffer: Buffer): void {
    // 查找对应的内存块
    const block = this.findBlockByBuffer(buffer);
    
    if (block) {
      block.markAvailable();
      this.activeBlocks.delete(block);
      this.emit('blockReleased', { size: block.size });
    }
  }

  /**
   * 强制垃圾回收
   */
  forceGarbageCollection(): void {
    if (global.gc) {
      const beforeMemory = process.memoryUsage();
      global.gc();
      const afterMemory = process.memoryUsage();
      
      const freedMemory = beforeMemory.heapUsed - afterMemory.heapUsed;
      this.emit('garbageCollected', { freedMemory, beforeMemory, afterMemory });
    } else {
      this.emit('gcNotAvailable');
    }
  }

  /**
   * 获取内存统计信息
   */
  getMemoryStats(): MemoryStats {
    const totalAllocated = this.memoryPool.reduce((sum, block) => sum + block.size, 0);
    const usedMemory = Array.from(this.activeBlocks).reduce((sum, block) => sum + block.size, 0);
    const availableMemory = totalAllocated - usedMemory;
    
    return {
      totalAllocated,
      usedMemory,
      availableMemory,
      poolSize: this.memoryPool.length,
      activeBlocks: this.activeBlocks.size,
      utilizationRate: totalAllocated > 0 ? usedMemory / totalAllocated : 0
    };
  }

  /**
   * 优化内存使用
   */
  async optimizeMemory(): Promise<void> {
    if (this.isOptimizing) {
      return;
    }

    this.isOptimizing = true;
    
    try {
      // 清理未使用的块
      await this.cleanupUnusedBlocks();
      
      // 检查内存压力
      await this.checkMemoryPressure();
      
      // 整理内存池
      await this.defragmentPool();
      
      this.emit('memoryOptimized', this.getMemoryStats());
      
    } finally {
      this.isOptimizing = false;
    }
  }

  /**
   * 设置内存使用限制
   */
  setMemoryLimit(limitBytes: number): void {
    const currentStats = this.getMemoryStats();
    
    if (currentStats.totalAllocated > limitBytes) {
      // 需要释放一些内存
      this.enforceMemoryLimit(limitBytes);
    }
    
    this.emit('memoryLimitSet', { limit: limitBytes });
  }

  /**
   * 监控内存使用情况
   */
  startMemoryMonitoring(interval: number = 10000): void {
    if (this.gcTimer) {
      clearInterval(this.gcTimer);
    }

    this.gcTimer = setInterval(() => {
      const memoryUsage = process.memoryUsage();
      const stats = this.getMemoryStats();
      
      this.emit('memoryStatus', {
        processMemory: memoryUsage,
        poolStats: stats,
        timestamp: new Date()
      });

      // 检查内存使用是否超过阈值
      const totalMemory = require('os').totalmem();
      const memoryUsageRatio = memoryUsage.rss / totalMemory;
      
      if (memoryUsageRatio > this.config.memoryThreshold) {
        this.emit('memoryPressure', {
          usage: memoryUsageRatio,
          threshold: this.config.memoryThreshold,
          memoryUsage
        });
        
        // 自动优化内存
        this.optimizeMemory();
      }
    }, interval);
  }

  /**
   * 停止内存监控
   */
  stopMemoryMonitoring(): void {
    if (this.gcTimer) {
      clearInterval(this.gcTimer);
      this.gcTimer = null;
    }
  }

  /**
   * 创建内存高效的流处理器
   */
  createStreamProcessor(options?: {
    bufferSize?: number;
    highWaterMark?: number;
  }): {
    process: (data: Buffer) => Promise<Buffer>;
    cleanup: () => void;
  } {
    const bufferSize = options?.bufferSize || this.config.blockSize;
    const processingBuffer = this.getMemoryBlock(bufferSize);
    
    return {
      process: async (data: Buffer): Promise<Buffer> => {
        // 重用缓冲区进行数据处理
        if (data.length <= bufferSize) {
          data.copy(processingBuffer, 0);
          return processingBuffer.subarray(0, data.length);
        } else {
          // 数据太大，需要分块处理
          const result = Buffer.alloc(data.length);
          let offset = 0;
          
          while (offset < data.length) {
            const chunkSize = Math.min(bufferSize, data.length - offset);
            data.copy(processingBuffer, 0, offset, offset + chunkSize);
            processingBuffer.copy(result, offset, 0, chunkSize);
            offset += chunkSize;
          }
          
          return result;
        }
      },
      cleanup: () => {
        this.releaseMemoryBlock(processingBuffer);
      }
    };
  }

  /**
   * 初始化内存池
   */
  private initializePool(): void {
    for (let i = 0; i < this.config.initialSize; i++) {
      const block = new MemoryBlock(this.config.blockSize);
      this.memoryPool.push(block);
    }
    
    this.emit('poolInitialized', { size: this.config.initialSize });
  }

  /**
   * 开始优化任务
   */
  private startOptimization(): void {
    // 定期清理任务
    this.cleanupTimer = setInterval(() => {
      this.optimizeMemory();
    }, this.config.cleanupInterval);

    // 开始内存监控
    this.startMemoryMonitoring();
  }

  /**
   * 查找可用的内存块
   */
  private findAvailableBlock(size: number): MemoryBlock | null {
    return this.memoryPool.find(block => 
      !block.inUse && block.size >= size
    ) || null;
  }

  /**
   * 根据缓冲区查找内存块
   */
  private findBlockByBuffer(buffer: Buffer): MemoryBlock | null {
    return this.memoryPool.find(block => 
      block.buffer === buffer || 
      (buffer.buffer === block.buffer.buffer && 
       buffer.byteOffset >= block.buffer.byteOffset &&
       buffer.byteOffset + buffer.length <= block.buffer.byteOffset + block.buffer.length)
    ) || null;
  }

  /**
   * 清理未使用的块
   */
  private async cleanupUnusedBlocks(): Promise<void> {
    const now = Date.now();
    const unusedThreshold = 5 * 60 * 1000; // 5分钟未使用
    
    const blocksToRemove = this.memoryPool.filter(block => 
      !block.inUse && 
      (now - block.lastUsed.getTime()) > unusedThreshold
    );

    // 保留最小数量的块
    const minBlocks = Math.max(this.config.initialSize, 5);
    const currentActiveBlocks = this.memoryPool.length - blocksToRemove.length;
    
    if (currentActiveBlocks >= minBlocks) {
      const toRemove = Math.min(blocksToRemove.length, currentActiveBlocks - minBlocks);
      
      for (let i = 0; i < toRemove; i++) {
        const block = blocksToRemove[i];
        const index = this.memoryPool.indexOf(block);
        if (index !== -1) {
          this.memoryPool.splice(index, 1);
        }
      }
      
      this.emit('blocksCleanedUp', { removedCount: toRemove });
    }
  }

  /**
   * 检查内存压力
   */
  private async checkMemoryPressure(): Promise<void> {
    const totalMemory = require('os').totalmem();
    const freeMemory = require('os').freemem();
    
    const memoryPressure = (totalMemory - freeMemory) / totalMemory;
    
    if (memoryPressure > this.config.memoryThreshold) {
      // 高内存压力，执行激进清理
      await this.aggressiveCleanup();
      
      // 强制垃圾回收
      this.forceGarbageCollection();
    }
  }

  /**
   * 整理内存池
   */
  private async defragmentPool(): Promise<void> {
    // 按使用频率排序块
    this.memoryPool.sort((a, b) => {
      if (a.inUse && !b.inUse) return -1;
      if (!a.inUse && b.inUse) return 1;
      return b.lastUsed.getTime() - a.lastUsed.getTime();
    });
    
    this.emit('poolDefragmented');
  }

  /**
   * 强制执行内存限制
   */
  private enforceMemoryLimit(limitBytes: number): void {
    const stats = this.getMemoryStats();
    let currentSize = stats.totalAllocated;
    
    // 从最久未使用的块开始释放
    const sortedBlocks = [...this.memoryPool]
      .filter(block => !block.inUse)
      .sort((a, b) => a.lastUsed.getTime() - b.lastUsed.getTime());
    
    for (const block of sortedBlocks) {
      if (currentSize <= limitBytes) {
        break;
      }
      
      const index = this.memoryPool.indexOf(block);
      if (index !== -1) {
        this.memoryPool.splice(index, 1);
        currentSize -= block.size;
      }
    }
    
    this.emit('memoryLimitEnforced', { 
      targetLimit: limitBytes, 
      actualSize: currentSize 
    });
  }

  /**
   * 激进清理
   */
  private async aggressiveCleanup(): Promise<void> {
    // 释放所有未使用的块
    const unusedBlocks = this.memoryPool.filter(block => !block.inUse);
    const minBlocks = 3; // 保留最少3个块
    
    if (unusedBlocks.length > minBlocks) {
      const toRemove = unusedBlocks.slice(minBlocks);
      
      for (const block of toRemove) {
        const index = this.memoryPool.indexOf(block);
        if (index !== -1) {
          this.memoryPool.splice(index, 1);
        }
      }
      
      this.emit('aggressiveCleanup', { removedBlocks: toRemove.length });
    }
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<MemoryPoolConfig>): void {
    this.config = { ...this.config, ...config };
    this.emit('configUpdated', this.config);
  }

  /**
   * 销毁优化器
   */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    
    this.stopMemoryMonitoring();
    
    // 清理所有内存块
    this.memoryPool = [];
    this.activeBlocks.clear();
    
    this.removeAllListeners();
    this.emit('destroyed');
  }
}
