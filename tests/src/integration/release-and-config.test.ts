import * as fs from 'fs/promises';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(__dirname, '../../..');

type PackageManifest = {
  name: string;
  version: string;
  private?: boolean;
  description?: string;
  license?: string;
  repository?: { type?: string; url?: string; directory?: string };
  homepage?: string;
  bugs?: { url?: string };
  keywords?: string[];
  dependencies?: Record<string, string>;
};

describe('release and repository contract tests', () => {
  it('release-check script passes', async () => {
    const { stdout } = await execFileAsync('node', ['scripts/release-check.js'], {
      cwd: repoRoot,
    });

    expect(stdout).toContain('release-check passed');
  });

  it('release-prepare prints current version and unreleased notes', async () => {
    const { stdout } = await execFileAsync('node', ['scripts/prepare-release.js'], {
      cwd: repoRoot,
    });

    expect(stdout).toContain('Release candidate version: 1.0.0');
    expect(stdout).toContain('Unreleased notes:');
    expect(stdout).toContain('Repository cleanup and runtime data isolation.');
  });

  it('example config files are valid JSON with required SFTP fields', async () => {
    const exampleFiles = [
      'examples/config/intranet-config.example.json',
      'examples/config/extranet-config.example.json',
    ];

    for (const relativePath of exampleFiles) {
      const content = await fs.readFile(path.join(repoRoot, relativePath), 'utf8');
      const parsed = JSON.parse(content) as {
        sftp: { host: string; port: number; username: string; authMethod: string };
      };

      expect(parsed.sftp.host).toBeTruthy();
      expect(parsed.sftp.port).toBeGreaterThan(0);
      expect(parsed.sftp.username).toBeTruthy();
      expect(parsed.sftp.authMethod).toBeTruthy();
    }
  });

  it('root README references the main documentation entry points', async () => {
    const readme = await fs.readFile(path.join(repoRoot, 'README.md'), 'utf8');

    expect(readme).toContain('[Architecture](docs/ARCHITECTURE.md)');
    expect(readme).toContain('[Configuration](docs/CONFIGURATION.md)');
    expect(readme).toContain('[Examples](examples/README.md)');
    expect(readme).toContain('[Release process](docs/RELEASE.md)');
  });

  it('public package manifests expose open-source metadata and aligned internal versions', async () => {
    const packageFiles = [
      'packages/shared/package.json',
      'packages/intranet-client/package.json',
      'packages/extranet-client/package.json',
      'packages/vscode-extension/package.json',
    ];

    const manifests = await Promise.all(
      packageFiles.map(async (relativePath) => {
        const content = await fs.readFile(path.join(repoRoot, relativePath), 'utf8');
        return JSON.parse(content) as PackageManifest;
      })
    );

    const expectedVersion = manifests[0].version;

    for (const manifest of manifests) {
      expect(manifest.version).toBe(expectedVersion);
      expect(manifest.description).toBeTruthy();
      expect(manifest.license).toBe('MIT');
      expect(manifest.repository?.url).toContain('github.com/code-sync-bridge/code-sync-bridge');
      expect(manifest.homepage).toContain('github.com/code-sync-bridge/code-sync-bridge');
      expect(manifest.bugs?.url).toContain('/issues');
      expect(Array.isArray(manifest.keywords)).toBe(true);
      expect((manifest.keywords || []).length).toBeGreaterThan(0);
    }

    const intranetManifest = manifests.find((item) => item.name === '@code-sync-bridge/intranet-client');
    const extranetManifest = manifests.find((item) => item.name === '@code-sync-bridge/extranet-client');
    const vscodeManifest = manifests.find((item) => item.name === 'code-sync-bridge-vscode');

    expect(intranetManifest?.dependencies?.['@code-sync-bridge/shared']).toBe(`^${expectedVersion}`);
    expect(extranetManifest?.dependencies?.['@code-sync-bridge/shared']).toBe(`^${expectedVersion}`);
    expect(vscodeManifest?.dependencies?.['@code-sync-bridge/shared']).toBe(`^${expectedVersion}`);
    expect(vscodeManifest?.dependencies?.['@code-sync-bridge/extranet-client']).toBe(`^${expectedVersion}`);
  });

  it('release workflow exists and validates before uploading artifacts', async () => {
    const workflow = await fs.readFile(path.join(repoRoot, '.github/workflows/release.yml'), 'utf8');

    expect(workflow).toContain("tags:");
    expect(workflow).toContain("- 'v*'");
    expect(workflow).toContain('npm run release:check');
    expect(workflow).toContain('npm run release:prepare');
    expect(workflow).toContain('softprops/action-gh-release');
  });
});
