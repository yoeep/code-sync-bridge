import { Command } from 'commander';
import * as fs from 'fs/promises';
import * as path from 'path';
import {
  ProgressIndicator,
  createClient,
  formatFileSize,
  formatOutput,
  formatTime,
  getCliConfig,
  getErrorHandler,
  initializeCLI,
  verboseLog,
} from './cliContext';

export function registerCommitCommands(program: Command): void {
  program
    .command('commit <streamId>')
    .description('Commit local changes to the remote stream')
    .option('-p, --path <path>', 'Local directory path')
    .option('-m, --message <message>', 'Commit message')
    .option('--dry-run', 'Preview changes without committing')
    .action(async (streamId: string, options: { path?: string; message?: string; dryRun?: boolean }) => {
      try {
        await initializeCLI(program.opts<{ config?: string; verbose?: boolean }>());
        const cliConfig = getCliConfig();
        const client = await createClient(cliConfig.get('configPath'));

        const localPath = options.path || path.join(cliConfig.get('workspace.basePath', './workspace'), streamId);
        const resolvedPath = path.resolve(localPath);
        await fs.access(resolvedPath);
        verboseLog(`committing ${streamId} from ${resolvedPath}`);

        const progress = new ProgressIndicator('Checking pending changes');
        progress.start();
        const hasPendingChanges = await client.hasPendingChanges(streamId);
        progress.succeed();

        if (!hasPendingChanges) {
          console.log(formatOutput('No changes to commit', 'info'));
          process.exit(0);
        }

        const pendingChanges = await client.getPendingChanges(streamId);
        const changeStats = await client.getChangeStats(streamId);

        if (options.dryRun) {
          console.log(JSON.stringify({ streamId, stats: changeStats, changes: pendingChanges }, null, 2));
          process.exit(0);
        }

        const commitMessage =
          options.message ||
          String(cliConfig.get('sync.commitMessageTemplate', 'Auto sync: {timestamp}')).replace(
            '{timestamp}',
            new Date().toISOString()
          );

        const commitProgress = new ProgressIndicator('Committing changes');
        commitProgress.start();
        const commitResult = await client.commitChanges(streamId, commitMessage);
        commitProgress.succeed();

        if (!commitResult.success) {
          throw new Error(commitResult.error || 'commit failed');
        }

        console.log(formatOutput('Commit completed', 'success'));
        console.log(`commitId: ${commitResult.commitId}`);
        console.log(`timestamp: ${formatTime(commitResult.timestamp)}`);
        console.log(`changesCount: ${commitResult.changesCount}`);
        if (commitResult.uploadedSize) {
          console.log(`uploadedSize: ${formatFileSize(commitResult.uploadedSize)}`);
        }

        process.exit(0);
      } catch (error) {
        getErrorHandler()?.handleError(error, 'COMMIT_CHANGES');
      }
    });

  program
    .command('history <streamId>')
    .alias('log')
    .description('Show commit history for a stream')
    .option('-n, --limit <number>', 'Maximum number of commits to show', '10')
    .option('-f, --format <type>', 'Output format (summary|detailed|json)', 'summary')
    .option('--since <date>', 'Only include commits after the given date')
    .action(
      async (
        streamId: string,
        options: { limit?: string; format?: 'summary' | 'detailed' | 'json'; since?: string }
      ) => {
        try {
          await initializeCLI(program.opts<{ config?: string; verbose?: boolean }>());
          const client = await createClient(getCliConfig().get('configPath'));
          const progress = new ProgressIndicator(`Loading history for ${streamId}`);
          progress.start();
          const commitHistory = await client.getCommitHistory(streamId, Number.parseInt(options.limit || '10', 10));
          progress.succeed();

          let filteredHistory = commitHistory;
          if (options.since) {
            const sinceDate = new Date(options.since);
            if (Number.isNaN(sinceDate.getTime())) {
              throw new Error('invalid date format');
            }
            filteredHistory = commitHistory.filter((commit) => commit.timestamp >= sinceDate);
          }

          if (options.format === 'json') {
            console.log(JSON.stringify(filteredHistory, null, 2));
            process.exit(0);
          }

          filteredHistory.forEach((commit) => {
            console.log(`${commit.commitId} ${formatTime(commit.timestamp)} ${commit.changesCount}`);
            if (options.format === 'detailed' && commit.uploadedSize) {
              console.log(`size ${formatFileSize(commit.uploadedSize)}`);
            }
          });

          process.exit(0);
        } catch (error) {
          getErrorHandler()?.handleError(error, 'COMMIT_HISTORY');
        }
      }
    );
}
