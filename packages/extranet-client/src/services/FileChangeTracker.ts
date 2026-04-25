import { FileChange } from '@code-sync-bridge/shared/types';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import { execSync } from 'child_process';

/**
 * 文件变更记录
 */
interface ChangeRecord {
  path: string;
  operation: 'create' | 'modify' | 'delete' | 'rename';
  checksum: string;
  timestamp: Date;
  oldPath?: string;
  size: number;
}

/**
 * 文件状态快照
 */
interface FileSnapshot {
  path: string;
  checksum: string;
  size: number;
  mtime: Date;
}

/**
 * 文件变更跟踪服务
 * 负责检测本地文件变更，计算文件差异，管理变更历史记录
 */
export class FileChangeTracker {
  private basePath: string;
  private snapshotPath: string;
  private historyPath: string;
  private excludePatterns: string[];

  constructor(basePath: string, excludePatterns: string[] = []) {
    this.basePath = basePath;
    this.snapshotPath = path.join(basePath, '.code-sync', 'snapshot.json');
    this.historyPath = path.join(basePath, '.code-sync', 'history.json');
    this.excludePatterns = [
      '.git/**',
      '.code-sync/**',
      'node_modules/**',
      '*.tmp',
      '*.temp',
      '*.log',
      ...excludePatterns
    ];
  }

