import * as vscode from 'vscode';
import { StreamExplorerProvider } from './providers/StreamExplorerProvider';
import { SyncStatusBar } from './components/SyncStatusBar';
import { AutoCommitWatcher } from './services/AutoCommitWatcher';
import { ExtensionConfig } from './config/ExtensionConfig';
import { ExtranetClientBridge } from './services/ExtranetClientBridge';
import { StreamManagementPanel } from './webview/StreamManagementPanel';

let streamExplorerProvider: StreamExplorerProvider;
let syncStatusBar: SyncStatusBar;
let autoCommitWatcher: AutoCommitWatcher;
let extranetClientBridge: ExtranetClientBridge;

export function activate(context: vscode.ExtensionContext) {
    console.log('Code Sync Bridge extension is now active!');

    // 初始化配置管理
    const config = new ExtensionConfig();
    
    // 初始化外网客户端桥接服务
    extranetClientBridge = new ExtranetClientBridge(config);
    
    // 初始化状态栏
    syncStatusBar = new SyncStatusBar();
    context.subscriptions.push(syncStatusBar);
    
    // 初始化代码流浏览器
    streamExplorerProvider = new StreamExplorerProvider(extranetClientBridge);
    vscode.window.registerTreeDataProvider('codeSyncBridge.streamExplorer', streamExplorerProvider);
    
    // 初始化自动提交监控
    autoCommitWatcher = new AutoCommitWatcher(extranetClientBridge, syncStatusBar);
    context.subscriptions.push(autoCommitWatcher);
    
    // 注册命令
    registerCommands(context);
    
    // 设置上下文
    vscode.commands.executeCommand('setContext', 'codeSyncBridge.enabled', true);
    
    // 初始加载代码流
    refreshStreams();
}

function registerCommands(context: vscode.ExtensionContext) {
    // 刷新代码流命令
    const refreshCommand = vscode.commands.registerCommand('codeSyncBridge.refreshStreams', () => {
        refreshStreams();
    });
    
    // 拉取代码流命令
    const pullCommand = vscode.commands.registerCommand('codeSyncBridge.pullStream', async (streamItem) => {
        if (streamItem && streamItem.stream) {
            await pullCodeStream(streamItem.stream);
        }
    });
    
    // 提交变更命令
    const commitCommand = vscode.commands.registerCommand('codeSyncBridge.commitChanges', async () => {
        await commitChanges();
    });
    
    // 打开设置命令
    const settingsCommand = vscode.commands.registerCommand('codeSyncBridge.openSettings', () => {
        vscode.commands.executeCommand('workbench.action.openSettings', 'codeSyncBridge');
    });
    
    // 打开管理面板命令
    const managementCommand = vscode.commands.registerCommand('codeSyncBridge.openManagementPanel', () => {
        StreamManagementPanel.createOrShow(context.extensionUri, extranetClientBridge);
    });
    
    context.subscriptions.push(refreshCommand, pullCommand, commitCommand, settingsCommand, managementCommand);
}

async function refreshStreams() {
    try {
        syncStatusBar.setStatus('正在刷新代码流...', 'loading');
        await streamExplorerProvider.refresh();
        syncStatusBar.setStatus('代码流已刷新', 'ready');
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : '未知错误';
        vscode.window.showErrorMessage(`刷新代码流失败: ${errorMessage}`);
        syncStatusBar.setStatus('刷新失败', 'error');
    }
}

async function pullCodeStream(stream: any) {
    try {
        syncStatusBar.setStatus(`正在拉取代码流: ${stream.name}`, 'syncing');
        
        // 选择本地目录
        const folderUri = await vscode.window.showOpenDialog({
            canSelectFolders: true,
            canSelectFiles: false,
            canSelectMany: false,
            openLabel: '选择代码流保存目录'
        });
        
        if (!folderUri || folderUri.length === 0) {
            syncStatusBar.setStatus('已取消拉取', 'ready');
            return;
        }
        
        const localPath = folderUri[0].fsPath;
        await extranetClientBridge.pullCodeStream(stream.id, localPath);
        
        // 在新窗口中打开拉取的代码
        const uri = vscode.Uri.file(localPath);
        await vscode.commands.executeCommand('vscode.openFolder', uri, true);
        
        syncStatusBar.setStatus(`代码流 ${stream.name} 拉取成功`, 'ready');
        vscode.window.showInformationMessage(`代码流 "${stream.name}" 已成功拉取到 ${localPath}`);
        
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : '未知错误';
        vscode.window.showErrorMessage(`拉取代码流失败: ${errorMessage}`);
        syncStatusBar.setStatus('拉取失败', 'error');
    }
}

async function commitChanges() {
    try {
        // 使用自动提交监控器的提交功能
        await autoCommitWatcher.commitPendingChanges();
        
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : '未知错误';
        vscode.window.showErrorMessage(`提交变更失败: ${errorMessage}`);
        syncStatusBar.setStatus('提交失败', 'error');
    }
}

export function deactivate() {
    console.log('Code Sync Bridge extension is now deactivated');
    
    if (autoCommitWatcher) {
        autoCommitWatcher.dispose();
    }
    
    if (syncStatusBar) {
        syncStatusBar.dispose();
    }
}