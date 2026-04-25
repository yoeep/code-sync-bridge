import { EventEmitter } from 'events';

/**
 * 传输性能指标
 */
export interface TransferMetrics {
  /** 传输速度 (字节/秒) */
  transferSpeed: number;
  /** 传输延迟 (毫秒) */
  latency: number;
  /** 传输成功率 */
  successRate: number;
  /** 平均文件大小 */
  averageFileSize: number;
  /** 并发传输数 */
  concurrentTransfers: number;
  /** 错误率 */
  errorRate: number;
}

/**
 * 内存使用指标
 */
export interface MemoryMetrics {
  /** 已使用内存 (字节) */
  usedMemory: number;
  /** 总内存 (字节) */
  totalMemory: number;
  /** 内存使用率 */
  memoryUsage: number;
  /** 堆内存使用 (字节) */
  heapUsed: number;
  /** 堆内存总量 (字节) */
  heapTotal: number;
  /** 外部内存使用 (字节) */
  external: number;
}

/**
 * 传输记录
 */
export interface TransferRecord {
  /** 传输ID */
  id: string;
  /** 文件路径 */
  filePath: string;
  /** 文件大小 */
  fileSize: number;
  /** 传输类型 */
  type: 'upload' | 'download';
  /** 开始时间 */
  startTime: Date;
  /** 结束时间 */
  endTime?: Date;
  /** 传输速度 */
  speed?: number;
  /** 是否成功 */
  success: boolean;
  /** 错误信息 */
  error?: string;
  /** 重试次数 */
  retryCount: number;
}

/**
 * 性能监控配置
 */
export interface PerformanceConfig {
  /** 监控间隔 (毫秒) */
  monitorInterval: number;
  /** 历史记录大小 */
  historySize: number;
  /** 内存警告阈值 */
  memoryWarningThreshold: number;
  /** 传输速度警告阈值 (字节/秒) */
  speedWarningThreshold: number;
  /** 启用详细日志 */
  enableDetailedLogging: boolean;
}

/**
 * 性能监控器
 * 监控传输性能和系统资源使用情况
 */
export class PerformanceMonitor extends EventEmitter {
  private config: PerformanceConfig;
  private transferRecords: TransferRecord[] = [];
  private activeTransfers: Map<string, TransferRecord> = new Map();
  private monitorTimer: NodeJS.Timeout | null = null;
  private isMonitoring: boolean = false;
  private startTime: Date = new Date();

  constructor(config?: Partial<PerformanceConfig>) {
    super();
    
    this.config = {
      monitorInterval: 5000, // 5秒
      historySize: 1000,
      memoryWarningThreshold: 0.8, // 80%
      speedWarningThreshold: 10 * 1024, // 10KB/s
      enableDetailedLogging: false,
      ...config
    };
  }

  /**
   * 开始性能监控
   */
  startMonitoring(): void {
    if (this.isMonitoring) {
      return;
    }

    this.isMonitoring = true;
    this.startTime = new Date();
    
    // 立即执行一次监控
    this.performMonitoring();
    
    // 设置定时监控
    this.monitorTimer = setInterval(() => {
      this.performMonitoring();
    }, this.config.monitorInterval);

    this.emit('monitoringStarted');
  }

  /**
   * 停止性能监控
   */
  stopMonitoring(): void {
    if (!this.isMonitoring) {
      return;
    }

    this.isMonitoring = false;
    
    if (this.monitorTimer) {
      clearInterval(this.monitorTimer);
      this.monitorTimer = null;
    }

    this.emit('monitoringStopped');
  }

  /**
   * 记录传输开始
   */
  recordTransferStart(id: string, filePath: string, fileSize: number, type: 'upload' | 'download'): void {
    const record: TransferRecord = {
      id,
      filePath,
      fileSize,
      type,
      startTime: new Date(),
      success: false,
      retryCount: 0
    };

    this.activeTransfers.set(id, record);
    
    if (this.config.enableDetailedLogging) {
      this.emit('transferStarted', record);
    }
  }

