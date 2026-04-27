const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const outputDir = path.join(repoRoot, 'artifacts', 'exe');
const nexeTarget = process.env.NEXE_TARGET || 'windows-x64-14.15.3';

const targets = [
  {
    name: 'intranet-client',
    entry: path.join('scripts', 'pkg-intranet-entry.js'),
    output: path.join('artifacts', 'exe', 'intranet-client.exe'),
  },
  {
    name: 'extranet-client',
    entry: path.join('scripts', 'pkg-extranet-entry.js'),
    output: path.join('artifacts', 'exe', 'extranet-client.exe'),
  },
  {
    name: 'sftp-bridge',
    entry: path.join('scripts', 'pkg-sftp-bridge-entry.js'),
    output: path.join('artifacts', 'exe', 'sftp-bridge.exe'),
  },
];

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

for (const target of targets) {
  if (!fs.existsSync(path.join(repoRoot, target.entry))) {
    throw new Error(`Missing package entry: ${target.entry}`);
  }
}

fs.mkdirSync(outputDir, { recursive: true });

run('npm.cmd', ['run', 'build:lite']);

for (const target of targets) {
  run('npx.cmd', [
    'nexe',
    target.entry,
    '--target',
    nexeTarget,
    '--output',
    target.output,
  ]);
}

console.log(`Executable artifacts written to ${outputDir}`);
