import * as fs from 'fs/promises';
import * as path from 'path';
import * as tmp from 'tmp';
import { simpleGit, SimpleGit } from 'simple-git';
import { SystemSFTPClient } from '../../../packages/shared/src/sftp/SystemSFTPClient';

export interface TestConfig {
  sftp: {
    host: string;
    port: number;
    username: string;
    password?: string;
    privateKey?: string;
  };
  testDataDir: string;
  tempDir: string;
}

/**
 * 测试环境管理器
 * 负责创建和清理测试所需的临时目录、SFTP连接等资源
 */
export class TestEnvironment {
  private static instance: TestEnvironment;
  private config: TestConfig;
  private tempDirs: string[] = [];
  private sftpClient: SystemSFTPClient;

  private constructor() {
    this.config = this.loadTestConfig();
    this.sftpClient = new SystemSFTPClient(this.config.sftp);
  }

  static async initialize(): Promise<TestEnvironment> {
    if (!TestEnvironment.instance) {
      TestEnvironment.instance = new TestEnvironment();
      await TestEnvironment.instance.setup();
    }
    return TestEnvironment.instance;
  }

  static getInstance(): TestEnvironment {
    if (!TestEnvironment.instance) {
      throw new Error('TestEnvironment not initialized. Call initialize() first.');
    }
    return TestEnvironment.instance;
  }

  static async cleanup(): Promise<void> {
    if (TestEnvironment.instance) {
      await TestEnvironment.instance.teardown();
    }
  }

  private loadTestConfig(): TestConfig {
    // 从环境变量或配置文件加载测试配置
    return {
      sftp: {
        host: process.env.TEST_SFTP_HOST || 'localhost',
        port: parseInt(process.env.TEST_SFTP_PORT || '22'),
        username: process.env.TEST_SFTP_USER || 'testuser',
        password: process.env.TEST_SFTP_PASSWORD || 'testpass',
      },
      testDataDir: path.join(__dirname, '../../test-data'),
      tempDir: tmp.dirSync({ unsafeCleanup: true }).name,
    };
  }

  private async setup(): Promise<void> {
    // 创建测试数据目录
    await fs.mkdir(this.config.testDataDir, { recursive: true });
    
    // 尝试连接SFTP服务器（如果配置了的话）
    if (this.shouldUseSFTP()) {
      try {
        await this.sftpClient.connect( );
        console.log('Connected to test SFTP server');
      } catch (error) {
        console.warn('Could not connect to SFTP server, using mock mode:', (error as Error).message);
      }
    }
  }

  private async teardown(): Promise<void> {
    // 清理临时目录
    for (const dir of this.tempDirs) {
      try {
        await fs.rm(dir, { recursive: true, force: true });
      } catch (error) {
        console.warn(`Failed to cleanup temp dir ${dir}:`, (error as Error).message);
      }
    }

    // 关闭SFTP连接
    if (this.sftpClient && (this.sftpClient as any).sftp) {
      await this.sftpClient.disconnect();
    }
  }

  /**
   * 创建临时目录
   */
  async createTempDir(prefix: string = 'test-'): Promise<string> {
    const tempDir = tmp.dirSync({ prefix, unsafeCleanup: true }).name;
    this.tempDirs.push(tempDir);
    return tempDir;
  }

  /**
   * 创建测试用的Git仓库
   */
  async createTestRepository(repoPath: string, files: Record<string, string> = {}, initGit: boolean = true): Promise<SimpleGit> {
    await fs.mkdir(repoPath, { recursive: true });
    
    const git = simpleGit(repoPath);
    
    if (initGit) {
      await git.init();
      await git.addConfig('user.name', 'Test User');
      await git.addConfig('user.email', 'test@example.com');
    }

    // 创建测试文件
    const defaultFiles = {
      'README.md': '# Test Repository\\n\\nThis is a test repository for integration tests.',
      'src/main.ts': 'console.log("Hello, World!");',
      'package.json': JSON.stringify({ name: 'test-repo', version: '1.0.0' }, null, 2),
      ...files,
    };

    for (const [filePath, content] of Object.entries(defaultFiles)) {
      const fullPath = path.join(repoPath, filePath);
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, content);
    }

    if (initGit) {
      await git.add('.');
      await git.commit('Initial commit');
    }

    return git;
  }

  /**
   * 获取SFTP客户端（如果可用）
   */
  getSftpClient(): SystemSFTPClient | null {
    return this.sftpClient && (this.sftpClient as any).sftp ? this.sftpClient : null;
  }

  /**
   * 检查是否应该使用真实的SFTP连接
   */
  private shouldUseSFTP(): boolean {
    return process.env.TEST_USE_REAL_SFTP === 'true';
  }

  /**
   * 创建模拟的SFTP目录结构
   */
  async createMockSftpStructure(baseDir: string): Promise<void> {
    const sftpStructure = [
      'streams',
      'locks',
      'config',
    ];

    for (const dir of sftpStructure) {
      await fs.mkdir(path.join(baseDir, dir), { recursive: true });
    }

    // 创建配置文件
    const bridgeConfig = {
      version: '1.0.0',
      maxConcurrentStreams: 10,
      retentionDays: 30,
    };

    await fs.writeFile(
      path.join(baseDir, 'config', 'bridge.json'),
      JSON.stringify(bridgeConfig, null, 2)
    );
  }

  getConfig(): TestConfig {
    return this.config;
  }
}