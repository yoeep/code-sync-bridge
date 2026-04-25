import { SyncResult, ConflictInfo } from '@code-sync-bridge/shared/types';
import { ConflictResolver, ConflictResolutionStrategy, ConflictDetail } from '@code-sync-bridge/shared/conflict/ConflictResolver';
import { ConflictNotificationManager, ConflictNotification } from '@code-sync-bridge/shared/conflict/ConflictNotificationManager';
import { RepositoryManager } from '../repository';
import { CodeStreamService } from './CodeStreamService';
import * as fs from 'fs/promises';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

type ConflictResolvedEvent = {
  conflictId: string;
  strategy: ConflictResolutionStrategy;
  filePath: string;
};

type MergeCompletedEvent = {
  success: boolean;
  conflictCount: number;
  mergedLines: number;
};

type NotificationActionEvent = {
  action: string;
  data: unknown;
  notification: ConflictNotification;
};

/**
 * VCS同步服务
 * 负责将外网变更应用到内网版本控制系统
 */
export class VCSSyncService {
  private repositoryManager: RepositoryManager;
  private codeStreamService: CodeStreamService;
  private conflictResolver: ConflictResolver;
  private notificationManager: ConflictNotificationManager;

  constructor(
    repositoryManager: RepositoryManager,
    codeStreamService: CodeStreamService
  ) {
    this.repositoryManager = repositoryManager;
    this.codeStreamService = codeStreamService;
    
    // 初始化冲突解决器
    this.conflictResolver = new ConflictResolver({
      ignoreWhitespace: false,
      ignoreCase: false,
      contextLines: 3,
      conflictMarkerStyle: 'standard'
    });

    // 初始化通知管理器
    this.notificationManager = new ConflictNotificationManager({
      enableDesktopNotifications: true,
      enableSoundNotifications: false,
      autoMarkReadAfter: 30000,
      maxNotifications: 100,
      groupSimilarNotifications: true
    });

    this.setupEventHandlers();
  }

  /**
   * 同步指定代码流的变更到VCS
   * @param streamId 代码流ID
   * @returns 同步结果
   */
  async syncChangesToVCS(streamId: string): Promise<SyncResult> {
    const result: SyncResult = {
      success: false,
      changesApplied: 0,
      conflicts: [],
      errors: []
    };

    try {
      console.log(`Starting VCS sync for stream ${streamId}`);

      // 获取代码流信息
      await this.codeStreamService.getCodeStream(streamId);
      const repoPath = this.codeStreamService.getRepositoryPath(streamId);

      // 获取待处理的变更文件
      const changesDir = path.join(repoPath, '../changes');
      const changeFiles = await this.getUnprocessedChanges(changesDir);

      if (changeFiles.length === 0) {
        console.log(`No changes to sync for stream ${streamId}`);
        result.success = true;
        return result;
      }

      // 确保仓库处于干净状态
      await this.ensureCleanRepository(repoPath);

      // 按时间顺序应用变更
      const sortedChanges = changeFiles.sort();
      
      for (const changeFile of sortedChanges) {
        try {
          const applied = await this.applyChangeFile(repoPath, changeFile);
          if (applied) {
            result.changesApplied++;
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          console.error(`Failed to apply change ${changeFile}:`, errorMessage);
          result.errors.push(`Failed to apply ${changeFile}: ${errorMessage}`);
          
          // 检查是否为冲突错误
          if (errorMessage.includes('conflict') || errorMessage.includes('merge')) {
            const conflict: ConflictInfo = {
              filePath: changeFile,
              type: 'content',
              description: errorMessage,
              localVersion: 'current',
              remoteVersion: 'incoming'
            };
            result.conflicts.push(conflict);
          }
        }
      }

      // 如果有冲突，使用增强的冲突解决机制
      if (result.conflicts.length > 0) {
        const resolvedConflicts = await this.handleConflictsAdvanced(repoPath, result.conflicts);
        result.conflicts = resolvedConflicts.filter(c => !c.resolved);
      }

      // 提交所有变更
      if (result.changesApplied > 0) {
        const commitMessage = `Sync ${result.changesApplied} changes from external network`;
        result.commitHash = await this.repositoryManager.commitChanges(repoPath, commitMessage);
        
        // 标记变更文件为已处理
        await this.markChangesAsProcessed(changesDir, sortedChanges);
      }

      result.success = result.errors.length === 0;
      console.log(`VCS sync completed for stream ${streamId}. Applied ${result.changesApplied} changes`);

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`VCS sync failed for stream ${streamId}:`, errorMessage);
      result.errors.push(errorMessage);
    }

    return result;
  }

