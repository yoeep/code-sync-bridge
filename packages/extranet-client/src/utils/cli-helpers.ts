import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * CLI配置管理
 */
export class CLIConfig {
  private configPath: string;
  private config: any = {};

  constructor(configPath?: string) {
    this.configPath = configPath || this.getDefaultConfigPath();
  }

  /**
   * 获取默认配置文件路径
   */
  private getDefaultConfigPath(): string {
    // 优先级：当前目录 > 用户主目录 > 系统配置目录
    const candidates = [
      './extranet-client.config.json',
      path.join(process.env.HOME || process.env.USERPROFILE || '.', '.extranet-client.json'),
      '/etc/extranet-client/config.json'
    ];

    return candidates[0]; // 默认使用当前目录
  }

  /**
   * 加载配置文件
   */
  async loadConfig(): Promise<void> {
    try {
      const configContent = await fs.readFile(this.configPath, 'utf-8');
      this.config = JSON.parse(configContent);
    } catch (error) {
      if ((error as any).code === 'ENOENT') {
        // 配置文件不存在，使用默认配置
        this.config = this.getDefaultConfig();
        await this.saveConfig();
      } else {
        throw new Error(`加载配置文件失败: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  /**
   * 保存配置文件
   */
  async saveConfig(): Promise<void> {
    try {
      const configDir = path.dirname(this.configPath);
      await fs.mkdir(configDir, { recursive: true });
      await fs.writeFile(this.configPath, JSON.stringify(this.config, null, 2), 'utf-8');
    } catch (error) {
      throw new Error(`保存配置文件失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 获取配置值
   */
  get(key: string, defaultValue?: any): any {
    const keys = key.split('.');
    let value = this.config;
    
    for (const k of keys) {
      if (value && typeof value === 'object' && k in value) {
        value = value[k];
      } else {
        return defaultValue;
      }
    }
    
    return value;
  }

  /**
   * 设置配置值
   */
  set(key: string, value: any): void {
    const keys = key.split('.');
    let current = this.config;
    
    for (let i = 0; i < keys.length - 1; i++) {
      const k = keys[i];
      if (!current[k] || typeof current[k] !== 'object') {
        current[k] = {};
      }
      current = current[k];
    }
    
    current[keys[keys.length - 1]] = value;
  }

  /**
   * 获取默认配置
   */
  private getDefaultConfig(): any {
    return {
      sftp: {
        host: 'localhost',
        port: 22,
        username: 'sync-user',
        authMethod: 'dynamic-token',
        timeout: 30000,
        retryAttempts: 3
      },
      workspace: {
        basePath: './workspace',
        maxConcurrentStreams: 5
      },
      sync: {
        autoCommit: false,
        commitMessageTemplate: 'Auto sync: {timestamp}',
        excludePatterns: [
          '*.log',
          'node_modules/',
          '.git/',
          '.DS_Store',
          'Thumbs.db'
        ]
      },
      ui: {
        colorOutput: true,
        verboseMode: false,
        dateFormat: 'YYYY-MM-DD HH:mm:ss'
      }
    };
  }

  /**
   * 获取所有配置
   */
  getAll(): any {
    return { ...this.config };
  }

  /**
   * 重置为默认配置
   */
  reset(): void {
    this.config = this.getDefaultConfig();
  }
}

/**
 * CLI错误处理器
 */
export class CLIErrorHandler {
  private verbose: boolean;

  constructor(verbose: boolean = false) {
    this.verbose = verbose;
  }

  /**
   * 处理错误并格式化输出
   */
  handleError(error: any, context?: string): never {
    let message = '未知错误';
    let details = '';

    if (error instanceof Error) {
      message = error.message;
      if (this.verbose && error.stack) {
        details = `\n堆栈跟踪:\n${error.stack}`;
      }
    } else if (typeof error === 'string') {
      message = error;
    } else {
      message = String(error);
    }

    const contextPrefix = context ? `[${context}] ` : '';
    console.error(`❌ ${contextPrefix}${message}${details}`);
    
    process.exit(1);
  }

  /**
   * 处理网络错误
   */
  handleNetworkError(error: any): never {
    if (error.code === 'ENOTFOUND') {
      this.handleError('网络连接失败：无法解析主机名', 'NETWORK');
    } else if (error.code === 'ECONNREFUSED') {
      this.handleError('网络连接失败：连接被拒绝', 'NETWORK');
    } else if (error.code === 'ETIMEDOUT') {
      this.handleError('网络连接失败：连接超时', 'NETWORK');
    } else {
      this.handleError(error, 'NETWORK');
    }
  }

  /**
   * 处理文件系统错误
   */
  handleFileSystemError(error: any): never {
    if (error.code === 'ENOENT') {
      this.handleError('文件或目录不存在', 'FILESYSTEM');
    } else if (error.code === 'EACCES') {
      this.handleError('权限不足：无法访问文件或目录', 'FILESYSTEM');
    } else if (error.code === 'ENOSPC') {
      this.handleError('磁盘空间不足', 'FILESYSTEM');
    } else {
      this.handleError(error, 'FILESYSTEM');
    }
  }

  /**
   * 处理认证错误
   */
  handleAuthError(_error: any): never {
    this.handleError('认证失败：请检查用户名和密码/动态码', 'AUTH');
  }
}

/**
 * 进度指示器
 */
export class ProgressIndicator {
  private message: string;
  private spinner: string[] = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  private currentFrame: number = 0;
  private interval: NodeJS.Timeout | null = null;

  constructor(message: string) {
    this.message = message;
  }

  /**
   * 开始显示进度
   */
  start(): void {
    if (process.env.NO_COLOR) {
      console.log(`${this.message}...`);
      return;
    }

    this.interval = setInterval(() => {
      process.stdout.write(`\r${this.spinner[this.currentFrame]} ${this.message}`);
      this.currentFrame = (this.currentFrame + 1) % this.spinner.length;
    }, 100);
  }

  /**
   * 停止并显示成功
   */
  succeed(message?: string): void {
    this.stop();
    const finalMessage = message || this.message;
    console.log(`✅ ${finalMessage}`);
  }

  /**
   * 停止并显示失败
   */
  fail(message?: string): void {
    this.stop();
    const finalMessage = message || this.message;
    console.log(`❌ ${finalMessage}`);
  }

  /**
   * 停止进度指示器
   */
  private stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
      process.stdout.write('\r');
    }
  }
}

/**
 * 表格输出工具
 */
export class TableFormatter {
  private headers: string[];
  private rows: string[][];
  private columnWidths: number[];

  constructor(headers: string[]) {
    this.headers = headers;
    this.rows = [];
    this.columnWidths = headers.map(h => h.length);
  }

  /**
   * 添加行
   */
  addRow(row: string[]): void {
    if (row.length !== this.headers.length) {
      throw new Error('行数据长度与表头不匹配');
    }

    this.rows.push(row);
    
    // 更新列宽
    row.forEach((cell, index) => {
      this.columnWidths[index] = Math.max(this.columnWidths[index], cell.length);
    });
  }

  /**
   * 格式化并输出表格
   */
  toString(): string {
    const lines: string[] = [];
    
    // 表头
    const headerLine = this.headers
      .map((header, index) => header.padEnd(this.columnWidths[index]))
      .join(' | ');
    lines.push(headerLine);
    
    // 分隔线
    const separatorLine = this.columnWidths
      .map(width => '-'.repeat(width))
      .join('-|-');
    lines.push(separatorLine);
    
    // 数据行
    this.rows.forEach(row => {
      const rowLine = row
        .map((cell, index) => cell.padEnd(this.columnWidths[index]))
        .join(' | ');
      lines.push(rowLine);
    });
    
    return lines.join('\n');
  }

  /**
   * 输出表格
   */
  print(): void {
    console.log(this.toString());
  }
}
