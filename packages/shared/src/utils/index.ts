import * as crypto from 'crypto';
export * from './paths';

/**
 * 生成唯一ID
 * @returns 唯一标识符
 */
export function generateId(): string {
  return crypto.randomUUID();
}

/**
 * 计算文件校验和
 * @param content 文件内容
 * @returns SHA256校验和
 */
export function calculateChecksum(content: Buffer): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * 格式化文件大小
 * @param bytes 字节数
 * @returns 格式化的大小字符串
 */
export function formatFileSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(2)} ${units[unitIndex]}`;
}

/**
 * 解析文件大小字符串
 * @param sizeStr 大小字符串（如 "100MB"）
 * @returns 字节数
 */
export function parseFileSize(sizeStr: string): number {
  const match = sizeStr.match(/^(\d+(?:\.\d+)?)\s*(B|KB|MB|GB)$/i);
  if (!match) {
    throw new Error(`Invalid file size format: ${sizeStr}`);
  }

  const value = parseFloat(match[1]);
  const unit = match[2].toUpperCase();

  const multipliers: Record<string, number> = {
    'B': 1,
    'KB': 1024,
    'MB': 1024 * 1024,
    'GB': 1024 * 1024 * 1024
  };

  return Math.floor(value * multipliers[unit]);
}

/**
 * 延迟执行
 * @param ms 延迟毫秒数
 */
export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 指数退避重试
 * @param fn 要重试的函数
 * @param maxAttempts 最大重试次数
 * @param baseDelay 基础延迟时间（毫秒）
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxAttempts: number = 3,
  baseDelay: number = 1000
): Promise<T> {
  let lastError: Error;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      
      if (attempt === maxAttempts) {
        break;
      }

      const delayMs = baseDelay * Math.pow(2, attempt - 1);
      await delay(delayMs);
    }
  }

  throw lastError!;
}

/**
 * 验证路径安全性
 * @param path 路径
 * @returns 是否安全
 */
export function isPathSafe(path: string): boolean {
  // 检查路径遍历攻击
  const normalizedPath = path.replace(/\\/g, '/');
  return !normalizedPath.includes('../') && !normalizedPath.includes('./');
}

/**
 * 验证SFTP主机地址格式
 * @param host 主机地址
 * @returns 是否有效
 */
export function validateSFTPHost(host: string): boolean {
  // 支持IP地址和域名
  const ipRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
  const domainRegex = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
  
  return ipRegex.test(host) || domainRegex.test(host);
}

/**
 * 验证端口号
 * @param port 端口号
 * @returns 是否有效
 */
export function validatePort(port: number): boolean {
  return Number.isInteger(port) && port > 0 && port <= 65535;
}

/**
 * 生成配置文件模板
 * @returns 配置文件JSON字符串
 */
export function generateConfigTemplate(): string {
  const template = {
    sftp: {
      host: "your-sftp-server.com",
      port: 22,
      username: "your-username",
      authMethod: "dynamic-token",
      timeout: 30000,
      retryAttempts: 3
    },
    sync: {
      monitorInterval: 300,
      maxFileSize: "100MB",
      excludePatterns: [
        "*.log",
        "node_modules/",
        ".git/",
        "dist/",
        "*.tmp",
        ".DS_Store"
      ]
    },
    security: {
      encryptionEnabled: true,
      checksumValidation: true,
      maxConcurrentStreams: 10
    },
    logging: {
      level: "info",
      console: true,
      filePath: "./logs/code-sync-bridge.log"
    }
  };

  return JSON.stringify(template, null, 2);
}
