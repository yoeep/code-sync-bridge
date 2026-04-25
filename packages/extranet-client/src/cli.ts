#!/usr/bin/env node

import { Command } from 'commander';
import {
  createClient,
  formatFileSize,
  formatOutput,
  formatTime,
  getCliConfig as cliConfig,
  getErrorHandler as errorHandler,
  initializeCLI,
  validateLocalPath,
  verboseLog,
} from './commands/cliContext';
import { registerCommitCommands } from './commands/registerCommitCommands';
import { registerStreamCommands } from './commands/registerStreamCommands';
import { registerSystemCommands } from './commands/registerSystemCommands';

const program = new Command();

process.on('uncaughtException', (error) => {
  console.error(formatOutput(`Uncaught exception: ${error.message}`, 'error'));
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  console.error(formatOutput(`Unhandled rejection: ${message}`, 'error'));
  process.exit(1);
});

program
  .name('extranet-client')
  .description('Extranet code sync bridge client')
  .version('1.0.0')
  .option('-c, --config <path>', 'Config file path', './config.json')
  .option('-v, --verbose', 'Enable verbose output')
  .option('--no-color', 'Disable colored output');

program.hook('preAction', (thisCommand) => {
  const options = thisCommand.opts<{ verbose?: boolean; color?: boolean }>();
  if (options.verbose) {
    process.env.VERBOSE = 'true';
  }

  if (!options.color) {
    process.env.NO_COLOR = 'true';
  }
});

registerStreamCommands(program);
registerCommitCommands(program);
registerSystemCommands(program);

if (require.main === module) {
  program.parse();
}

export {
  program,
  cliConfig,
  createClient,
  errorHandler,
  formatFileSize,
  formatOutput,
  formatTime,
  initializeCLI,
  validateLocalPath,
  verboseLog,
};
