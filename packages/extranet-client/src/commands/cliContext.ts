import * as fs from 'fs/promises';
import * as path from 'path';
import { ExtranetClient } from '../index';
import { CLIConfig, CLIErrorHandler, ProgressIndicator } from '../utils/cli-helpers';

export type OutputType = 'success' | 'error' | 'info' | 'warning';

let cliConfig: CLIConfig | undefined;
let errorHandler: CLIErrorHandler | undefined;

export function formatOutput(message: string, type: OutputType = 'info'): string {
  if (process.env.NO_COLOR) {
    const prefixes: Record<OutputType, string> = {
      success: '[ok]',
      error: '[error]',
      info: '[info]',
      warning: '[warn]',
    };

    return `${prefixes[type]} ${message}`;
  }

  const colors: Record<OutputType, string> = {
    success: '\x1b[32m',
    error: '\x1b[31m',
    info: '\x1b[34m',
    warning: '\x1b[33m',
  };

  return `${colors[type]}${message}\x1b[0m`;
}

export function verboseLog(message: string): void {
  if (process.env.VERBOSE) {
    console.log(`[verbose] ${message}`);
  }
}

export async function createClient(configPath?: string): Promise<ExtranetClient> {
  verboseLog(`using config: ${configPath || 'default'}`);
  return new ExtranetClient(configPath);
}

export async function validateLocalPath(localPath: string): Promise<void> {
  try {
    const resolvedPath = path.resolve(localPath);
    const stat = await fs.stat(resolvedPath);

    if (!stat.isDirectory()) {
      throw new Error(`path is not a directory: ${resolvedPath}`);
    }

    await fs.access(resolvedPath, fs.constants.W_OK);
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === 'ENOENT') {
      await fs.mkdir(path.resolve(localPath), { recursive: true });
      return;
    }

    throw error;
  }
}

export function formatFileSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  return `${size.toFixed(1)} ${units[unitIndex]}`;
}

export function formatTime(date: Date): string {
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export async function initializeCLI(options: { config?: string; verbose?: boolean }): Promise<void> {
  cliConfig = new CLIConfig(options.config);
  await cliConfig.loadConfig();
  errorHandler = new CLIErrorHandler(Boolean(options.verbose));
  verboseLog('CLI initialized');
}

export function getCliConfig(): CLIConfig {
  if (!cliConfig) {
    throw new Error('CLI is not initialized');
  }

  return cliConfig;
}

export function getErrorHandler(): CLIErrorHandler | undefined {
  return errorHandler;
}

export { ProgressIndicator };
