import { 
  IntranetClient as IIntranetClient, 
} from '@code-sync-bridge/shared/interfaces';
import { SyncResult } from '@code-sync-bridge/shared/types';
import { SFTPConnectionManager } from '@code-sync-bridge/shared/sftp';
import { ConfigManager } from '@code-sync-bridge/shared/config';
import { getTempFilePath } from '@code-sync-bridge/shared/runtime';
import * as fs from 'fs/promises';
import { RepositoryManager } from './repository';
import { CodeStreamService, ChangeMonitorService, VCSSyncService } from './services';

/**
 * 内网客户端实现
 */
export class IntranetClient implements IIntranetClient {
  private repositoryManager: RepositoryManager;
  private codeStreamService: CodeStreamService;
  private changeMonitorService: ChangeMonitorService;
  private vcsSyncService: VCSSyncService;
  private sftpManager: SFTPConnectionManager;

  constructor(configPath?: string) {
    // 初始化配置管理器
    const configManager = new ConfigManager(configPath);
    
    // 初始化SFTP连接管理器
    this.sftpManager = new SFTPConnectionManager(configManager.getConfig().sftp);
    
    // 初始化仓库管理器
    this.repositoryManager = new RepositoryManager();
    
    // 初始化代码流服务
    this.codeStreamService = new CodeStreamService();
    
    // 初始化变更监控服务
    this.changeMonitorService = new ChangeMonitorService(
      this.sftpManager,
      this.codeStreamService
    );
    
    // 初始化VCS同步服务
    this.vcsSyncService = new VCSSyncService(
      this.repositoryManager,
      this.codeStreamService
    );
  }

