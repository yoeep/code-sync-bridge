import * as os from 'os';
import * as path from 'path';
import { getAppHomeDir, getAppPath, getTempFilePath } from '@code-sync-bridge/shared/runtime';

describe('shared runtime AppPaths', () => {
  const originalHome = process.env.CODE_SYNC_BRIDGE_HOME;

  afterEach(() => {
    if (originalHome === undefined) {
      delete process.env.CODE_SYNC_BRIDGE_HOME;
    } else {
      process.env.CODE_SYNC_BRIDGE_HOME = originalHome;
    }
  });

  it('uses the default runtime home when override is absent', () => {
    delete process.env.CODE_SYNC_BRIDGE_HOME;

    expect(getAppHomeDir()).toBe(path.join(os.homedir(), '.code-sync-bridge'));
    expect(getAppPath('logs', 'app.log')).toBe(path.join(os.homedir(), '.code-sync-bridge', 'logs', 'app.log'));
  });

  it('uses CODE_SYNC_BRIDGE_HOME when provided', () => {
    process.env.CODE_SYNC_BRIDGE_HOME = path.join('custom', 'runtime-home');

    expect(getAppHomeDir()).toBe(path.resolve('custom', 'runtime-home'));
    expect(getAppPath('cache')).toBe(path.resolve('custom', 'runtime-home', 'cache'));
  });

  it('creates temp file paths in the OS temp directory with sanitized prefixes', () => {
    const tempPath = getTempFilePath('unsafe prefix/with spaces', '.json');

    expect(path.dirname(tempPath)).toBe(os.tmpdir());
    expect(path.basename(tempPath)).toMatch(/^unsafe-prefix-with-spaces-/);
    expect(tempPath.endsWith('.json')).toBe(true);
  });

  it('returns unique temp file paths across calls', () => {
    const firstPath = getTempFilePath('unit-test');
    const secondPath = getTempFilePath('unit-test');

    expect(firstPath).not.toBe(secondPath);
  });
});
