import * as path from 'path';
import { EventEmitter } from 'events';
import { ConflictInfo } from '../types';

/**
 * 冲突类型
 */
export enum ConflictType {
  CONTENT = 'content',
  RENAME = 'rename',
  DELETE = 'delete',
  BINARY = 'binary',
  PERMISSION = 'permission'
}

/**
 * 冲突解决策略
 */
export enum ConflictResolutionStrategy {
  MANUAL = 'manual',
  ACCEPT_LOCAL = 'accept_local',
  ACCEPT_REMOTE = 'accept_remote',
  MERGE_AUTO = 'merge_auto',
  MERGE_MANUAL = 'merge_manual'
}

/**
 * 文件版本信息
 */
export interface FileVersion {
  content: string;
  checksum: string;
  timestamp: Date;
  author?: string;
  message?: string;
}

/**
 * 冲突详情
 */
export interface ConflictDetail extends ConflictInfo {
  id: string;
  localVersionDetail: FileVersion;
  remoteVersionDetail: FileVersion;
  baseVersion?: FileVersion; // 共同祖先版本
  conflictMarkers?: ConflictMarker[];
  resolutionStrategy?: ConflictResolutionStrategy;
  resolved: boolean;
  resolvedAt?: Date;
  resolvedBy?: string;
}

/**
 * 冲突标记
 */
export interface ConflictMarker {
  startLine: number;
  endLine: number;
  localContent: string[];
  remoteContent: string[];
  baseContent?: string[];
}

/**
 * 合并结果
 */
export interface MergeResult {
  success: boolean;
  content?: string;
  conflicts: ConflictMarker[];
  hasConflicts: boolean;
  mergedLines: number;
  conflictLines: number;
}

/**
 * 三方合并配置
 */
export interface ThreeWayMergeConfig {
  ignoreWhitespace: boolean;
  ignoreCase: boolean;
  contextLines: number;
  conflictMarkerStyle: 'standard' | 'diff3' | 'merge';
}

/**
 * 冲突解决器
 * 提供高级的三方合并算法和冲突解决机制
 */
export class ConflictResolver extends EventEmitter {
  private conflicts: Map<string, ConflictDetail> = new Map();
  private mergeConfig: ThreeWayMergeConfig;

  constructor(config?: Partial<ThreeWayMergeConfig>) {
    super();
    
    this.mergeConfig = {
      ignoreWhitespace: false,
      ignoreCase: false,
      contextLines: 3,
      conflictMarkerStyle: 'standard',
      ...config
    };
  }

  /**
   * 检测文件冲突
   */
  async detectConflicts(
    filePath: string,
    localContent: string,
    remoteContent: string,
    baseContent?: string
  ): Promise<ConflictDetail | null> {
    // 如果内容相同，没有冲突
    if (localContent === remoteContent) {
      return null;
    }

    const conflictId = this.generateConflictId(filePath);
    
    const localVersion: FileVersion = {
      content: localContent,
      checksum: this.calculateChecksum(localContent),
      timestamp: new Date()
    };

    const remoteVersion: FileVersion = {
      content: remoteContent,
      checksum: this.calculateChecksum(remoteContent),
      timestamp: new Date()
    };

    let baseVersion: FileVersion | undefined;
    if (baseContent) {
      baseVersion = {
        content: baseContent,
        checksum: this.calculateChecksum(baseContent),
        timestamp: new Date()
      };
    }

    // 确定冲突类型
    const conflictType = this.determineConflictType(localContent, remoteContent, baseContent);

    const conflict: ConflictDetail = {
      id: conflictId,
      filePath,
      type: conflictType,
      description: this.generateConflictDescription(conflictType, filePath),
      localVersion: localVersion.checksum,
      remoteVersion: remoteVersion.checksum,
      localVersionDetail: localVersion,
      remoteVersionDetail: remoteVersion,
      baseVersion,
      resolved: false
    };

    // 如果是内容冲突，执行三方合并分析
    if (conflictType === ConflictType.CONTENT) {
      const mergeResult = await this.performThreeWayMerge(
        conflict.localVersionDetail.content,
        conflict.remoteVersionDetail.content,
        baseContent || ''
      );
      
      conflict.conflictMarkers = mergeResult.conflicts;
    }

    this.conflicts.set(conflictId, conflict);
    this.emit('conflictDetected', conflict);

    return conflict;
  }