  /**
   * 检测本地文件变更
   * 需求: 4.1 - WHEN 外网开发者执行提交命令，THE ExtranetClient SHALL 检测本地代码变更
   */
  async detectChanges(): Promise<FileChange[]> {
    try {
      // 获取当前文件快照
      const currentSnapshot = await this.createFileSnapshot();
      
      // 获取上次的快照
      const previousSnapshot = await this.loadPreviousSnapshot();
      
      // 计算差异
      const changes = await this.calculateDifferences(previousSnapshot, currentSnapshot);
      
      // 保存当前快照
      await this.saveSnapshot(currentSnapshot);
      
      return changes;
    } catch (error) {
      throw new Error(`Failed to detect changes: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 创建当前文件系统快照
   */
  private async createFileSnapshot(): Promise<Map<string, FileSnapshot>> {
    const snapshot = new Map<string, FileSnapshot>();
    
    await this.walkDirectory(this.basePath, async (filePath: string, stats: any) => {
      const relativePath = path.relative(this.basePath, filePath);
      
      // 跳过排除的文件
      if (this.shouldExclude(relativePath)) {
        return;
      }

      try {
        const content = await fs.readFile(filePath);
        const checksum = this.calculateChecksum(content);
        
        snapshot.set(relativePath, {
          path: relativePath,
          checksum,
          size: stats.size,
          mtime: stats.mtime
        });
      } catch (error) {
        console.warn(`Failed to process file ${relativePath}:`, error);
      }
    });

    return snapshot;
  }

  /**
   * 加载上次保存的快照
   */
  private async loadPreviousSnapshot(): Promise<Map<string, FileSnapshot>> {
    try {
      const snapshotData = await fs.readFile(this.snapshotPath, 'utf-8');
      const snapshotArray = JSON.parse(snapshotData);
      
      const snapshot = new Map<string, FileSnapshot>();
      for (const item of snapshotArray) {
        snapshot.set(item.path, {
          ...item,
          mtime: new Date(item.mtime)
        });
      }
      
      return snapshot;
    } catch (error) {
      // 如果快照文件不存在，返回空快照
      return new Map();
    }
  }

  /**
   * 保存当前快照
   */
  private async saveSnapshot(snapshot: Map<string, FileSnapshot>): Promise<void> {
    try {
      await fs.mkdir(path.dirname(this.snapshotPath), { recursive: true });
      
      const snapshotArray = Array.from(snapshot.values());
      await fs.writeFile(this.snapshotPath, JSON.stringify(snapshotArray, null, 2));
    } catch (error) {
      console.warn('Failed to save snapshot:', error);
    }
  }

  /**
   * 计算两个快照之间的差异
   * 需求: 4.2 - WHEN 检测到变更，THE ExtranetClient SHALL 创建变更包含差异信息
   */
  private async calculateDifferences(
    previous: Map<string, FileSnapshot>,
    current: Map<string, FileSnapshot>
  ): Promise<FileChange[]> {
    const changes: FileChange[] = [];

    // 检查新增和修改的文件
    for (const [filePath, currentFile] of current.entries()) {
      const previousFile = previous.get(filePath);
      
      if (!previousFile) {
        // 新增文件
        const content = await this.readFileContent(filePath);
        changes.push({
          path: filePath,
          operation: 'create',
          content,
          checksum: currentFile.checksum,
          timestamp: new Date()
        });
      } else if (previousFile.checksum !== currentFile.checksum) {
        // 修改文件
        const content = await this.readFileContent(filePath);
        changes.push({
          path: filePath,
          operation: 'modify',
          content,
          checksum: currentFile.checksum,
          timestamp: new Date()
        });
      }
    }

    // 检查删除的文件
    for (const [filePath, previousFile] of previous.entries()) {
      if (!current.has(filePath)) {
        changes.push({
          path: filePath,
          operation: 'delete',
          checksum: previousFile.checksum,
          timestamp: new Date()
        });
      }
    }

    return changes;
  }

  /**
   * 读取文件内容
   */
  private async readFileContent(relativePath: string): Promise<Buffer> {
    const fullPath = path.join(this.basePath, relativePath);
    return await fs.readFile(fullPath);
  }

  /**
   * 计算文件校验和
   */
  private calculateChecksum(content: Buffer): string {
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  /**
   * 遍历目录
   */
  private async walkDirectory(
    dirPath: string, 
    callback: (filePath: string, stats: any) => Promise<void>
  ): Promise<void> {
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        
        if (entry.isDirectory()) {
          await this.walkDirectory(fullPath, callback);
        } else if (entry.isFile()) {
          const stats = await fs.stat(fullPath);
          await callback(fullPath, stats);
        }
      }
    } catch (error) {
      console.warn(`Failed to walk directory ${dirPath}:`, error);
    }
  }

  /**
   * 检查文件是否应该被排除
   */
  private shouldExclude(relativePath: string): boolean {
    const normalizedPath = relativePath.replace(/\\/g, '/');
    
    return this.excludePatterns.some(pattern => {
      // 简单的glob模式匹配
      const regexPattern = pattern
        .replace(/\*\*/g, '.*')
        .replace(/\*/g, '[^/]*')
        .replace(/\?/g, '[^/]');
      
      const regex = new RegExp(`^${regexPattern}$`);
      return regex.test(normalizedPath);
    });
  }

  /**
   * 获取变更历史记录
   */
  async getChangeHistory(limit: number = 50): Promise<ChangeRecord[]> {
    try {
      const historyData = await fs.readFile(this.historyPath, 'utf-8');
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
   * 添加变更记录到历史
   */
  async addToHistory(changes: FileChange[]): Promise<void> {
    try {
      const history = await this.getChangeHistory(1000); // 保留最近1000条记录
      
      const newRecords: ChangeRecord[] = changes.map(change => ({
        path: change.path,
        operation: change.operation,
        checksum: change.checksum,
        timestamp: change.timestamp,
        oldPath: change.oldPath,
        size: change.content?.length || 0
      }));

      const updatedHistory = [...newRecords, ...history].slice(0, 1000);
      
      await fs.mkdir(path.dirname(this.historyPath), { recursive: true });
      await fs.writeFile(this.historyPath, JSON.stringify(updatedHistory, null, 2));
    } catch (error) {
      console.warn('Failed to add to history:', error);
    }
  }

  /**
   * 获取文件的变更统计
   */
  async getChangeStats(): Promise<{
    totalChanges: number;
    createdFiles: number;
    modifiedFiles: number;
    deletedFiles: number;
    lastChangeTime: Date | null;
  }> {
    const history = await this.getChangeHistory();
    
    const stats = {
      totalChanges: history.length,
      createdFiles: history.filter(r => r.operation === 'create').length,
      modifiedFiles: history.filter(r => r.operation === 'modify').length,
      deletedFiles: history.filter(r => r.operation === 'delete').length,
      lastChangeTime: history.length > 0 ? history[0].timestamp : null
    };

    return stats;
  }

  /**
   * 重置跟踪状态（清除快照和历史）
   */
  async reset(): Promise<void> {
    try {
      await fs.unlink(this.snapshotPath).catch(() => {});
      await fs.unlink(this.historyPath).catch(() => {});
      console.log('File change tracking state reset');
    } catch (error) {
      console.warn('Failed to reset tracking state:', error);
    }
  }

  /**
   * 检查是否有未提交的变更
   */
  async hasUncommittedChanges(): Promise<boolean> {
    const changes = await this.detectChanges();
    return changes.length > 0;
  }

  /**
   * 获取特定文件的变更历史
   */
  async getFileHistory(filePath: string, limit: number = 20): Promise<ChangeRecord[]> {
    const history = await this.getChangeHistory(1000);
    
    return history
      .filter(record => record.path === filePath || record.oldPath === filePath)
      .slice(0, limit);
  }

  /**
   * 使用Git获取变更（如果可用）
   */
  async getGitChanges(): Promise<FileChange[]> {
    try {
      // 检查是否在Git仓库中
      execSync('git rev-parse --git-dir', { cwd: this.basePath, stdio: 'pipe' });
      
      // 获取Git状态
      const statusOutput = execSync('git status --porcelain', { 
        cwd: this.basePath, 
        encoding: 'utf-8' 
      });

      const changes: FileChange[] = [];
      const lines = statusOutput.trim().split('\n').filter(line => line.length > 0);

      for (const line of lines) {
        const status = line.substring(0, 2);
        const filePath = line.substring(3);

        let operation: 'create' | 'modify' | 'delete' | 'rename';
        
        if (status.includes('A')) {
          operation = 'create';
        } else if (status.includes('M')) {
          operation = 'modify';
        } else if (status.includes('D')) {
          operation = 'delete';
        } else if (status.includes('R')) {
          operation = 'rename';
        } else {
          continue; // 跳过其他状态
        }

        if (operation !== 'delete') {
          const content = await this.readFileContent(filePath);
          const checksum = this.calculateChecksum(content);
          
          changes.push({
            path: filePath,
            operation,
            content,
            checksum,
            timestamp: new Date()
          });
        } else {
          changes.push({
            path: filePath,
            operation,
            checksum: '',
            timestamp: new Date()
          });
        }
      }

      return changes;
    } catch (error) {
      // 如果Git不可用，回退到文件系统检测
      return await this.detectChanges();
    }
  }
}