  /**
   * 获取未处理的变更文件
   * @param changesDir 变更目录
   * @returns 变更文件列表
   */
  private async getUnprocessedChanges(changesDir: string): Promise<string[]> {
    try {
      const files = await fs.readdir(changesDir);
      const processedFile = path.join(changesDir, '.processed');
      
      let processedChanges: string[] = [];
      try {
        const processedContent = await fs.readFile(processedFile, 'utf-8');
        processedChanges = processedContent.split('\n').filter(line => line.trim());
      } catch {
        // 文件不存在，所有变更都未处理
      }

      return files
        .filter(file => file.endsWith('.patch'))
        .filter(file => !processedChanges.includes(file));
    } catch (error) {
      // 目录不存在
      return [];
    }
  }

  /**
   * 确保仓库处于干净状态
   * @param repoPath 仓库路径
   */
  private async ensureCleanRepository(repoPath: string): Promise<void> {
    const status = await this.repositoryManager.getRepositoryStatus(repoPath);
    
    if (status.hasChanges) {
      console.log('Repository has uncommitted changes, stashing them');
      
      if (status.type === 'git') {
        await execAsync('git stash push -m "Auto-stash before sync"', { cwd: repoPath });
      } else if (status.type === 'svn') {
        // SVN没有stash功能，先提交当前变更
        await this.repositoryManager.commitChanges(repoPath, 'Auto-commit before sync');
      }
    }
  }

