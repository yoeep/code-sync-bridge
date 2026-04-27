const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const outputDir = path.join(repoRoot, 'artifacts', 'macos');
const nexeTarget = process.env.NEXE_TARGET || 'mac-x64-14.15.3';
const entry = path.join('scripts', 'pkg-sftp-bridge-entry.js');
const outputName = process.env.MACOS_OUTPUT_NAME || `sftp-bridge-${nexeTarget}`;
const outputPath = path.join('artifacts', 'macos', outputName);

function run(command, args) {
  const isWindows = process.platform === 'win32';
  const quote = (value) => (/\s/.test(value) ? `"${value}"` : value);
  const commandLine = [command, ...args].map(quote).join(' ');
  console.log(`> ${commandLine}`);

  const result = spawnSync(
    isWindows ? process.env.ComSpec || 'cmd.exe' : command,
    isWindows ? ['/d', '/s', '/c', commandLine] : args,
    {
      cwd: repoRoot,
      stdio: 'inherit',
      env: {
        ...process.env,
        CI: '1',
      },
    }
  );

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

if (!fs.existsSync(path.join(repoRoot, entry))) {
  throw new Error(`Missing package entry: ${entry}`);
}

fs.mkdirSync(outputDir, { recursive: true });

run('npm.cmd', ['run', 'build:lite']);
run('npx.cmd', ['nexe', entry, '--target', nexeTarget, '--output', outputPath]);

console.log(`macOS artifact written to ${path.join(repoRoot, outputPath)}`);
