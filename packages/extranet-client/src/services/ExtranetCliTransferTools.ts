import * as path from 'path';
import * as fs from 'fs/promises';
import archiver from 'archiver';
import { createWriteStream } from 'fs';
import {
  SFTPConnectionManager,
  SFTPClientFactory,
  ConsoleDynamicTokenProvider,
  SystemSFTPConfig,
} from '@code-sync-bridge/shared/sftp';
import { getConfigManager } from '@code-sync-bridge/shared/config';

export async function createArchive(
  sourcePath: string,
  targetPath: string,
  format: 'zip' | 'tar' | 'tar.gz'
): Promise<void> {
  return await new Promise((resolve, reject) => {
    const output = createWriteStream(targetPath);
    const archive = archiver(format === 'tar.gz' ? 'tar' : format, {
      gzip: format === 'tar.gz'
    });

    output.on('close', () => resolve());
    archive.on('error', (err: Error) => reject(err));

    archive.pipe(output);
    archive.directory(sourcePath, false);
    archive.finalize();
  });
}

export async function uploadToSFTP(
  localPath: string,
  remotePath: string,
  configPath?: string
): Promise<void> {
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
    console.log('正在连接到SFTP服务器...');
    await sftpManager.connect();

    const targetDir = path.posix.dirname(remotePath);
    try {
      await sftpManager.createDirectory(targetDir);
      console.log(`📁 确保目录存在: ${targetDir}`);
    } catch {
      // 目录可能已存在，忽略错误
    }

    console.log('📤 正在上传文件...');
    await sftpManager.uploadFile(localPath, remotePath);
    console.log('✓ 文件上传成功');
  } finally {
    await sftpManager.disconnect();
    console.log('🔌 SFTP连接已断开');
  }
}

export async function testSFTPConnectionForExtranet(
  configPath?: string,
  detailed: boolean = false
): Promise<void> {
  try {
    console.log('   🔍 正在检查SFTP连接...');

    let config: {
      sftp: {
        host: string;
        port: number;
        username: string;
        authMethod: 'dynamic-token' | 'password' | 'key';
        timeout: number;
        retryAttempts: number;
        password?: string;
        qrCodeImagePath?: string;
        totpSecret?: string;
        privateKeyPath?: string;
      };
    };

    try {
      if (configPath) {
        const content = await fs.readFile(configPath, 'utf8');
        config = JSON.parse(content);
      } else {
        config = {
          sftp: {
            host: 'localhost',
            port: 22,
            username: 'sync-user',
            authMethod: 'dynamic-token',
            timeout: 30000,
            retryAttempts: 3
          }
        };
      }
    } catch (error) {
      console.log(`   ❌  配置加载失败: ${error instanceof Error ? error.message : String(error)}`);
      console.log('   💡 请确保配置文件存在且格式正确');
      return;
    }

    if (detailed) {
      console.log('   🔍 SFTP配置:');
      console.log(`      - 服务器: ${config.sftp.host}:${config.sftp.port}`);
      console.log(`      - 用户名: ${config.sftp.username}`);
      console.log(`      - 认证方式: ${config.sftp.authMethod}`);
      console.log(`      - 超时时间: ${config.sftp.timeout}ms`);
    }

    const envTest = await SFTPClientFactory.testEnvironment();

    if (!envTest.ssh2Supported) {
      console.log('   ❌ 系统环境不支持SSH2');
      if (envTest.recommendations.length > 0) {
        console.log('   💡 建议:');
        envTest.recommendations.forEach((rec: string) => console.log(`      - ${rec}`));
      }
      return;
    }

    if (detailed && envTest.ssh2Version) {
      console.log('   ✅ 系统环境检查通过');
      console.log(`      - SSH2版本: ${envTest.ssh2Version}`);
    }

    const sftpConfig: SystemSFTPConfig = {
      host: config.sftp.host,
      port: config.sftp.port,
      username: config.sftp.username,
      authMethod: config.sftp.authMethod,
      privateKey: config.sftp.privateKeyPath,
      password: config.sftp.password,
      timeout: config.sftp.timeout,
      retries: config.sftp.retryAttempts || 3,
      retryDelay: 2000
    };

    if (config.sftp.authMethod === 'dynamic-token' && !config.sftp.password) {
      if (config.sftp.qrCodeImagePath) {
        sftpConfig.qrCodeImagePath = config.sftp.qrCodeImagePath;
        console.log('   🔐 使用二维码动态令牌认证');
      } else if (config.sftp.totpSecret) {
        sftpConfig.totpSecret = config.sftp.totpSecret;
        console.log('   🔐 使用TOTP动态令牌认证');
      } else {
        const provider = new ConsoleDynamicTokenProvider('请输入SFTP验证码: ');
        sftpConfig.dynamicTokenProvider = () => provider.getToken();
        console.log('   🔐 使用控制台输入动态令牌认证');
      }
    }

    const startTime = Date.now();
    const client = await SFTPClientFactory.createClient(sftpConfig);
    await client.connectWithRetry();
    const connectTime = Date.now() - startTime;

    console.log(`   ✅ SFTP连接成功 (耗时: ${connectTime}ms)`);

    if (detailed) {
      console.log('   🧪 测试基本操作...');

      try {
        const testStart = Date.now();
        const files = await client.listDirectory('.');
        const listTime = Date.now() - testStart;
        console.log(`      ✅ 目录列表: ${files.length} 个文件 (耗时: ${listTime}ms)`);
        if (files.length > 0) {
          console.log(`      📁 前几个文件: ${files.slice(0, 3).map((f: { filename?: string; name?: string }) => f.filename || f.name || '').join(', ')}`);
        }
      } catch (error) {
        console.log(`      ❌  目录列表失败: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    client.disconnect();
    console.log('   🔌 连接已断开');
  } catch (error) {
    console.log(`   ❌ SFTP连接失败: ${error instanceof Error ? error.message : String(error)}`);
    if (detailed) {
      console.log('   💡 故障排除建议:');
      console.log('      - 检查配置文件是否存在且格式正确');
      console.log('      - 检查SFTP服务器配置');
      console.log('      - 检查网络连接状态');
      console.log('      - 确保已安装必要的依赖库');
    }
  }
}
