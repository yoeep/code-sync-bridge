import { Command } from 'commander';
import * as fs from 'fs/promises';
import * as path from 'path';
import { CodeStream, FileChange } from '@code-sync-bridge/shared/types';
import {
  ProgressIndicator,
  createClient,
  formatFileSize,
  formatOutput,
  formatTime,
  getCliConfig,
  getErrorHandler,
  initializeCLI,
  validateLocalPath,
  verboseLog,
} from './cliContext';

export function registerStreamCommands(program: Command): void {
  program
    .command('list')
    .alias('ls')
    .description('List available code streams')
    .option('-f, --format <type>', 'Output format (table|json)', 'table')
    .option('--status <status>', 'Filter by status (active|paused|archived)')
    .action(async (options: { format: 'table' | 'json'; status?: string }) => {
      try {
        await initializeCLI(program.opts<{ config?: string; verbose?: boolean }>());
        const client = await createClient(getCliConfig().get('configPath'));
        const progress = new ProgressIndicator('Fetching streams');
        progress.start();

        const allStreams = await client.listAvailableStreams();
        progress.succeed();

        const filteredStreams = options.status
          ? allStreams.filter((stream) => stream.status === options.status)
          : allStreams;

        if (filteredStreams.length === 0) {
          console.log(formatOutput('No matching code streams found', 'info'));
          process.exit(0);
        }

        if (options.format === 'json') {
          console.log(JSON.stringify(filteredStreams, null, 2));
          process.exit(0);
        }

        const rows = filteredStreams.map((stream: CodeStream) => ({
          id: stream.id,
          name: stream.name,
          type: stream.repoType,
          status: stream.status,
          lastSync: formatTime(stream.lastSyncAt),
        }));

        console.table(rows);
        process.exit(0);
      } catch (error) {
        getErrorHandler()?.handleError(error, 'LIST_STREAMS');
      }
    });

  program
    .command('pull <streamId>')
    .description('Pull a code stream to a local directory')
    .option('-p, --path <path>', 'Local directory path')
    .option('-f, --force', 'Overwrite an existing non-empty directory')
    .option('--check-updates', 'Check for updates before pulling')
    .action(async (streamId: string, options: { path?: string; force?: boolean; checkUpdates?: boolean }) => {
      try {
        await initializeCLI(program.opts<{ config?: string; verbose?: boolean }>());
        const cliConfig = getCliConfig();
        const client = await createClient(cliConfig.get('configPath'));

        let localPath = options.path;
        if (!localPath) {
          localPath = path.join(cliConfig.get('workspace.basePath', './workspace'), streamId);
        }

        const resolvedPath = path.resolve(localPath);
        const pathExists = await fs.access(resolvedPath).then(() => true).catch(() => false);
        if (pathExists && !options.force) {
          const files = await fs.readdir(resolvedPath);
          if (files.length > 0) {
            throw new Error(`directory is not empty: ${resolvedPath}`);
          }
        }

        if (options.checkUpdates && pathExists) {
          const progress = new ProgressIndicator('Checking for updates');
          progress.start();
          const hasUpdates = await client.checkForUpdates(streamId, resolvedPath);
          progress.succeed();

          if (!hasUpdates) {
            console.log(formatOutput('Stream is already up to date', 'info'));
            process.exit(0);
          }
        }

        await validateLocalPath(localPath);

        const progress = new ProgressIndicator(`Pulling ${streamId}`);
        progress.start();
        await client.pullCodeStream(streamId, resolvedPath);
        progress.succeed(`Pulled ${streamId}`);

        console.log(formatOutput(`Code stream pulled to ${resolvedPath}`, 'success'));
        process.exit(0);
      } catch (error) {
        getErrorHandler()?.handleError(error, 'PULL_STREAM');
      }
    });

  program
    .command('status <streamId>')
    .description('Show stream status')
    .option('-p, --path <path>', 'Local directory path')
    .option('-d, --detailed', 'Show detailed status')
    .action(async (streamId: string, options: { path?: string; detailed?: boolean }) => {
      try {
        await initializeCLI(program.opts<{ config?: string; verbose?: boolean }>());
        const client = await createClient(getCliConfig().get('configPath'));
        const progress = new ProgressIndicator(`Querying ${streamId}`);
        progress.start();
        const streamStatus = await client.getStreamStatus(streamId);
        progress.succeed();

        console.log(`streamId: ${streamId}`);
        console.log(`online: ${streamStatus.online}`);
        console.log(`lastActivity: ${formatTime(streamStatus.lastActivity)}`);
        console.log(`pendingChanges: ${streamStatus.pendingChanges}`);
        console.log(`syncStatus: ${streamStatus.syncStatus}`);
        if (streamStatus.error) {
          console.log(`error: ${streamStatus.error}`);
        }

        if (options.detailed) {
          const streamInfo = await client.getCodeStreamInfo(streamId);
          if (streamInfo) {
            console.log(JSON.stringify(streamInfo, null, 2));
          }
        }

        process.exit(0);
      } catch (error) {
        getErrorHandler()?.handleError(error, 'STREAM_STATUS');
      }
    });

  program
    .command('diff <streamId>')
    .alias('changes')
    .description('Show local changes for a stream')
    .option('-p, --path <path>', 'Local directory path')
    .option('-f, --format <type>', 'Output format (summary|detailed|json)', 'summary')
    .action(async (streamId: string, options: { path?: string; format?: 'summary' | 'detailed' | 'json' }) => {
      try {
        await initializeCLI(program.opts<{ config?: string; verbose?: boolean }>());
        const cliConfig = getCliConfig();
        const client = await createClient(cliConfig.get('configPath'));

        const localPath = options.path || path.join(cliConfig.get('workspace.basePath', './workspace'), streamId);
        const resolvedPath = path.resolve(localPath);
        verboseLog(`checking changes for ${streamId} in ${resolvedPath}`);
        await fs.access(resolvedPath);

        const progress = new ProgressIndicator('Checking changes');
        progress.start();
        const pendingChanges = await client.getPendingChanges(streamId);
        const changeStats = await client.getChangeStats(streamId);
        progress.succeed();

        if (pendingChanges.length === 0) {
          console.log(formatOutput('No pending changes detected', 'info'));
          process.exit(0);
        }

        if (options.format === 'json') {
          console.log(JSON.stringify({ streamId, stats: changeStats, changes: pendingChanges }, null, 2));
          process.exit(0);
        }

        console.log(`totalChanges: ${changeStats.totalChanges}`);
        console.log(`createdFiles: ${changeStats.createdFiles}`);
        console.log(`modifiedFiles: ${changeStats.modifiedFiles}`);
        console.log(`deletedFiles: ${changeStats.deletedFiles}`);

        if (options.format === 'detailed') {
          pendingChanges.forEach((change: FileChange) => {
            const details = [`${change.operation.toUpperCase()}: ${change.path}`];
            if (change.oldPath) {
              details.push(`from ${change.oldPath}`);
            }
            if (change.content) {
              details.push(`size ${formatFileSize(change.content.length)}`);
            }
            console.log(details.join(' | '));
          });
        }

        process.exit(0);
      } catch (error) {
        getErrorHandler()?.handleError(error, 'DETECT_CHANGES');
      }
    });
}
