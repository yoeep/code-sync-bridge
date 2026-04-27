import { createBridgeClient, type BridgeProgressHandlers } from './client';
import { getApplicationBaseDir, loadBridgeConfig } from './config';
import * as fs from 'fs';
import * as path from 'path';
import type { ProgressInfo } from '@code-sync-bridge/shared/sftp';

async function withClient<T>(
  configPath: string,
  action: (client: Awaited<ReturnType<typeof createBridgeClient>>) => Promise<T>,
  handlers?: BridgeProgressHandlers
): Promise<T> {
  const config = loadBridgeConfig(configPath);
  const client = await createBridgeClient(config, handlers);

  try {
    await client.connectWithRetry();
    return await action(client);
  } finally {
    client.disconnect();
  }
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;
  return `${value.toFixed(value >= 100 || index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatSeconds(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return '0s';
  }

  if (seconds < 60) {
    return `${Math.round(seconds)}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  return `${minutes}m ${remainingSeconds}s`;
}

function renderProgressBar(label: string, progress: ProgressInfo): void {
  const width = 24;
  const percentage = Math.max(0, Math.min(100, progress.percentage));
  const filled = Math.round((percentage / 100) * width);
  const bar = `${'='.repeat(filled)}${'-'.repeat(width - filled)}`;
  const line =
    `\r${label} [${bar}] ${percentage.toString().padStart(3, ' ')}% ` +
    `${formatBytes(progress.transferred)}/${formatBytes(progress.total)} ` +
    `${formatBytes(progress.speed)}/s ETA ${formatSeconds(progress.eta)}`;

  process.stdout.write(line);

  if (percentage >= 100 || progress.transferred >= progress.total) {
    process.stdout.write('\n');
  }
}

function createSingleFileProgressHandlers(label: string): BridgeProgressHandlers {
  return {
    onUploadProgress(progress: ProgressInfo): void {
      renderProgressBar(label, progress);
    },
    onDownloadProgress(progress: ProgressInfo): void {
      renderProgressBar(label, progress);
    },
  };
}

