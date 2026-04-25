import * as vscode from 'vscode';

export type SyncStatus = 'ready' | 'syncing' | 'loading' | 'error' | 'offline';

/**
 * 同步状态栏组件
 * 在VSCode状态栏显示代码同步状态
 */
export class SyncStatusBar implements vscode.Disposable {
    private statusBarItem: vscode.StatusBarItem;
    private currentStatus: SyncStatus = 'ready';
    private lastSyncTime?: Date;
    
    constructor() {
        this.statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Left,
            100
        );
        
        this.statusBarItem.command = 'codeSyncBridge.refreshStreams';
        this.statusBarItem.show();
        
        this.updateDisplay();
    }
    
    /**
     * 设置同步状态
     */
    setStatus(message: string, status: SyncStatus): void {
        this.currentStatus = status;
        this.statusBarItem.text = this.getStatusIcon(status) + ' ' + message;
        this.statusBarItem.tooltip = this.getTooltip(message, status);
        
        if (status === 'ready') {
            this.lastSyncTime = new Date();
        }
        
        this.updateDisplay();
    }
    
    /**
     * 设置最后同步时间
     */
    setLastSyncTime(time: Date): void {
        this.lastSyncTime = time;
        this.updateDisplay();
    }
    
    /**
     * 获取当前状态
     */
    getCurrentStatus(): SyncStatus {
        return this.currentStatus;
    }
    
    /**
     * 显示进度信息
     */
    showProgress(message: string, progress?: { current: number; total: number }): void {
        let displayMessage = message;
        
        if (progress) {
            const percentage = Math.round((progress.current / progress.total) * 100);
            displayMessage = `${message} (${percentage}%)`;
        }
        
        this.setStatus(displayMessage, 'syncing');
    }
    
    /**
     * 显示错误信息
     */
    showError(message: string, error?: Error): void {
        const errorMessage = error ? `${message}: ${error.message}` : message;
        this.setStatus(errorMessage, 'error');
        
        // 5秒后自动恢复到就绪状态
        setTimeout(() => {
            if (this.currentStatus === 'error') {
                this.setStatus('就绪', 'ready');
            }
        }, 5000);
    }
    
    /**
     * 显示成功信息
     */
    showSuccess(message: string): void {
        this.setStatus(message, 'ready');
        
        // 3秒后显示默认就绪状态
        setTimeout(() => {
            this.setStatus('就绪', 'ready');
        }, 3000);
    }
    
    private getStatusIcon(status: SyncStatus): string {
        switch (status) {
            case 'ready':
                return '$(check)';
            case 'syncing':
                return '$(sync~spin)';
            case 'loading':
                return '$(loading~spin)';
            case 'error':
                return '$(error)';
            case 'offline':
                return '$(plug)';
            default:
                return '$(question)';
        }
    }
    
    private getTooltip(message: string, status: SyncStatus): string {
        let tooltip = `Code Sync Bridge - ${message}`;
        
        if (this.lastSyncTime && status === 'ready') {
            const timeStr = this.lastSyncTime.toLocaleTimeString();
            tooltip += `\n最后同步: ${timeStr}`;
        }
        
        switch (status) {
            case 'ready':
                tooltip += '\n点击刷新代码流';
                break;
            case 'syncing':
                tooltip += '\n正在同步中...';
                break;
            case 'error':
                tooltip += '\n发生错误，点击重试';
                break;
            case 'offline':
                tooltip += '\n网络连接异常';
                break;
        }
        
        return tooltip;
    }
    
    private updateDisplay(): void {
        // 根据状态更新颜色
        switch (this.currentStatus) {
            case 'ready':
                this.statusBarItem.backgroundColor = undefined;
                break;
            case 'syncing':
            case 'loading':
                this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
                break;
            case 'error':
                this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
                break;
            case 'offline':
                this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
                break;
        }
    }
    
    dispose(): void {
        this.statusBarItem.dispose();
    }
}