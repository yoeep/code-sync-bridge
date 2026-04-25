const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const packageFiles = [
  'package.json',
  'packages/shared/package.json',
  'packages/intranet-client/package.json',
  'packages/extranet-client/package.json',
  'packages/vscode-extension/package.json',
  'tests/package.json',
];

const internalPackageNames = new Set([
  '@code-sync-bridge/shared',
  '@code-sync-bridge/intranet-client',
  '@code-sync-bridge/extranet-client',
]);

function parseVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) {
    throw new Error(`Unsupported version format: ${version}`);
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function formatVersion(parts) {
  return `${parts.major}.${parts.minor}.${parts.patch}`;
}

function nextVersion(currentVersion, bumpType) {
  const parts = parseVersion(currentVersion);

  switch (bumpType) {
    case 'major':
      return formatVersion({ major: parts.major + 1, minor: 0, patch: 0 });
    case 'minor':
      return formatVersion({ major: parts.major, minor: parts.minor + 1, patch: 0 });
    case 'patch':
      return formatVersion({ major: parts.major, minor: parts.minor, patch: parts.patch + 1 });
    default:
      throw new Error(`Unsupported bump type: ${bumpType}`);
  }
}

function updateDependencyBlock(block, newVersion) {
  if (!block) {
    return;
  }

  for (const dependencyName of Object.keys(block)) {
    if (internalPackageNames.has(dependencyName)) {
      block[dependencyName] = `^${newVersion}`;
    }
  }
}

const bumpType = process.argv[2];
if (!bumpType) {
  console.error('Usage: node scripts/bump-version.js <major|minor|patch>');
  process.exit(1);
}

const rootPackagePath = path.join(rootDir, 'package.json');
const rootPackage = JSON.parse(fs.readFileSync(rootPackagePath, 'utf8'));
const newVersion = nextVersion(rootPackage.version, bumpType);

for (const relativePath of packageFiles) {
  const filePath = path.join(rootDir, relativePath);
  const manifest = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  manifest.version = newVersion;

  updateDependencyBlock(manifest.dependencies, newVersion);
  updateDependencyBlock(manifest.devDependencies, newVersion);
  updateDependencyBlock(manifest.optionalDependencies, newVersion);

  fs.writeFileSync(filePath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(`updated ${relativePath} -> ${newVersion}`);
}