  /**
   * 执行三方合并
   */
  async performThreeWayMerge(
    localContent: string,
    remoteContent: string,
    baseContent: string
  ): Promise<MergeResult> {
    const localLines = this.splitLines(localContent);
    const remoteLines = this.splitLines(remoteContent);
    const baseLines = this.splitLines(baseContent);

    const result: MergeResult = {
      success: false,
      conflicts: [],
      hasConflicts: false,
      mergedLines: 0,
      conflictLines: 0
    };

    try {
      // 使用改进的三方合并算法
      const mergedLines = await this.mergeLines(localLines, remoteLines, baseLines);
      
      result.content = mergedLines.join('\n');
      result.mergedLines = mergedLines.length;
      result.success = result.conflicts.length === 0;
      result.hasConflicts = result.conflicts.length > 0;
      result.conflictLines = result.conflicts.reduce((sum, conflict) => 
        sum + (conflict.endLine - conflict.startLine + 1), 0);

      this.emit('mergeCompleted', {
        success: result.success,
        conflictCount: result.conflicts.length,
        mergedLines: result.mergedLines
      });

      return result;
    } catch (error) {
      this.emit('mergeError', error);
      throw error;
    }
  }

  /**
   * 解决冲突
   */
  async resolveConflict(
    conflictId: string,
    strategy: ConflictResolutionStrategy,
    customContent?: string
  ): Promise<string> {
    const conflict = this.conflicts.get(conflictId);
    if (!conflict) {
      throw new Error(`Conflict ${conflictId} not found`);
    }

    let resolvedContent: string;

    switch (strategy) {
      case ConflictResolutionStrategy.ACCEPT_LOCAL:
        resolvedContent = conflict.localVersionDetail.content;
        break;

      case ConflictResolutionStrategy.ACCEPT_REMOTE:
        resolvedContent = conflict.remoteVersionDetail.content;
        break;

      case ConflictResolutionStrategy.MERGE_AUTO:
        {
          const mergeResult = await this.performThreeWayMerge(
            conflict.localVersionDetail.content,
            conflict.remoteVersionDetail.content,
            conflict.baseVersion?.content || ''
          );
          
          if (mergeResult.hasConflicts) {
            throw new Error('Automatic merge failed due to conflicts');
          }
          
          resolvedContent = mergeResult.content!;
        }
        break;

      case ConflictResolutionStrategy.MERGE_MANUAL:
        if (!customContent) {
          throw new Error('Custom content required for manual merge');
        }
        resolvedContent = customContent;
        break;

      default:
        throw new Error(`Unsupported resolution strategy: ${strategy}`);
    }

    // 更新冲突状态
    conflict.resolved = true;
    conflict.resolvedAt = new Date();
    conflict.resolutionStrategy = strategy;

    this.emit('conflictResolved', {
      conflictId,
      strategy,
      filePath: conflict.filePath
    });

    return resolvedContent;
  }

  /**
   * 生成冲突标记的内容
   */
  generateConflictMarkers(conflict: ConflictDetail): string {
    if (!conflict.conflictMarkers || conflict.conflictMarkers.length === 0) {
      return conflict.localVersionDetail.content;
    }

    const lines = this.splitLines(conflict.localVersionDetail.content);
    const result: string[] = [];
    let lastIndex = 0;

    for (const marker of conflict.conflictMarkers) {
      // 添加冲突前的内容
      result.push(...lines.slice(lastIndex, marker.startLine));

      // 添加冲突标记
      switch (this.mergeConfig.conflictMarkerStyle) {
        case 'standard':
          result.push('<<<<<<< LOCAL');
          result.push(...marker.localContent);
          result.push('=======');
          result.push(...marker.remoteContent);
          result.push('>>>>>>> REMOTE');
          break;

        case 'diff3':
          result.push('<<<<<<< LOCAL');
          result.push(...marker.localContent);
          if (marker.baseContent) {
            result.push('||||||| BASE');
            result.push(...marker.baseContent);
          }
          result.push('=======');
          result.push(...marker.remoteContent);
          result.push('>>>>>>> REMOTE');
          break;

        case 'merge':
          result.push(`<<<<<<< ${conflict.filePath} (LOCAL)`);
          result.push(...marker.localContent);
          result.push('=======');
          result.push(...marker.remoteContent);
          result.push(`>>>>>>> ${conflict.filePath} (REMOTE)`);
          break;
      }

      lastIndex = marker.endLine + 1;
    }

    // 添加剩余内容
    result.push(...lines.slice(lastIndex));

    return result.join('\n');
  }

