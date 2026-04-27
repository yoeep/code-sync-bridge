#!/usr/bin/env node

import { runCli } from '../cli';

runCli(process.argv).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`sftp-bridge failed: ${message}`);
  process.exit(1);
});