function joinRemotePath(basePath: string, childName: string): string {
  if (basePath === '.' || basePath === '/') {
    return `${basePath.replace(/\/$/, '')}/${childName}`.replace(/^\/\//, '/');
  }

  return `${basePath.replace(/\/$/, '')}/${childName}`;
}

function normalizeRemoteRoot(input: string): string {
  const sanitized = input.replace(/\\/g, '/').trim();
  return path.posix.resolve('/', sanitized || '/');
}

type FileSnapshot = {
  relativePath: string;
  size: number;
  modifiedTime: number;
};

type SyncLogger = {
  logPath: string;
  write: (message: string) => void;
  close: () => void;
};

function printDirectoryEntries(entries: Array<{ filename?: string; longname?: string }>): void {
  for (const entry of entries) {
    console.log(entry.longname ?? entry.filename ?? '<unknown>');
  }
}

function ensureParentDir(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function createSyncLogger(localDir: string): SyncLogger {
  const timestamp = new Date().toISOString().replace(/[:]/g, '-');
  const logDir = path.join(localDir, '.sftp-bridge');
  const logPath = path.join(logDir, `sync-${timestamp}.log`);

  fs.mkdirSync(logDir, { recursive: true });
  fs.writeFileSync(logPath, `sftp-bridge sync log\ncreated: ${new Date().toISOString()}\n\n`, 'utf8');

  return {
    logPath,
    write(message: string): void {
      fs.appendFileSync(logPath, `${new Date().toISOString()} ${message}\n`, 'utf8');
    },
    close(): void {
      fs.appendFileSync(logPath, `\ncompleted: ${new Date().toISOString()}\n`, 'utf8');
    },
  };
}

function backupLocalFile(localPath: string, localRoot: string): string {
  const timestamp = new Date().toISOString().replace(/[:]/g, '-');
  const relativePath = normalizeRelativePath(path.relative(localRoot, localPath));
  const backupRoot = path.join(localRoot, '.sftp-bridge', 'backups', timestamp);
  const backupPath = path.join(backupRoot, relativePath);

  ensureParentDir(backupPath);
  fs.copyFileSync(localPath, backupPath);
  return backupPath;
}

async function downloadDirectoryRecursive(
  client: Awaited<ReturnType<typeof createBridgeClient>>,
  remoteDir: string,
  localDir: string
): Promise<void> {
  fs.mkdirSync(localDir, { recursive: true });

  const entries = await client.listDirectory(remoteDir);

  for (const entry of entries as Array<{ filename?: string; attrs?: { isDirectory?: () => boolean } }>) {
    const filename = entry.filename;

    if (!filename || filename === '.' || filename === '..') {
      continue;
    }

    const remoteChildPath = joinRemotePath(remoteDir, filename);
    const localChildPath = path.join(localDir, filename);
    const isDirectory =
      typeof entry.attrs?.isDirectory === 'function' ? entry.attrs.isDirectory() : await client.directoryExists(remoteChildPath);

    if (isDirectory) {
      await downloadDirectoryRecursive(client, remoteChildPath, localChildPath);
      continue;
    }

    await client.downloadFile(remoteChildPath, localChildPath);
  }
}

async function uploadDirectoryRecursive(
  client: Awaited<ReturnType<typeof createBridgeClient>>,
  localDir: string,
  remoteDir: string
): Promise<void> {
  const entries = fs.readdirSync(localDir, { withFileTypes: true });

  for (const entry of entries) {
    const localChildPath = path.join(localDir, entry.name);
    const remoteChildPath = joinRemotePath(remoteDir, entry.name);

    if (entry.isDirectory()) {
      await client.createDirectory(remoteChildPath);
      await uploadDirectoryRecursive(client, localChildPath, remoteChildPath);
      continue;
    }

    if (entry.isFile()) {
      await client.uploadFile(localChildPath, remoteChildPath);
    }
  }
}

function normalizeRelativePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.?\//, '');
}

function buildRemotePath(root: string, relativePath: string): string {
  const normalizedRelativePath = normalizeRelativePath(relativePath);
  return normalizedRelativePath ? joinRemotePath(root, normalizedRelativePath) : root;
}

function collectLocalFiles(localDir: string, baseDir: string = localDir): FileSnapshot[] {
  const snapshots: FileSnapshot[] = [];
  const entries = fs.readdirSync(localDir, { withFileTypes: true });

  for (const entry of entries) {
    const absolutePath = path.join(localDir, entry.name);

    if (entry.isDirectory()) {
      snapshots.push(...collectLocalFiles(absolutePath, baseDir));
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const stats = fs.statSync(absolutePath);
    snapshots.push({
      relativePath: normalizeRelativePath(path.relative(baseDir, absolutePath)),
      size: stats.size,
      modifiedTime: stats.mtimeMs,
    });
  }

  return snapshots;
}

async function collectRemoteFiles(
  client: Awaited<ReturnType<typeof createBridgeClient>>,
  remoteDir: string,
  baseDir: string = remoteDir
): Promise<FileSnapshot[]> {
  const snapshots: FileSnapshot[] = [];
  const entries = await client.listDirectory(remoteDir);

  for (const entry of entries as Array<{ filename?: string; attrs?: { isDirectory?: () => boolean; size?: number; mtime?: number } }>) {
    const filename = entry.filename;

    if (!filename || filename === '.' || filename === '..') {
      continue;
    }

    const childRemotePath = joinRemotePath(remoteDir, filename);
    const isDirectory =
      typeof entry.attrs?.isDirectory === 'function' ? entry.attrs.isDirectory() : await client.directoryExists(childRemotePath);

    if (isDirectory) {
      snapshots.push(...(await collectRemoteFiles(client, childRemotePath, baseDir)));
      continue;
    }

    snapshots.push({
      relativePath: normalizeRelativePath(childRemotePath.substring(baseDir.replace(/\/$/, '').length).replace(/^\/+/, '')),
      size: entry.attrs?.size ?? 0,
      modifiedTime: (entry.attrs?.mtime ?? 0) * 1000,
    });
  }

  return snapshots;
}

async function syncDirectoryBidirectional(
  client: Awaited<ReturnType<typeof createBridgeClient>>,
  localDir: string,
  remoteDir: string
): Promise<void> {
  const logger = createSyncLogger(localDir);
  const localFiles = new Map(collectLocalFiles(localDir).map((item) => [item.relativePath, item]));
  let remoteSnapshots: FileSnapshot[];

  try {
    remoteSnapshots = await collectRemoteFiles(client, remoteDir);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.write(`[ERROR_REMOTE_DIR] ${remoteDir} -> ${message}`);
    logger.close();
    throw new Error(`Remote directory not found or inaccessible: ${remoteDir}`);
  }

  const remoteFiles = new Map(remoteSnapshots.map((item) => [item.relativePath, item]));
  const relativePaths = new Set([...localFiles.keys(), ...remoteFiles.keys()]);

  try {
    for (const relativePath of relativePaths) {
      const localFile = localFiles.get(relativePath);
      const remoteFile = remoteFiles.get(relativePath);
      const localPath = path.join(localDir, relativePath);
      const remotePath = buildRemotePath(remoteDir, relativePath);

      if (localFile && !remoteFile) {
        await client.uploadFile(localPath, remotePath);
        console.log(`Synced up   ${relativePath}`);
        logger.write(`[ADD_REMOTE] ${relativePath}`);
        continue;
      }

      if (!localFile && remoteFile) {
        await client.downloadFile(remotePath, localPath);
        console.log(`Synced down ${relativePath}`);
        logger.write(`[ADD_LOCAL] ${relativePath}`);
        continue;
      }

      if (!localFile || !remoteFile) {
        continue;
      }

      if (localFile.size === remoteFile.size && Math.abs(localFile.modifiedTime - remoteFile.modifiedTime) < 1000) {
        logger.write(`[SKIP] ${relativePath}`);
        continue;
      }

      if (localFile.modifiedTime >= remoteFile.modifiedTime) {
        await client.uploadFile(localPath, remotePath);
        console.log(`Updated up  ${relativePath}`);
        logger.write(`[OVERWRITE_REMOTE] ${relativePath}`);
        continue;
      }

      const backupPath = backupLocalFile(localPath, localDir);
      logger.write(`[BACKUP_LOCAL] ${relativePath} -> ${backupPath}`);
      await client.downloadFile(remotePath, localPath);
      console.log(`Updated down ${relativePath}`);
      logger.write(`[OVERWRITE_LOCAL] ${relativePath}`);
    }
  } finally {
    logger.close();
    console.log(`Sync log written to ${logger.logPath}`);
  }
}

function printHelp(): void {
  console.log('Usage: sftp-bridge [options] <command> [args]');
  console.log('');
  console.log('Minimal interactive SFTP bridge for upload and download across isolated networks');
  console.log('');
  console.log('Options:');
  console.log(`  -c, --config <path>   Config file path (default: ${getApplicationBaseDir()}\\config.json)`);
  console.log('  -h, --help            Display help');
  console.log('');
  console.log('Commands:');
  console.log('  test');
  console.log('  list [remotePath]');
  console.log('  upload <localPath> <remotePath>');
  console.log('  upload-dir <localDir> <remoteDir>');
  console.log('  download <remotePath> <localPath>');
  console.log('  download-dir <remoteDir> <localDir>');
  console.log('  sync-dir <localDir> <remoteDir>');
}

type ParsedArgs = {
  command?: string;
  positionals: string[];
  configPath: string;
  showHelp: boolean;
};

function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  const parsed: ParsedArgs = {
    positionals: [],
    configPath: 'config.json',
    showHelp: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const current = args[index];

    if (current === '-h' || current === '--help') {
      parsed.showHelp = true;
      continue;
    }

    if (current === '-c' || current === '--config') {
      parsed.configPath = args[index + 1] ?? parsed.configPath;
      index += 1;
      continue;
    }

    if (!parsed.command) {
      parsed.command = current;
      continue;
    }

    parsed.positionals.push(current);
  }

  return parsed;
}

export async function runCli(argv: string[]): Promise<void> {
  const parsed = parseArgs(argv);

  if (parsed.showHelp || !parsed.command) {
    printHelp();
    return;
  }

  switch (parsed.command) {
    case 'test':
      await withClient(parsed.configPath, async () => {
        console.log('SFTP connection established successfully.');
      });
      return;
    case 'list':
      await withClient(parsed.configPath, async (client) => {
        const remotePath = parsed.positionals[0] ?? '.';
        const entries = await client.listDirectory(remotePath);
        printDirectoryEntries(entries as Array<{ filename?: string; longname?: string }>);
      });
      return;
    case 'upload':
      if (parsed.positionals.length < 2) {
        throw new Error('upload requires <localPath> and <remotePath>');
      }
      await withClient(parsed.configPath, async (client) => {
        const remotePath = normalizeRemoteRoot(parsed.positionals[1]);
        await client.uploadFile(parsed.positionals[0], remotePath);
        console.log(`Uploaded ${parsed.positionals[0]} -> ${remotePath}`);
      }, createSingleFileProgressHandlers('upload'));
      return;
    case 'upload-dir':
      if (parsed.positionals.length < 2) {
        throw new Error('upload-dir requires <localDir> and <remoteDir>');
      }
      await withClient(parsed.configPath, async (client) => {
        const remoteDir = normalizeRemoteRoot(parsed.positionals[1]);
        try {
          await client.createDirectory(remoteDir);
        } catch {
          throw new Error(`Remote directory could not be created or accessed: ${remoteDir}`);
        }
        await uploadDirectoryRecursive(client, parsed.positionals[0], remoteDir);
        console.log(`Upload completed: local="${parsed.positionals[0]}" remote="${remoteDir}"`);
      });
      return;
    case 'download':
      if (parsed.positionals.length < 2) {
        throw new Error('download requires <remotePath> and <localPath>');
      }
      await withClient(parsed.configPath, async (client) => {
        const remotePath = normalizeRemoteRoot(parsed.positionals[0]);
        await client.downloadFile(remotePath, parsed.positionals[1]);
        console.log(`Downloaded ${remotePath} -> ${parsed.positionals[1]}`);
      }, createSingleFileProgressHandlers('download'));
      return;
    case 'download-dir':
      if (parsed.positionals.length < 2) {
        throw new Error('download-dir requires <remoteDir> and <localDir>');
      }
      await withClient(parsed.configPath, async (client) => {
        const remoteDir = normalizeRemoteRoot(parsed.positionals[0]);
        await downloadDirectoryRecursive(client, remoteDir, parsed.positionals[1]);
        console.log(`Download completed: remote="${remoteDir}" local="${parsed.positionals[1]}"`);
      });
      return;
    case 'sync-dir':
      if (parsed.positionals.length < 2) {
        throw new Error('sync-dir requires <localDir> and <remoteDir>');
      }
      await withClient(parsed.configPath, async (client) => {
        if (!fs.existsSync(parsed.positionals[0]) || !fs.statSync(parsed.positionals[0]).isDirectory()) {
          throw new Error(`Local directory not found: ${parsed.positionals[0]}`);
        }

        const remoteDir = normalizeRemoteRoot(parsed.positionals[1]);
        try {
          await client.createDirectory(remoteDir);
        } catch {
          throw new Error(`Remote directory could not be created or accessed: ${remoteDir}`);
        }

        await syncDirectoryBidirectional(client, parsed.positionals[0], remoteDir);
        console.log(`Sync completed: local="${parsed.positionals[0]}" remote="${remoteDir}"`);
      });
      return;
    default:
      throw new Error(`Unknown command: ${parsed.command}`);
  }
}
