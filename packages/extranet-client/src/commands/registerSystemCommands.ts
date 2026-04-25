import { Command } from 'commander';
import * as fs from 'fs/promises';
import * as path from 'path';
import { getConfigManager } from '@code-sync-bridge/shared/config';
import { getTempFilePath } from '@code-sync-bridge/shared/runtime';
import {
  createArchive as createArchiveTool,
  testSFTPConnectionForExtranet as testSFTPConnectionTool,
  uploadToSFTP as uploadToSFTPTool,
} from '../services/ExtranetCliTransferTools';
import {
  ProgressIndicator,
  createClient,
  formatOutput,
  getCliConfig,
  getErrorHandler,
  initializeCLI,
  verboseLog,
} from './cliContext';

export function registerSystemCommands(program: Command): void {
  program
    .command('system-status')
    .alias('sys')
    .description('Show system and connection status')
    .option('--test-sftp', 'Run the SFTP connectivity check')
    .option('--detailed', 'Show detailed status information')
    .action(async (options: { testSftp?: boolean; detailed?: boolean }) => {
      try {
        await initializeCLI(program.opts<{ config?: string; verbose?: boolean }>());
        console.log(`version: 1.0.0`);
        console.log(`platform: ${process.platform} ${process.arch}`);
        console.log(`node: ${process.version}`);

        if (options.detailed) {
          console.log(`cwd: ${process.cwd()}`);
          console.log(`memoryMb: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}`);
          console.log(`uptimeSec: ${Math.round(process.uptime())}`);
        }

        if (options.testSftp) {
          await testSFTPConnectionTool(getCliConfig().get('configPath'), Boolean(options.detailed));
        }

        process.exit(0);
      } catch (error) {
        getErrorHandler()?.handleError(error, 'SYSTEM_STATUS');
      }
    });

  program
    .command('config')
    .description('Manage CLI configuration')
    .option('--get <key>', 'Read a config value')
    .option('--set <key=value>', 'Set a config value')
    .option('--list', 'List all config values')
    .option('--reset', 'Reset config to defaults')
    .action(async (options: { get?: string; set?: string; list?: boolean; reset?: boolean }) => {
      try {
        await initializeCLI(program.opts<{ config?: string; verbose?: boolean }>());
        const cliConfig = getCliConfig();

        if (options.get) {
          console.log(JSON.stringify(cliConfig.get(options.get), null, 2));
        } else if (options.set) {
          const [key, ...valueParts] = options.set.split('=');
          if (!key || valueParts.length === 0) {
            throw new Error('config value must be in key=value format');
          }

          const rawValue = valueParts.join('=');
          try {
            cliConfig.set(key, JSON.parse(rawValue));
          } catch {
            cliConfig.set(key, rawValue);
          }

          await cliConfig.saveConfig();
          console.log(formatOutput(`updated ${key}`, 'success'));
        } else if (options.list) {
          console.log(JSON.stringify(cliConfig.getAll(), null, 2));
        } else if (options.reset) {
          cliConfig.reset();
          await cliConfig.saveConfig();
          console.log(formatOutput('configuration reset', 'success'));
        } else {
          console.log('Use one of --get, --set, --list, or --reset.');
        }

        process.exit(0);
      } catch (error) {
        getErrorHandler()?.handleError(error, 'CONFIG');
      }
    });

  program
    .command('cleanup')
    .description('Clean temporary files and caches')
    .action(async () => {
      try {
        await initializeCLI(program.opts<{ config?: string; verbose?: boolean }>());
        const progress = new ProgressIndicator('Cleaning temporary files');
        progress.start();
        progress.succeed('Cleanup complete');
        process.exit(0);
      } catch (error) {
        getErrorHandler()?.handleError(error, 'CLEANUP');
      }
    });

  program
    .command('help [command]')
    .description('Show help information')
    .action((command?: string) => {
      if (command) {
        const targetCommand = program.commands.find((item) => item.name() === command);
        if (!targetCommand) {
          throw new Error(`command not found: ${command}`);
        }
        targetCommand.help();
        return;
      }

      program.help();
    });

  program
    .command('upload')
    .description('Upload a file or directory to the SFTP server')
    .requiredOption('-s, --source <path>', 'Local file or directory path')
    .option('-t, --target <path>', 'Remote target directory')
    .option('-c, --config <path>', 'Config file path', './config.json')
    .option('--no-compress', 'Disable compression')
    .option('--format <format>', 'Compression format (zip|tar|tar.gz)', 'zip')
    .action(
      async (options: {
        source: string;
        target?: string;
        config?: string;
        compress?: boolean;
        format?: 'zip' | 'tar' | 'tar.gz';
      }) => {
        try {
          await initializeCLI(program.opts<{ config?: string; verbose?: boolean }>());
          await createClient(options.config);

          const configManager = getConfigManager(options.config);
          const config = await configManager.load();
          const sourcePath = path.resolve(options.source);
          const sourceStat = await fs.stat(sourcePath);

          console.log(formatOutput(`Preparing upload: ${sourcePath}`, 'info'));
          verboseLog(`upload type: ${sourceStat.isDirectory() ? 'directory' : 'file'}`);

          let uploadPath = sourcePath;
          let tempArchivePath: string | undefined;

          if (sourceStat.isDirectory()) {
            const dirName = path.basename(sourcePath);
            const shouldCompress = options.compress !== false && config.sync.upload?.enableCompression !== false;

            if (shouldCompress) {
              const format = options.format || config.sync.upload?.compressionFormat || 'zip';
              const archiveName = `${dirName}_${Date.now()}.${format === 'tar.gz' ? 'tar.gz' : format}`;
              tempArchivePath = getTempFilePath(path.parse(archiveName).name, path.extname(archiveName) || '.zip');
              await createArchiveTool(sourcePath, tempArchivePath, format);
              uploadPath = tempArchivePath;
            }
          }

          const targetDirectory = options.target || config.sync.upload?.targetDirectory || '/uploads';
          const targetPath = path.posix.join(targetDirectory, path.basename(uploadPath)).replace(/\\/g, '/');
          await uploadToSFTPTool(uploadPath, targetPath, options.config);

          if (tempArchivePath) {
            await fs.unlink(tempArchivePath).catch(() => undefined);
          }

          console.log(formatOutput('Upload completed', 'success'));
          process.exit(0);
        } catch (error) {
          getErrorHandler()?.handleError(error, 'UPLOAD');
        }
      }
    );
}