  /**
   * 获取所有冲突
   */
  getAllConflicts(): ConflictDetail[] {
    return Array.from(this.conflicts.values());
  }

  /**
   * 获取未解决的冲突
   */
  getUnresolvedConflicts(): ConflictDetail[] {
    return Array.from(this.conflicts.values()).filter(conflict => !conflict.resolved);
  }

  /**
   * 获取特定冲突
   */
  getConflict(conflictId: string): ConflictDetail | undefined {
    return this.conflicts.get(conflictId);
  }

  /**
   * 清除已解决的冲突
   */
  clearResolvedConflicts(): number {
    const resolved = Array.from(this.conflicts.entries())
      .filter(([, conflict]) => conflict.resolved);
    
    for (const [id] of resolved) {
      this.conflicts.delete(id);
    }

    this.emit('resolvedConflictsCleared', { count: resolved.length });
    return resolved.length;
  }

  /**
   * 更新合并配置
   */
  updateMergeConfig(config: Partial<ThreeWayMergeConfig>): void {
    this.mergeConfig = { ...this.mergeConfig, ...config };
    this.emit('mergeConfigUpdated', this.mergeConfig);
  }

  /**
   * 改进的三方合并算法
   */
  private async mergeLines(
    localLines: string[],
    remoteLines: string[],
    baseLines: string[]
  ): Promise<string[]> {
    const result: string[] = [];
    const conflicts: ConflictMarker[] = [];

    // 使用最长公共子序列算法进行合并
    const localDiff = this.computeDiff(baseLines, localLines);
    const remoteDiff = this.computeDiff(baseLines, remoteLines);

    let localIndex = 0;
    let remoteIndex = 0;
    let baseIndex = 0;

    while (baseIndex < baseLines.length || localIndex < localDiff.length || remoteIndex < remoteDiff.length) {
      const localChange = localIndex < localDiff.length ? localDiff[localIndex] : null;
      const remoteChange = remoteIndex < remoteDiff.length ? remoteDiff[remoteIndex] : null;

      // 如果没有变更，使用基础版本
      if (!localChange && !remoteChange) {
        if (baseIndex < baseLines.length) {
          result.push(baseLines[baseIndex]);
          baseIndex++;
        }
        continue;
      }

      // 如果只有一方有变更，使用该变更
      if (localChange && !remoteChange) {
        this.applyChange(result, localChange);
        localIndex++;
        continue;
      }

      if (remoteChange && !localChange) {
        this.applyChange(result, remoteChange);
        remoteIndex++;
        continue;
      }

      // 如果双方都有变更，检查是否冲突
      if (localChange && remoteChange) {
        if (this.changesConflict(localChange, remoteChange)) {
          // 创建冲突标记
          const conflict: ConflictMarker = {
            startLine: result.length,
            endLine: result.length + Math.max(localChange.lines.length, remoteChange.lines.length) - 1,
            localContent: localChange.lines,
            remoteContent: remoteChange.lines,
            baseContent: baseIndex < baseLines.length ? [baseLines[baseIndex]] : undefined
          };
          
          conflicts.push(conflict);
          
          // 添加冲突标记到结果中
          result.push('<<<<<<< LOCAL');
          result.push(...localChange.lines);
          result.push('=======');
          result.push(...remoteChange.lines);
          result.push('>>>>>>> REMOTE');
        } else {
          // 非冲突变更，可以合并
          this.applyChange(result, localChange);
          this.applyChange(result, remoteChange);
        }
        
        localIndex++;
        remoteIndex++;
        baseIndex++;
      }
    }

    // 将冲突信息存储到结果中
    (result as any).conflicts = conflicts;
    
    return result;
  }

