import { EventEmitter } from 'events';
import { SFTPConfig } from '../interfaces';

/**
 * 网络状态
 */
export enum NetworkStatus {
  ONLINE = 'online',
  OFFLINE = 'offline',
  UNSTABLE = 'unstable',
  UNKNOWN = 'unknown'
}

/**
 * 网络质量指标
 */
export interface NetworkQuality {
  latency: number; // 延迟（毫秒）
  packetLoss: number; // 丢包率（0-1）
  bandwidth: number; // 带宽（字节/秒）
  stability: number; // 稳定性评分（0-1）
}

/**
 * 网络监控配置
 */
export interface NetworkMonitorConfig {
  checkInterval: number; // 检查间隔（毫秒）
  timeoutThreshold: number; // 超时阈值（毫秒）
  unstableThreshold: number; // 不稳定阈值
  historySize: number; // 历史记录大小
}

/**
 * 网络检查结果
 */
export interface NetworkCheckResult {
  timestamp: Date;
  status: NetworkStatus;
  latency: number;
  success: boolean;
  error?: string;
}

/**
 * 网络状态监控器
 * 监控网络连接状态和质量，提供网络状态变化通知
 */
export class NetworkMonitor extends EventEmitter {
  private config: NetworkMonitorConfig;
  private sftpConfig: SFTPConfig;
  private currentStatus: NetworkStatus = NetworkStatus.UNKNOWN;
  private checkHistory: NetworkCheckResult[] = [];
  private monitorTimer: NodeJS.Timeout | null = null;
  private isMonitoring: boolean = false;

  constructor(sftpConfig: SFTPConfig, config?: Partial<NetworkMonitorConfig>) {
    super();
    this.sftpConfig = sftpConfig;
    this.config = {
      checkInterval: 30000, // 30秒
      timeoutThreshold: 10000, // 10秒
      unstableThreshold: 0.3, // 30%失败率认为不稳定
      historySize: 100,
      ...config
    };
  }

  /**
   * 开始监控网络状态
   */
  startMonitoring(): void {
    if (this.isMonitoring) {
      return;
    }

    this.isMonitoring = true;
    this.emit('monitoringStarted');

    // 立即执行一次检查
    this.performNetworkCheck();

    // 设置定时检查
    this.monitorTimer = setInterval(() => {
      this.performNetworkCheck();
    }, this.config.checkInterval);
  }

  /**
   * 停止监控网络状态
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
   * 获取当前网络状态
   */
  getCurrentStatus(): NetworkStatus {
    return this.currentStatus;
  }

  /**
   * 获取网络质量指标
   */
  getNetworkQuality(): NetworkQuality {
    if (this.checkHistory.length === 0) {
      return {
        latency: 0,
        packetLoss: 1,
        bandwidth: 0,
        stability: 0
      };
    }

    const recentChecks = this.checkHistory.slice(-20); // 最近20次检查
    const successfulChecks = recentChecks.filter(check => check.success);
    
    const avgLatency = successfulChecks.length > 0
      ? successfulChecks.reduce((sum, check) => sum + check.latency, 0) / successfulChecks.length
      : 0;
    
    const packetLoss = 1 - (successfulChecks.length / recentChecks.length);
    const stability = this.calculateStability(recentChecks);
    
    return {
      latency: Math.round(avgLatency),
      packetLoss: Math.round(packetLoss * 100) / 100,
      bandwidth: this.estimateBandwidth(),
      stability: Math.round(stability * 100) / 100
    };
  }

  /**
   * 获取检查历史
   */
  getCheckHistory(): NetworkCheckResult[] {
    return [...this.checkHistory];
  }

  /**
   * 手动执行网络检查
   */
  async checkNetworkStatus(): Promise<NetworkCheckResult> {
    return this.performNetworkCheck();
  }

  /**
   * 执行网络检查
   */
  private async performNetworkCheck(): Promise<NetworkCheckResult> {
    const startTime = Date.now();
    const result: NetworkCheckResult = {
      timestamp: new Date(),
      status: NetworkStatus.UNKNOWN,
      latency: 0,
      success: false
    };

    try {
      // 尝试连接SFTP服务器进行网络检查
      await this.testSFTPConnection();
      
      result.latency = Date.now() - startTime;
      result.success = true;
      result.status = this.determineNetworkStatus(result.latency);
      
    } catch (error) {
      result.latency = Date.now() - startTime;
      result.success = false;
      result.error = (error as Error).message;
      result.status = NetworkStatus.OFFLINE;
    }

    // 添加到历史记录
    this.addToHistory(result);

    // 更新当前状态
    this.updateCurrentStatus(result);

    return result;
  }

