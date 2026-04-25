/**
 * 系统配置接口
 */
export interface SystemConfig {
  /** SFTP配置 */
  sftp: SFTPConfiguration;
  /** 同步配置 */
  sync: SyncConfiguration;
  /** 安全配置 */
  security: SecurityConfiguration;
}

/**
 * SFTP配置
 */
export interface SFTPConfiguration {
  /** 主机地址 */
  host: string;
  /** 端口号 */
  port: number;
  /** 用户名 */
  username: string;
  /** 认证方式 */
  authMethod: 'dynamic-token' | 'password' | 'key';
  /** 连接超时（毫秒） */
  timeout: number;
  /** 重试次数 */
  retryAttempts: number;
  /** 基础路径 */
  basePath?: string;
}

/**
 * 同步配置
 */
export interface SyncConfiguration {
  /** 监控间隔（秒） */
  monitorInterval: number;
  /** 最大文件大小 */
  maxFileSize: string;
  /** 排除模式 */
  excludePatterns: string[];
  /** 上传配置 */
  upload?: {
    /** 上传目标目录 */
    targetDirectory: string;
    /** 是否启用压缩 */
    enableCompression: boolean;
    /** 压缩格式 */
    compressionFormat: 'zip' | 'tar' | 'tar.gz';
  };
}

/**
 * 安全配置
 */
export interface SecurityConfiguration {
  /** 是否启用加密 */
  encryptionEnabled: boolean;
  /** 是否启用校验和验证 */
  checksumValidation: boolean;
  /** 最大并发代码流数量 */
  maxConcurrentStreams: number;
}

/**
 * 默认配置
 */
export const DEFAULT_CONFIG: SystemConfig = {
  sftp: {
    host: 'localhost',
    port: 22,
    username: 'sync-user',
    authMethod: 'dynamic-token',
    timeout: 30000,
    retryAttempts: 3
  },
  sync: {
    monitorInterval: 300,
    maxFileSize: '100MB',
    excludePatterns: ['*.log', 'node_modules/', '.git/', 'dist/', '*.tmp'],
    upload: {
      targetDirectory: '/uploads',
      enableCompression: true,
      compressionFormat: 'zip'
    }
  },
  security: {
    encryptionEnabled: true,
    checksumValidation: true,
    maxConcurrentStreams: 10
  }
};

// 导出配置管理器
export { ConfigManager, getConfigManager, resetConfigManager } from './ConfigManager';
export type { AppConfig } from './ConfigManager';