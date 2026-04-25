import * as vscode from 'vscode';
import * as path from 'path';
import { ExtranetClientBridge } from './ExtranetClientBridge';
import { SyncStatusBar } from '../components/SyncStatusBar';

/**
 * 自动提交监控服务
 * 监听文件保存事件，自动标记待提交状态，提供一键提交功能
 */
export class AutoCommitWatcher implements vscode.Disposable {
    private disposables: vscode.Disposable[] = [];
    private pendingChanges: Set<string> = new Set();
    private autoCommitEnabled: boolean = false;
    private commitButton!: vscode.StatusBarItem;
    
    constructor(
        private extranetClientBridge: ExtranetClientBridge,
        private syncStatusBar: SyncStatusBar
    ) {
        this.initializeWatcher();
        this.createCommitButton();
        this.loadConfiguration();
    }
    
    private initializeWatcher(): void {
        // 监听文件保存事件
        const saveWatcher = vscode.workspace.onDidSaveTextDocument((document: vscode.TextDocument) => {
            this.onFileSaved(document);
        });
        
        // 监听文件变更事件
        const changeWatcher = vscode.workspace.onDidChangeTextDocument((event) => {
            this.onFileChanged(event);
        });
        
        // 监听配置变更
        const configWatcher = vscode.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration('codeSyncBridge.autoCommit')) {
                this.loadConfiguration();
            }
        });
        
        // 监听工作区变更
        const workspaceWatcher = vscode.workspace.onDidChangeWorkspaceFolders(() => {
            this.clearPendingChanges();
        });
        
        this.disposables.push(saveWatcher, changeWatcher, configWatcher, workspaceWatcher);
    }
    
    private createCommitButton(): void {
        this.commitButton = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Left,
            99
        );
        
        this.commitButton.command = 'codeSyncBridge.commitChanges';
        this.commitButton.tooltip = '提交待处理的代码变更';
        this.updateCommitButton();
        
        this.disposables.push(this.commitButton);
    }
    
    private loadConfiguration(): void {
        const config = vscode.workspace.getConfiguration('codeSyncBridge');
        this.autoCommitEnabled = config.get<boolean>('autoCommit', false);
        
        console.log(`自动提交功能: ${this.autoCommitEnabled ? '启用' : '禁用'}`);
    }
    
    private onFileSaved(document: vscode.TextDocument): void {
        // 只处理工作区内的文件
        if (!this.isWorkspaceFile(document.uri)) {
            return;
        }
        
        // 排除某些文件类型
        if (this.shouldIgnoreFile(document.uri)) {
            return;
        }
        
        const filePath = document.uri.fsPath;
        console.log(`文件已保存: ${filePath}`);
        
        // 添加到待提交列表
        this.addPendingChange(filePath);
        
        // 如果启用自动提交，延迟提交
        if (this.autoCommitEnabled) {
            this.scheduleAutoCommit();
        }
    }
    
    private onFileChanged(event: vscode.TextDocumentChangeEvent): void {
        // 只处理工作区内的文件
        if (!this.isWorkspaceFile(event.document.uri)) {
            return;
        }
        
        // 排除某些文件类型
        if (this.shouldIgnoreFile(event.document.uri)) {
            return;
        }
        
        // 如果有实质性变更，标记为待提交
        if (event.contentChanges.length > 0) {
            const filePath = event.document.uri.fsPath;
            this.addPendingChange(filePath);
        }
    }
    
    private isWorkspaceFile(uri: vscode.Uri): boolean {
        return vscode.workspace.getWorkspaceFolder(uri) !== undefined;
    }
    
    private shouldIgnoreFile(uri: vscode.Uri): boolean {
        const fileName = path.basename(uri.fsPath);
        const fileExt = path.extname(uri.fsPath);
        
        // 忽略的文件类型
        const ignoredExtensions = ['.log', '.tmp', '.cache', '.lock'];
        if (ignoredExtensions.includes(fileExt)) {
            return true;
        }
        
        // 忽略的文件名
        const ignoredFiles = ['.DS_Store', 'Thumbs.db', '.gitignore'];
        if (ignoredFiles.includes(fileName)) {
            return true;
        }
        
        // 忽略node_modules等目录
        const relativePath = vscode.workspace.asRelativePath(uri);
        const ignoredPaths = ['node_modules/', '.git/', 'dist/', 'build/'];
        if (ignoredPaths.some(ignored => relativePath.startsWith(ignored))) {
            return true;
        }
        
        return false;
    }
    
    private addPendingChange(filePath: string): void {
        this.pendingChanges.add(filePath);
        this.updateCommitButton();
        this.updateContexts();
        
        console.log(`待提交文件数量: ${this.pendingChanges.size}`);
    }
    
    private clearPendingChanges(): void {
        this.pendingChanges.clear();
        this.updateCommitButton();
        this.updateContexts();
    }
    
    private updateCommitButton(): void {
        const changeCount = this.pendingChanges.size;
        
        if (changeCount === 0) {
            this.commitButton.hide();
        } else {
            this.commitButton.text = `$(cloud-upload) 提交变更 (${changeCount})`;
            this.commitButton.show();
        }
    }
    
    private updateContexts(): void {
        const hasChanges = this.pendingChanges.size > 0;
        vscode.commands.executeCommand('setContext', 'codeSyncBridge.hasChanges', hasChanges);
    }
    
    private autoCommitTimer?: NodeJS.Timeout;
    
    private scheduleAutoCommit(): void {
        // 清除之前的定时器
        if (this.autoCommitTimer) {
            clearTimeout(this.autoCommitTimer);
        }
        
        // 延迟5秒后自动提交，避免频繁提交
        this.autoCommitTimer = setTimeout(async () => {
            if (this.pendingChanges.size > 0) {
                await this.performAutoCommit();
            }
        }, 5000);
    }
    
    private async performAutoCommit(): Promise<void> {
        try {
            console.log('执行自动提交...');
            
            if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
                console.log('没有打开的工作区，跳过自动提交');
                return;
            }
            
            const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
            
            // 显示提交进度
            this.syncStatusBar.setStatus('自动提交中...', 'syncing');
            
            await this.extranetClientBridge.commitChanges(workspaceRoot);
            
            // 清除待提交列表
            this.clearPendingChanges();
            
            this.syncStatusBar.showSuccess('自动提交成功');
            
            // 显示通知（可选）
            const config = vscode.workspace.getConfiguration('codeSyncBridge');
            const showNotifications = config.get<boolean>('showAutoCommitNotifications', false);
            
            if (showNotifications) {
                vscode.window.showInformationMessage('代码变更已自动提交');
            }
            
        } catch (error) {
            console.error('自动提交失败:', error);
            
            const errorMessage = error instanceof Error ? error.message : '未知错误';
            this.syncStatusBar.showError('自动提交失败', error as Error);
            
            // 显示错误通知
            const action = await vscode.window.showErrorMessage(
                `自动提交失败: ${errorMessage}`,
                '重试',
                '禁用自动提交'
            );
            
            if (action === '重试') {
                this.scheduleAutoCommit();
            } else if (action === '禁用自动提交') {
                await this.disableAutoCommit();
            }
        }
    }
    
    private async disableAutoCommit(): Promise<void> {
        const config = vscode.workspace.getConfiguration('codeSyncBridge');
        await config.update('autoCommit', false, vscode.ConfigurationTarget.Workspace);
        
        vscode.window.showInformationMessage('自动提交功能已禁用');
    }
    
    /**
     * 手动提交所有待处理的变更
     */
    async commitPendingChanges(): Promise<void> {
        if (this.pendingChanges.size === 0) {
            vscode.window.showInformationMessage('没有待提交的变更');
            return;
        }
        
        try {
            if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
                throw new Error('没有打开的工作区');
            }
            
            const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
            
            this.syncStatusBar.setStatus('正在提交变更...', 'syncing');
            
            await this.extranetClientBridge.commitChanges(workspaceRoot);
            
            this.clearPendingChanges();
            this.syncStatusBar.showSuccess('变更提交成功');
            
            vscode.window.showInformationMessage('代码变更已成功提交');
            
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : '未知错误';
            this.syncStatusBar.showError('提交失败', error as Error);
            
            vscode.window.showErrorMessage(`提交变更失败: ${errorMessage}`);
        }
    }
    
    /**
     * 获取待提交的文件列表
     */
    getPendingChanges(): string[] {
        return Array.from(this.pendingChanges);
    }
    
    /**
     * 获取待提交文件数量
     */
    getPendingChangeCount(): number {
        return this.pendingChanges.size;
    }
    
    /**
     * 是否启用自动提交
     */
    isAutoCommitEnabled(): boolean {
        return this.autoCommitEnabled;
    }
    
    dispose(): void {
        if (this.autoCommitTimer) {
            clearTimeout(this.autoCommitTimer);
        }
        
        this.disposables.forEach(disposable => disposable.dispose());
        this.disposables = [];
    }
}