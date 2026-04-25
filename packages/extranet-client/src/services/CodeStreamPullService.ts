import { CodeStream } from '@code-sync-bridge/shared/types';
import { SFTPConnectionManager } from '@code-sync-bridge/shared/sftp';
import { ConfigManager } from '@code-sync-bridge/shared/config';
import * as path from 'path';
import * as fs from 'fs/promises';
import AdmZip = require('adm-zip');
import { execSync } from 'child_process';

/**
 * 代码流拉取服务
 * 负责从SFTP服务器获取可用代码流列表，下载代码包并初始化本地Git仓库
 */
export class CodeStreamPullService {
  private sftpManager: SFTPConnectionManager;
  private configManager: ConfigManager;

  constructor(configManager: ConfigManager) {
    this.configManager = configManager;
    const sftpConfig = this.configManager.getConfig().sftp;
    this.sftpManager = new SFTPConnectionManager(sftpConfig);
  }

  /**
   * 获取可用代码流列表
   * 需求: 2.1 - 外网开发者执行拉取命令，THE ExtranetClient SHALL 连接SFTPBridge并验证DynamicToken
   * 需求: 2.2 - WHEN 连接成功，THE ExtranetClient SHALL 列出所有可用的CodeStream
   */
  async listAvailableStreams(): Promise<CodeStream[]> {
    try {
      // 连接SFTP服务器
      await this.sftpManager.connect();

      // 列出streams目录下的所有代码流
      const streamsPath = '/code-sync-bridge/streams';
      const streamDirs = await this.sftpManager.listDirectory(streamsPath);

      const codeStreams: CodeStream[] = [];

      // 遍历每个代码流目录，读取元数据
      for (const streamDir of streamDirs) {
        if (streamDir === '.' || streamDir === '..') continue;

        try {
          const metadataPath = `${streamsPath}/${streamDir}/metadata.json`;
          const metadataExists = await this.sftpManager.fileExists(metadataPath);
          
          if (metadataExists) {
            const metadataBuffer = await this.sftpManager.downloadBuffer(metadataPath);
            const metadata = JSON.parse(metadataBuffer.toString('utf-8'));
            
            const codeStream: CodeStream = {
              id: metadata.streamId || streamDir,
              name: metadata.name || streamDir,
              repoType: metadata.repoType || 'git',
              repoUrl: metadata.repoUrl || '',
              createdAt: new Date(metadata.createdAt || Date.now()),
              lastSyncAt: new Date(metadata.lastSync || Date.now()),
              status: metadata.status || 'active',
              metadata: {
                version: metadata.version || '1.0.0',
                description: metadata.description,
                tags: metadata.tags,
                config: metadata.config
              }
            };

            codeStreams.push(codeStream);
          }
        } catch (error) {
          console.warn(`Failed to read metadata for stream ${streamDir}:`, error);
        }
      }

      return codeStreams.filter(stream => stream.status === 'active');
    } catch (error) {
      throw new Error(`Failed to list available streams: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 拉取指定代码流到本地
   * 需求: 2.3 - WHEN 用户选择特定CodeStream，THE ExtranetClient SHALL 从SFTPBridge下载最新代码包
   * 需求: 2.4 - WHEN 下载完成，THE ExtranetClient SHALL 解压代码到指定本地目录
   * 需求: 2.5 - THE ExtranetClient SHALL 初始化本地Git仓库用于版本跟踪
   */
  async pullCodeStream(streamId: string, localPath: string): Promise<void> {
    try {
      // 确保SFTP连接
      await this.sftpManager.connect();

      // 检查代码流是否存在
      const streamPath = `/code-sync-bridge/streams/${streamId}`;
      const streamExists = await this.sftpManager.fileExists(`${streamPath}/metadata.json`);
      
      if (!streamExists) {
        throw new Error(`Code stream ${streamId} not found`);
      }

      // 下载代码包
      const codePackagePath = `${streamPath}/code.zip`;
      const codePackageExists = await this.sftpManager.fileExists(codePackagePath);
      
      if (!codePackageExists) {
        throw new Error(`Code package not found for stream ${streamId}`);
      }

      // 创建本地目录
      await fs.mkdir(localPath, { recursive: true });

      // 下载代码包到临时文件
      const tempZipPath = path.join(localPath, 'temp_code.zip');
      await this.sftpManager.downloadFile(codePackagePath, tempZipPath);

      // 解压代码包
      await this.extractCodePackage(tempZipPath, localPath);

      // 删除临时文件
      await fs.unlink(tempZipPath);

      // 初始化本地Git仓库
      await this.initializeLocalGitRepository(localPath, streamId);

      // 下载并保存元数据
      const metadataBuffer = await this.sftpManager.downloadBuffer(`${streamPath}/metadata.json`);
      const metadataPath = path.join(localPath, '.code-sync', 'metadata.json');
      await fs.mkdir(path.dirname(metadataPath), { recursive: true });
      await fs.writeFile(metadataPath, metadataBuffer);

      console.log(`Successfully pulled code stream ${streamId} to ${localPath}`);
    } catch (error) {
      throw new Error(`Failed to pull code stream ${streamId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 解压代码包到指定目录
   */
  private async extractCodePackage(zipPath: string, extractPath: string): Promise<void> {
    try {
      const zip = new AdmZip(zipPath);
      zip.extractAllTo(extractPath, true);
    } catch (error) {
      throw new Error(`Failed to extract code package: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 初始化本地Git仓库
   */
  private async initializeLocalGitRepository(localPath: string, streamId: string): Promise<void> {
    try {
      // 检查是否已经是Git仓库
      const gitDir = path.join(localPath, '.git');
      try {
        await fs.access(gitDir);
        console.log('Git repository already exists, skipping initialization');
        return;
      } catch {
        // .git目录不存在，需要初始化
      }

      // 初始化Git仓库
      execSync('git init', { cwd: localPath, stdio: 'pipe' });

      // 配置Git用户信息（如果没有全局配置）
      try {
        execSync('git config user.name', { cwd: localPath, stdio: 'pipe' });
      } catch {
        execSync('git config user.name "Code Sync Bridge"', { cwd: localPath, stdio: 'pipe' });
      }

      try {
        execSync('git config user.email', { cwd: localPath, stdio: 'pipe' });
      } catch {
        execSync('git config user.email "code-sync@bridge.local"', { cwd: localPath, stdio: 'pipe' });
      }

      // 创建.gitignore文件
      const gitignoreContent = `
# Code Sync Bridge
.code-sync/
*.tmp
*.temp

# Common ignores
node_modules/
.DS_Store
Thumbs.db
*.log
`;
      await fs.writeFile(path.join(localPath, '.gitignore'), gitignoreContent.trim());

      // 添加所有文件并创建初始提交
      execSync('git add .', { cwd: localPath, stdio: 'pipe' });
      execSync(`git commit -m "Initial commit from code stream ${streamId}"`, { 
        cwd: localPath, 
        stdio: 'pipe' 
      });

      console.log('Local Git repository initialized successfully');
    } catch (error) {
      throw new Error(`Failed to initialize Git repository: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 获取代码流的详细信息
   */
  async getCodeStreamInfo(streamId: string): Promise<CodeStream | null> {
    try {
      await this.sftpManager.connect();

      const metadataPath = `/code-sync-bridge/streams/${streamId}/metadata.json`;
      const metadataExists = await this.sftpManager.fileExists(metadataPath);
      
      if (!metadataExists) {
        return null;
      }

      const metadataBuffer = await this.sftpManager.downloadBuffer(metadataPath);
      const metadata = JSON.parse(metadataBuffer.toString('utf-8'));
      
      return {
        id: metadata.streamId || streamId,
        name: metadata.name || streamId,
        repoType: metadata.repoType || 'git',
        repoUrl: metadata.repoUrl || '',
        createdAt: new Date(metadata.createdAt || Date.now()),
        lastSyncAt: new Date(metadata.lastSync || Date.now()),
        status: metadata.status || 'active',
        metadata: {
          version: metadata.version || '1.0.0',
          description: metadata.description,
          tags: metadata.tags,
          config: metadata.config
        }
      };
    } catch (error) {
      throw new Error(`Failed to get code stream info: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 检查代码流是否有更新
   */
  async checkForUpdates(streamId: string, localPath: string): Promise<boolean> {
    try {
      const localMetadataPath = path.join(localPath, '.code-sync', 'metadata.json');
      const localMetadataExists = await fs.access(localMetadataPath).then(() => true).catch(() => false);
      
      if (!localMetadataExists) {
        return true; // 本地没有元数据，需要更新
      }

      const localMetadata = JSON.parse(await fs.readFile(localMetadataPath, 'utf-8'));
      const remoteInfo = await this.getCodeStreamInfo(streamId);
      
      if (!remoteInfo) {
        return false; // 远程代码流不存在
      }

      // 比较最后同步时间
      const localLastSync = new Date(localMetadata.lastSync || 0);
      const remoteLastSync = remoteInfo.lastSyncAt;
      
      return remoteLastSync > localLastSync;
    } catch (error) {
      console.warn(`Failed to check for updates: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  /**
   * 清理资源
   */
  async cleanup(): Promise<void> {
    try {
      await this.sftpManager.disconnect();
    } catch (error) {
      console.warn('Error during cleanup:', error);
    }
  }
}
