import * as fs from 'fs/promises';
import * as path from 'path';
import { ConfigManager } from '@code-sync-bridge/shared/config';
import { TestEnvironment } from '../test-utils/TestEnvironment';

describe('shared config ConfigManager', () => {
  const originalEnv = {
    CONFIG_PATH: process.env.CONFIG_PATH,
    NODE_ENV: process.env.NODE_ENV,
    SFTP_HOST: process.env.SFTP_HOST,
    SFTP_PORT: process.env.SFTP_PORT,
    LOG_CONSOLE: process.env.LOG_CONSOLE,
  };

  let testEnv: TestEnvironment;

  beforeAll(async () => {
    testEnv = await TestEnvironment.initialize();
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it('creates a default config file when the target file does not exist', async () => {
    const configDir = await testEnv.createTempDir('config-manager-default-');
    const configPath = path.join(configDir, 'config.json');

    const manager = new ConfigManager(configPath);
    const loadedConfig = await manager.load();

    expect(await fs.access(configPath).then(() => true).catch(() => false)).toBe(true);
    expect(loadedConfig.sftp.host).toBe('localhost');
    expect(loadedConfig.sync.monitorInterval).toBe(300);
    expect(manager.getConfigPath()).toBe(configPath);
  });

  it('applies environment overrides and parses numbers and booleans', async () => {
    const configDir = await testEnv.createTempDir('config-manager-env-');
    const configPath = path.join(configDir, 'config.json');

    process.env.SFTP_HOST = 'env-host.example.com';
    process.env.SFTP_PORT = '2022';
    process.env.LOG_CONSOLE = 'false';

    const manager = new ConfigManager(configPath);
    const loadedConfig = await manager.load();

    expect(loadedConfig.sftp.host).toBe('env-host.example.com');
    expect(loadedConfig.sftp.port).toBe(2022);
    expect(loadedConfig.logging?.console).toBe(false);
  });

  it('updates nested configuration values and persists them', async () => {
    const configDir = await testEnv.createTempDir('config-manager-set-');
    const configPath = path.join(configDir, 'config.json');
    const manager = new ConfigManager(configPath);

    await manager.load();
    await manager.set('sync.monitorInterval', 900);
    await manager.set('logging.filePath', '/tmp/code-sync.log');

    const reloadedConfig = JSON.parse(await fs.readFile(configPath, 'utf8')) as {
      sync: { monitorInterval: number };
      logging: { filePath: string };
    };

    expect(manager.get<number>('sync.monitorInterval')).toBe(900);
    expect(reloadedConfig.sync.monitorInterval).toBe(900);
    expect(reloadedConfig.logging.filePath).toBe('/tmp/code-sync.log');
  });

  it('rejects invalid configuration updates and preserves the old config', async () => {
    const configDir = await testEnv.createTempDir('config-manager-invalid-');
    const configPath = path.join(configDir, 'config.json');
    const manager = new ConfigManager(configPath);

    await manager.load();
    const previousPort = manager.get<number>('sftp.port');

    await expect(manager.set('sftp.port', -1)).rejects.toThrow('Configuration validation failed');
    expect(manager.get<number>('sftp.port')).toBe(previousPort);
  });

  it('honors CONFIG_PATH when no path is passed explicitly', async () => {
    const configDir = await testEnv.createTempDir('config-manager-env-path-');
    const configPath = path.join(configDir, 'env-config.json');
    process.env.CONFIG_PATH = configPath;

    const manager = new ConfigManager();
    await manager.load();

    expect(manager.getConfigPath()).toBe(configPath);
  });
});
