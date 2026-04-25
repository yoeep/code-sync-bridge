/**
 * 代码流定义
 */
export interface CodeStream {
  /** 唯一标识符 */
  id: string;
  /** 代码流名称 */
  name: string;
  /** 仓库类型 */
  repoType: 'git' | 'svn';
  /** 仓库URL */
  repoUrl: string;
  /** 创建时间 */
  createdAt: Date;
  /** 最后同步时间 */
  lastSyncAt: Date;
  /** 状态 */
  status: 'active' | 'paused' | 'archived';
  /** 元数据 */
  metadata: StreamMetadata;
}

/**
 * 代码流元数据
 */
export interface StreamMetadata {
  /** 版本号 */
  version: string;
  /** 描述 */
  description?: string;
  /** 标签 */
  tags?: string[];
  /** 配置选项 */
  config?: Record<string, any>;
}

/**
 * 文件变更定义
 */
export interface FileChange {
  /** 文件路径 */
  path: string;
  /** 操作类型 */
  operation: 'create' | 'modify' | 'delete' | 'rename';
  /** 文件内容 */
  content?: Buffer;
  /** 重命名前的路径 */
  oldPath?: string;
  /** 文件校验和 */
  checksum: string;
  /** 变更时间戳 */
  timestamp: Date;
}

/**
 * 同步结果
 */
export interface SyncResult {
  /** 是否成功 */
  success: boolean;
  /** 应用的变更数量 */
  changesApplied: number;
  /** 冲突信息 */
  conflicts: ConflictInfo[];
  /** 错误信息 */
  errors: string[];
  /** 提交哈希 */
  commitHash?: string;
}

/**
 * 冲突信息
 */
export interface ConflictInfo {
  /** 冲突文件路径 */
  filePath: string;
  /** 冲突类型 */
  type: 'content' | 'rename' | 'delete';
  /** 冲突描述 */
  description: string;
  /** 本地版本 */
  localVersion?: string;
  /** 远程版本 */
  remoteVersion?: string;
}

/**
 * 代码流状态
 */
export interface StreamStatus {
  /** 代码流ID */
  streamId: string;
  /** 是否在线 */
  online: boolean;
  /** 最后活动时间 */
  lastActivity: Date;
  /** 待处理变更数量 */
  pendingChanges: number;
  /** 同步状态 */
  syncStatus: 'idle' | 'syncing' | 'error';
  /** 错误信息 */
  error?: string;
}