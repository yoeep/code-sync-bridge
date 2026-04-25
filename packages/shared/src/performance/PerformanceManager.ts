import { EventEmitter } from 'events';
import { PerformanceMonitor, PerformanceConfig, TransferMetrics, MemoryMetrics } from './PerformanceMonitor';
import { LargeFileHandler, LargeFileConfig, TransferProgress } from './LargeFileHandler';
import { MemoryOptimizer, MemoryPoolConfig, MemoryStats } from './MemoryOptimizer';

/**
 * 性能管理器配置
 */
export interface PerformanceManagerConfig {
  /** 性能监控配置 */
  monitor?: Partial<PerformanceConfig>;
  /** 大文件处理配置 */
  largeFile?: Partial<LargeFileConfig>;
  /** 内存优化配置 */
  memory?: Partial<MemoryPoolConfig>;
  /** 启用自动优化 */
  enableAutoOptimization?: boolean;
  /** 性能报告间隔 (毫秒) */
  reportInterval?: number;
}

/**
 * 综合性能报告
 */
export interface PerformanceReport {
  /** 报告时间戳 */
  timestamp: Date;
  /** 系统运行时间 */
  uptime: number;
  /** 传输性能指标 */
  transferMetrics: TransferMetrics;
  /** 内存使用指标 */
  memoryMetrics: MemoryMetrics;
  /** 内存池统计 */
  memoryPoolStats: MemoryStats;
  /** 活跃传输数量 */
  activeTransfers: number;
  /** 系统健康评分 */
  healthScore: number;
  /** 性能建议 */
  recommendations: string[];
}

/**
 * 性能优化建议
 */
export interface OptimizationRecommendation {
  /** 建议类型 */
  type: 'memory' | 'transfer' | 'system';
  /** 优先级 */
  priority: 'low' | 'medium' | 'high' | 'critical';
  /** 建议描述 */
  description: string;
  /** 预期改善 */
  expectedImprovement: string;
  /** 实施方法 */
  implementation?: string;
}

/**
 * 性能管理器
 * 统一管理传输性能监控、大文件处理优化和内存使用优化
 */
export class PerformanceManager extends EventEmitter {
  private config: PerformanceManagerConfig;
  private monitor: PerformanceMonitor;
  private largeFileHandler: LargeFileHandler;
  private memoryOptimizer: MemoryOptimizer;
  private reportTimer: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;
  private startTime: Date = new Date();

  constructor(config?: PerformanceManagerConfig) {
    super();
    
    this.config = {
      enableAutoOptimization: true,
      reportInterval: 60000, // 1分钟
      ...config
    };

    // 初始化各个组件
    this.monitor = new PerformanceMonitor(this.config.monitor);
    this.largeFileHandler = new LargeFileHandler(this.config.largeFile);
    this.memoryOptimizer = new MemoryOptimizer(this.config.memory);

    this.setupEventHandlers();
  }

  /**
   * 启动性能管理
   */
  start(): void {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    this.startTime = new Date();

    // 启动各个组件
    this.monitor.startMonitoring();
    this.memoryOptimizer.startMemoryMonitoring();

    // 启动定期报告
    if (this.config.reportInterval && this.config.reportInterval > 0) {
      this.reportTimer = setInterval(() => {
        this.generatePerformanceReport();
      }, this.config.reportInterval);
    }

    this.emit('started');
  }

  /**
   * 停止性能管理
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;

    // 停止各个组件
    this.monitor.stopMonitoring();
    this.memoryOptimizer.stopMemoryMonitoring();

    // 停止定期报告
    if (this.reportTimer) {
      clearInterval(this.reportTimer);
      this.reportTimer = null;
    }

    this.emit('stopped');
  }

  /**
   * 记录传输开始
   */
  recordTransferStart(id: string, filePath: string, fileSize: number, type: 'upload' | 'download'): void {
    this.monitor.recordTransferStart(id, filePath, fileSize, type);
  }

