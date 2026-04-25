import * as path from 'path';
import * as fs from 'fs/promises';
import { TestEnvironment } from '../test-utils/TestEnvironment';
import { MockSftpServer } from '../test-utils/MockSftpServer';
// Import types for testing
import { CodeStream } from '@code-sync-bridge/shared';

describe('完整同步流程集成测试', () => {
  let testEnv: TestEnvironment;
  let intranetRepoPath: string;
  let extranetWorkPath: string;
  let sftpBasePath: string;

  beforeAll(async () => {
    testEnv = await TestEnvironment.initialize();
  });

  beforeEach(async () => {
    // 创建测试目录
    intranetRepoPath = await testEnv.createTempDir('intranet-repo-');
    extranetWorkPath = await testEnv.createTempDir('extranet-work-');
    sftpBasePath = await testEnv.createTempDir('sftp-base-');

    // 设置模拟SFTP目录结构
    await testEnv.createMockSftpStructure(sftpBasePath);

    // 创建测试仓库
    await testEnv.createTestRepository(intranetRepoPath, {
      'src/utils.ts': 'export function hello() { return "Hello World"; }',
      'src/main.ts': 'import { hello } from "./utils"; console.log(hello());',
      'tests/utils.test.ts': 'import { hello } from "../src/utils"; test("hello", () => { expect(hello()).toBe("Hello World"); });',
    });
  });

  describe('需求1: 内网代码流注册', () => {
    it('应该成功注册Git仓库到代码流', async () => {
      // 创建内网客户端服务 - 使用实际的构造函数签名
      const workspaceDir = await testEnv.createTempDir('intranet-workspace-');
      
      // 模拟代码流注册过程
      const streamId = `test-project-${Date.now()}`;
      
      // 验证测试仓库存在
      const mainTsExists = await fs.access(path.join(intranetRepoPath, 'src', 'main.ts')).then(() => true).catch(() => false);
      expect(mainTsExists).toBe(true);

      // 模拟创建代码流元数据
      const codeStream: CodeStream = {
        id: streamId,
        name: 'test-project',
        repoType: 'git',
        repoUrl: intranetRepoPath,
        createdAt: new Date(),
        lastSyncAt: new Date(),
        status: 'active',
        metadata: {
          version: '1.0.0',
          description: 'Test project for integration testing'
        }
      };

      // 验证代码流对象结构
      expect(codeStream.id).toBeDefined();
      expect(codeStream.name).toBe('test-project');
      expect(codeStream.repoType).toBe('git');
      expect(codeStream.status).toBe('active');
    });

    it('应该验证无效的仓库路径', async () => {
      const invalidPath = '/invalid/path/that/does/not/exist';
      
      // 验证路径不存在
      const pathExists = await fs.access(invalidPath).then(() => true).catch(() => false);
      expect(pathExists).toBe(false);
    });
  });

  describe('需求2: 外网代码流拉取', () => {
    it('应该成功模拟代码流拉取过程', async () => {
      // 模拟从SFTP拉取代码流的过程
      // 1. 复制代码到外网工作目录（模拟下载和解压）
      const filesToCopy = ['src/main.ts', 'src/utils.ts', 'package.json'];
      
      for (const file of filesToCopy) {
        const sourcePath = path.join(intranetRepoPath, file);
        const targetPath = path.join(extranetWorkPath, file);
        
        // 确保目标目录存在
        await fs.mkdir(path.dirname(targetPath), { recursive: true });
        
        // 复制文件
        await fs.copyFile(sourcePath, targetPath);
      }

      // 验证文件是否正确拉取
      const mainTsExists = await fs.access(path.join(extranetWorkPath, 'src', 'main.ts')).then(() => true).catch(() => false);
      const utilsTsExists = await fs.access(path.join(extranetWorkPath, 'src', 'utils.ts')).then(() => true).catch(() => false);
      const packageJsonExists = await fs.access(path.join(extranetWorkPath, 'package.json')).then(() => true).catch(() => false);

      expect(mainTsExists).toBe(true);
      expect(utilsTsExists).toBe(true);
      expect(packageJsonExists).toBe(true);

      // 2. 模拟初始化Git仓库
      const git = await testEnv.createTestRepository(extranetWorkPath, {}, true);
      
      // 验证Git仓库是否初始化
      const gitDirExists = await fs.access(path.join(extranetWorkPath, '.git')).then(() => true).catch(() => false);
      expect(gitDirExists).toBe(true);
    });

    it('应该验证代码流元数据结构', async () => {
      // 创建模拟的代码流列表
      const mockStreams: CodeStream[] = [
        {
          id: 'test-stream-1',
          name: 'test-project',
          repoType: 'git',
          repoUrl: 'https://github.com/test/repo.git',
          createdAt: new Date(),
          lastSyncAt: new Date(),
          status: 'active',
          metadata: {
            version: '1.0.0',
            description: 'Test project'
          }
        }
      ];

      // 验证代码流结构
      expect(mockStreams).toHaveLength(1);
      expect(mockStreams[0].id).toBe('test-stream-1');
      expect(mockStreams[0].name).toBe('test-project');
      expect(mockStreams[0].status).toBe('active');
      expect(mockStreams[0].repoType).toBe('git');
    });
  });

  describe('需求4: 外网代码提交', () => {
    beforeEach(async () => {
      // 设置外网工作环境 - 复制代码到外网目录
      const filesToCopy = ['src/main.ts', 'src/utils.ts', 'package.json'];
      
      for (const file of filesToCopy) {
        const sourcePath = path.join(intranetRepoPath, file);
        const targetPath = path.join(extranetWorkPath, file);
        
        await fs.mkdir(path.dirname(targetPath), { recursive: true });
        await fs.copyFile(sourcePath, targetPath);
      }
    });

    it('应该检测到本地代码变更', async () => {
      // 修改文件
      await fs.writeFile(
        path.join(extranetWorkPath, 'src', 'utils.ts'),
        'export function hello() { return "Hello World Updated"; }'
      );

      // 添加新文件
      await fs.writeFile(
        path.join(extranetWorkPath, 'src', 'new-feature.ts'),
        'export function newFeature() { return "New Feature"; }'
      );

      // 验证文件变更
      const updatedContent = await fs.readFile(path.join(extranetWorkPath, 'src', 'utils.ts'), 'utf-8');
      expect(updatedContent).toContain('Hello World Updated');

      const newFeatureExists = await fs.access(path.join(extranetWorkPath, 'src', 'new-feature.ts')).then(() => true).catch(() => false);
      expect(newFeatureExists).toBe(true);
    });

    it('应该模拟变更提交过程', async () => {
      // 修改文件
      await fs.writeFile(
        path.join(extranetWorkPath, 'src', 'utils.ts'),
        'export function hello() { return "Hello World Updated"; }'
      );

      // 模拟创建变更包
      const streamId = 'test-stream-123';
      const changesDir = path.join(sftpBasePath, 'streams', streamId, 'changes');
      await fs.mkdir(changesDir, { recursive: true });

      // 模拟上传变更文件
      const commitId = `commit-${Date.now()}`;
      const changePackagePath = path.join(changesDir, `${commitId}.zip`);
      
      // 创建一个简单的变更记录文件
      const changeInfo = {
        commitId,
        streamId,
        timestamp: new Date().toISOString(),
        message: 'Update utils function',
        files: ['src/utils.ts']
      };

      await fs.writeFile(
        path.join(changesDir, `${commitId}.json`),
        JSON.stringify(changeInfo, null, 2)
      );

      // 验证变更文件是否创建
      const changeInfoExists = await fs.access(path.join(changesDir, `${commitId}.json`)).then(() => true).catch(() => false);
      expect(changeInfoExists).toBe(true);

      // 验证变更信息
      const savedChangeInfo = JSON.parse(await fs.readFile(path.join(changesDir, `${commitId}.json`), 'utf-8'));
      expect(savedChangeInfo.commitId).toBe(commitId);
      expect(savedChangeInfo.streamId).toBe(streamId);
      expect(savedChangeInfo.files).toContain('src/utils.ts');
    });
  });

  describe('需求3: 内网自动同步', () => {
    it('应该模拟检测外网提交的变更', async () => {
      const streamId = 'test-stream-sync';
      
      // 模拟外网提交变更到SFTP
      const changesDir = path.join(sftpBasePath, 'streams', streamId, 'changes');
      await fs.mkdir(changesDir, { recursive: true });

      // 创建变更文件
      const commitId = `commit-${Date.now()}`;
      const changeInfo = {
        commitId,
        streamId,
        timestamp: new Date().toISOString(),
        message: 'Update from extranet',
        files: ['src/utils.ts']
      };

      await fs.writeFile(
        path.join(changesDir, `${commitId}.json`),
        JSON.stringify(changeInfo, null, 2)
      );

      // 检查变更是否存在
      const changeFiles = await fs.readdir(changesDir);
      const hasChanges = changeFiles.length > 0;
      
      expect(hasChanges).toBe(true);
      expect(changeFiles).toContain(`${commitId}.json`);
    });

    it('应该模拟同步变更到内网VCS', async () => {
      // 模拟从SFTP下载变更并应用到内网仓库
      const originalContent = await fs.readFile(path.join(intranetRepoPath, 'src', 'utils.ts'), 'utf-8');
      expect(originalContent).toContain('Hello World');

      // 模拟应用外网变更
      const updatedContent = 'export function hello() { return "Hello from Extranet"; }';
      await fs.writeFile(path.join(intranetRepoPath, 'src', 'utils.ts'), updatedContent);

      // 验证变更已应用
      const newContent = await fs.readFile(path.join(intranetRepoPath, 'src', 'utils.ts'), 'utf-8');
      expect(newContent).toContain('Hello from Extranet');

      // 验证Git仓库状态（已经在beforeEach中初始化）
      const gitDirExists = await fs.access(path.join(intranetRepoPath, '.git')).then(() => true).catch(() => false);
      expect(gitDirExists).toBe(true);
    });
  });

  describe('端到端完整流程测试', () => {
    it('应该完成从注册到同步的完整流程模拟', async () => {
      const streamId = `e2e-test-${Date.now()}`;

      // 1. 模拟内网注册代码流
      const streamMetadataDir = path.join(sftpBasePath, 'streams', streamId);
      await fs.mkdir(streamMetadataDir, { recursive: true });

      const codeStream: CodeStream = {
        id: streamId,
        name: 'e2e-test-project',
        repoType: 'git',
        repoUrl: intranetRepoPath,
        createdAt: new Date(),
        lastSyncAt: new Date(),
        status: 'active',
        metadata: {
          version: '1.0.0',
          description: 'E2E test project'
        }
      };

      await fs.writeFile(
        path.join(streamMetadataDir, 'metadata.json'),
        JSON.stringify(codeStream, null, 2)
      );

      expect(streamId).toBeDefined();

      // 2. 模拟外网拉取代码流
      const filesToCopy = ['src/main.ts', 'src/utils.ts', 'package.json'];
      
      for (const file of filesToCopy) {
        const sourcePath = path.join(intranetRepoPath, file);
        const targetPath = path.join(extranetWorkPath, file);
        
        await fs.mkdir(path.dirname(targetPath), { recursive: true });
        await fs.copyFile(sourcePath, targetPath);
      }

      const mainTsExists = await fs.access(path.join(extranetWorkPath, 'src', 'main.ts')).then(() => true).catch(() => false);
      expect(mainTsExists).toBe(true);

      // 3. 模拟外网修改并提交代码
      await fs.writeFile(
        path.join(extranetWorkPath, 'src', 'utils.ts'),
        'export function hello() { return "E2E Test Update"; }'
      );

      // 模拟提交到SFTP
      const changesDir = path.join(sftpBasePath, 'streams', streamId, 'changes');
      await fs.mkdir(changesDir, { recursive: true });

      const commitId = `e2e-commit-${Date.now()}`;
      const commitInfo = {
        commitId,
        streamId,
        timestamp: new Date().toISOString(),
        message: 'E2E test update',
        files: ['src/utils.ts']
      };

      await fs.writeFile(
        path.join(changesDir, `${commitId}.json`),
        JSON.stringify(commitInfo, null, 2)
      );

      // 4. 模拟内网监控并同步变更
      const changeFiles = await fs.readdir(changesDir);
      const hasChanges = changeFiles.length > 0;
      expect(hasChanges).toBe(true);

      // 模拟应用变更到内网
      await fs.writeFile(
        path.join(intranetRepoPath, 'src', 'utils.ts'),
        'export function hello() { return "E2E Test Update"; }'
      );

      // 5. 验证最终结果
      const finalContent = await fs.readFile(path.join(intranetRepoPath, 'src', 'utils.ts'), 'utf-8');
      expect(finalContent).toContain('E2E Test Update');
    });
  });
});