import { CodeStream, StreamMetadata } from '@code-sync-bridge/shared/types';
import { RepositoryManager } from '../repository';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import archiver from 'archiver';
import { createWriteStream } from 'fs';
import { getAppPath } from '@code-sync-bridge/shared/runtime';

/**
 * 代码流服务
 * 负责代码流的注册、打包和元数据管理
 */
export class CodeStreamService {
  private repositoryManager: RepositoryManager;
  private baseDataPath: string;

  constructor(baseDataPath: string = getAppPath('data', 'streams')) {
    this.repositoryManager = new RepositoryManager();
    this.baseDataPath = baseDataPath;
  }

  /**
   * 注册新的代码流
   * @param repoUrl 仓库URL
   * @param streamName 代码流名称
   * @param options 选项
   * @returns 代码流ID
   */
  async registerCodeStream(
    repoUrl: string, 
    streamName: string, 
    options?: { 
      onProgress?: (progress: { percentage: number; message?: string }) => void 
    }
  ): Promise<string> {
    try {
      // 1. 验证仓库URL
      options?.onProgress?.({ percentage: 10, message: '验证仓库URL...' });
      const isValid = await this.repositoryManager.validateRepoUrl(repoUrl);
      if (!isValid) {
        throw new Error(`Invalid repository URL: ${repoUrl}`);
      }

      // 2. 生成唯一的代码流ID
      options?.onProgress?.({ percentage: 20, message: '生成代码流ID...' });
      const streamId = this.generateStreamId(repoUrl, streamName);
      
      // 3. 创建代码流目录结构
      options?.onProgress?.({ percentage: 30, message: '创建目录结构...' });
      const streamPath = path.join(this.baseDataPath, streamId);
      await fs.mkdir(streamPath, { recursive: true });
      
      // 4. 克隆仓库到本地缓存
      options?.onProgress?.({ percentage: 40, message: '克隆仓库...' });
      const repoPath = path.join(streamPath, 'repository');
      await this.repositoryManager.cloneRepository(repoUrl, repoPath);
      
      // 5. 创建代码流元数据
      options?.onProgress?.({ percentage: 70, message: '创建元数据...' });
      const codeStream = await this.createCodeStreamMetadata(
        streamId,
        streamName,
        repoUrl,
        repoPath
      );
      
      // 6. 保存元数据到文件
      options?.onProgress?.({ percentage: 80, message: '保存元数据...' });
      await this.saveCodeStreamMetadata(streamPath, codeStream);
      
      // 7. 打包代码并准备上传
      options?.onProgress?.({ percentage: 90, message: '打包代码...' });
      const packagePath = await this.packageCodeForUpload(repoPath, streamPath);
      
      options?.onProgress?.({ percentage: 100, message: '注册完成' });
      console.log(`Code stream registered successfully: ${streamId}`);
      console.log(`Package created at: ${packagePath}`);
      
      return streamId;
    } catch (error) {
      throw new Error(`Failed to register code stream: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 获取代码流信息
   * @param streamId 代码流ID
   * @returns 代码流信息
   */
  async getCodeStream(streamId: string): Promise<CodeStream> {
    const streamPath = path.join(this.baseDataPath, streamId);
    const metadataPath = path.join(streamPath, 'metadata.json');
    
    try {
      const metadataContent = await fs.readFile(metadataPath, 'utf-8');
      return JSON.parse(metadataContent);
    } catch (error) {
      throw new Error(`Code stream not found: ${streamId}`);
    }
  }

  /**
   * 列出所有代码流
   * @returns 代码流列表
   */
  async listCodeStreams(): Promise<CodeStream[]> {
    try {
      await fs.mkdir(this.baseDataPath, { recursive: true });
      const streamDirs = await fs.readdir(this.baseDataPath);
      const codeStreams: CodeStream[] = [];
      
      for (const streamId of streamDirs) {
        try {
          const codeStream = await this.getCodeStream(streamId);
          codeStreams.push(codeStream);
        } catch (error) {
          console.warn(`Failed to load code stream ${streamId}:`, error instanceof Error ? error.message : String(error));
        }
      }
      
      return codeStreams;
    } catch (error) {
      throw new Error(`Failed to list code streams: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 更新代码流状态
   * @param streamId 代码流ID
   * @param status 新状态
   */
  async updateCodeStreamStatus(
    streamId: string, 
    status: 'active' | 'paused' | 'archived'
  ): Promise<void> {
    const codeStream = await this.getCodeStream(streamId);
    codeStream.status = status;
    codeStream.lastSyncAt = new Date();
    
    const streamPath = path.join(this.baseDataPath, streamId);
    await this.saveCodeStreamMetadata(streamPath, codeStream);
  }

  /**
   * 获取代码包路径
   * @param streamId 代码流ID
   * @returns 代码包路径
   */
  getCodePackagePath(streamId: string): string {
    return path.join(this.baseDataPath, streamId, 'code.zip');
  }

  /**
   * 获取代码流元数据路径
   * @param streamId 代码流ID
   * @returns 元数据路径
   */
  getCodeStreamMetadataPath(streamId: string): string {
    return path.join(this.baseDataPath, streamId, 'metadata.json');
  }

  /**
   * 获取仓库本地路径
   * @param streamId 代码流ID
   * @returns 仓库路径
   */
  getRepositoryPath(streamId: string): string {
    return path.join(this.baseDataPath, streamId, 'repository');
  }

  /**
   * 生成唯一的代码流ID
   */
  private generateStreamId(repoUrl: string, streamName: string): string {
    const timestamp = Date.now();
    const hash = crypto
      .createHash('md5')
      .update(`${repoUrl}:${streamName}:${timestamp}`)
      .digest('hex')
      .substring(0, 8);
    
    return `${streamName.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()}-${hash}`;
  }

  /**
   * 创建代码流元数据
   */
  private async createCodeStreamMetadata(
    streamId: string,
    streamName: string,
    repoUrl: string,
    repoPath: string
  ): Promise<CodeStream> {
    const repoStatus = await this.repositoryManager.getRepositoryStatus(repoPath);
    const repoType = this.detectRepoType(repoUrl);
    
    const metadata: StreamMetadata = {
      version: '1.0.0',
      description: `Code stream for ${streamName}`,
      config: {
        repoStatus,
        clonedAt: new Date().toISOString()
      }
    };

    return {
      id: streamId,
      name: streamName,
      repoType,
      repoUrl,
      createdAt: new Date(),
      lastSyncAt: new Date(),
      status: 'active',
      metadata
    };
  }

  /**
   * 保存代码流元数据到文件
   */
  private async saveCodeStreamMetadata(
    streamPath: string, 
    codeStream: CodeStream
  ): Promise<void> {
    const metadataPath = path.join(streamPath, 'metadata.json');
    await fs.writeFile(
      metadataPath, 
      JSON.stringify(codeStream, null, 2), 
      'utf-8'
    );
  }

  /**
   * 打包代码用于上传
   */
  private async packageCodeForUpload(
    repoPath: string, 
    streamPath: string
  ): Promise<string> {
    const packagePath = path.join(streamPath, 'code.zip');
    
    return new Promise((resolve, reject) => {
      const output = createWriteStream(packagePath);
      const archive = archiver('zip', {
        zlib: { level: 9 } // 最高压缩级别
      });

      output.on('close', () => {
        console.log(`Package created: ${archive.pointer()} total bytes`);
        resolve(packagePath);
      });

      archive.on('error', (err: Error) => {
        reject(err);
      });

      archive.pipe(output);

      // 添加仓库内容到压缩包，排除版本控制目录
      archive.glob('**/*', {
        cwd: repoPath,
        ignore: ['.git/**', '.svn/**', 'node_modules/**', '*.log']
      });

      archive.finalize();
    });
  }

  /**
   * 检测仓库类型
   */
  private detectRepoType(repoUrl: string): 'git' | 'svn' {
    if (repoUrl.includes('.git') || repoUrl.startsWith('git@') || repoUrl.startsWith('ssh://git')) {
      return 'git';
    } else if (repoUrl.startsWith('svn://') || repoUrl.includes('/svn/')) {
      return 'svn';
    }
    // 默认为git
    return 'git';
  }
}