  /**
   * 记录传输完成
   */
  recordTransferComplete(id: string, success: boolean, error?: string): void {
    this.monitor.recordTransferComplete(id, success, error);
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
    const transferId = this.generateTransferId(filePath);
    const fileSize = require('fs').statSync(filePath).size;
    
    this.recordTransferStart(transferId, filePath, fileSize, 'upload');
    
    try {
      await this.largeFileHandler.optimizedUpload(filePath, uploadFunction, options);
      this.recordTransferComplete(transferId, true);
    } catch (error) {
      this.recordTransferComplete(transferId, false, (error as Error).message);
      throw error;
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
    const transferId = this.generateTransferId(localPath);
    
    this.recordTransferStart(transferId, localPath, totalSize, 'download');
    
    try {
      await this.largeFileHandler.optimizedDownload(remotePath, localPath, downloadFunction, totalSize, options);
      this.recordTransferComplete(transferId, true);
    } catch (error) {
      this.recordTransferComplete(transferId, false, (error as Error).message);
      throw error;
    }
  }

  /**
   * 获取内存块
   */
  getMemoryBlock(size?: number): Buffer {
    return this.memoryOptimizer.getMemoryBlock(size);
  }

  /**
   * 释放内存块
   */
  releaseMemoryBlock(buffer: Buffer): void {
    this.memoryOptimizer.releaseMemoryBlock(buffer);
  }

  /**
   * 创建内存高效的流处理器
   */
  createStreamProcessor(options?: {
    bufferSize?: number;
    highWaterMark?: number;
  }) {
    return this.memoryOptimizer.createStreamProcessor(options);
  }

  /**
   * 生成性能报告
   */
  generatePerformanceReport(): PerformanceReport {
    const transferMetrics = this.monitor.getTransferMetrics();
    const memoryMetrics = this.monitor.getMemoryMetrics();
    const memoryPoolStats = this.memoryOptimizer.getMemoryStats();
    const activeTransfers = this.largeFileHandler.getActiveTransfers().size;
    
    const report: PerformanceReport = {
      timestamp: new Date(),
      uptime: Date.now() - this.startTime.getTime(),
      transferMetrics,
      memoryMetrics,
      memoryPoolStats,
      activeTransfers,
      healthScore: this.calculateHealthScore(transferMetrics, memoryMetrics, memoryPoolStats),
      recommendations: this.generateRecommendations(transferMetrics, memoryMetrics, memoryPoolStats)
    };

    this.emit('performanceReport', report);
    return report;
  }

  /**
   * 执行全面性能优化
   */
  async performOptimization(): Promise<void> {
    this.emit('optimizationStarted');
    
    try {
      // 内存优化
      await this.memoryOptimizer.optimizeMemory();
      
      // 清理大文件处理器的临时文件
      await this.largeFileHandler.cleanup();
      
      // 强制垃圾回收
      this.memoryOptimizer.forceGarbageCollection();
      
      this.emit('optimizationCompleted');
    } catch (error) {
      this.emit('optimizationFailed', error);
      throw error;
    }
  }

  /**
   * 获取性能摘要
   */
  getPerformanceSummary() {
    return {
      monitor: this.monitor.getPerformanceSummary(),
      largeFile: {
        activeTransfers: this.largeFileHandler.getActiveTransfers().size
      },
      memory: this.memoryOptimizer.getMemoryStats(),
      isRunning: this.isRunning,
      uptime: Date.now() - this.startTime.getTime()
    };
  }

  /**
   * 获取优化建议
   */
  getOptimizationRecommendations(): OptimizationRecommendation[] {
    const transferMetrics = this.monitor.getTransferMetrics();
    const memoryMetrics = this.monitor.getMemoryMetrics();
    const memoryPoolStats = this.memoryOptimizer.getMemoryStats();
    
    const recommendations: OptimizationRecommendation[] = [];

    // 内存相关建议
    if (memoryMetrics.memoryUsage > 0.9) {
      recommendations.push({
        type: 'memory',
        priority: 'critical',
        description: '内存使用率过高 (>90%)',
        expectedImprovement: '降低内存使用率，提高系统稳定性',
        implementation: '执行内存优化，清理未使用的缓存'
      });
    } else if (memoryMetrics.memoryUsage > 0.8) {
      recommendations.push({
        type: 'memory',
        priority: 'high',
        description: '内存使用率较高 (>80%)',
        expectedImprovement: '预防内存不足问题',
        implementation: '定期执行内存清理'
      });
    }

    // 传输性能相关建议
    if (transferMetrics.errorRate > 0.1) {
      recommendations.push({
        type: 'transfer',
        priority: 'high',
        description: `传输错误率过高 (${(transferMetrics.errorRate * 100).toFixed(1)}%)`,
        expectedImprovement: '提高传输成功率和稳定性',
        implementation: '检查网络连接，调整重试策略'
      });
    }

    if (transferMetrics.transferSpeed > 0 && transferMetrics.transferSpeed < 10 * 1024) {
      recommendations.push({
        type: 'transfer',
        priority: 'medium',
        description: '传输速度较慢 (<10KB/s)',
        expectedImprovement: '提高文件传输效率',
        implementation: '优化网络配置，启用压缩'
      });
    }

    // 内存池相关建议
    if (memoryPoolStats.utilizationRate < 0.3) {
      recommendations.push({
        type: 'memory',
        priority: 'low',
        description: '内存池利用率较低',
        expectedImprovement: '减少内存浪费',
        implementation: '调整内存池大小配置'
      });
    }

    return recommendations;
  }

  /**
   * 设置性能阈值
   */
  setPerformanceThresholds(thresholds: {
    memoryWarning?: number;
    speedWarning?: number;
    errorRateWarning?: number;
  }): void {
    if (thresholds.memoryWarning !== undefined) {
      this.monitor.updateConfig({ memoryWarningThreshold: thresholds.memoryWarning });
    }
    
    if (thresholds.speedWarning !== undefined) {
      this.monitor.updateConfig({ speedWarningThreshold: thresholds.speedWarning });
    }
    
    this.emit('thresholdsUpdated', thresholds);
  }

  /**
   * 设置事件处理器
   */
  private setupEventHandlers(): void {
    // 性能监控事件
    this.monitor.on('memoryWarning', (data) => {
      this.emit('memoryWarning', data);
      if (this.config.enableAutoOptimization) {
        this.performOptimization();
      }
    });

    this.monitor.on('speedWarning', (data) => {
      this.emit('speedWarning', data);
    });

    this.monitor.on('errorRateWarning', (data) => {
      this.emit('errorRateWarning', data);
    });

    // 大文件处理事件
    this.largeFileHandler.on('progressUpdated', (progress) => {
      this.emit('transferProgress', progress);
    });

    this.largeFileHandler.on('uploadCompleted', (data) => {
      this.emit('uploadCompleted', data);
    });

    this.largeFileHandler.on('downloadCompleted', (data) => {
      this.emit('downloadCompleted', data);
    });

    // 内存优化事件
    this.memoryOptimizer.on('memoryPressure', (data) => {
      this.emit('memoryPressure', data);
      if (this.config.enableAutoOptimization) {
        this.performOptimization();
      }
    });

    this.memoryOptimizer.on('memoryOptimized', (stats) => {
      this.emit('memoryOptimized', stats);
    });
  }

  /**
   * 计算系统健康评分
   */
  private calculateHealthScore(
    transferMetrics: TransferMetrics,
    memoryMetrics: MemoryMetrics,
    memoryPoolStats: MemoryStats
  ): number {
    let score = 100;

    // 内存使用评分 (30%)
    if (memoryMetrics.memoryUsage > 0.9) score -= 30;
    else if (memoryMetrics.memoryUsage > 0.8) score -= 20;
    else if (memoryMetrics.memoryUsage > 0.7) score -= 10;

    // 传输性能评分 (40%)
    if (transferMetrics.successRate < 0.8) score -= 25;
    else if (transferMetrics.successRate < 0.9) score -= 15;
    else if (transferMetrics.successRate < 0.95) score -= 5;

    if (transferMetrics.errorRate > 0.2) score -= 15;
    else if (transferMetrics.errorRate > 0.1) score -= 10;
    else if (transferMetrics.errorRate > 0.05) score -= 5;

    // 内存池效率评分 (20%)
    if (memoryPoolStats.utilizationRate < 0.2) score -= 10;
    else if (memoryPoolStats.utilizationRate < 0.3) score -= 5;

    // 并发处理评分 (10%)
    if (transferMetrics.concurrentTransfers > 10) score -= 10;
    else if (transferMetrics.concurrentTransfers > 5) score -= 5;

    return Math.max(0, Math.min(100, score));
  }

  /**
   * 生成性能建议
   */
  private generateRecommendations(
    transferMetrics: TransferMetrics,
    memoryMetrics: MemoryMetrics,
    memoryPoolStats: MemoryStats
  ): string[] {
    const recommendations: string[] = [];

    if (memoryMetrics.memoryUsage > 0.8) {
      recommendations.push('建议执行内存优化以释放未使用的内存');
    }

    if (transferMetrics.errorRate > 0.1) {
      recommendations.push('传输错误率较高，建议检查网络连接稳定性');
    }

    if (transferMetrics.transferSpeed > 0 && transferMetrics.transferSpeed < 10 * 1024) {
      recommendations.push('传输速度较慢，建议启用压缩或优化网络配置');
    }

    if (memoryPoolStats.utilizationRate < 0.3) {
      recommendations.push('内存池利用率较低，建议调整池大小配置');
    }

    if (transferMetrics.concurrentTransfers > 8) {
      recommendations.push('并发传输数量较多，建议限制并发数以提高稳定性');
    }

    return recommendations;
  }

  /**
   * 生成传输ID
   */
  private generateTransferId(filePath: string): string {
    return require('crypto').createHash('md5').update(`${filePath}:${Date.now()}`).digest('hex');
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<PerformanceManagerConfig>): void {
    this.config = { ...this.config, ...config };
    
    if (config.monitor) {
      this.monitor.updateConfig(config.monitor);
    }
    
    if (config.largeFile) {
      this.largeFileHandler.updateConfig(config.largeFile);
    }
    
    if (config.memory) {
      this.memoryOptimizer.updateConfig(config.memory);
    }
    
    this.emit('configUpdated', this.config);
  }

  /**
   * 销毁性能管理器
   */
  destroy(): void {
    this.stop();
    
    this.monitor.destroy();
    this.largeFileHandler.destroy();
    this.memoryOptimizer.destroy();
    
    this.removeAllListeners();
  }
}