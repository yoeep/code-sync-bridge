import { SFTPConnectionManager } from '@code-sync-bridge/shared/sftp';
import { CodeStreamService } from './CodeStreamService';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * 变更监控服务
 * 负责监控SFTP上的代码变更并下载处理
 */
export class ChangeMonitorService {
  private sftpManager: SFTPConnectionManager;
  private codeStreamService: CodeStreamService;
  private monitoringIntervals: Map<string, NodeJS.Timeout> = new Map();
  private isMonitoring: boolean = false;

  constructor(
    sftpManager: SFTPConnectionManager,
    codeStreamService: CodeStreamService
  ) {
    this.sftpManager = sftpManager;
    this.codeStreamService = codeStreamService;
  }

  /**
   * 开始监控指定代码流的变更
   * @param streamId 代码流ID
   * @param interval 监控间隔（秒）
   */
  startMonitoring(streamId: string, interval: number = 300): void {
    // 如果已经在监控，先停止
    if (this.monitoringIntervals.has(streamId)) {
      this.stopMonitoring(streamId);
    }

    console.log(`Starting monitoring for stream ${streamId} with interval ${interval}s`);

    const intervalId = setInterval(async () => {
      try {
        await this.checkForChanges(streamId);
      } catch (error) {
        console.error(`Error monitoring stream ${streamId}:`, error instanceof Error ? error.message : String(error));
      }
    }, interval * 1000);

    this.monitoringIntervals.set(streamId, intervalId);
    this.isMonitoring = true;
  }

  /**
   * 停止监控指定代码流
   * @param streamId 代码流ID
   */
  stopMonitoring(streamId: string): void {
    const intervalId = this.monitoringIntervals.get(streamId);
    if (intervalId) {
      clearInterval(intervalId);
      this.monitoringIntervals.delete(streamId);
      console.log(`Stopped monitoring for stream ${streamId}`);
    }

    if (this.monitoringIntervals.size === 0) {
      this.isMonitoring = false;
    }
  }

  /**
   * 停止所有监控
   */
  stopAllMonitoring(): void {
    for (const streamId of this.monitoringIntervals.keys()) {
      this.stopMonitoring(streamId);
    }
    this.isMonitoring = false;
    console.log('Stopped all monitoring');
  }

  /**
   * 获取监控状态
   * @returns 监控状态信息
   */
  getMonitoringStatus(): {
    isMonitoring: boolean;
    monitoredStreams: string[];
    totalStreams: number;
  } {
    return {
      isMonitoring: this.isMonitoring,
      monitoredStreams: Array.from(this.monitoringIntervals.keys()),
      totalStreams: this.monitoringIntervals.size
    };
  }

  /**
   * 手动检查指定代码流的变更
   * @param streamId 代码流ID
   * @returns 检测到的变更信息
   */
  async checkForChanges(streamId: string): Promise<{
    hasChanges: boolean;
    changes: string[];
    downloadedFiles: string[];
  }> {
    try {
      console.log(`Checking for changes in stream ${streamId}`);

      // 获取代码流信息
      await this.codeStreamService.getCodeStream(streamId);
      
      // 连接SFTP服务器
      // await this.sftpManager.connect();

      // 检查SFTP上的变更目录
      const remotePath = `/code-sync-bridge/streams/${streamId}/changes`;
      const changes = await this.listRemoteChanges(remotePath);

      if (changes.length === 0) {
        console.log(`No changes found for stream ${streamId}`);
        return {
          hasChanges: false,
          changes: [],
          downloadedFiles: []
        };
      }

      // 下载新的变更文件
      const downloadedFiles = await this.downloadChanges(streamId, changes);

      // 更新代码流的最后同步时间
      await this.codeStreamService.updateCodeStreamStatus(streamId, 'active');

      console.log(`Found ${changes.length} changes for stream ${streamId}`);
      return {
        hasChanges: true,
        changes,
        downloadedFiles
      };

    } catch (error) {
      console.error(`Failed to check changes for stream ${streamId}:`, error instanceof Error ? error.message : String(error));
      throw error;
    } finally {
      await this.sftpManager.disconnect();
    }
  }

