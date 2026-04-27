import type { SystemSFTPConfig } from '@code-sync-bridge/shared/sftp';

export type DynamicTokenSource = 'prompt' | 'env' | 'file' | 'qr' | 'totp';

export interface DynamicTokenSettings {
  source: DynamicTokenSource;
  prompt?: string;
  envVarName?: string;
  filePath?: string;
  qrCodeImagePath?: string;
  watchMode?: boolean;
  watchInterval?: number;
  totpSecret?: string;
}

export interface SftpBridgeConfig {
  host: string;
  port?: number;
  username: string;
  password?: string;
  privateKey?: string;
  authMethod?: SystemSFTPConfig['authMethod'];
  timeout?: number;
  retries?: number;
  retryDelay?: number;
  basePath?: string;
  dynamicToken?: DynamicTokenSettings;
}