  /**
   * 注册代码流（带进度监控）
   * @param repoUrl 仓库URL
   * @param streamName 代码流名称
   * @returns 代码流ID
   */
  async registerCodeStream(repoUrl: string, streamName: string): Promise<string> {
    try {
      console.log('🚀 开始注册代码流...');
      console.log(`📦 仓库URL: ${repoUrl}`);
      console.log(`📝 代码流名称: ${streamName}`);
      
      // 1. 克隆/拉取代码仓库
      console.log('\n📥 步骤 1/4: 拉取代码仓库...');
      const streamId = await this.codeStreamService.registerCodeStream(repoUrl, streamName, {
        onProgress: (progress: { percentage: number; message?: string }) => {
          console.log(`📊 拉取进度: ${progress.percentage}% | ${progress.message || ''}`);
        }
      });
      console.log(`✅ 代码流注册成功，ID: ${streamId}`);
      
      // 2. 打包代码
      console.log('\n📦 步骤 2/4: 打包代码...');
      const packagePath = this.codeStreamService.getCodePackagePath(streamId);
      const packageData = await fs.readFile(packagePath);
      console.log(`✅ 代码打包完成，大小: ${this.formatBytes(packageData.length)}`);
      
      // 3. 上传到SFTP
      console.log('\n📤 步骤 3/4: 上传到SFTP服务器...');
      //同时需要上传metadata.json 文件
      const metadataPath = this.codeStreamService.getCodeStreamMetadataPath(streamId);
      const metadataData = await fs.readFile(metadataPath);
      // 上传metadata.json 文件
      await this.uploadToSFTP(streamId, metadataData, 'metadata.json', {
        onProgress: (progress) => {
          const bar = this.createProgressBar(progress.percentage);
          console.log(
            `📊 [${bar}] ${progress.percentage}% | ` +
            `${this.formatBytes(progress.transferred)}/${this.formatBytes(progress.total)} | ` +
            `${this.formatSpeed(progress.speed)} | ` +
            `ETA: ${this.formatTime(progress.eta)}`
          );
        }
      });
      // 上传code.zip 文件
      await this.uploadToSFTP(streamId, packageData, 'code.zip', {
        onProgress: (progress) => {
          const bar = this.createProgressBar(progress.percentage);
          console.log(
            `📊 [${bar}] ${progress.percentage}% | ` +
            `${this.formatBytes(progress.transferred)}/${this.formatBytes(progress.total)} | ` +
            `${this.formatSpeed(progress.speed)} | ` +
            `ETA: ${this.formatTime(progress.eta)}`
          );
        }
      });

      console.log('✅ 上传完成');
      
      // 4. 验证注册
      console.log('\n🔍 步骤 4/4: 验证注册...');
      const verification = await this.verifyRegistration(streamId);
      if (verification.success) {
        console.log('✅ 注册验证成功');
      } else {
        throw new Error(`注册验证失败: ${verification.error}`);
      }
      
      console.log(`\n🎉 代码流注册完成！`);
      console.log(`📋 代码流ID: ${streamId}`);
      console.log(`🔗 仓库URL: ${repoUrl}`);
      console.log(`📝 名称: ${streamName}`);
      
      return streamId;
    } catch (error) {
      console.error('\n❌ 代码流注册失败:', error instanceof Error ? error.message : String(error));
      throw new Error(`Failed to register code stream: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 开始监控代码流
   * @param streamId 代码流ID
   * @param interval 监控间隔（秒）
   */
  startMonitoring(streamId: string, interval: number): void {
    this.changeMonitorService.startMonitoring(streamId, interval);
  }

  /**
   * 从SFTP同步变更
   * @param streamId 代码流ID
   * @returns 同步结果
   */
  async syncChangesFromSFTP(streamId: string): Promise<SyncResult> {
    try {
      // 1. 检查并下载变更
      const changeResult = await this.changeMonitorService.checkForChanges(streamId);
      
      if (!changeResult.hasChanges) {
        return {
          success: true,
          changesApplied: 0,
          conflicts: [],
          errors: []
        };
      }

      // 2. 将变更同步到VCS
      const syncResult = await this.vcsSyncService.syncChangesToVCS(streamId);
      
      return syncResult;
    } catch (error) {
      return {
        success: false,
        changesApplied: 0,
        conflicts: [],
        errors: [error instanceof Error ? error.message : String(error)]
      };
    }
  }

  /**
   * 上传到SFTP（带进度监控）
   * @param streamId 代码流ID
   * @param data 数据
   * @param fileName 文件名
   * @param options 选项
   */
  async uploadToSFTP(streamId: string, data: Buffer, fileName: string, options?: {
    onProgress?: (progress: { transferred: number; total: number; percentage: number; speed: number; eta: number }) => void;
  }): Promise<void> {
    try {
      
      // await this.sftpManager.getConnection();
      
      // 确保远程目录存在
      const remotePath = `/code-sync-bridge/streams/${streamId}/${fileName}`;
      const remoteDir = `/code-sync-bridge/streams/${streamId}`;
      
      // 创建远程目录
      try {
        await this.sftpManager.createDirectory(remoteDir, true);
      } catch (error) {
        // 目录可能已存在，忽略错误
      }
      
      // 创建临时文件
      const tempFile = getTempFilePath(`code-${streamId}`, '.zip');
      await fs.writeFile(tempFile, data);
      
      try {
        // 使用带进度监控的上传
        await this.sftpManager.uploadFile(tempFile, remotePath, {
          enableIntegrityCheck: true,
          enableResumable: false,
          enableEncryption: false
        });
        
        // 监听上传进度事件
        if (options?.onProgress) {
          this.sftpManager.on('uploadProgress', (progressData: UploadProgressEvent) => {
            if (progressData.remotePath === remotePath) {
              options.onProgress!({
                transferred: progressData.progress.transferred || 0,
                total: progressData.progress.total || data.length,
                percentage: progressData.progress.percentage || 0,
                speed: progressData.speed || 0,
                eta: progressData.remainingTime || 0
              });
            }
          });
        }
        
      } finally {
        // 清理临时文件
        await fs.unlink(tempFile).catch(() => {});
      }
      
    } catch (error) {
      throw new Error(`Failed to upload to SFTP: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      await this.sftpManager.disconnect();
    }
  }

  /**
   * 停止监控
   * @param streamId 代码流ID（可选，不提供则停止所有监控）
   */
  stopMonitoring(streamId?: string): void {
    if (streamId) {
      this.changeMonitorService.stopMonitoring(streamId);
    } else {
      this.changeMonitorService.stopAllMonitoring();
    }
  }

  /**
   * 获取监控状态
   */
  getMonitoringStatus() {
    return this.changeMonitorService.getMonitoringStatus();
  }

  /**
   * 批量同步所有活跃代码流
   */
  async syncAllActiveStreams() {
    return await this.vcsSyncService.syncAllActiveStreams();
  }

  /**
   * 列出所有代码流
   */
  async listCodeStreams() {
    return await this.codeStreamService.listCodeStreams();
  }

  /**
   * 验证注册
   */
  private async verifyRegistration(streamId: string): Promise<{ success: boolean; error?: string }> {
    try {
      // 检查远程文件是否存在
      // await this.sftpManager.getConnection();
      const remotePath = `/code-sync-bridge/streams/${streamId}/code.zip`;
      const exists = await this.sftpManager.fileExists(remotePath);
      await this.sftpManager.disconnect();
      
      if (!exists) {
        return { success: false, error: '远程文件不存在' };
      }
      
      return { success: true };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : String(error) 
      };
    }
  }

  /**
   * 格式化字节大小
   */
  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  /**
   * 格式化速度
   */
  private formatSpeed(bytesPerSec: number): string {
    return this.formatBytes(bytesPerSec) + '/s';
  }

  /**
   * 格式化时间
   */
  private formatTime(seconds: number): string {
    if (seconds < 60) return `${Math.round(seconds)}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.round(seconds % 60);
    return `${minutes}m ${remainingSeconds}s`;
  }

  /**
   * 创建进度条
   */
  private createProgressBar(percentage: number, length: number = 30): string {
    const filledLength = Math.round((percentage / 100) * length);
    return '█'.repeat(filledLength) + '░'.repeat(length - filledLength);
  }
}

type UploadProgressEvent = {
  remotePath: string;
  progress: {
    transferred?: number;
    total?: number;
    percentage?: number;
  };
  speed?: number;
  remainingTime?: number;
};

export default IntranetClient;