  /**
   * 记录传输完成
   */
  recordTransferComplete(id: string, success: boolean, error?: string): void {
    const record = this.activeTransfers.get(id);
    if (!record) {
      return;
    }

    record.endTime = new Date();
    record.success = success;
    record.error = error;

    // 计算传输速度
    if (success && record.endTime) {
      const duration = record.endTime.getTime() - record.startTime.getTime();
      record.speed = duration > 0 ? (record.fileSize / duration) * 1000 : 0; // 字节/秒
    }

    // 移动到历史记录
    this.transferRecords.push(record);
    this.activeTransfers.delete(id);

    // 限制历史记录大小
    if (this.transferRecords.length > this.config.historySize) {
      this.transferRecords.shift();
    }

    this.emit('transferCompleted', record);

    // 检查性能警告
    this.checkPerformanceWarnings(record);
  }

  /**
   * 记录传输重试
   */
  recordTransferRetry(id: string): void {
    const record = this.activeTransfers.get(id);
    if (record) {
      record.retryCount++;
      this.emit('transferRetried', record);
    }
  }

  /**
   * 获取传输性能指标
   */
  getTransferMetrics(): TransferMetrics {
    const recentRecords = this.getRecentRecords(300000); // 最近5分钟
    
    if (recentRecords.length === 0) {
      return {
        transferSpeed: 0,
        latency: 0,
        successRate: 0,
        averageFileSize: 0,
        concurrentTransfers: this.activeTransfers.size,
        errorRate: 0
      };
    }

    const successfulRecords = recentRecords.filter(r => r.success);
    const speeds = successfulRecords
      .filter(r => r.speed && r.speed > 0)
      .map(r => r.speed!);

    return {
      transferSpeed: speeds.length > 0 ? speeds.reduce((sum, speed) => sum + speed, 0) / speeds.length : 0,
      latency: this.calculateAverageLatency(recentRecords),
      successRate: recentRecords.length > 0 ? successfulRecords.length / recentRecords.length : 0,
      averageFileSize: recentRecords.reduce((sum, r) => sum + r.fileSize, 0) / recentRecords.length,
      concurrentTransfers: this.activeTransfers.size,
      errorRate: recentRecords.length > 0 ? (recentRecords.length - successfulRecords.length) / recentRecords.length : 0
    };
  }

  /**
   * 获取内存使用指标
   */
  getMemoryMetrics(): MemoryMetrics {
    const memUsage = process.memoryUsage();
    
    return {
      usedMemory: memUsage.rss,
      totalMemory: require('os').totalmem(),
      memoryUsage: memUsage.rss / require('os').totalmem(),
      heapUsed: memUsage.heapUsed,
      heapTotal: memUsage.heapTotal,
      external: memUsage.external
    };
  }

  /**
   * 获取活跃传输列表
   */
  getActiveTransfers(): TransferRecord[] {
    return Array.from(this.activeTransfers.values());
  }

  /**
   * 获取传输历史记录
   */
  getTransferHistory(limit?: number): TransferRecord[] {
    const records = [...this.transferRecords];
    return limit ? records.slice(-limit) : records;
  }

  /**
   * 获取性能摘要
   */
  getPerformanceSummary() {
    const transferMetrics = this.getTransferMetrics();
    const memoryMetrics = this.getMemoryMetrics();
    const uptime = Date.now() - this.startTime.getTime();

    return {
      uptime,
      transferMetrics,
      memoryMetrics,
      totalTransfers: this.transferRecords.length,
      activeTransfers: this.activeTransfers.size,
      averageTransferTime: this.calculateAverageTransferTime(),
      systemHealth: this.assessSystemHealth(transferMetrics, memoryMetrics)
    };
  }

  /**
   * 清除历史记录
   */
  clearHistory(): void {
    this.transferRecords = [];
    this.emit('historyCleared');
  }

  /**
   * 执行性能监控
   */
  private performMonitoring(): void {
    const transferMetrics = this.getTransferMetrics();
    const memoryMetrics = this.getMemoryMetrics();

    // 发出监控事件
    this.emit('metricsUpdated', {
      timestamp: new Date(),
      transferMetrics,
      memoryMetrics
    });

    // 检查系统健康状况
    this.checkSystemHealth(transferMetrics, memoryMetrics);
  }

