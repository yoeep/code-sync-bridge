import * as os from 'os';
import * as path from 'path';

const APP_DIR_NAME = '.code-sync-bridge';

function resolveBaseDir(): string {
  const customDir = process.env.CODE_SYNC_BRIDGE_HOME?.trim();
  if (customDir) {
    return path.resolve(customDir);
  }

  return path.join(os.homedir(), APP_DIR_NAME);
}

export function getAppHomeDir(): string {
  return resolveBaseDir();
}

export function getAppPath(...segments: string[]): string {
  return path.join(resolveBaseDir(), ...segments);
}

export function getTempFilePath(prefix: string, extension: string = '.tmp'): string {
  const safePrefix = prefix.replace(/[^a-zA-Z0-9-_]/g, '-');
  return path.join(os.tmpdir(), `${safePrefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}${extension}`);
}