  /**
   * 测试SFTP连接
   */
  private async testSFTPConnection(): Promise<void> {
    const { SystemSFTPClient } = await import('../sftp/SystemSFTPClient');
    
    const connectConfig = {
      host: this.sftpConfig.host,
      port: this.sftpConfig.port,
      username: this.sftpConfig.username,
      password: this.sftpConfig.password,
      privateKey: this.sftpConfig.privateKeyPath,
      authMethod: this.sftpConfig.authMethod as 'password' | 'dynamic-token' | 'key',
      timeout: this.config.timeoutThreshold,
      retries: 1,
      retryDelay: 1000
    };

    const client = new SystemSFTPClient(connectConfig);
    
    try {
      await client.connect();
      // 执行一个简单的操作来确认连接正常
      await client.listDirectory('.');
    } finally {
      client.disconnect();
    }
  }

  /**
   * 根据延迟确定网络状态
   */
  private determineNetworkStatus(latency: number): NetworkStatus {
    if (latency < 1000) {
      return NetworkStatus.ONLINE;
    } else if (latency < 5000) {
      return NetworkStatus.UNSTABLE;
    } else {
      return NetworkStatus.OFFLINE;
    }
  }

  /**
   * 更新当前网络状态
   */
  private updateCurrentStatus(result: NetworkCheckResult): void {
    const previousStatus = this.currentStatus;
    
    // 基于最近几次检查结果确定整体状态
    const recentChecks = this.checkHistory.slice(-5);
    const successRate = recentChecks.filter(check => check.success).length / recentChecks.length;
    
    let newStatus: NetworkStatus;
    
    if (successRate >= 0.8) {
      newStatus = NetworkStatus.ONLINE;
    } else if (successRate >= 0.4) {
      newStatus = NetworkStatus.UNSTABLE;
    } else {
      newStatus = NetworkStatus.OFFLINE;
    }

    this.currentStatus = newStatus;

    // 如果状态发生变化，发出事件
    if (previousStatus !== newStatus) {
      this.emit('statusChanged', {
        previousStatus,
        currentStatus: newStatus,
        timestamp: new Date()
      });
    }

    // 发出检查完成事件
    this.emit('checkCompleted', result);
  }

  /**
   * 计算网络稳定性
   */
  private calculateStability(checks: NetworkCheckResult[]): number {
    if (checks.length < 2) {
      return 0;
    }

    let stabilityScore = 0;
    let consecutiveSuccesses = 0;
    let maxConsecutiveSuccesses = 0;

    for (const check of checks) {
      if (check.success) {
        consecutiveSuccesses++;
        maxConsecutiveSuccesses = Math.max(maxConsecutiveSuccesses, consecutiveSuccesses);
      } else {
        consecutiveSuccesses = 0;
      }
    }

    // 基于连续成功次数和总体成功率计算稳定性
    const successRate = checks.filter(check => check.success).length / checks.length;
    const consistencyScore = maxConsecutiveSuccesses / checks.length;
    
    stabilityScore = (successRate * 0.7) + (consistencyScore * 0.3);
    
    return Math.min(1, stabilityScore);
  }

  /**
   * 估算带宽
   */
  private estimateBandwidth(): number {
    // 这里可以实现更复杂的带宽估算逻辑
    // 目前返回基于延迟的简单估算
    const quality = this.getNetworkQuality();
    
    if (quality.latency < 100) {
      return 1000000; // 1MB/s
    } else if (quality.latency < 500) {
      return 500000; // 500KB/s
    } else {
      return 100000; // 100KB/s
    }
  }

  /**
   * 添加检查结果到历史记录
   */
  private addToHistory(result: NetworkCheckResult): void {
    this.checkHistory.push(result);
    
    // 保持历史记录大小限制
    if (this.checkHistory.length > this.config.historySize) {
      this.checkHistory.shift();
    }
  }

  /**
   * 更新监控配置
   */
  updateConfig(config: Partial<NetworkMonitorConfig>): void {
    this.config = { ...this.config, ...config };
    
    // 如果正在监控，重启监控以应用新配置
    if (this.isMonitoring) {
      this.stopMonitoring();
      this.startMonitoring();
    }
    
    this.emit('configUpdated', this.config);
  }

  /**
   * 清除历史记录
   */
  clearHistory(): void {
    this.checkHistory = [];
    this.emit('historyCleared');
  }
}