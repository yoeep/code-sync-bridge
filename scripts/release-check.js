const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const packageFiles = [
  'package.json',
  'packages/shared/package.json',
  'packages/intranet-client/package.json',
  'packages/extranet-client/package.json',
  'packages/vscode-extension/package.json',
];

const requiredFields = ['name', 'version', 'description'];
const requiredOpenSourceFields = ['license', 'repository', 'homepage', 'bugs'];

let hasError = false;

for (const relativePath of packageFiles) {
  const filePath = path.join(rootDir, relativePath);
  const manifest = JSON.parse(fs.readFileSync(filePath, 'utf8'));

  for (const field of requiredFields) {
    if (!manifest[field]) {
      console.error(`${relativePath}: missing required field "${field}"`);
      hasError = true;
    }
  }

  if (!manifest.private) {
    for (const field of requiredOpenSourceFields) {
      if (!manifest[field]) {
        console.error(`${relativePath}: missing open-source field "${field}"`);
        hasError = true;
      }
    }
  }

  if (!manifest.private && (!Array.isArray(manifest.keywords) || manifest.keywords.length === 0)) {
    console.error(`${relativePath}: expected non-empty "keywords" array`);
    hasError = true;
  }
}

if (hasError) {
  process.exit(1);
}

console.log('release-check passed');
