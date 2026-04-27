const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const sourceBinary = path.join(repoRoot, 'artifacts', 'macos', 'sftp-bridge-mac-x64-14.15.3');
const bundleRoot = path.join(repoRoot, 'artifacts', 'macos', 'sftp-bridge-mac-x64-bundle');
const zipPath = path.join(repoRoot, 'artifacts', 'macos', 'sftp-bridge-mac-x64-bundle.zip');

function ensureExists(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing required file: ${filePath}`);
  }
}

function resetDir(dirPath) {
  fs.rmSync(dirPath, { recursive: true, force: true });
  fs.mkdirSync(dirPath, { recursive: true });
}

function copyFile(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

function writeText(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: false,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

ensureExists(sourceBinary);
resetDir(bundleRoot);

copyFile(sourceBinary, path.join(bundleRoot, 'sftp-bridge'));
copyFile(
  path.join(repoRoot, 'packages', 'sftp-bridge', 'config.example.json'),
  path.join(bundleRoot, 'config.example.json')
);
copyFile(
  path.join(repoRoot, 'packages', 'sftp-bridge', 'README.md'),
  path.join(bundleRoot, 'README.md')
);

writeText(
  path.join(bundleRoot, 'USAGE.txt'),
  [
    'sftp-bridge macOS x64 bundle',
    '',
    'Contents:',
    '- sftp-bridge',
    '- config.example.json',
    '- README.md',
    '',
    'Typical usage:',
    'chmod +x ./sftp-bridge',
    './sftp-bridge --config ./config.json test',
    './sftp-bridge --config ./config.json upload ./local.zip /incoming/local.zip',
    './sftp-bridge --config ./config.json download /incoming/local.zip ./downloaded.zip',
    '',
    'Path behavior:',
    '- config.json is resolved relative to the executable directory',
    '- relative privateKey/filePath/qrCodeImagePath values are resolved relative to the config file directory',
  ].join('\n')
);

if (fs.existsSync(zipPath)) {
  fs.rmSync(zipPath, { force: true });
}

run('powershell', [
  '-NoProfile',
  '-Command',
  `Compress-Archive -Path '${bundleRoot}\\*' -DestinationPath '${zipPath}'`,
]);

console.log(`macOS bundle directory written to ${bundleRoot}`);
console.log(`macOS zip bundle written to ${zipPath}`);
