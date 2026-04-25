import * as path from 'path';

process.env.CODE_SYNC_BRIDGE_HOME = path.resolve(__dirname, '../../.runtime');

const { SFTPClientFactory, SystemSFTPClient } = require('../../../packages/shared/src/sftp/SystemSFTPClient');

describe('shared sftp SystemSFTPClient', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('answers keyboard-interactive prompts with password and dynamic token', async () => {
    const dynamicTokenProvider = jest.fn().mockResolvedValue('654321');
    const client = new SystemSFTPClient({
      host: 'sftp.example.com',
      port: 22,
      username: 'demo',
      password: 'password-123',
      authMethod: 'dynamic-token',
      dynamicTokenProvider,
    });

    const finish = jest.fn();
    await (client as any).handleAuth(
      [
        { prompt: 'Password: ', echo: false },
        { prompt: 'Verification code: ', echo: false },
      ],
      finish
    );

    expect(finish).toHaveBeenCalledWith(['password-123', '654321']);
    expect(dynamicTokenProvider).toHaveBeenCalledTimes(1);
  });

  it('refreshes the dynamic token and stores the trimmed token as password', async () => {
    const dynamicTokenProvider = jest.fn().mockResolvedValue(' 246810 ');
    const client = new SystemSFTPClient({
      host: 'sftp.example.com',
      port: 22,
      username: 'demo',
      authMethod: 'dynamic-token',
      dynamicTokenProvider,
    });

    await client.refreshDynamicToken();

    expect(dynamicTokenProvider).toHaveBeenCalledTimes(1);
    expect((client as unknown as { config: { password?: string } }).config.password).toBe('246810');
  });

  it('fails dynamic token refresh when the provider returns an empty token', async () => {
    const client = new SystemSFTPClient({
      host: 'sftp.example.com',
      port: 22,
      username: 'demo',
      authMethod: 'dynamic-token',
      dynamicTokenProvider: jest.fn().mockResolvedValue('   '),
    });

    await expect(client.refreshDynamicToken()).rejects.toThrow('动态令牌不能为空');
  });

  it('rejects dynamic-token configs that do not provide a token source', () => {
    expect(() =>
      SFTPClientFactory.validateConfig({
        host: 'sftp.example.com',
        port: 22,
        username: 'demo',
        authMethod: 'dynamic-token',
      })
    ).toThrow('dynamicTokenProvider');
  });

  it('disconnects cleanly after a successful connection state', () => {
    const client = new SystemSFTPClient({
      host: 'sftp.example.com',
      port: 22,
      username: 'demo',
      password: 'password-123',
      authMethod: 'password',
    });
    const end = jest.fn();
    const destroy = jest.fn();

    (client as any).client = { end, destroy };
    (client as any).sftp = {};
    (client as any).isConnected = true;

    client.disconnect();

    expect(end).toHaveBeenCalledTimes(1);
    expect(client.isConnectionActive()).toBe(false);
  });

  it('retries connectWithRetry until a later attempt succeeds', async () => {
    const client = new SystemSFTPClient({
      host: 'sftp.example.com',
      port: 22,
      username: 'demo',
      password: 'password-123',
      authMethod: 'password',
      retries: 3,
      retryDelay: 1,
    });

    const connectMock = jest
      .spyOn(client, 'connect')
      .mockRejectedValueOnce(new Error('first failure'))
      .mockRejectedValueOnce(new Error('second failure'))
      .mockResolvedValueOnce(undefined);

    await expect(client.connectWithRetry()).resolves.toBeUndefined();
    expect(connectMock).toHaveBeenCalledTimes(3);
  });

  it('surfaces the last error when connectWithRetry exhausts all attempts', async () => {
    const client = new SystemSFTPClient({
      host: 'sftp.example.com',
      port: 22,
      username: 'demo',
      password: 'password-123',
      authMethod: 'password',
      retries: 2,
      retryDelay: 1,
    });

    jest
      .spyOn(client, 'connect')
      .mockRejectedValueOnce(new Error('first failure'))
      .mockRejectedValueOnce(new Error('last failure'));

    await expect(client.connectWithRetry()).rejects.toThrow('last failure');
  });
});
