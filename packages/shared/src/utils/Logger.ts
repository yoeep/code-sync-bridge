/**
 * 统一日志管理器
 * 将日志记录到文件中，只保留进程监控和必要的错误信息在控制台输出
 */

import * as fs from 'fs';
import * as path from 'path';
import { getAppPath } from '../runtime';

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  CRITICAL = 4
}

export interface LoggerConfig {
  logDir?: string;
  maxFileSize?: number; // MB
  maxFiles?: number;
  enableConsole?: boolean;
  consoleLevel?: LogLevel;
  fileLevel?: LogLevel;
  enableTimestamp?: boolean;
  enablePid?: boolean;
}

export interface LogEntry {
  timestamp: string;
  level: string;
  category: string;
  message: string;
  pid?: number;
  data?: any;
}

/**
 * 日志管理器类
 */
export class Logger {
  private config: Required<LoggerConfig>;
  private logFiles: Map<string, string> = new Map();
  private static instance: Logger | null = null;

  constructor(config: LoggerConfig = {}) {
    this.config = {
      logDir: config.logDir || getAppPath('logs'),
      maxFileSize: config.maxFileSize || 10, // 10MB
      maxFiles: config.maxFiles || 5,
      enableConsole: config.enableConsole !== false,
      consoleLevel: config.consoleLevel ?? LogLevel.ERROR,
      fileLevel: config.fileLevel ?? LogLevel.DEBUG,
      enableTimestamp: config.enableTimestamp !== false,
      enablePid: config.enablePid !== false
    };

    this.ensureLogDirectory();
  }

