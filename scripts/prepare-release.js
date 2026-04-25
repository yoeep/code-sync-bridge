const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const rootPackage = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
const changelog = fs.readFileSync(path.join(rootDir, 'CHANGELOG.md'), 'utf8');

const unreleasedSectionMatch = changelog.match(/## \[Unreleased\]\s*([\s\S]*?)(?:\n## |\s*$)/);
const unreleasedBody = unreleasedSectionMatch ? unreleasedSectionMatch[1].trim() : '';

console.log(`Release candidate version: ${rootPackage.version}`);
console.log('');
console.log('Required checks:');
console.log('- npm run release:check');
console.log('- review CHANGELOG.md');
console.log('- tag the release after validation');
console.log('');
console.log('Unreleased notes:');
console.log(unreleasedBody || '(no unreleased notes found)');
