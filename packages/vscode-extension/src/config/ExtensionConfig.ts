import * as vscode from 'vscode';
import { SFTPConfig } from '@code-sync-bridge/shared/interfaces';

export class ExtensionConfig {
    private static readonly CONFIG_SECTION = 'codeSyncBridge';
    
    getSFTPConfig(): SFTPConfig {
        const config = vscode.workspace.getConfiguration(ExtensionConfig.CONFIG_SECTION);
        
        return {
            host: config.get<string>('sftpHost', ''),
            port: config.get<number>('sftpPort', 22),
            username: config.get<string>('sftpUsername', ''),
            authMethod: 'dynamic-token' as const,
            timeout: 30000,
            retryAttempts: 3,
            retryDelay: 2000,
            maxRetryDelay: 30000,
            dynamicTokenRefreshInterval: 60000,
            qrCodeImagePath: config.get<string>('qrCodeImagePath', ''),
        };
    }
    
    getAutoCommitEnabled(): boolean {
        const config = vscode.workspace.getConfiguration(ExtensionConfig.CONFIG_SECTION);
        return config.get<boolean>('autoCommit', false);
    }
    
    getMonitorInterval(): number {
        const config = vscode.workspace.getConfiguration(ExtensionConfig.CONFIG_SECTION);
        return config.get<number>('monitorInterval', 300);
    }
    
    async updateSFTPConfig(sftpConfig: Partial<SFTPConfig>): Promise<void> {
        const config = vscode.workspace.getConfiguration(ExtensionConfig.CONFIG_SECTION);
        
        if (sftpConfig.host !== undefined) {
            await config.update('sftpHost', sftpConfig.host, vscode.ConfigurationTarget.Global);
        }
        
        if (sftpConfig.port !== undefined) {
            await config.update('sftpPort', sftpConfig.port, vscode.ConfigurationTarget.Global);
        }
        
        if (sftpConfig.username !== undefined) {
            await config.update('sftpUsername', sftpConfig.username, vscode.ConfigurationTarget.Global);
        }
    }
    
    async setAutoCommitEnabled(enabled: boolean): Promise<void> {
        const config = vscode.workspace.getConfiguration(ExtensionConfig.CONFIG_SECTION);
        await config.update('autoCommit', enabled, vscode.ConfigurationTarget.Workspace);
    }
    
    onConfigurationChanged(callback: () => void): vscode.Disposable {
        return vscode.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration(ExtensionConfig.CONFIG_SECTION)) {
                callback();
            }
        });
    }
    
    validateConfig(): { isValid: boolean; errors: string[] } {
        const sftpConfig = this.getSFTPConfig();
        const errors: string[] = [];
        
        if (!sftpConfig.host) {
            errors.push('SFTP服务器地址未配置');
        }
        
        if (!sftpConfig.username) {
            errors.push('SFTP用户名未配置');
        }
        
        if (sftpConfig.port <= 0 || sftpConfig.port > 65535) {
            errors.push('SFTP端口号无效');
        }
        
        return {
            isValid: errors.length === 0,
            errors
        };
    }
}
