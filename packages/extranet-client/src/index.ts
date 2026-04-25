import { 
  ExtranetClient as IExtranetClient, 
} from '@code-sync-bridge/shared/interfaces';
import { CodeStream, FileChange, StreamStatus } from '@code-sync-bridge/shared/types';
import { ConfigManager } from '@code-sync-bridge/shared/config';
import { CodeStreamPullService } from './services/CodeStreamPullService';
import { CodeCommitService, CommitResult } from './services/CodeCommitService';
import { FileChangeTracker } from './services/FileChangeTracker';
import * as path from 'path';
import * as fs from 'fs/promises';

/**
 * 外网客户端实现
 */
export class ExtranetClient implements IExtranetClient {
  private configManager: ConfigManager;
  private pullService: CodeStreamPullService;
  private commitServices: Map<string, CodeCommitService> = new Map();
  private changeTrackers: Map<string, FileChangeTracker> = new Map();

  constructor(configPath?: string) {
    this.configManager = new ConfigManager(configPath);
    this.pullService = new CodeStreamPullService(this.configManager);
  }

  /**
   * 列出可用的代码流
   * 需求: 2.1, 2.2 - 连接SFTP并列出所有可用的CodeStream
   */
  async listAvailableStreams(): Promise<CodeStream[]> {
    return await this.pullService.listAvailableStreams();
  }

  /**
   * 拉取代码流
   * 需求: 2.3, 2.4, 2.5 - 下载代码包，解压到本地目录，初始化Git仓库
   */
  async pullCodeStream(streamId: string, localPath: string): Promise<void> {
    return await this.pullService.pullCodeStream(streamId, localPath);
  }

  /**
   * 推送变更
   * 需求: 4.1, 4.2 - 检测本地代码变更并创建变更包
   * 需求: 4.3, 4.4, 4.5 - 上传变更包到SFTP并跟踪状态
   */
  async pushChanges(streamId: string, changes?: FileChange[]): Promise<void> {
    const commitService = await this.getCommitService(streamId);
    
    if (changes && changes.length > 0) {
      // 如果提供了具体的变更，直接提交这些变更
      // 这里需要实现直接提交指定变更的逻辑
      throw new Error('Direct change submission not yet implemented');
    } else {
      // 自动检测并提交所有变更
      await commitService.commitChanges();
    }
  }

  /**
   * 获取代码流状态
   */
  async getStreamStatus(streamId: string): Promise<StreamStatus> {
    try {
      const commitService = await this.getCommitService(streamId);
      const changeStats = await commitService.getChangeStats();
      const hasPendingChanges = await commitService.hasPendingChanges();
      
      return {
        streamId,
        online: true, // 假设在线，实际可以通过SFTP连接测试
        lastActivity: changeStats.lastChangeTime || new Date(),
        pendingChanges: hasPendingChanges ? changeStats.totalChanges : 0,
        syncStatus: 'idle'
      };
    } catch (error) {
      return {
        streamId,
        online: false,
        lastActivity: new Date(),
        pendingChanges: 0,
        syncStatus: 'error',
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * 提交代码变更
   */
  async commitChanges(streamId: string, message?: string): Promise<CommitResult> {
    const commitService = await this.getCommitService(streamId);
    return await commitService.commitChanges(message);
  }

  /**
   * 检查是否有待提交的变更
   */
  async hasPendingChanges(streamId: string): Promise<boolean> {
    const commitService = await this.getCommitService(streamId);
    return await commitService.hasPendingChanges();
  }

  /**
   * 获取待提交的变更
   */
  async getPendingChanges(streamId: string): Promise<FileChange[]> {
    const commitService = await this.getCommitService(streamId);
    return await commitService.getPendingChanges();
  }

  /**
   * 获取提交历史
   */
  async getCommitHistory(streamId: string, limit?: number): Promise<CommitResult[]> {
    const commitService = await this.getCommitService(streamId);
    return await commitService.getCommitHistory(limit);
  }

  /**
   * 获取变更统计
   */
  async getChangeStats(streamId: string): Promise<{
    totalChanges: number;
    createdFiles: number;
    modifiedFiles: number;
    deletedFiles: number;
    lastChangeTime: Date | null;
  }> {
    const commitService = await this.getCommitService(streamId);
    return await commitService.getChangeStats();
  }

  /**
   * 获取代码流详细信息
   */
  async getCodeStreamInfo(streamId: string): Promise<CodeStream | null> {
    return await this.pullService.getCodeStreamInfo(streamId);
  }

  /**
   * 检查代码流是否有更新
   */
  async checkForUpdates(streamId: string, localPath: string): Promise<boolean> {
    return await this.pullService.checkForUpdates(streamId, localPath);
  }

  /**
   * 获取或创建提交服务实例
   */
  private async getCommitService(streamId: string): Promise<CodeCommitService> {
    if (!this.commitServices.has(streamId)) {
      // 需要找到对应的本地路径
      const localPath = await this.findLocalPath(streamId);
      if (!localPath) {
        throw new Error(`Local path not found for stream ${streamId}. Please pull the stream first.`);
      }

      const commitService = new CodeCommitService(
        localPath,
        streamId,
        this.configManager
      );
      
      this.commitServices.set(streamId, commitService);
    }

    return this.commitServices.get(streamId)!;
  }

  /**
   * 查找代码流的本地路径
   */
  private async findLocalPath(streamId: string): Promise<string | null> {
    // 这里可以实现多种策略来查找本地路径：
    // 1. 从配置文件中读取
    // 2. 从环境变量中读取
    // 3. 使用默认路径约定
    
    const defaultBasePath = process.env.CODE_SYNC_WORKSPACE || './workspace';
    const possiblePath = path.join(defaultBasePath, streamId);
    
    try {
      const metadataPath = path.join(possiblePath, '.code-sync', 'metadata.json');
      await fs.access(metadataPath);
      return possiblePath;
    } catch {
      return null;
    }
  }

  /**
   * 设置代码流的本地路径
   */
  setStreamPath(streamId: string, _localPath: string): void {
    // 清除现有的服务实例，强制重新创建
    this.commitServices.delete(streamId);
    this.changeTrackers.delete(streamId);
  }

  /**
   * 清理资源
   */
  async cleanup(): Promise<void> {
    await this.pullService.cleanup();
    
    // 清理所有提交服务
    for (const commitService of this.commitServices.values()) {
      await commitService.cleanup();
    }
    
    this.commitServices.clear();
    this.changeTrackers.clear();
  }
}

// 导出服务类供直接使用
export { CodeStreamPullService } from './services/CodeStreamPullService';
export { CodeCommitService, CommitResult } from './services/CodeCommitService';
export { FileChangeTracker } from './services/FileChangeTracker';

export default ExtranetClient;
