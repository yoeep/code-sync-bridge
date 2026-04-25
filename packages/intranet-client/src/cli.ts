#!/usr/bin/env node

import { Command } from 'commander';
import { IntranetClient } from './index';
import * as path from 'path';
import * as fs from 'fs/promises';
import archiver from 'archiver';
import { createWriteStream } from 'fs';
import { log } from '@code-sync-bridge/shared/utils/Logger';
import { getConfigManager } from '@code-sync-bridge/shared/config';
import { CodeStream, ConflictInfo } from '@code-sync-bridge/shared/types';
import { SFTPConnectionManager, SFTPClientFactory, SystemSFTPConfig, ConsoleDynamicTokenProvider } from '@code-sync-bridge/shared/sftp';
import { getTempFilePath } from '@code-sync-bridge/shared/runtime';

const program = new Command();

program
  .name('intranet-client')
  .description('内网客户端 - 代码同步桥接服务')
  .version('1.0.0');

// 注册代码流命令
program
  .command('register')
  .description('注册新的代码流')
  .requiredOption('-r, --repo <url>', '仓库URL')
  .requiredOption('-n, --name <name>', '代码流名称')
  .option('-c, --config <path>', '配置文件路径')
  .action(async (options) => {
    try {
      const client = new IntranetClient(options.config);
      const streamId = await client.registerCodeStream(options.repo, options.name);
      console.log(`✅ 代码流注册成功: ${streamId}`); // 保留进程监控信息
      log.info('CLI-Register', '代码流注册成功', { streamId });
      process.exit(0);
    } catch (error) {
      console.error('❌ 注册失败:', error instanceof Error ? error.message : String(error)); // 保留错误信息
      log.error('CLI-Register', '注册失败', { error: error instanceof Error ? error.message : String(error) });
      process.exit(1);
    }
  });

// 开始监控命令
program
  .command('monitor')
  .description('开始监控代码流变更')
  .option('-s, --stream <id>', '指定代码流ID')
  .option('-i, --interval <seconds>', '监控间隔（秒）', '300')
  .option('-c, --config <path>', '配置文件路径')
  .action(async (options) => {
    try {
      const client = new IntranetClient(options.config);
      const interval = parseInt(options.interval);
      
      if (options.stream) {
        client.startMonitoring(options.stream, interval);
        console.log(`🔍 开始监控代码流: ${options.stream} (间隔: ${interval}秒)`); // 保留进程监控信息
        log.info('CLI-Monitor', '开始监控代码流', { streamId: options.stream, interval });
      } else {
        // 监控所有活跃代码流
        const streams = await client.listCodeStreams();
        const activeStreams = streams.filter((s: CodeStream) => s.status === 'active');
        
        for (const stream of activeStreams) {
          client.startMonitoring(stream.id, interval);
        }
        
        console.log(`🔍 开始监控 ${activeStreams.length} 个活跃代码流 (间隔: ${interval}秒)`); // 保留进程监控信息
        log.info('CLI-Monitor', '开始监控多个代码流', { count: activeStreams.length, interval });
      }
      
      // 保持进程运行
      console.log('按 Ctrl+C 停止监控'); // 保留用户提示信息
      process.on('SIGINT', () => {
        console.log('\n⏹️  停止监控'); // 保留进程监控信息
        log.info('CLI-Monitor', '停止监控');
        client.stopMonitoring();
        process.exit(0);
      });
      
    } catch (error) {
      console.error('❌ 监控启动失败:', error instanceof Error ? error.message : String(error)); // 保留错误信息
      log.error('CLI-Monitor', '监控启动失败', { error: error instanceof Error ? error.message : String(error) });
      process.exit(1);
    }
  });

