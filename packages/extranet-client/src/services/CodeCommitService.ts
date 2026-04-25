import { FileChange } from '@code-sync-bridge/shared/types';
import { ConfigManager } from '@code-sync-bridge/shared/config';
import { SFTPConnectionManager } from '@code-sync-bridge/shared/sftp';
import { FileChangeTracker } from './FileChangeTracker';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as crypto from 'crypto';
import AdmZip = require('adm-zip');

/**
 * 提交结果
 */
export interface CommitResult {
  success: boolean;
  commitId: string;
  changesCount: number;
  uploadedSize: number;
  timestamp: Date;
  error?: string;
}

/**
 * 提交状态
 */
export interface CommitStatus {
  commitId: string;
  status: 'pending' | 'uploading' | 'completed' | 'failed';
  progress: number;
  message?: string;
  timestamp: Date;
}

/**
 * 代码提交服务
 * 负责创建变更包，上传到SFTP，跟踪提交状态
 */
export class CodeCommitService {
  private basePath: string;
  private streamId: string;
  private sftpManager: SFTPConnectionManager;
  private changeTracker: FileChangeTracker;
  private configManager: ConfigManager;
  private commitHistoryPath: string;

  constructor(
    basePath: string, 
    streamId: string, 
    configManager: ConfigManager,
    excludePatterns?: string[]
  ) {
    this.basePath = basePath;
    this.streamId = streamId;
    this.configManager = configManager;
    this.changeTracker = new FileChangeTracker(basePath, excludePatterns);
    
    const sftpConfig = this.configManager.getConfig().sftp;
    this.sftpManager = new SFTPConnectionManager(sftpConfig);
    
    this.commitHistoryPath = path.join(basePath, '.code-sync', 'commits.json');
  }

