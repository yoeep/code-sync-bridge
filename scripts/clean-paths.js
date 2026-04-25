#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const targets = process.argv.slice(2);

if (targets.length === 0) {
  console.error('Usage: node scripts/clean-paths.js <path> [more paths]');
  process.exit(1);
}

for (const target of targets) {
  const resolvedPath = path.resolve(process.cwd(), target);
  fs.rmSync(resolvedPath, {
    force: true,
    recursive: true,
  });
  console.log(`Removed ${resolvedPath}`);
}