// 同步命令
program
  .command('sync')
  .description('手动同步代码流变更')
  .option('-s, --stream <id>', '指定代码流ID')
  .option('-c, --config <path>', '配置文件路径')
  .action(async (options) => {
    try {
      const client = new IntranetClient(options.config);
      
      if (options.stream) {
        console.log(`🔄 同步代码流: ${options.stream}`); // 保留进程监控信息
        log.info('CLI-Sync', '开始同步代码流', { streamId: options.stream });
        const result = await client.syncChangesFromSFTP(options.stream);
        
        if (result.success) {
          console.log(`✅ 同步成功: 应用了 ${result.changesApplied} 个变更`); // 保留进程监控信息
          if (result.commitHash) {
            console.log(`📝 提交哈希: ${result.commitHash}`); // 保留进程监控信息
          }
          log.info('CLI-Sync', '同步成功', { changesApplied: result.changesApplied, commitHash: result.commitHash });
        } else {
          console.log(`❌ 同步失败:`); // 保留错误信息
          result.errors.forEach((error: string) => console.log(`   - ${error}`)); // 保留错误信息
          log.error('CLI-Sync', '同步失败', { errors: result.errors });
        }
        
        if (result.conflicts.length > 0) {
          console.log(`⚠️  发现 ${result.conflicts.length} 个冲突:`); // 保留重要警告信息
          result.conflicts.forEach((conflict: ConflictInfo) => {
            console.log(`   - ${conflict.filePath}: ${conflict.description}`); // 保留重要警告信息
          });
          log.warn('CLI-Sync', '发现冲突', { conflicts: result.conflicts });
        }
      } else {
        console.log('🔄 同步所有活跃代码流'); // 保留进程监控信息
        const summary = await client.syncAllActiveStreams();
        
        console.log(`📊 同步完成:`); // 保留进程监控信息
        console.log(`   - 总代码流: ${summary.totalStreams}`); // 保留进程监控信息
        console.log(`   - 成功: ${summary.successfulSyncs}`); // 保留进程监控信息
        console.log(`   - 失败: ${summary.failedSyncs}`); // 保留进程监控信息
        console.log(`   - 总变更: ${summary.totalChanges}`); // 保留进程监控信息
        log.info('CLI-Sync', '批量同步完成', summary);
      }
      
      process.exit(0);
    } catch (error) {
      console.error('❌ 同步失败:', error instanceof Error ? error.message : String(error)); // 保留错误信息
      log.error('CLI-Sync', '同步失败', { error: error instanceof Error ? error.message : String(error) });
      process.exit(1);
    }
  });

// 列出代码流命令
program
  .command('list')
  .description('列出所有代码流')
  .option('-c, --config <path>', '配置文件路径')
  .action(async (options) => {
    try {
      const client = new IntranetClient(options.config);
      const streams = await client.listCodeStreams();
      
      if (streams.length === 0) {
        console.log('📭 没有找到代码流'); // 保留用户信息
        log.info('CLI-List', '没有找到代码流');
        process.exit(0);
      }
      
      console.log(`📋 找到 ${streams.length} 个代码流:`); // 保留用户信息
      console.log('');
      
      streams.forEach(stream => {
        console.log(`🔗 ${stream.name} (${stream.id})`); // 保留用户信息
        console.log(`   仓库: ${stream.repoUrl}`); // 保留用户信息
        console.log(`   类型: ${stream.repoType}`); // 保留用户信息
        console.log(`   状态: ${stream.status}`); // 保留用户信息
        console.log(`   创建时间: ${stream.createdAt.toLocaleString()}`); // 保留用户信息
        console.log(`   最后同步: ${stream.lastSyncAt.toLocaleString()}`); // 保留用户信息
        console.log('');
      });
      log.info('CLI-List', '列出代码流', { count: streams.length, streams: streams.map(s => ({ id: s.id, name: s.name, status: s.status })) });
      
      process.exit(0);
    } catch (error) {
      console.error('❌ 获取代码流列表失败:', error instanceof Error ? error.message : String(error)); // 保留错误信息
      log.error('CLI-List', '获取代码流列表失败', { error: error instanceof Error ? error.message : String(error) });
      process.exit(1);
    }
  });

