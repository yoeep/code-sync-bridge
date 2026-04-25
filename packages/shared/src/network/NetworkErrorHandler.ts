import { EventEmitter } from 'events';

/**
 * 网络错误类型
 */
export enum NetworkErrorType {
  CONNECTION_TIMEOUT = 'connection_timeout',
  CONNECTION_REFUSED = 'connection_refused',
  DNS_RESOLUTION = 'dns_resolution',
  AUTHENTICATION_FAILED = 'authentication_failed',
  NETWORK_UNREACHABLE = 'network_unreachable',
  SFTP_PROTOCOL_ERROR = 'sftp_protocol_error',
  UNKNOWN = 'unknown'
}

/**
 * 网络错误信息
 */
export interface NetworkError {
  type: NetworkErrorType;
  message: string;
  originalError: Error;
  timestamp: Date;
  retryable: boolean;
}

/**
 * 重试策略配置
 */
export interface RetryConfig {
  maxAttempts: number;
  baseDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
  jitterEnabled: boolean;
}

/**
 * 网络错误处理器
 * 提供统一的网络错误分类、重试策略和错误恢复机制
 */
export class NetworkErrorHandler extends EventEmitter {
  private retryConfig: RetryConfig;
  private errorHistory: NetworkError[] = [];
  private maxHistorySize: number = 100;

  constructor(retryConfig?: Partial<RetryConfig>) {
    super();
    this.retryConfig = {
      maxAttempts: 3,
      baseDelay: 1000,
      maxDelay: 30000,
      backoffMultiplier: 2,
      jitterEnabled: true,
      ...retryConfig
    };
  }

  /**
   * 分类网络错误
   */
  classifyError(error: Error): NetworkError {
    const networkError: NetworkError = {
      type: this.determineErrorType(error),
      message: error.message,
      originalError: error,
      timestamp: new Date(),
      retryable: this.isRetryable(error)
    };

    this.addToHistory(networkError);
    this.emit('errorClassified', networkError);

    return networkError;
  }

  /**
   * 执行带重试的操作
   */
  async executeWithRetry<T>(
    operation: () => Promise<T>,
    operationName: string = 'unknown'
  ): Promise<T> {
    let lastError: NetworkError | undefined;
    
    for (let attempt = 1; attempt <= this.retryConfig.maxAttempts; attempt++) {
      try {
        const result = await operation();
        
        if (attempt > 1) {
          this.emit('operationRecovered', {
            operationName,
            attempt,
            totalAttempts: this.retryConfig.maxAttempts
          });
        }
        
        return result;
      } catch (error) {
        lastError = this.classifyError(error as Error);
        
        this.emit('operationFailed', {
          operationName,
          attempt,
          totalAttempts: this.retryConfig.maxAttempts,
          error: lastError
        });

        // 如果不可重试或已达到最大重试次数，直接抛出错误
        if (!lastError.retryable || attempt === this.retryConfig.maxAttempts) {
          break;
        }

        // 计算延迟时间并等待
        const delay = this.calculateDelay(attempt);
        this.emit('retryScheduled', {
          operationName,
          attempt: attempt + 1,
          delay
        });
        
        await this.sleep(delay);
      }
    }

    throw new Error(
      `Operation '${operationName}' failed after ${this.retryConfig.maxAttempts} attempts. Last error: ${lastError?.message}`
    );
  }

  /**
   * 确定错误类型
   */
  private determineErrorType(error: Error): NetworkErrorType {
    const message = error.message.toLowerCase();
    
    if (message.includes('timeout') || message.includes('timed out')) {
      return NetworkErrorType.CONNECTION_TIMEOUT;
    }
    
    if (message.includes('connection refused') || message.includes('econnrefused')) {
      return NetworkErrorType.CONNECTION_REFUSED;
    }
    
    if (message.includes('getaddrinfo') || message.includes('dns') || message.includes('enotfound')) {
      return NetworkErrorType.DNS_RESOLUTION;
    }
    
    if (message.includes('authentication') || message.includes('auth') || message.includes('login')) {
      return NetworkErrorType.AUTHENTICATION_FAILED;
    }
    
    if (message.includes('network unreachable') || message.includes('enetunreach')) {
      return NetworkErrorType.NETWORK_UNREACHABLE;
    }
    
    if (message.includes('sftp') || message.includes('ssh')) {
      return NetworkErrorType.SFTP_PROTOCOL_ERROR;
    }
    
    return NetworkErrorType.UNKNOWN;
  }

  /**
   * 判断错误是否可重试
   */
  private isRetryable(error: Error): boolean {
    const errorType = this.determineErrorType(error);
    
    // 认证失败通常不应该重试（除非是动态码过期）
    if (errorType === NetworkErrorType.AUTHENTICATION_FAILED) {
      return error.message.includes('dynamic') || error.message.includes('token');
    }
    
    // DNS解析失败通常不应该重试
    if (errorType === NetworkErrorType.DNS_RESOLUTION) {
      return false;
    }
    
    // 其他错误类型通常可以重试
    return true;
  }

  /**
   * 计算重试延迟时间
   */
  private calculateDelay(attempt: number): number {
    let delay = this.retryConfig.baseDelay * Math.pow(this.retryConfig.backoffMultiplier, attempt - 1);
    delay = Math.min(delay, this.retryConfig.maxDelay);
    
    // 添加抖动以避免雷群效应
    if (this.retryConfig.jitterEnabled) {
      const jitter = Math.random() * 0.1 * delay;
      delay += jitter;
    }
    
    return Math.floor(delay);
  }

  /**
   * 添加错误到历史记录
   */
  private addToHistory(error: NetworkError): void {
    this.errorHistory.push(error);
    
    // 保持历史记录大小限制
    if (this.errorHistory.length > this.maxHistorySize) {
      this.errorHistory.shift();
    }
  }

  /**
   * 获取错误统计信息
   */
  getErrorStatistics(): {
    totalErrors: number;
    errorsByType: Record<NetworkErrorType, number>;
    recentErrors: NetworkError[];
  } {
    const errorsByType = {} as Record<NetworkErrorType, number>;
    
    // 初始化计数器
    Object.values(NetworkErrorType).forEach(type => {
      errorsByType[type] = 0;
    });
    
    // 统计错误类型
    this.errorHistory.forEach(error => {
      errorsByType[error.type]++;
    });
    
    // 获取最近的错误（最近10个）
    const recentErrors = this.errorHistory.slice(-10);
    
    return {
      totalErrors: this.errorHistory.length,
      errorsByType,
      recentErrors
    };
  }

  /**
   * 清除错误历史
   */
  clearHistory(): void {
    this.errorHistory = [];
    this.emit('historyCleared');
  }

  /**
   * 更新重试配置
   */
  updateRetryConfig(config: Partial<RetryConfig>): void {
    this.retryConfig = { ...this.retryConfig, ...config };
    this.emit('retryConfigUpdated', this.retryConfig);
  }

  /**
   * 休眠指定毫秒数
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}