  /**
   * 检查系统健康状况
   */
  private checkSystemHealth(transferMetrics: TransferMetrics, memoryMetrics: MemoryMetrics): void {
    // 内存使用警告
    if (memoryMetrics.memoryUsage > this.config.memoryWarningThreshold) {
      this.emit('memoryWarning', {
        usage: memoryMetrics.memoryUsage,
        threshold: this.config.memoryWarningThreshold,
        usedMemory: memoryMetrics.usedMemory
      });
    }

    // 传输速度警告
    if (transferMetrics.transferSpeed > 0 && transferMetrics.transferSpeed < this.config.speedWarningThreshold) {
      this.emit('speedWarning', {
        speed: transferMetrics.transferSpeed,
        threshold: this.config.speedWarningThreshold
      });
    }

    // 错误率警告
    if (transferMetrics.errorRate > 0.1) { // 10%错误率
      this.emit('errorRateWarning', {
        errorRate: transferMetrics.errorRate
      });
    }
  }

  /**
   * 检查性能警告
   */
  private checkPerformanceWarnings(record: TransferRecord): void {
    if (!record.success) {
      return;
    }

    // 传输速度过慢警告
    if (record.speed && record.speed < this.config.speedWarningThreshold) {
      this.emit('slowTransferWarning', {
        record,
        threshold: this.config.speedWarningThreshold
      });
    }

    // 大文件传输警告
    if (record.fileSize > 50 * 1024 * 1024) { // 50MB
      this.emit('largeFileTransfer', record);
    }
  }

  /**
   * 获取最近的传输记录
   */
  private getRecentRecords(timeWindow: number): TransferRecord[] {
    const cutoff = new Date(Date.now() - timeWindow);
    return this.transferRecords.filter(record => 
      record.endTime && record.endTime >= cutoff
    );
  }

  /**
   * 计算平均延迟
   */
  private calculateAverageLatency(records: TransferRecord[]): number {
    const completedRecords = records.filter(r => r.endTime);
    
    if (completedRecords.length === 0) {
      return 0;
    }

    const totalLatency = completedRecords.reduce((sum, record) => {
      const duration = record.endTime!.getTime() - record.startTime.getTime();
      return sum + duration;
    }, 0);

    return totalLatency / completedRecords.length;
  }

  /**
   * 计算平均传输时间
   */
  private calculateAverageTransferTime(): number {
    const completedRecords = this.transferRecords.filter(r => r.endTime && r.success);
    
    if (completedRecords.length === 0) {
      return 0;
    }

    const totalTime = completedRecords.reduce((sum, record) => {
      const duration = record.endTime!.getTime() - record.startTime.getTime();
      return sum + duration;
    }, 0);

    return totalTime / completedRecords.length;
  }

  /**
   * 评估系统健康状况
   */
  private assessSystemHealth(transferMetrics: TransferMetrics, memoryMetrics: MemoryMetrics): 'excellent' | 'good' | 'fair' | 'poor' {
    let score = 100;

    // 内存使用评分
    if (memoryMetrics.memoryUsage > 0.9) score -= 30;
    else if (memoryMetrics.memoryUsage > 0.8) score -= 20;
    else if (memoryMetrics.memoryUsage > 0.7) score -= 10;

    // 传输性能评分
    if (transferMetrics.successRate < 0.8) score -= 25;
    else if (transferMetrics.successRate < 0.9) score -= 15;
    else if (transferMetrics.successRate < 0.95) score -= 5;

    // 错误率评分
    if (transferMetrics.errorRate > 0.2) score -= 20;
    else if (transferMetrics.errorRate > 0.1) score -= 10;
    else if (transferMetrics.errorRate > 0.05) score -= 5;

    // 传输速度评分
    if (transferMetrics.transferSpeed > 0 && transferMetrics.transferSpeed < this.config.speedWarningThreshold) {
      score -= 15;
    }

    if (score >= 90) return 'excellent';
    if (score >= 75) return 'good';
    if (score >= 60) return 'fair';
    return 'poor';
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<PerformanceConfig>): void {
    this.config = { ...this.config, ...config };
    
    // 如果正在监控，重启监控以应用新配置
    if (this.isMonitoring) {
      this.stopMonitoring();
      this.startMonitoring();
    }
    
    this.emit('configUpdated', this.config);
  }

  /**
   * 销毁监控器
   */
  destroy(): void {
    this.stopMonitoring();
    this.removeAllListeners();
  }
}