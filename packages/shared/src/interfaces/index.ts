import { CodeStream, FileChange, SyncResult, StreamStatus } from '../types';

/**
 * 内网客户端接口
 */
export interface IntranetClient {
  /**
   * 注册代码流
   * @param repoUrl 仓库URL
   * @param streamName 代码流名称
   * @returns 代码流ID
   */
  registerCodeStream(repoUrl: string, streamName: string): Promise<string>;

  /**
   * 开始监控代码流
   * @param streamId 代码流ID
   * @param interval 监控间隔（秒）
   */
  startMonitoring(streamId: string, interval: number): void;

  /**
   * 从SFTP同步变更
   * @param streamId 代码流ID
   * @returns 同步结果
   */
  syncChangesFromSFTP(streamId: string): Promise<SyncResult>;

  /**
   * 上传到SFTP
   * @param streamId 代码流ID
   * @param data 数据
   * @param fileName 文件名
   */
  uploadToSFTP(streamId: string, data: Buffer, fileName: string): Promise<void>;
}

/**
 * 外网客户端接口
 */
export interface ExtranetClient {
  /**
   * 列出可用的代码流
   * @returns 代码流列表
   */
  listAvailableStreams(): Promise<CodeStream[]>;

  /**
   * 拉取代码流
   * @param streamId 代码流ID
   * @param localPath 本地路径
   */
  pullCodeStream(streamId: string, localPath: string): Promise<void>;

  /**
   * 推送变更
   * @param streamId 代码流ID
   * @param changes 变更列表
   */
  pushChanges(streamId: string, changes: FileChange[]): Promise<void>;

  /**
   * 获取代码流状态
   * @param streamId 代码流ID
   * @returns 代码流状态
   */
  getStreamStatus(streamId: string): Promise<StreamStatus>;
}

/**
 * SFTP连接配置
 */
export interface SFTPConfig {
  /** 主机地址 */
  host: string;
  /** 端口号 */
  port: number;
  /** 用户名 */
  username: string;
  /** 认证方式 */
  authMethod: 'password' | 'dynamic-token' | 'key';
  /** 密码或动态码 */
  password?: string;
  /** 私钥路径 */
  privateKeyPath?: string;
  /** 连接超时 */
  timeout: number;
  /** 重试次数 */
  retryAttempts: number;
  /** 重试延迟 */
  retryDelay: number;
  /** 最大重试延迟 */
  maxRetryDelay: number;
  /** 动态码刷新间隔 */
  dynamicTokenRefreshInterval: number;
  /** 二维码图片路径 */
  qrCodeImagePath?: string;
  /** 基础路径 */
  basePath?: string;
}

/**
 * 仓库管理器接口
 */
export interface RepositoryManager {
  /**
   * 验证仓库URL
   * @param repoUrl 仓库URL
   * @returns 是否有效
   */
  validateRepoUrl(repoUrl: string): Promise<boolean>;

  /**
   * 克隆仓库
   * @param repoUrl 仓库URL
   * @param localPath 本地路径
   */
  cloneRepository(repoUrl: string, localPath: string): Promise<void>;

  /**
   * 获取仓库状态
   * @param localPath 本地路径
   * @returns 仓库状态
   */
  getRepositoryStatus(localPath: string): Promise<any>;

  /**
   * 提交变更
   * @param localPath 本地路径
   * @param message 提交信息
   * @returns 提交哈希
   */
  commitChanges(localPath: string, message: string): Promise<string>;
}

/**
 * SFTP操作接口
 */
export interface SFTPOperations {
  /**
   * 连接SFTP服务器
   * @param config SFTP配置
   */
  connect(config: SFTPConfig): Promise<void>;

  /**
   * 断开连接
   */
  disconnect(): Promise<void>;

  /**
   * 上传文件
   * @param localPath 本地路径
   * @param remotePath 远程路径
   */
  uploadFile(localPath: string, remotePath: string): Promise<void>;

  /**
   * 下载文件
   * @param remotePath 远程路径
   * @param localPath 本地路径
   */
  downloadFile(remotePath: string, localPath: string): Promise<void>;

  /**
   * 列出目录内容
   * @param remotePath 远程路径
   * @returns 文件列表
   */
  listDirectory(remotePath: string): Promise<string[]>;

  /**
   * 检查文件是否存在
   * @param remotePath 远程路径
   * @returns 是否存在
   */
  fileExists(remotePath: string): Promise<boolean>;
}