  /**
   * 获取单例实例
   */
  static getInstance(config?: LoggerConfig): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger(config);
    }
    return Logger.instance;
  }

  /**
   * 确保日志目录存在
   */
  private ensureLogDirectory(): void {
    if (!fs.existsSync(this.config.logDir)) {
      fs.mkdirSync(this.config.logDir, { recursive: true });
    }
  }

  /**
   * 获取日志文件路径
   */
  private getLogFilePath(category: string): string {
    if (!this.logFiles.has(category)) {
      const date = new Date().toISOString().split('T')[0];
      const filename = `${category}-${date}.log`;
      const filepath = path.join(this.config.logDir, filename);
      this.logFiles.set(category, filepath);
    }
    return this.logFiles.get(category)!;
  }

  /**
   * 格式化日志条目
   */
  private formatLogEntry(entry: LogEntry): string {
    const parts: string[] = [];
    
    if (this.config.enableTimestamp) {
      parts.push(`[${entry.timestamp}]`);
    }
    
    if (this.config.enablePid && entry.pid) {
      parts.push(`[PID:${entry.pid}]`);
    }
    
    parts.push(`[${entry.level.toUpperCase()}]`);
    parts.push(`[${entry.category}]`);
    parts.push(entry.message);
    
    if (entry.data) {
      parts.push(JSON.stringify(entry.data));
    }
    
    return parts.join(' ');
  }

  /**
   * 写入日志到文件
   */
  private writeToFile(category: string, entry: LogEntry): void {
    try {
      const filepath = this.getLogFilePath(category);
      const logLine = this.formatLogEntry(entry) + '\n';
      
      // 检查文件大小并轮转
      this.rotateLogIfNeeded(filepath);
      
      fs.appendFileSync(filepath, logLine, 'utf8');
    } catch (error) {
      // 如果文件写入失败，至少输出到控制台
      console.error('Logger: Failed to write to log file:', error);
    }
  }

  /**
   * 输出到控制台
   */
  private writeToConsole(level: LogLevel, category: string, message: string, data?: any): void {
    if (!this.config.enableConsole || level < this.config.consoleLevel) {
      return;
    }

    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${LogLevel[level]}] [${category}]`;
    
    switch (level) {
      case LogLevel.DEBUG:
        console.debug(prefix, message, data || '');
        break;
      case LogLevel.INFO:
        console.info(prefix, message, data || '');
        break;
      case LogLevel.WARN:
        console.warn(prefix, message, data || '');
        break;
      case LogLevel.ERROR:
      case LogLevel.CRITICAL:
        console.error(prefix, message, data || '');
        break;
    }
  }

  /**
   * 轮转日志文件
   */
  private rotateLogIfNeeded(filepath: string): void {
    try {
      if (!fs.existsSync(filepath)) {
        return;
      }

      const stats = fs.statSync(filepath);
      const fileSizeMB = stats.size / (1024 * 1024);
      
      if (fileSizeMB >= this.config.maxFileSize) {
        const dir = path.dirname(filepath);
        const ext = path.extname(filepath);
        const basename = path.basename(filepath, ext);
        
        // 轮转现有文件
        for (let i = this.config.maxFiles - 1; i > 0; i--) {
          const oldFile = path.join(dir, `${basename}.${i}${ext}`);
          const newFile = path.join(dir, `${basename}.${i + 1}${ext}`);
          
          if (fs.existsSync(oldFile)) {
            if (i === this.config.maxFiles - 1) {
              fs.unlinkSync(oldFile); // 删除最老的文件
            } else {
              fs.renameSync(oldFile, newFile);
            }
          }
        }
        
        // 重命名当前文件
        const rotatedFile = path.join(dir, `${basename}.1${ext}`);
        fs.renameSync(filepath, rotatedFile);
      }
    } catch (error) {
      console.error('Logger: Failed to rotate log file:', error);
    }
  }

  /**
   * 记录日志
   */
  private log(level: LogLevel, category: string, message: string, data?: any): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: LogLevel[level],
      category,
      message,
      pid: this.config.enablePid ? process.pid : undefined,
      data
    };

    // 写入文件（如果级别足够）
    if (level >= this.config.fileLevel) {
      this.writeToFile(category, entry);
    }

    // 输出到控制台（如果级别足够）
    this.writeToConsole(level, category, message, data);
  }

  /**
   * Debug 级别日志
   */
  debug(category: string, message: string, data?: any): void {
    this.log(LogLevel.DEBUG, category, message, data);
  }

  /**
   * Info 级别日志
   */
  info(category: string, message: string, data?: any): void {
    this.log(LogLevel.INFO, category, message, data);
  }

  /**
   * Warning 级别日志
   */
  warn(category: string, message: string, data?: any): void {
    this.log(LogLevel.WARN, category, message, data);
  }

  /**
   * Error 级别日志
   */
  error(category: string, message: string, data?: any): void {
    this.log(LogLevel.ERROR, category, message, data);
  }

  /**
   * Critical 级别日志
   */
  critical(category: string, message: string, data?: any): void {
    this.log(LogLevel.CRITICAL, category, message, data);
  }

  /**
   * 进程监控日志（只记录到文件）
   */
  monitor(category: string, message: string, data?: any): void {
    // 只记录到文件，不输出到控制台
    this.log(LogLevel.INFO, category, `[MONITOR] ${message}`, data);
  }

  /**
   * 清理旧日志文件
   */
  cleanup(daysToKeep: number = 7): void {
    try {
      const files = fs.readdirSync(this.config.logDir);
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

      for (const file of files) {
        const filepath = path.join(this.config.logDir, file);
        const stats = fs.statSync(filepath);
        
        if (stats.mtime < cutoffDate) {
          fs.unlinkSync(filepath);
          this.info('Logger', `Cleaned up old log file: ${file}`);
        }
      }
    } catch (error) {
      this.error('Logger', 'Failed to cleanup old log files', error);
    }
  }

  /**
   * 获取日志统计信息
   */
  getStats(): { totalFiles: number; totalSize: number; oldestFile?: string; newestFile?: string } {
    try {
      const files = fs.readdirSync(this.config.logDir);
      let totalSize = 0;
      let oldestFile: string | undefined;
      let newestFile: string | undefined;
      let oldestTime = Infinity;
      let newestTime = 0;

      for (const file of files) {
        const filepath = path.join(this.config.logDir, file);
        const stats = fs.statSync(filepath);
        totalSize += stats.size;

        if (stats.mtime.getTime() < oldestTime) {
          oldestTime = stats.mtime.getTime();
          oldestFile = file;
        }

        if (stats.mtime.getTime() > newestTime) {
          newestTime = stats.mtime.getTime();
          newestFile = file;
        }
      }

      return {
        totalFiles: files.length,
        totalSize,
        oldestFile,
        newestFile
      };
    } catch (error) {
      this.error('Logger', 'Failed to get log stats', error);
      return { totalFiles: 0, totalSize: 0 };
    }
  }
}

/**
 * 默认日志实例
 */
export const logger = Logger.getInstance({
  logDir: getAppPath('logs'),
  maxFileSize: 10, // 10MB
  maxFiles: 5,
  enableConsole: false, // 禁用控制台输出
  consoleLevel: LogLevel.CRITICAL, // 设置最高级别，基本不会输出到控制台
  fileLevel: LogLevel.DEBUG, // 文件中记录所有级别
  enableTimestamp: true,
  enablePid: true
});

/**
 * 便捷的日志函数
 */
export const log = {
  debug: (category: string, message: string, data?: any) => logger.debug(category, message, data),
  info: (category: string, message: string, data?: any) => logger.info(category, message, data),
  warn: (category: string, message: string, data?: any) => logger.warn(category, message, data),
  error: (category: string, message: string, data?: any) => logger.error(category, message, data),
  critical: (category: string, message: string, data?: any) => logger.critical(category, message, data),
  monitor: (category: string, message: string, data?: any) => logger.monitor(category, message, data)
};
