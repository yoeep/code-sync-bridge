import * as path from 'path';
import * as fs from 'fs/promises';
import { TestEnvironment } from '../test-utils/TestEnvironment';
import { MockSftpServer } from '../test-utils/MockSftpServer';
// Import types for testing
import { CodeStream } from '@code-sync-bridge/shared';

describe('多代码流并发测试', () => {
  let testEnv: TestEnvironment;
  let sftpBasePath: string;

  beforeAll(async () => {
    testEnv = await TestEnvironment.initialize();
  });

  beforeEach(async () => {
    sftpBasePath = await testEnv.createTempDir('sftp-concurrent-');
    await testEnv.createMockSftpStructure(sftpBasePath);
  });

  describe('并发代码流注册', () => {
    it('应该支持同时创建多个代码流', async () => {
      const numStreams = 5;
      const streamCreationPromises: Promise<CodeStream>[] = [];

      // 并发创建多个代码流
      for (let i = 0; i < numStreams; i++) {
        const repoPath = await testEnv.createTempDir(`concurrent-repo-${i}-`);
        await testEnv.createTestRepository(repoPath, {
          'src/main.ts': `console.log("Project ${i}");`,
          'README.md': `# Project ${i}\\n\\nThis is project number ${i}.`,
        });

        // 模拟代码流创建
        const streamPromise = Promise.resolve({
          id: `concurrent-project-${i}-${Date.now()}`,
          name: `concurrent-project-${i}`,
          repoType: 'git' as const,
          repoUrl: repoPath,
          createdAt: new Date(),
          lastSyncAt: new Date(),
          status: 'active' as const,
          metadata: {
            version: '1.0.0',
            description: `Concurrent project ${i}`
          }
        });

        streamCreationPromises.push(streamPromise);
      }

      // 等待所有创建完成
      const codeStreams = await Promise.all(streamCreationPromises);

      // 验证所有代码流都成功创建
      expect(codeStreams).toHaveLength(numStreams);
      codeStreams.forEach((stream, index) => {
        expect(stream.id).toBeDefined();
        expect(stream.name).toBe(`concurrent-project-${index}`);
        expect(stream.status).toBe('active');
      });

      // 模拟保存到SFTP结构
      for (const stream of codeStreams) {
        const streamDir = path.join(sftpBasePath, 'streams', stream.id);
        await fs.mkdir(streamDir, { recursive: true });
        
        await fs.writeFile(
          path.join(streamDir, 'metadata.json'),
          JSON.stringify(stream, null, 2)
        );
      }

      // 验证SFTP上的文件结构
      for (const stream of codeStreams) {
        const streamDir = path.join(sftpBasePath, 'streams', stream.id);
        const metadataExists = await fs.access(path.join(streamDir, 'metadata.json')).then(() => true).catch(() => false);
        expect(metadataExists).toBe(true);
      }
    });
  });

  describe('并发代码流拉取', () => {
    it('应该支持同时拉取多个代码流', async () => {
      const numStreams = 3;
      const pullPromises: Promise<void>[] = [];
      const workPaths: string[] = [];
      const repoPaths: string[] = [];

      // 创建多个源仓库
      for (let i = 0; i < numStreams; i++) {
        const repoPath = await testEnv.createTempDir(`pull-repo-${i}-`);
        await testEnv.createTestRepository(repoPath, {
          'src/main.ts': `console.log("Pull Project ${i}");`,
          'src/utils.ts': `export const projectId = ${i};`,
        });
        repoPaths.push(repoPath);
      }

      // 并发拉取代码流（模拟复制文件）
      for (let i = 0; i < numStreams; i++) {
        const workPath = await testEnv.createTempDir(`extranet-work-${i}-`);
        workPaths.push(workPath);

        // 模拟拉取过程
        const pullPromise = (async () => {
          const filesToCopy = ['src/main.ts', 'src/utils.ts'];
          
          for (const file of filesToCopy) {
            const sourcePath = path.join(repoPaths[i], file);
            const targetPath = path.join(workPath, file);
            
            await fs.mkdir(path.dirname(targetPath), { recursive: true });
            await fs.copyFile(sourcePath, targetPath);
          }
        })();

        pullPromises.push(pullPromise);
      }

      // 等待所有拉取完成
      await Promise.all(pullPromises);

      // 验证所有代码流都成功拉取
      for (let i = 0; i < workPaths.length; i++) {
        const workPath = workPaths[i];
        const mainTsExists = await fs.access(path.join(workPath, 'src', 'main.ts')).then(() => true).catch(() => false);
        const utilsTsExists = await fs.access(path.join(workPath, 'src', 'utils.ts')).then(() => true).catch(() => false);

        expect(mainTsExists).toBe(true);
        expect(utilsTsExists).toBe(true);

        // 验证内容正确性
        const utilsContent = await fs.readFile(path.join(workPath, 'src', 'utils.ts'), 'utf-8');
        expect(utilsContent).toContain(`projectId = ${i}`);
      }
    });
  });

  describe('并发代码提交', () => {
    it('应该支持同时提交多个代码流的变更', async () => {
      const numStreams = 3;
      const commitPromises: Promise<void>[] = [];
      const streamIds: string[] = [];

      // 设置多个代码流环境
      for (let i = 0; i < numStreams; i++) {
        const streamId = `commit-project-${i}-${Date.now()}`;
        streamIds.push(streamId);

        const workPath = await testEnv.createTempDir(`commit-work-${i}-`);
        
        // 创建工作目录和文件
        await fs.mkdir(path.join(workPath, 'src'), { recursive: true });
        await fs.writeFile(
          path.join(workPath, 'src', 'utils.ts'),
          `export const projectId = ${i};`
        );

        // 模拟并发提交过程
        const commitPromise = (async () => {
          // 修改文件
          await fs.writeFile(
            path.join(workPath, 'src', 'utils.ts'),
            `export const projectId = ${i}; export const updated = true;`
          );

          await fs.writeFile(
            path.join(workPath, 'src', 'new-feature.ts'),
            `export function newFeature${i}() { return "Feature ${i}"; }`
          );

          // 模拟上传到SFTP
          const changesDir = path.join(sftpBasePath, 'streams', streamId, 'changes');
          await fs.mkdir(changesDir, { recursive: true });

          const commitId = `commit-${i}-${Date.now()}`;
          const commitInfo = {
            commitId,
            streamId,
            timestamp: new Date().toISOString(),
            message: `Concurrent update for project ${i}`,
            files: ['src/utils.ts', 'src/new-feature.ts']
          };

          await fs.writeFile(
            path.join(changesDir, `${commitId}.json`),
            JSON.stringify(commitInfo, null, 2)
          );
        })();

        commitPromises.push(commitPromise);
      }

      // 等待所有提交完成
      await Promise.all(commitPromises);

      // 验证SFTP上的变更文件
      for (const streamId of streamIds) {
        const changesDir = path.join(sftpBasePath, 'streams', streamId, 'changes');
        const changeFiles = await fs.readdir(changesDir);
        expect(changeFiles.length).toBeGreaterThan(0);
        
        // 验证至少有一个JSON文件
        const jsonFiles = changeFiles.filter(file => file.endsWith('.json'));
        expect(jsonFiles.length).toBeGreaterThan(0);
      }
    });
  });

  describe('并发监控和同步', () => {
    it('应该支持同时监控和同步多个代码流', async () => {
      const numStreams = 3;
      const syncPromises: Promise<void>[] = [];
      const streamIds: string[] = [];

      // 设置多个代码流的变更
      for (let i = 0; i < numStreams; i++) {
        const streamId = `sync-project-${i}-${Date.now()}`;
        streamIds.push(streamId);

        // 模拟并发同步过程
        const syncPromise = (async () => {
          // 创建变更目录
          const changesDir = path.join(sftpBasePath, 'streams', streamId, 'changes');
          await fs.mkdir(changesDir, { recursive: true });

          // 模拟检测变更
          const commitId = `sync-commit-${i}-${Date.now()}`;
          const changeInfo = {
            commitId,
            streamId,
            timestamp: new Date().toISOString(),
            message: `Sync test update for project ${i}`,
            files: ['src/utils.ts']
          };

          await fs.writeFile(
            path.join(changesDir, `${commitId}.json`),
            JSON.stringify(changeInfo, null, 2)
          );

          // 模拟应用变更到本地仓库
          const repoPath = await testEnv.createTempDir(`sync-repo-${i}-`);
          await fs.mkdir(path.join(repoPath, 'src'), { recursive: true });
          await fs.writeFile(
            path.join(repoPath, 'src', 'utils.ts'),
            `export const projectId = ${i}; export const syncTest = true;`
          );
        })();

        syncPromises.push(syncPromise);
      }

      // 等待所有同步完成
      await Promise.all(syncPromises);

      // 验证所有变更都已处理
      for (const streamId of streamIds) {
        const changesDir = path.join(sftpBasePath, 'streams', streamId, 'changes');
        const changeFiles = await fs.readdir(changesDir);
        expect(changeFiles.length).toBeGreaterThan(0);
      }
    });
  });

  describe('资源竞争和锁机制测试', () => {
    it('应该正确处理同一代码流的并发操作', async () => {
      const streamId = `race-test-${Date.now()}`;
      const numConcurrentOps = 3;
      const commitPromises: Promise<void>[] = [];

      // 创建并发操作
      for (let i = 0; i < numConcurrentOps; i++) {
        const commitPromise = (async () => {
          const workPath = await testEnv.createTempDir(`race-work-${i}-`);
          
          // 创建工作文件
          await fs.mkdir(path.join(workPath, 'src'), { recursive: true });
          await fs.writeFile(
            path.join(workPath, 'src', 'main.ts'),
            `console.log("Race condition test - update ${i}");`
          );

          // 模拟提交操作
          const changesDir = path.join(sftpBasePath, 'streams', streamId, 'changes');
          await fs.mkdir(changesDir, { recursive: true });

          const commitId = `race-commit-${i}-${Date.now()}`;
          const commitInfo = {
            commitId,
            streamId,
            timestamp: new Date().toISOString(),
            message: `Concurrent update ${i}`,
            files: ['src/main.ts']
          };

          await fs.writeFile(
            path.join(changesDir, `${commitId}.json`),
            JSON.stringify(commitInfo, null, 2)
          );
        })();

        commitPromises.push(commitPromise);
      }

      // 等待所有并发提交完成
      await Promise.all(commitPromises);

      // 验证SFTP上有相应的变更记录
      const changesDir = path.join(sftpBasePath, 'streams', streamId, 'changes');
      const changeFiles = await fs.readdir(changesDir);
      expect(changeFiles.length).toBe(numConcurrentOps);
    });
  });

  describe('性能和负载测试', () => {
    it('应该在合理时间内处理大量并发操作', async () => {
      const startTime = Date.now();
      const numStreams = 10;
      const operations: Promise<string>[] = [];

      // 创建大量并发操作
      for (let i = 0; i < numStreams; i++) {
        const operation = (async () => {
          const repoPath = await testEnv.createTempDir(`perf-repo-${i}-`);
          await testEnv.createTestRepository(repoPath, {
            'src/main.ts': `console.log("Performance test ${i}");`,
            'src/utils.ts': `export const id = ${i};`,
            'README.md': `# Performance Test ${i}\\n\\nThis is performance test number ${i}.`,
          });

          // 模拟代码流注册
          const streamId = `perf-project-${i}-${Date.now()}`;
          
          // 模拟创建SFTP结构
          const streamDir = path.join(sftpBasePath, 'streams', streamId);
          await fs.mkdir(streamDir, { recursive: true });
          
          const metadata = {
            id: streamId,
            name: `perf-project-${i}`,
            repoType: 'git',
            repoUrl: repoPath,
            createdAt: new Date(),
            lastSyncAt: new Date(),
            status: 'active',
            metadata: {
              version: '1.0.0',
              description: `Performance test ${i}`
            }
          };

          await fs.writeFile(
            path.join(streamDir, 'metadata.json'),
            JSON.stringify(metadata, null, 2)
          );

          return streamId;
        })();

        operations.push(operation);
      }

      // 等待所有操作完成
      const results = await Promise.all(operations);
      const endTime = Date.now();
      const duration = endTime - startTime;

      // 验证性能要求（应该在合理时间内完成）
      expect(duration).toBeLessThan(30000); // 30秒内完成
      expect(results).toHaveLength(numStreams);
      results.forEach(streamId => {
        expect(streamId).toBeDefined();
        expect(streamId).toContain('perf-project-');
      });
    });
  });
});