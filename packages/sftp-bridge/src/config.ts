import * as fs from 'fs';
import * as path from 'path';
import type { SftpBridgeConfig } from './types';

function isPackagedExecutable(): boolean {
  const execPath = process.execPath.toLowerCase();
  return execPath.endsWith('.exe') && !execPath.endsWith('\\node.exe');
}

export function getApplicationBaseDir(): string {
  if (isPackagedExecutable()) {
    return path.dirname(process.execPath);
  }

  const entryFile = require.main?.filename ?? process.argv[1];
  if (entryFile) {
    return path.dirname(path.resolve(entryFile));
  }

  return process.cwd();
}

export function resolveConfigPath(configPath: string): string {
  if (path.isAbsolute(configPath)) {
    return configPath;
  }

  return path.resolve(getApplicationBaseDir(), configPath);
}

function resolveRelativeFile(configDir: string, filePath?: string): string | undefined {
  if (!filePath) {
    return undefined;
  }

  if (path.isAbsolute(filePath)) {
    return filePath;
  }

  return path.resolve(configDir, filePath);
}

function normalizeBridgeConfig(config: SftpBridgeConfig, configDir: string): SftpBridgeConfig {
  return {
    ...config,
    privateKey: resolveRelativeFile(configDir, config.privateKey),
    dynamicToken: config.dynamicToken
      ? {
          ...config.dynamicToken,
          filePath: resolveRelativeFile(configDir, config.dynamicToken.filePath),
          qrCodeImagePath: resolveRelativeFile(configDir, config.dynamicToken.qrCodeImagePath),
        }
      : undefined,
  };
}

export function loadBridgeConfig(configPath: string): SftpBridgeConfig {
  const resolvedPath = resolveConfigPath(configPath);

  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Config file not found: ${resolvedPath}`);
  }

  const rawContent = fs.readFileSync(resolvedPath, 'utf8');
  const parsed = JSON.parse(rawContent) as SftpBridgeConfig;
  const normalized = normalizeBridgeConfig(parsed, path.dirname(resolvedPath));

  validateBridgeConfig(normalized);
  return normalized;
}

export function validateBridgeConfig(config: SftpBridgeConfig): void {
  if (!config.host) {
    throw new Error('Config field "host" is required.');
  }

  if (!config.username) {
    throw new Error('Config field "username" is required.');
  }

  if (config.authMethod === 'dynamic-token' && !config.dynamicToken && !config.password) {
    throw new Error('Dynamic-token authentication requires "dynamicToken" settings or a password fallback.');
  }

  if (config.dynamicToken?.source === 'file' && !config.dynamicToken.filePath) {
    throw new Error('Dynamic token source "file" requires "dynamicToken.filePath".');
  }

  if (config.dynamicToken?.source === 'env' && !config.dynamicToken.envVarName) {
    throw new Error('Dynamic token source "env" requires "dynamicToken.envVarName".');
  }

  if (config.dynamicToken?.source === 'qr' && !config.dynamicToken.qrCodeImagePath) {
    throw new Error('Dynamic token source "qr" requires "dynamicToken.qrCodeImagePath".');
  }

  if (config.dynamicToken?.source === 'totp' && !config.dynamicToken.totpSecret) {
    throw new Error('Dynamic token source "totp" requires "dynamicToken.totpSecret".');
  }
}
