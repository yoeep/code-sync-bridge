import {
  ConsoleDynamicTokenProvider,
  EnvironmentDynamicTokenProvider,
  FileDynamicTokenProvider,
  type ProgressInfo,
  QRCodeDynamicTokenProvider,
  SFTPClientFactory,
  type DynamicTokenProvider,
  type SystemSFTPClient,
  type SystemSFTPConfig,
} from '@code-sync-bridge/shared/sftp';
import { authenticator } from 'otplib';
import type { DynamicTokenSettings, SftpBridgeConfig } from './types';

export type BridgeProgressHandlers = {
  onUploadProgress?: (progress: ProgressInfo) => void;
  onDownloadProgress?: (progress: ProgressInfo) => void;
};

function buildTokenProvider(settings?: DynamicTokenSettings): DynamicTokenProvider | undefined {
  if (!settings) {
    return undefined;
  }

  switch (settings.source) {
    case 'prompt':
      return new ConsoleDynamicTokenProvider(settings.prompt ?? 'Enter dynamic token: ');
    case 'env':
      return new EnvironmentDynamicTokenProvider(settings.envVarName ?? 'SFTP_DYNAMIC_TOKEN');
    case 'file':
      return new FileDynamicTokenProvider(settings.filePath!);
    case 'qr':
      return new QRCodeDynamicTokenProvider(
        settings.qrCodeImagePath!,
        settings.watchMode ?? false,
        settings.watchInterval ?? 5000
      );
    case 'totp':
      return {
        async getToken(): Promise<string> {
          return authenticator.generate(settings.totpSecret!);
        },
      };
    default:
      return undefined;
  }
}

export function toSystemSftpConfig(config: SftpBridgeConfig, handlers?: BridgeProgressHandlers): SystemSFTPConfig {
  const tokenProvider = buildTokenProvider(config.dynamicToken);

  return {
    host: config.host,
    port: config.port ?? 22,
    username: config.username,
    password: config.password,
    privateKey: config.privateKey,
    authMethod: config.authMethod ?? (tokenProvider ? 'dynamic-token' : 'password'),
    timeout: config.timeout ?? 30000,
    retries: config.retries ?? 3,
    retryDelay: config.retryDelay ?? 2000,
    basePath: config.basePath ?? '/',
    totpSecret: config.dynamicToken?.source === 'totp' ? config.dynamicToken.totpSecret : undefined,
    qrCodeImagePath: config.dynamicToken?.source === 'qr' ? config.dynamicToken.qrCodeImagePath : undefined,
    dynamicTokenProvider: tokenProvider ? () => tokenProvider.getToken() : undefined,
    onUploadProgress: handlers?.onUploadProgress,
    onDownloadProgress: handlers?.onDownloadProgress,
  };
}

export async function createBridgeClient(
  config: SftpBridgeConfig,
  handlers?: BridgeProgressHandlers
): Promise<SystemSFTPClient> {
  const systemConfig = toSystemSftpConfig(config, handlers);
  SFTPClientFactory.validateConfig(systemConfig);
  return SFTPClientFactory.createClient(systemConfig);
}
