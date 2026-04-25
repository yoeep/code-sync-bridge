import { EventEmitter } from 'events';
import { existsSync, readFileSync, unwatchFile, watchFile, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { SFTPConfig } from '../interfaces';
import { getAppPath } from '../runtime';
import { SyncConfiguration } from './index';

export interface AppConfig {
  sftp: SFTPConfig;
  sync: SyncConfiguration;
  security: {
    encryptionEnabled: boolean;
    checksumValidation: boolean;
    maxConcurrentStreams: number;
  };
  logging?: {
    level: 'debug' | 'info' | 'warn' | 'error';
    filePath?: string;
    console: boolean;
  };
}

const DEFAULT_CONFIG: AppConfig = {
  sftp: {
    host: 'localhost',
    port: 22,
    username: 'sync-user',
    authMethod: 'dynamic-token',
    timeout: 30000,
    retryAttempts: 3,
    retryDelay: 2000,
    maxRetryDelay: 30000,
    dynamicTokenRefreshInterval: 60000,
    qrCodeImagePath: '',
    basePath: '',
  },
  sync: {
    monitorInterval: 300,
    maxFileSize: '100MB',
    excludePatterns: ['*.log', 'node_modules/', '.git/', '*.tmp'],
    upload: {
      targetDirectory: '/uploads',
      enableCompression: true,
      compressionFormat: 'zip',
    },
  },
  security: {
    encryptionEnabled: true,
    checksumValidation: true,
    maxConcurrentStreams: 10,
  },
  logging: {
    level: 'info',
    console: true,
  },
};

interface ValidationRule {
  path: string;
  validator: (value: unknown) => boolean;
  message: string;
}

export class ConfigManager extends EventEmitter {
  private config: AppConfig;
  private readonly configPath: string;
  private isWatching = false;
  private validationRules: ValidationRule[] = [];

  constructor(configPath?: string) {
    super();
    this.configPath = configPath || this.getDefaultConfigPath();
    this.config = this.cloneConfig(DEFAULT_CONFIG);
    this.initializeValidationRules();
    void this.load().catch((error: unknown) => {
      this.emit('configError', error);
    });
  }

  async load(): Promise<AppConfig> {
    try {
      let nextConfig = this.cloneConfig(DEFAULT_CONFIG);

      if (existsSync(this.configPath)) {
        const fileConfig = this.loadConfigFile();
        nextConfig = this.mergeConfigs(nextConfig, fileConfig);
      } else {
        this.config = nextConfig;
        await this.save();
      }

      nextConfig = this.applyEnvironmentOverrides(nextConfig);
      this.validateConfigValue(nextConfig);
      this.config = nextConfig;
      this.emit('configLoaded', this.getConfig());
      return this.getConfig();
    } catch (error) {
      this.emit('configError', error);
      throw error;
    }
  }

  async save(): Promise<void> {
    try {
      const configDir = dirname(this.configPath);
      const fs = await import('fs');

      if (!existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }

      writeFileSync(this.configPath, JSON.stringify(this.config, null, 2), 'utf8');
      this.emit('configSaved', this.configPath);
    } catch (error) {
      this.emit('configError', error);
      throw error;
    }
  }

  getConfig(): AppConfig {
    return this.cloneConfig(this.config);
  }

  async updateConfig(updates: Partial<AppConfig>): Promise<void> {
    const oldConfig = this.getConfig();
    const nextConfig = this.mergeConfigs(this.cloneConfig(this.config), updates);

    this.validateConfigValue(nextConfig);
    this.config = nextConfig;
    await this.save();
    this.emit('configUpdated', { oldConfig, newConfig: this.getConfig() });
  }

  get<T = unknown>(path: string): T {
    return this.getNestedValue(this.config, path) as T;
  }

  async set(path: string, value: unknown): Promise<void> {
    const oldConfig = this.getConfig();
    const nextConfig = this.cloneConfig(this.config);

    this.setNestedValue(nextConfig, path, value);
    this.validateConfigValue(nextConfig);
    this.config = nextConfig;
    await this.save();
    this.emit('configUpdated', { oldConfig, newConfig: this.getConfig() });
  }

  enableHotReload(): void {
    if (this.isWatching) {
      return;
    }

    this.isWatching = true;
    watchFile(this.configPath, { interval: 1000 }, async () => {
      try {
        const oldConfig = this.getConfig();
        await this.load();
        this.emit('configReloaded', { oldConfig, newConfig: this.getConfig() });
      } catch (error) {
        this.emit('configReloadError', error);
      }
    });

    this.emit('hotReloadEnabled');
  }

  disableHotReload(): void {
    if (!this.isWatching) {
      return;
    }

    this.isWatching = false;
    unwatchFile(this.configPath);
    this.emit('hotReloadDisabled');
  }

  async reset(): Promise<void> {
    this.config = this.cloneConfig(DEFAULT_CONFIG);
    await this.save();
    this.emit('configReset');
  }

  validateConfig(): void {
    this.validateConfigValue(this.config);
  }

  addValidationRule(path: string, validator: (value: unknown) => boolean, message: string): void {
    this.validationRules.push({ path, validator, message });
  }

  getConfigPath(): string {
    return this.configPath;
  }

  private validateConfigValue(config: AppConfig): void {
    const errors: string[] = [];

    for (const rule of this.validationRules) {
      const value = this.getNestedValue(config, rule.path);
      if (!rule.validator(value)) {
        errors.push(`${rule.path}: ${rule.message}`);
      }
    }

    if (errors.length > 0) {
      throw new Error(`Configuration validation failed:\n${errors.join('\n')}`);
    }
  }

  private loadConfigFile(): Partial<AppConfig> {
    try {
      return JSON.parse(readFileSync(this.configPath, 'utf8')) as Partial<AppConfig>;
    } catch (error) {
      throw new Error(
        `Failed to load config file ${this.configPath}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private mergeConfigs<T extends object>(target: T, source: Partial<T> | Record<string, unknown>): T {
    const result: Record<string, unknown> = { ...(target as Record<string, unknown>) };

    for (const [key, value] of Object.entries(source)) {
      const targetValue = result[key];
      if (this.isPlainObject(value) && this.isPlainObject(targetValue)) {
        result[key] = this.mergeConfigs(targetValue, value);
      } else if (this.isPlainObject(value)) {
        result[key] = this.mergeConfigs({}, value);
      } else {
        result[key] = value;
      }
    }

    return result as T;
  }

  private cloneConfig<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
  }

  private applyEnvironmentOverrides(config: AppConfig): AppConfig {
    const nextConfig = this.cloneConfig(config);
    const envMappings: Record<string, string> = {
      SFTP_HOST: 'sftp.host',
      SFTP_PORT: 'sftp.port',
      SFTP_USERNAME: 'sftp.username',
      SFTP_AUTH_METHOD: 'sftp.authMethod',
      SFTP_PASSWORD: 'sftp.password',
      SFTP_PRIVATE_KEY_PATH: 'sftp.privateKeyPath',
      SFTP_TIMEOUT: 'sftp.timeout',
      SFTP_RETRY_ATTEMPTS: 'sftp.retryAttempts',
      SYNC_MONITOR_INTERVAL: 'sync.monitorInterval',
      SYNC_MAX_FILE_SIZE: 'sync.maxFileSize',
      SECURITY_ENCRYPTION_ENABLED: 'security.encryptionEnabled',
      SECURITY_CHECKSUM_VALIDATION: 'security.checksumValidation',
      SECURITY_MAX_CONCURRENT_STREAMS: 'security.maxConcurrentStreams',
      LOG_LEVEL: 'logging.level',
      LOG_FILE_PATH: 'logging.filePath',
      LOG_CONSOLE: 'logging.console',
    };

    for (const [envVar, configPath] of Object.entries(envMappings)) {
      const envValue = process.env[envVar];
      if (envValue !== undefined) {
        this.setNestedValue(nextConfig, configPath, this.parseEnvironmentValue(envValue));
      }
    }

    return nextConfig;
  }

  private parseEnvironmentValue(value: string): boolean | number | string {
    if (value === 'true') {
      return true;
    }
    if (value === 'false') {
      return false;
    }
    if (/^\d+$/.test(value)) {
      return parseInt(value, 10);
    }
    if (/^\d+\.\d+$/.test(value)) {
      return parseFloat(value);
    }
    return value;
  }

  private getNestedValue(obj: unknown, path: string): unknown {
    return path.split('.').reduce<unknown>((current, key) => {
      if (current && typeof current === 'object') {
        return (current as Record<string, unknown>)[key];
      }
      return undefined;
    }, obj);
  }

  private setNestedValue(obj: unknown, path: string, value: unknown): void {
    const keys = path.split('.');
    const lastKey = keys.pop();

    if (!lastKey || !obj || typeof obj !== 'object') {
      return;
    }

    const target = keys.reduce<Record<string, unknown>>((current, key) => {
      const currentValue = current[key];
      if (!this.isPlainObject(currentValue)) {
        current[key] = {};
      }
      return current[key] as Record<string, unknown>;
    }, obj as Record<string, unknown>);

    target[lastKey] = value;
  }

  private getDefaultConfigPath(): string {
    if (process.env.CONFIG_PATH) {
      return process.env.CONFIG_PATH;
    }

    const configDir = process.env.NODE_ENV === 'production' ? '/etc/code-sync-bridge' : getAppPath('config');
    return join(configDir, 'config.json');
  }

  private initializeValidationRules(): void {
    this.validationRules = [
      {
        path: 'sftp.host',
        validator: (value) => typeof value === 'string' && value.length > 0,
        message: 'SFTP host must be a non-empty string',
      },
      {
        path: 'sftp.port',
        validator: (value) => typeof value === 'number' && value > 0 && value <= 65535,
        message: 'SFTP port must be a number between 1 and 65535',
      },
      {
        path: 'sftp.username',
        validator: (value) => typeof value === 'string' && value.length > 0,
        message: 'SFTP username must be a non-empty string',
      },
      {
        path: 'sftp.authMethod',
        validator: (value) => value === 'password' || value === 'dynamic-token' || value === 'key',
        message: 'SFTP auth method must be one of: password, dynamic-token, key',
      },
      {
        path: 'sftp.timeout',
        validator: (value) => typeof value === 'number' && value > 0,
        message: 'SFTP timeout must be a positive number',
      },
      {
        path: 'sftp.retryAttempts',
        validator: (value) => typeof value === 'number' && value >= 0,
        message: 'SFTP retry attempts must be a non-negative number',
      },
      {
        path: 'sync.monitorInterval',
        validator: (value) => typeof value === 'number' && value > 0,
        message: 'Sync monitor interval must be a positive number',
      },
      {
        path: 'security.maxConcurrentStreams',
        validator: (value) => typeof value === 'number' && value > 0,
        message: 'Max concurrent streams must be a positive number',
      },
    ];
  }

  private isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}

let globalConfigManager: ConfigManager | null = null;

export function getConfigManager(configPath?: string): ConfigManager {
  if (!globalConfigManager) {
    globalConfigManager = new ConfigManager(configPath);
  }
  return globalConfigManager;
}

export function resetConfigManager(): void {
  if (globalConfigManager) {
    globalConfigManager.disableHotReload();
    globalConfigManager = null;
  }
}