// 状态命令
program
  .command('status')
  .description('查看监控状态')
  .option('-c, --config <path>', '配置文件路径')
  .option('--test-sftp', '测试SFTP连接状态')
  .option('--detailed', '显示详细状态信息')
  .action(async (options) => {
    try {
      const client = new IntranetClient(options.config);
      const status = client.getMonitoringStatus();
      
      console.log('📊 监控状态:'); // 保留用户信息
      console.log(`   - 是否监控中: ${status.isMonitoring ? '是' : '否'}`); // 保留用户信息
      console.log(`   - 监控的代码流: ${status.totalStreams}`); // 保留用户信息
      
      if (status.monitoredStreams.length > 0) {
        console.log('   - 监控列表:'); // 保留用户信息
        status.monitoredStreams.forEach(streamId => {
          console.log(`     • ${streamId}`); // 保留用户信息
        });
      }
      log.info('CLI-Status', '查询监控状态', status);
      
      // 测试SFTP连接状态
      if (options.testSftp) {
        console.log('\n🔗 SFTP连接测试:'); // 保留用户信息
        await testSFTPConnection(options.config, options.detailed);
      }
      
      process.exit(0);
    } catch (error) {
      console.error('❌ 获取状态失败:', error instanceof Error ? error.message : String(error)); // 保留错误信息
      log.error('CLI-Status', '获取状态失败', { error: error instanceof Error ? error.message : String(error) });
      process.exit(1);
    }
  });

/**
 * 测试SFTP连接状态
 */