  /**
   * 应用单个变更文件
   * @param repoPath 仓库路径
   * @param changeFile 变更文件路径
   * @returns 是否成功应用
   */
  private async applyChangeFile(repoPath: string, changeFile: string): Promise<boolean> {
    try {
      console.log(`Applying change file: ${changeFile}`);
      
      const changeFilePath = path.join(repoPath, '../changes', changeFile);
      
      // 读取变更文件内容
      const patchContent = await fs.readFile(changeFilePath, 'utf-8');
      
      // 检查是否为Git patch格式
      if (patchContent.includes('diff --git')) {
        return await this.applyGitPatch(repoPath, changeFilePath);
      } else {
        // 尝试作为通用patch应用
        return await this.applyGenericPatch(repoPath, changeFilePath);
      }
    } catch (error) {
      console.error(`Failed to apply change file ${changeFile}:`, error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  /**
   * 应用Git格式的patch
   * @param repoPath 仓库路径
   * @param patchPath patch文件路径
   * @returns 是否成功应用
   */
  private async applyGitPatch(repoPath: string, patchPath: string): Promise<boolean> {
    try {
      await execAsync(`git apply "${patchPath}"`, { cwd: repoPath });
      return true;
    } catch (error) {
      // 尝试三方合并
      try {
        await execAsync(`git apply --3way "${patchPath}"`, { cwd: repoPath });
        return true;
      } catch (mergeError) {
        throw new Error(`Git patch application failed: ${mergeError instanceof Error ? mergeError.message : String(mergeError)}`);
      }
    }
  }

  /**
   * 应用通用patch
   * @param repoPath 仓库路径
   * @param patchPath patch文件路径
   * @returns 是否成功应用
   */
  private async applyGenericPatch(repoPath: string, patchPath: string): Promise<boolean> {
    try {
      await execAsync(`patch -p1 < "${patchPath}"`, { cwd: repoPath });
      return true;
    } catch (error) {
      throw new Error(`Generic patch application failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 使用增强的冲突解决机制处理冲突
   * @param repoPath 仓库路径
   * @param conflicts 冲突列表
   * @returns 处理后的冲突详情列表
   */
  private async handleConflictsAdvanced(repoPath: string, conflicts: ConflictInfo[]): Promise<ConflictDetail[]> {
    console.log(`Handling ${conflicts.length} conflicts with advanced resolver`);
    
    const conflictDetails: ConflictDetail[] = [];

    for (const conflict of conflicts) {
      try {
        const conflictDetail = await this.analyzeAndResolveConflict(repoPath, conflict);
        if (conflictDetail) {
          conflictDetails.push(conflictDetail);
        }
      } catch (error) {
        console.error(`Failed to resolve conflict in ${conflict.filePath}:`, error instanceof Error ? error.message : String(error));
      }
    }

    // 发送批量冲突通知
    if (conflictDetails.length > 0) {
      this.notificationManager.notifyBatchConflicts(conflictDetails);
    }

    return conflictDetails;
  }

  /**
   * 分析并解决单个冲突
   * @param repoPath 仓库路径
   * @param conflict 冲突信息
   * @returns 冲突详情
   */
  private async analyzeAndResolveConflict(repoPath: string, conflict: ConflictInfo): Promise<ConflictDetail | null> {
    const filePath = path.join(repoPath, conflict.filePath);
    
    try {
      // 读取当前文件内容（包含冲突标记）
      const currentContent = await fs.readFile(filePath, 'utf-8');
      
      // 获取基础版本（如果可能）
      let baseContent: string | undefined;
      try {
        const { stdout } = await execAsync(`git show HEAD:${conflict.filePath}`, { cwd: repoPath });
        baseContent = stdout;
      } catch {
        // 无法获取基础版本，可能是新文件
      }

      // 提取本地和远程版本
      const { localContent, remoteContent } = this.extractVersionsFromConflictMarkers(currentContent);
      
      // 使用冲突解决器检测和分析冲突
      const conflictDetail = await this.conflictResolver.detectConflicts(
        conflict.filePath,
        localContent,
        remoteContent,
        baseContent
      );

      if (!conflictDetail) {
        return null;
      }

      // 发送冲突检测通知
      this.notificationManager.notifyConflictDetected(conflictDetail);

      // 尝试自动解决冲突
      const autoResolved = await this.attemptAutoResolution(conflictDetail, filePath);
      
      if (autoResolved) {
        // 发送解决成功通知
        this.notificationManager.notifyConflictResolved(
          conflictDetail.id,
          ConflictResolutionStrategy.MERGE_AUTO,
          conflict.filePath
        );
      }

      return conflictDetail;
    } catch (error) {
      console.error(`Failed to analyze conflict in ${conflict.filePath}:`, error instanceof Error ? error.message : String(error));
      return null;
    }
  }

  /**
   * 尝试自动解决冲突
   * @param conflictDetail 冲突详情
   * @param filePath 文件路径
   * @returns 是否成功自动解决
   */
  private async attemptAutoResolution(conflictDetail: ConflictDetail, filePath: string): Promise<boolean> {
    try {
      // 尝试自动合并
      const mergeResult = await this.conflictResolver.performThreeWayMerge(
        conflictDetail.localVersionDetail.content,
        conflictDetail.remoteVersionDetail.content,
        conflictDetail.baseVersion?.content || ''
      );

      if (mergeResult.success && !mergeResult.hasConflicts) {
        // 自动合并成功，写入文件
        await fs.writeFile(filePath, mergeResult.content!, 'utf-8');
        
        // 解决冲突
        await this.conflictResolver.resolveConflict(
          conflictDetail.id,
          ConflictResolutionStrategy.MERGE_AUTO
        );

        console.log(`Auto-resolved conflict in ${conflictDetail.filePath}`);
        return true;
      } else {
        // 自动合并失败，生成冲突标记
        const conflictMarkedContent = this.conflictResolver.generateConflictMarkers(conflictDetail);
        await fs.writeFile(filePath, conflictMarkedContent, 'utf-8');
        
        console.log(`Generated conflict markers for ${conflictDetail.filePath}`);
        return false;
      }
    } catch (error) {
      console.error(`Auto-resolution failed for ${conflictDetail.filePath}:`, error instanceof Error ? error.message : String(error));
      return false;
    }
  }

  /**
   * 从冲突标记中提取本地和远程版本
   * @param content 包含冲突标记的内容
   * @returns 本地和远程版本内容
   */
  private extractVersionsFromConflictMarkers(content: string): {
    localContent: string;
    remoteContent: string;
  } {
    const lines = content.split('\n');
    let localLines: string[] = [];
    let remoteLines: string[] = [];
    let currentSection: 'none' | 'local' | 'remote' = 'none';

    for (const line of lines) {
      if (line.startsWith('<<<<<<<')) {
        currentSection = 'local';
        continue;
      } else if (line.startsWith('=======')) {
        currentSection = 'remote';
        continue;
      } else if (line.startsWith('>>>>>>>')) {
        currentSection = 'none';
        continue;
      }

      switch (currentSection) {
        case 'local':
          localLines.push(line);
          break;
        case 'remote':
          remoteLines.push(line);
          break;
        case 'none':
          // 非冲突区域，添加到两个版本中
          localLines.push(line);
          remoteLines.push(line);
          break;
      }
    }

    return {
      localContent: localLines.join('\n'),
      remoteContent: remoteLines.join('\n')
    };
  }

  /**
   * 解决单个冲突
   * @param repoPath 仓库路径
   * @param conflict 冲突信息
   */
  private async resolveConflict(repoPath: string, conflict: ConflictInfo): Promise<void> {
    const filePath = path.join(repoPath, conflict.filePath);
    
    try {
      // 检查文件是否存在冲突标记
      const content = await fs.readFile(filePath, 'utf-8');
      
      if (content.includes('<<<<<<<') && content.includes('>>>>>>>')) {
        // 自动解决冲突：优先使用远程版本
        const resolvedContent = this.autoResolveConflictMarkers(content);
        await fs.writeFile(filePath, resolvedContent, 'utf-8');
        
        console.log(`Auto-resolved conflict in ${conflict.filePath}`);
      }
    } catch (error) {
      console.error(`Failed to resolve conflict in ${conflict.filePath}:`, error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * 自动解决冲突标记
   * @param content 包含冲突标记的内容
   * @returns 解决后的内容
   */
  private autoResolveConflictMarkers(content: string): string {
    // 简单策略：使用远程版本（incoming changes）
    return content.replace(
      /<<<<<<< .*?\n([\s\S]*?)\n=======\n([\s\S]*?)\n>>>>>>> .*?\n/g,
      '$2\n'
    );
  }

  /**
   * 标记变更文件为已处理
   * @param changesDir 变更目录
   * @param processedFiles 已处理的文件列表
   */
  private async markChangesAsProcessed(
    changesDir: string, 
    processedFiles: string[]
  ): Promise<void> {
    const processedFile = path.join(changesDir, '.processed');
    
    try {
      // 读取现有的已处理文件列表
      let existingProcessed: string[] = [];
      try {
        const content = await fs.readFile(processedFile, 'utf-8');
        existingProcessed = content.split('\n').filter(line => line.trim());
      } catch {
        // 文件不存在
      }

      // 合并新处理的文件
      const allProcessed = [...new Set([...existingProcessed, ...processedFiles])];
      
      // 写回文件
      await fs.writeFile(processedFile, allProcessed.join('\n'), 'utf-8');
      
      console.log(`Marked ${processedFiles.length} changes as processed`);
    } catch (error) {
      console.error('Failed to mark changes as processed:', error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * 批量同步所有活跃代码流
   * @returns 同步结果汇总
   */
  async syncAllActiveStreams(): Promise<{
    totalStreams: number;
    successfulSyncs: number;
    failedSyncs: number;
    totalChanges: number;
    results: Array<{ streamId: string; result: SyncResult }>;
  }> {
    const summary = {
      totalStreams: 0,
      successfulSyncs: 0,
      failedSyncs: 0,
      totalChanges: 0,
      results: [] as Array<{ streamId: string; result: SyncResult }>
    };

    try {
      // 获取所有活跃的代码流
      const codeStreams = await this.codeStreamService.listCodeStreams();
      const activeStreams = codeStreams.filter(stream => stream.status === 'active');
      
      summary.totalStreams = activeStreams.length;

      // 逐个同步代码流
      for (const stream of activeStreams) {
        try {
          const result = await this.syncChangesToVCS(stream.id);
          summary.results.push({ streamId: stream.id, result });
          
          if (result.success) {
            summary.successfulSyncs++;
          } else {
            summary.failedSyncs++;
          }
          
          summary.totalChanges += result.changesApplied;
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          console.error(`Failed to sync stream ${stream.id}:`, errorMessage);
          summary.failedSyncs++;
          
          const failedResult: SyncResult = {
            success: false,
            changesApplied: 0,
            conflicts: [],
            errors: [errorMessage]
          };
          summary.results.push({ streamId: stream.id, result: failedResult });
        }
      }

      console.log(`Batch sync completed: ${summary.successfulSyncs}/${summary.totalStreams} successful`);
    } catch (error) {
      console.error('Batch sync failed:', error instanceof Error ? error.message : String(error));
    }

    return summary;
  }

  /**
   * 设置事件处理器
   */
  private setupEventHandlers(): void {
    // 冲突解决器事件
    this.conflictResolver.on('conflictDetected', (conflict: ConflictDetail) => {
      console.log(`Conflict detected in ${conflict.filePath}: ${conflict.description}`);
    });

    this.conflictResolver.on('conflictResolved', ({ conflictId, strategy, filePath }: ConflictResolvedEvent) => {
      console.log(`Conflict ${conflictId} in ${filePath} resolved using ${strategy}`);
    });

    this.conflictResolver.on('mergeCompleted', ({ success, conflictCount, mergedLines }: MergeCompletedEvent) => {
      if (success) {
        console.log(`Merge completed successfully with ${mergedLines} lines`);
      } else {
        console.log(`Merge completed with ${conflictCount} conflicts remaining`);
      }
    });

    // 通知管理器事件
    this.notificationManager.on('notificationActionExecuted', ({ action, data, notification }: NotificationActionEvent) => {
      this.handleNotificationAction(action, data, notification);
    });
  }

  /**
   * 处理通知操作
   * @param action 操作类型
   * @param data 操作数据
   * @param notification 通知信息
   */
  private async handleNotificationAction(action: string, data: unknown, notification: ConflictNotification): Promise<void> {
    try {
      const actionData = (data ?? {}) as { strategy?: ConflictResolutionStrategy; filePath?: string };
      switch (action) {
        case 'resolve-conflict':
          if (notification.conflictId && actionData.strategy) {
            await this.resolveConflictById(notification.conflictId, actionData.strategy);
          }
          break;

        case 'resolve-all-conflicts':
          if (actionData.strategy) {
            await this.resolveAllConflicts(actionData.strategy);
          }
          break;

        case 'retry-merge':
          if (actionData.filePath) {
            await this.retryMergeForFile(actionData.filePath);
          }
          break;

        default:
          console.log(`Unhandled notification action: ${action}`);
      }
    } catch (error) {
      console.error(`Failed to handle notification action ${action}:`, error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * 根据ID解决冲突
   * @param conflictId 冲突ID
   * @param strategy 解决策略
   */
  private async resolveConflictById(conflictId: string, strategy: ConflictResolutionStrategy): Promise<void> {
    const conflict = this.conflictResolver.getConflict(conflictId);
    if (!conflict) {
      throw new Error(`Conflict ${conflictId} not found`);
    }

    const resolvedContent = await this.conflictResolver.resolveConflict(conflictId, strategy);
    
    // 写入解决后的内容到文件
    await fs.writeFile(conflict.filePath, resolvedContent, 'utf-8');
    
    // 发送解决成功通知
    this.notificationManager.notifyConflictResolved(conflictId, strategy, conflict.filePath);
  }

  /**
   * 解决所有未解决的冲突
   * @param strategy 解决策略
   */
  private async resolveAllConflicts(strategy: ConflictResolutionStrategy): Promise<void> {
    const unresolvedConflicts = this.conflictResolver.getUnresolvedConflicts();
    
    for (const conflict of unresolvedConflicts) {
      try {
        await this.resolveConflictById(conflict.id, strategy);
      } catch (error) {
        console.error(`Failed to resolve conflict ${conflict.id}:`, error instanceof Error ? error.message : String(error));
      }
    }
  }

  /**
   * 重试文件合并
   * @param filePath 文件路径
   */
  private async retryMergeForFile(filePath: string): Promise<void> {
    // 这里可以实现重试逻辑
    console.log(`Retrying merge for file: ${filePath}`);
    // 实际实现需要根据具体需求来定制
  }

  /**
   * 获取冲突统计信息
   */
  getConflictStatistics(): {
    totalConflicts: number;
    unresolvedConflicts: number;
    resolvedConflicts: number;
    conflictsByType: Record<string, number>;
  } {
    const allConflicts = this.conflictResolver.getAllConflicts();
    const unresolvedConflicts = this.conflictResolver.getUnresolvedConflicts();
    
    const conflictsByType: Record<string, number> = {};
    allConflicts.forEach((conflict: ConflictDetail) => {
      conflictsByType[conflict.type] = (conflictsByType[conflict.type] || 0) + 1;
    });

    return {
      totalConflicts: allConflicts.length,
      unresolvedConflicts: unresolvedConflicts.length,
      resolvedConflicts: allConflicts.length - unresolvedConflicts.length,
      conflictsByType
    };
  }

  /**
   * 获取通知统计信息
   */
  getNotificationStatistics() {
    return this.notificationManager.getNotificationStats();
  }

  /**
   * 清理已解决的冲突
   */
  cleanupResolvedConflicts(): number {
    return this.conflictResolver.clearResolvedConflicts();
  }

  /**
   * 获取冲突解决器实例（用于外部访问）
   */
  getConflictResolver(): ConflictResolver {
    return this.conflictResolver;
  }

  /**
   * 获取通知管理器实例（用于外部访问）
   */
  getNotificationManager(): ConflictNotificationManager {
    return this.notificationManager;
  }
}