  /**
   * 计算差异
   */
  private computeDiff(baseLines: string[], targetLines: string[]): Array<{
    type: 'add' | 'delete' | 'modify';
    baseIndex: number;
    targetIndex: number;
    lines: string[];
  }> {
    // 简化的差异计算实现
    const diff: Array<{
      type: 'add' | 'delete' | 'modify';
      baseIndex: number;
      targetIndex: number;
      lines: string[];
    }> = [];

    // 这里应该实现更复杂的差异算法，如Myers算法
    // 为了简化，这里使用基本的逐行比较
    
    let baseIndex = 0;
    let targetIndex = 0;

    while (baseIndex < baseLines.length || targetIndex < targetLines.length) {
      if (baseIndex >= baseLines.length) {
        // 只有目标行剩余，都是添加
        diff.push({
          type: 'add',
          baseIndex,
          targetIndex,
          lines: [targetLines[targetIndex]]
        });
        targetIndex++;
      } else if (targetIndex >= targetLines.length) {
        // 只有基础行剩余，都是删除
        diff.push({
          type: 'delete',
          baseIndex,
          targetIndex,
          lines: []
        });
        baseIndex++;
      } else if (this.linesEqual(baseLines[baseIndex], targetLines[targetIndex])) {
        // 行相同，跳过
        baseIndex++;
        targetIndex++;
      } else {
        // 行不同，标记为修改
        diff.push({
          type: 'modify',
          baseIndex,
          targetIndex,
          lines: [targetLines[targetIndex]]
        });
        baseIndex++;
        targetIndex++;
      }
    }

    return diff;
  }

  /**
   * 应用变更
   */
  private applyChange(result: string[], change: {
    type: 'add' | 'delete' | 'modify';
    baseIndex: number;
    targetIndex: number;
    lines: string[];
  }): void {
    switch (change.type) {
      case 'add':
      case 'modify':
        result.push(...change.lines);
        break;
      case 'delete':
        // 删除操作不添加任何内容
        break;
    }
  }

  /**
   * 检查变更是否冲突
   */
  private changesConflict(
    localChange: { type: string; lines: string[] },
    remoteChange: { type: string; lines: string[] }
  ): boolean {
    // 如果变更内容相同，不冲突
    if (localChange.lines.length === remoteChange.lines.length) {
      for (let i = 0; i < localChange.lines.length; i++) {
        if (!this.linesEqual(localChange.lines[i], remoteChange.lines[i])) {
          return true;
        }
      }
      return false;
    }
    
    return true;
  }

  /**
   * 比较两行是否相等
   */
  private linesEqual(line1: string, line2: string): boolean {
    let l1 = line1;
    let l2 = line2;

    if (this.mergeConfig.ignoreWhitespace) {
      l1 = l1.trim();
      l2 = l2.trim();
    }

    if (this.mergeConfig.ignoreCase) {
      l1 = l1.toLowerCase();
      l2 = l2.toLowerCase();
    }

    return l1 === l2;
  }

  /**
   * 确定冲突类型
   */
  private determineConflictType(
    localContent: string,
    remoteContent: string,
    _baseContent?: string
  ): 'content' | 'rename' | 'delete' {
    // 检查是否为二进制文件
    if (this.isBinaryContent(localContent) || this.isBinaryContent(remoteContent)) {
      return 'content'; // 将二进制冲突归类为内容冲突
    }

    // 检查是否为重命名冲突
    // 这里需要更多上下文信息来判断，简化处理
    
    return 'content';
  }

  /**
   * 检查是否为二进制内容
   */
  private isBinaryContent(content: string): boolean {
    // 简单的二进制检测：检查是否包含null字符
    return content.includes('\0');
  }

  /**
   * 生成冲突描述
   */
  private generateConflictDescription(type: 'content' | 'rename' | 'delete', filePath: string): string {
    switch (type) {
      case 'content':
        return `Content conflict in ${filePath}`;
      case 'rename':
        return `Rename conflict in ${filePath}`;
      case 'delete':
        return `Delete conflict in ${filePath}`;
      default:
        return `Unknown conflict in ${filePath}`;
    }
  }

  /**
   * 分割文本为行
   */
  private splitLines(content: string): string[] {
    return content.split(/\r?\n/);
  }

  /**
   * 计算内容校验和
   */
  private calculateChecksum(content: string): string {
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  /**
   * 生成冲突ID
   */
  private generateConflictId(filePath: string): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 11);
    return `conflict_${timestamp}_${random}_${path.basename(filePath)}`;
  }
}