async function testSFTPConnection(configPath?: string, detailed: boolean = false): Promise<void> {
  try {
    console.log('   🔍 正在检查SFTP连接...'); // 保留用户信息
    log.info('CLI-SFTP-Test', '开始SFTP连接测试');
    
    // 加载配置
    const configManager = getConfigManager(configPath);
    const config = await configManager.load();
    
    if (detailed) {
      console.log(`   📋 SFTP配置:`); // 保留用户信息
      console.log(`      - 服务器: ${config.sftp.host}:${config.sftp.port}`); // 保留用户信息
      console.log(`      - 用户名: ${config.sftp.username}`); // 保留用户信息
      console.log(`      - 认证方式: ${config.sftp.authMethod}`); // 保留用户信息
      console.log(`      - 超时时间: ${config.sftp.timeout}ms`); // 保留用户信息
      console.log(`      - 重试次数: ${config.sftp.retryAttempts}`); // 保留用户信息
    }
    log.debug('CLI-SFTP-Test', 'SFTP配置', config.sftp);
    
    // 检查系统环境
    const envTest = await SFTPClientFactory.testEnvironment();
    
    if (!envTest.ssh2Supported ) {
      console.log('   ❌ 系统环境不支持SSH2');
      if (envTest.recommendations.length > 0) {
        console.log('   💡 建议:');
        envTest.recommendations.forEach((rec: string) => console.log(`      - ${rec}`));
      }
      return;
    }
    
    if (detailed) {
      console.log(`   ✅ 系统环境检查通过`);
      if (envTest.ssh2Version) {
        console.log(`      - SSH2版本: ${envTest.ssh2Version}`);
      }
    }
    
    // 创建SFTP客户端配置
    const sftpConfig: SystemSFTPConfig = {
      host: config.sftp.host,
      port: config.sftp.port,
      username: config.sftp.username,
      authMethod: config.sftp.authMethod as 'password' | 'dynamic-token' | 'key',
      privateKey: config.sftp.privateKeyPath,
      password: config.sftp.password,
      timeout: config.sftp.timeout,
      retries: config.sftp.retryAttempts || 3,
      retryDelay: 2000
    };
    
    // 处理动态令牌认证
    if (config.sftp.authMethod === 'dynamic-token') {
      const configAny = config as any;
      if (configAny.sftp.qrCodeImagePath) {
        // 二维码认证
        sftpConfig.qrCodeImagePath = configAny.sftp.qrCodeImagePath;
        console.log('   🔐 使用二维码动态令牌认证');
      } else if (configAny.sftp.totpSecret) {
        // TOTP认证
        sftpConfig.totpSecret = configAny.sftp.totpSecret;
        console.log('   🔐 使用TOTP动态令牌认证');
      } else {
        // 控制台输入认证
        const provider = new ConsoleDynamicTokenProvider('请输入SFTP验证码: ');
        sftpConfig.dynamicTokenProvider = () => provider.getToken();
        console.log('   🔐 使用控制台输入动态令牌认证');
      }
    }
    
    // 创建SFTP客户端
    const startTime = Date.now();
    const client = await SFTPClientFactory.createClient(sftpConfig);
    
    // 测试连接
    await client.connectWithRetry();
    const connectTime = Date.now() - startTime;
    
    console.log(`   ✅ SFTP连接成功 (耗时: ${connectTime}ms)`);
    
    if (detailed) {
      // 测试基本操作
      console.log('   🧪 测试基本操作...');
      
      try {
        // 测试目录列表
        const testStart = Date.now();
        const files = await client.listDirectory('.');
        const listTime = Date.now() - testStart;
        console.log(`      ✅ 目录列表: ${files.length} 个文件 (耗时: ${listTime}ms)`);
        if (files.length > 0) {
          console.log(`      📁 前几个文件: ${files.slice(0, 3).map((f: { filename?: string; name?: string }) => f.filename || f.name || '').join(', ')}`);
        }
      } catch (error) {
        console.log(`      ⚠️  目录列表失败: ${error instanceof Error ? error.message : String(error)}`);
      }
      
      try {
        // 测试文件存在检查
        const testStart = Date.now();
        const exists = await client.fileExists('test.txt');
        const checkTime = Date.now() - testStart;
        console.log(`      ✅ 文件存在检查: test.txt ${exists ? '存在' : '不存在'} (耗时: ${checkTime}ms)`);
      } catch (error) {
        console.log(`      ⚠️  文件检查失败: ${error instanceof Error ? error.message : String(error)}`);
      }
      
      try {
        // 测试连接状态
        const isActive = client.isConnectionActive();
        console.log(`      ✅ 连接状态: ${isActive ? '活跃' : '非活跃'}`);
      } catch (error) {
        console.log(`      ⚠️  连接状态检查失败: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    
    // 断开连接
    client.disconnect();
    console.log('   🔌 连接已断开');
    
  } catch (error) {
    console.log(`   ❌ SFTP连接失败: ${error instanceof Error ? error.message : String(error)}`);
    
    // 提供故障排除建议
    if (detailed) {
      console.log('   🔧 故障排除建议:');
      console.log('      - 检查服务器地址和端口是否正确');
      console.log('      - 确认用户名和认证信息是否正确');
      console.log('      - 检查网络连接是否正常');
      console.log('      - 确认SFTP服务器是否允许您的IP访问');
      console.log('      - 检查防火墙设置');
      
      if (error instanceof Error) {
        if (error.message.includes('timeout')) {
          console.log('      - 连接超时，尝试增加timeout设置');
        }
        
        if (error.message.includes('authentication') || error.message.includes('Permission denied')) {
          console.log('      - 认证失败，检查密钥文件权限或密码');
        }
        
        if (error.message.includes('Connection refused')) {
          console.log('      - 连接被拒绝，检查服务器是否运行SSH/SFTP服务');
        }
      }
    }
  }
}

// 上传命令
program
  .command('upload')
  .description('上传文件或目录到SFTP服务器')
  .requiredOption('-s, --source <path>', '本地文件或目录路径')
  .option('-t, --target <path>', '目标路径（可选，默认使用配置文件中的目标目录）')
  .option('-c, --config <path>', '配置文件路径')
  .option('--no-compress', '禁用压缩')
  .option('--format <format>', '压缩格式 (zip|tar|tar.gz)', 'zip')
  .action(async (options) => {
    try {
      const configManager = getConfigManager(options.config);
      const config = await configManager.load();
      
      // 解析源路径
      const sourcePath = path.resolve(options.source);
      const sourceStat = await fs.stat(sourcePath);
      
      console.log(`📤 准备上传: ${sourcePath}`);
      log.info('CLI-Upload', '开始上传', { sourcePath, isDirectory: sourceStat.isDirectory() });
      
      let uploadPath: string;
      let tempArchivePath: string | null = null;
      
      if (sourceStat.isDirectory()) {
        // 处理目录上传
        const dirName = path.basename(sourcePath);
        const shouldCompress = !options.noCompress && config.sync.upload?.enableCompression !== false;
        
        if (shouldCompress) {
          // 创建压缩文件
          const format = options.format || config.sync.upload?.compressionFormat || 'zip';
          const archiveName = `${dirName}_${Date.now()}.${format === 'tar.gz' ? 'tar.gz' : format}`;
          tempArchivePath = getTempFilePath(path.parse(archiveName).name, path.extname(archiveName) || '.zip');
          
          console.log(`🗜️  正在压缩目录: ${dirName}`);
          await createArchive(sourcePath, tempArchivePath, format);
          uploadPath = tempArchivePath;
          console.log(`✅ 压缩完成: ${archiveName}`);
        } else {
          // 直接上传目录（需要SFTP支持目录上传）
          uploadPath = sourcePath;
        }
      } else {
        // 处理文件上传
        uploadPath = sourcePath;
      }
      
      // 确定目标路径
      const targetDirectory = options.target || config.sync.upload?.targetDirectory || '/uploads';
      const fileName = path.basename(uploadPath);
      const targetPath = path.posix.join(targetDirectory, fileName).replace(/\\/g, '/');
      
      console.log(`📁 目标路径: ${targetPath}`);
      
      // 执行上传
      await uploadToSFTP(uploadPath, targetPath, options.config);
      
      // 清理临时文件
      if (tempArchivePath) {
        try {
          await fs.unlink(tempArchivePath);
          console.log(`🧹 清理临时文件: ${tempArchivePath}`);
        } catch (error) {
          console.warn(`⚠️  清理临时文件失败: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      
      console.log('✅ 上传完成');
      log.info('CLI-Upload', '上传完成', { sourcePath, targetPath });
      process.exit(0);
      
    } catch (error) {
      console.error('❌ 上传失败:', error instanceof Error ? error.message : String(error));
      log.error('CLI-Upload', '上传失败', { error: error instanceof Error ? error.message : String(error) });
      process.exit(1);
    }
  });

/**
 * 创建压缩文件
 */
async function createArchive(sourcePath: string, targetPath: string, format: 'zip' | 'tar' | 'tar.gz'): Promise<void> {
  return new Promise((resolve, reject) => {
    const output = createWriteStream(targetPath);
    const archive = archiver(format === 'tar.gz' ? 'tar' : format, {
      gzip: format === 'tar.gz'
    });
    
    output.on('close', () => {
      resolve();
    });
    
    archive.on('error', (err: any) => {
      reject(err);
    });
    
    archive.pipe(output);
    archive.directory(sourcePath, false);
    archive.finalize();
  });
}

/**
 * 上传到SFTP
 */
async function uploadToSFTP(localPath: string, remotePath: string, configPath?: string): Promise<void> {
  const configManager = getConfigManager(configPath);
  const config = await configManager.load();
  const sftpManager = new SFTPConnectionManager(config.sftp);
  sftpManager.on('connected', (connectionId: string) => {
      console.log('✓ SFTP连接成功，连接ID:', connectionId);
    });
    
    sftpManager.on('fileUploaded', ({ localPath, remotePath }: { localPath: string; remotePath: string }) => {
      console.log('✓ 文件上传成功:', localPath, '->', remotePath);
    });
    
    sftpManager.on('error', (error: Error) => {
      console.error('✗ SFTP错误:', error.message);
    });
    
    
  try {
   // 连接到SFTP服务器
    console.log('正在连接到SFTP服务器...');
    await sftpManager.connect();
    // 确保目标目录存在
    const targetDir = path.posix.dirname(remotePath);
    try {
      await sftpManager.createDirectory(targetDir);
      console.log(`📁 确保目录存在: ${targetDir}`);
    } catch (error) {
      // 目录可能已经存在，忽略错误
    }
    
    // 上传文件
    console.log('📤 正在上传文件...');
    await sftpManager.uploadFile(localPath, remotePath);
    console.log('✅ 文件上传成功');
    
  } finally {
    await sftpManager.disconnect();
    console.log('🔌 SFTP连接已断开');
  }
}

program.parse();