  /**
   * 列出远程变更文件
   * @param remotePath 远程路径
   * @returns 变更文件列表
   */
  private async listRemoteChanges(remotePath: string): Promise<string[]> {
    try {
      const files = await this.sftpManager.listDirectory(remotePath);
      
      // 过滤出.patch文件并按时间戳排序
      const patchFiles = files
        .filter((file: string) => file.endsWith('.patch'))
        .sort(); // 文件名包含时间戳，可以直接排序

      return patchFiles;
    } catch (error) {
      // 如果目录不存在，返回空数组
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('No such file') || errorMessage.includes('not found')) {
        return [];
      }
      throw error;
    }
  }

  /**
   * 下载变更文件到本地
   * @param streamId 代码流ID
   * @param changeFiles 变更文件列表
   * @returns 下载的文件路径列表
   */
  private async downloadChanges(streamId: string, changeFiles: string[]): Promise<string[]> {
    const downloadedFiles: string[] = [];
    const localChangesDir = path.join(
      this.codeStreamService.getRepositoryPath(streamId),
      '../changes'
    );

    // 确保本地变更目录存在
    await fs.mkdir(localChangesDir, { recursive: true });

    for (const changeFile of changeFiles) {
      try {
        const remotePath = `/code-sync-bridge/streams/${streamId}/changes/${changeFile}`;
        const localPath = path.join(localChangesDir, changeFile);

        // 检查文件是否已经下载
        try {
          await fs.access(localPath);
          console.log(`Change file already exists: ${changeFile}`);
          continue;
        } catch {
          // 文件不存在，需要下载
        }

        // 下载变更文件
        await this.sftpManager.downloadFile(remotePath, localPath);
        downloadedFiles.push(localPath);
        
        console.log(`Downloaded change file: ${changeFile}`);
      } catch (error) {
        console.error(`Failed to download change file ${changeFile}:`, error instanceof Error ? error.message : String(error));
      }
    }

    return downloadedFiles;
  }

  /**
   * 获取本地变更文件列表
   * @param streamId 代码流ID
   * @returns 本地变更文件列表
   */
  async getLocalChanges(streamId: string): Promise<string[]> {
    const localChangesDir = path.join(
      this.codeStreamService.getRepositoryPath(streamId),
      '../changes'
    );

    try {
      const files = await fs.readdir(localChangesDir);
      return files
        .filter((file: string) => file.endsWith('.patch'))
        .sort();
    } catch (error) {
      // 目录不存在返回空数组
      return [];
    }
  }

  /**
   * 清理已处理的变更文件
   * @param streamId 代码流ID
   * @param processedFiles 已处理的文件列表
   */
  async cleanupProcessedChanges(streamId: string, processedFiles: string[]): Promise<void> {
    const localChangesDir = path.join(
      this.codeStreamService.getRepositoryPath(streamId),
      '../changes'
    );

    for (const file of processedFiles) {
      try {
        const filePath = path.join(localChangesDir, path.basename(file));
        await fs.unlink(filePath);
        console.log(`Cleaned up processed change file: ${file}`);
      } catch (error) {
        console.warn(`Failed to cleanup change file ${file}:`, error instanceof Error ? error.message : String(error));
      }
    }
  }

  /**
   * 创建定时任务调度器
   * 用于批量管理多个代码流的监控
   */
  async startBatchMonitoring(interval: number = 300): Promise<void> {
    console.log('Starting batch monitoring for all active code streams');

    // 获取所有活跃的代码流
    const codeStreams = await this.codeStreamService.listCodeStreams();
    const activeStreams = codeStreams.filter(stream => stream.status === 'active');

    // 为每个活跃代码流启动监控
    for (const stream of activeStreams) {
      this.startMonitoring(stream.id, interval);
    }

    console.log(`Started monitoring for ${activeStreams.length} active code streams`);
  }
}