  /**
   * 提交代码变更
   * 需求: 4.3 - WHEN 变更包创建完成，THE ExtranetClient SHALL 连接SFTPBridge并验证DynamicToken
   * 需求: 4.4 - WHEN 连接成功，THE ExtranetClient SHALL 上传变更包到指定CodeStream目录
   * 需求: 4.5 - THE ExtranetClient SHALL 更新本地提交记录并返回提交确认
   */
  async commitChanges(message?: string): Promise<CommitResult> {
    const commitId = this.generateCommitId();
    const timestamp = new Date();

    try {
      // 更新提交状态
      await this.updateCommitStatus(commitId, {
        commitId,
        status: 'pending',
        progress: 0,
        message: 'Detecting changes...',
        timestamp
      });

      // 检测变更
      const changes = await this.changeTracker.detectChanges();
      
      if (changes.length === 0) {
        return {
          success: true,
          commitId,
          changesCount: 0,
          uploadedSize: 0,
          timestamp,
          error: 'No changes to commit'
        };
      }

      // 更新状态
      await this.updateCommitStatus(commitId, {
        commitId,
        status: 'pending',
        progress: 20,
        message: `Found ${changes.length} changes, creating change package...`,
        timestamp
      });

      // 创建变更包
      const changePackage = await this.createChangePackage(changes, message || 'Code changes from extranet client');
      
      // 更新状态
      await this.updateCommitStatus(commitId, {
        commitId,
        status: 'uploading',
        progress: 50,
        message: 'Uploading changes to SFTP...',
        timestamp
      });

      // 上传到SFTP
      await this.uploadChangePackage(commitId, changePackage);

      // 更新状态
      await this.updateCommitStatus(commitId, {
        commitId,
        status: 'completed',
        progress: 100,
        message: 'Changes uploaded successfully',
        timestamp
      });

      // 添加到变更历史
      await this.changeTracker.addToHistory(changes);

      // 保存提交记录
      await this.saveCommitRecord({
        success: true,
        commitId,
        changesCount: changes.length,
        uploadedSize: changePackage.length,
        timestamp
      });

      return {
        success: true,
        commitId,
        changesCount: changes.length,
        uploadedSize: changePackage.length,
        timestamp
      };

    } catch (error) {
      // 更新失败状态
      await this.updateCommitStatus(commitId, {
        commitId,
        status: 'failed',
        progress: 0,
        message: error instanceof Error ? error.message : String(error),
        timestamp
      });

      const result: CommitResult = {
        success: false,
        commitId,
        changesCount: 0,
        uploadedSize: 0,
        timestamp,
        error: error instanceof Error ? error.message : String(error)
      };

      await this.saveCommitRecord(result);
      throw new Error(`Commit failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 创建变更包
   */
  private async createChangePackage(changes: FileChange[], message: string): Promise<Buffer> {
    const zip = new AdmZip();
    
    // 创建变更元数据
    const metadata = {
      commitId: this.generateCommitId(),
      streamId: this.streamId,
      timestamp: new Date().toISOString(),
      message,
      changesCount: changes.length,
      changes: changes.map(change => ({
        path: change.path,
        operation: change.operation,
        checksum: change.checksum,
        oldPath: change.oldPath,
        size: change.content?.length || 0
      }))
    };

    // 添加元数据文件
    zip.addFile('metadata.json', Buffer.from(JSON.stringify(metadata, null, 2)));

    // 添加变更的文件
    for (const change of changes) {
      if (change.operation !== 'delete' && change.content) {
        zip.addFile(`files/${change.path}`, change.content);
      }
    }

    return zip.toBuffer();
  }

  /**
   * 上传变更包到SFTP
   */
  private async uploadChangePackage(commitId: string, packageBuffer: Buffer): Promise<void> {
    try {
      // 连接SFTP
      await this.sftpManager.connect();

      // 确保目录存在
      const changesDir = `/code-sync-bridge/streams/${this.streamId}/changes`;
      await this.sftpManager.createDirectory(changesDir, true);

      // 上传变更包
      const packagePath = `${changesDir}/${commitId}.zip`;
      await this.sftpManager.uploadBuffer(packageBuffer, packagePath);

      // 创建提交标记文件
      const commitInfo = {
        commitId,
        streamId: this.streamId,
        timestamp: new Date().toISOString(),
        size: packageBuffer.length,
        status: 'completed'
      };

      const commitInfoPath = `${changesDir}/${commitId}.json`;
      await this.sftpManager.uploadBuffer(
        Buffer.from(JSON.stringify(commitInfo, null, 2)), 
        commitInfoPath
      );

    } catch (error) {
      throw new Error(`Failed to upload change package: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 获取提交状态
   */
  async getCommitStatus(commitId: string): Promise<CommitStatus | null> {
    try {
      const statusPath = path.join(this.basePath, '.code-sync', 'status', `${commitId}.json`);
      const statusData = await fs.readFile(statusPath, 'utf-8');
      const status = JSON.parse(statusData);
      
      return {
        ...status,
        timestamp: new Date(status.timestamp)
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * 更新提交状态
   */
  private async updateCommitStatus(commitId: string, status: CommitStatus): Promise<void> {
    try {
      const statusDir = path.join(this.basePath, '.code-sync', 'status');
      await fs.mkdir(statusDir, { recursive: true });
      
      const statusPath = path.join(statusDir, `${commitId}.json`);
      await fs.writeFile(statusPath, JSON.stringify(status, null, 2));
    } catch (error) {
      console.warn('Failed to update commit status:', error);
    }
  }

  /**
   * 保存提交记录
   */
  private async saveCommitRecord(result: CommitResult): Promise<void> {
    try {
      let history: CommitResult[] = [];
      
      try {
        const historyData = await fs.readFile(this.commitHistoryPath, 'utf-8');
        history = JSON.parse(historyData);
      } catch {
        // 历史文件不存在，使用空数组
      }

      history.unshift(result);
      
      // 只保留最近100条记录
      if (history.length > 100) {
        history = history.slice(0, 100);
      }

      await fs.mkdir(path.dirname(this.commitHistoryPath), { recursive: true });
      await fs.writeFile(this.commitHistoryPath, JSON.stringify(history, null, 2));
    } catch (error) {
      console.warn('Failed to save commit record:', error);
    }
  }

  /**
   * 获取提交历史
   */
  async getCommitHistory(limit: number = 20): Promise<CommitResult[]> {
    try {
      const historyData = await fs.readFile(this.commitHistoryPath, 'utf-8');
      const history = JSON.parse(historyData);
      
      return history
        .map((record: any) => ({
          ...record,
          timestamp: new Date(record.timestamp)
        }))
        .slice(0, limit);
    } catch (error) {
      return [];
    }
  }

  /**
   * 检查是否有待提交的变更
   */
  async hasPendingChanges(): Promise<boolean> {
    return await this.changeTracker.hasUncommittedChanges();
  }

  /**
   * 获取待提交的变更
   */
  async getPendingChanges(): Promise<FileChange[]> {
    return await this.changeTracker.detectChanges();
  }

  /**
   * 获取变更统计
   */
  async getChangeStats(): Promise<{
    totalChanges: number;
    createdFiles: number;
    modifiedFiles: number;
    deletedFiles: number;
    lastChangeTime: Date | null;
  }> {
    return await this.changeTracker.getChangeStats();
  }

  /**
   * 验证远程提交状态
   */
  async verifyRemoteCommit(commitId: string): Promise<boolean> {
    try {
      await this.sftpManager.connect();
      
      const commitInfoPath = `/code-sync-bridge/streams/${this.streamId}/changes/${commitId}.json`;
      return await this.sftpManager.fileExists(commitInfoPath);
    } catch (error) {
      console.warn('Failed to verify remote commit:', error);
      return false;
    }
  }

  /**
   * 获取远程提交列表
   */
  async getRemoteCommits(): Promise<string[]> {
    try {
      await this.sftpManager.connect();
      
      const changesDir = `/code-sync-bridge/streams/${this.streamId}/changes`;
      const files = await this.sftpManager.listDirectory(changesDir);
      
      return files
        .filter(file => file.endsWith('.json'))
        .map(file => file.replace('.json', ''))
        .sort()
        .reverse(); // 最新的在前
    } catch (error) {
      console.warn('Failed to get remote commits:', error);
      return [];
    }
  }

  /**
   * 生成提交ID
   */
  private generateCommitId(): string {
    const timestamp = Date.now().toString();
    const random = Math.random().toString(36).substring(2, 8);
    const hash = crypto.createHash('md5').update(`${timestamp}-${random}`).digest('hex');
    return `${timestamp}-${hash.substring(0, 8)}`;
  }

  /**
   * 清理本地状态文件
   */
  async cleanup(): Promise<void> {
    try {
      const statusDir = path.join(this.basePath, '.code-sync', 'status');
      const files = await fs.readdir(statusDir).catch(() => []);
      
      const now = Date.now();
      const maxAge = 7 * 24 * 60 * 60 * 1000; // 7天

      for (const file of files) {
        if (file.endsWith('.json')) {
          const filePath = path.join(statusDir, file);
          const stats = await fs.stat(filePath);
          
          if (now - stats.mtime.getTime() > maxAge) {
            await fs.unlink(filePath);
          }
        }
      }

      await this.sftpManager.disconnect();
    } catch (error) {
      console.warn('Error during cleanup:', error);
    }
  }

  /**
   * 重置提交状态
   */
  async resetCommitState(): Promise<void> {
    try {
      const statusDir = path.join(this.basePath, '.code-sync', 'status');
      const files = await fs.readdir(statusDir).catch(() => []);
      
      for (const file of files) {
        if (file.endsWith('.json')) {
          await fs.unlink(path.join(statusDir, file));
        }
      }

      await this.changeTracker.reset();
      console.log('Commit state reset successfully');
    } catch (error) {
      console.warn('Failed to reset commit state:', error);
    }
  }
}
