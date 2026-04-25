import * as vscode from 'vscode';
import { ExtranetClientBridge } from '../services/ExtranetClientBridge';

/**
 * 代码流管理面板
 * 提供更详细的代码流管理界面
 */
export class StreamManagementPanel {
    public static currentPanel: StreamManagementPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private _disposables: vscode.Disposable[] = [];
    
    public static createOrShow(
        extensionUri: vscode.Uri,
        extranetClientBridge: ExtranetClientBridge
    ) {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;
        
        if (StreamManagementPanel.currentPanel) {
            StreamManagementPanel.currentPanel._panel.reveal(column);
            return;
        }
        
        const panel = vscode.window.createWebviewPanel(
            'streamManagement',
            '代码流管理',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [
                    vscode.Uri.joinPath(extensionUri, 'media')
                ]
            }
        );
        
        StreamManagementPanel.currentPanel = new StreamManagementPanel(
            panel,
            extensionUri,
            extranetClientBridge
        );
    }
    
    private constructor(
        panel: vscode.WebviewPanel,
        extensionUri: vscode.Uri,
        private extranetClientBridge: ExtranetClientBridge
    ) {
        this._panel = panel;
        
        this._update();
        
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
        
        this._panel.webview.onDidReceiveMessage(
            async (message) => {
                switch (message.command) {
                    case 'refresh':
                        await this._refreshStreams();
                        break;
                    case 'pullStream':
                        await this._pullStream(message.streamId);
                        break;
                    case 'getStreamStatus':
                        await this._getStreamStatus(message.streamId);
                        break;
                }
            },
            null,
            this._disposables
        );
    }
    
    private async _update() {
        const webview = this._panel.webview;
        this._panel.title = '代码流管理';
        this._panel.webview.html = await this._getHtmlForWebview(webview);
    }
    
    private async _refreshStreams() {
        try {
            const streams = await this.extranetClientBridge.listAvailableStreams();
            this._panel.webview.postMessage({
                command: 'updateStreams',
                streams: streams
            });
        } catch (error) {
            this._panel.webview.postMessage({
                command: 'showError',
                message: `刷新失败: ${error instanceof Error ? error.message : '未知错误'}`
            });
        }
    }
    
    private async _pullStream(streamId: string) {
        try {
            const folderUri = await vscode.window.showOpenDialog({
                canSelectFolders: true,
                canSelectFiles: false,
                canSelectMany: false,
                openLabel: '选择代码流保存目录'
            });
            
            if (!folderUri || folderUri.length === 0) {
                return;
            }
            
            const localPath = folderUri[0].fsPath;
            await this.extranetClientBridge.pullCodeStream(streamId, localPath);
            
            this._panel.webview.postMessage({
                command: 'showSuccess',
                message: `代码流已成功拉取到 ${localPath}`
            });
            
        } catch (error) {
            this._panel.webview.postMessage({
                command: 'showError',
                message: `拉取失败: ${error instanceof Error ? error.message : '未知错误'}`
            });
        }
    }
    
    private async _getStreamStatus(streamId: string) {
        try {
            const status = await this.extranetClientBridge.getStreamStatus(streamId);
            this._panel.webview.postMessage({
                command: 'updateStreamStatus',
                streamId: streamId,
                status: status
            });
        } catch (error) {
            console.error('获取代码流状态失败:', error);
        }
    }
    
    private async _getHtmlForWebview(_webview: vscode.Webview): Promise<string> {
        return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>代码流管理</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            margin: 0;
            padding: 20px;
        }
        
        .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
            padding-bottom: 10px;
            border-bottom: 1px solid var(--vscode-panel-border);
        }
        
        .refresh-btn {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 8px 16px;
            border-radius: 4px;
            cursor: pointer;
        }
        
        .refresh-btn:hover {
            background-color: var(--vscode-button-hoverBackground);
        }
        
        .stream-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
            gap: 20px;
        }
        
        .stream-card {
            border: 1px solid var(--vscode-panel-border);
            border-radius: 8px;
            padding: 16px;
            background-color: var(--vscode-editor-background);
        }
        
        .stream-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 12px;
        }
        
        .stream-name {
            font-weight: bold;
            font-size: 16px;
        }
        
        .stream-status {
            padding: 4px 8px;
            border-radius: 12px;
            font-size: 12px;
            font-weight: bold;
        }
        
        .status-active {
            background-color: var(--vscode-testing-iconPassed);
            color: white;
        }
        
        .status-paused {
            background-color: var(--vscode-testing-iconQueued);
            color: white;
        }
        
        .status-archived {
            background-color: var(--vscode-testing-iconSkipped);
            color: white;
        }
        
        .stream-info {
            margin-bottom: 12px;
        }
        
        .info-row {
            display: flex;
            justify-content: space-between;
            margin-bottom: 4px;
            font-size: 14px;
        }
        
        .info-label {
            color: var(--vscode-descriptionForeground);
        }
        
        .stream-actions {
            display: flex;
            gap: 8px;
        }
        
        .action-btn {
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: none;
            padding: 6px 12px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
        }
        
        .action-btn:hover {
            background-color: var(--vscode-button-secondaryHoverBackground);
        }
        
        .action-btn.primary {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }
        
        .action-btn.primary:hover {
            background-color: var(--vscode-button-hoverBackground);
        }
        
        .loading {
            text-align: center;
            padding: 40px;
            color: var(--vscode-descriptionForeground);
        }
        
        .empty {
            text-align: center;
            padding: 40px;
            color: var(--vscode-descriptionForeground);
        }
        
        .message {
            padding: 12px;
            border-radius: 4px;
            margin-bottom: 16px;
        }
        
        .message.success {
            background-color: var(--vscode-testing-iconPassed);
            color: white;
        }
        
        .message.error {
            background-color: var(--vscode-testing-iconFailed);
            color: white;
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>代码流管理</h1>
        <button class="refresh-btn" onclick="refreshStreams()">刷新</button>
    </div>
    
    <div id="messages"></div>
    <div id="content">
        <div class="loading">正在加载代码流...</div>
    </div>
    
    <script>
        const vscode = acquireVsCodeApi();
        let streams = [];
        
        function refreshStreams() {
            document.getElementById('content').innerHTML = '<div class="loading">正在刷新代码流...</div>';
            vscode.postMessage({ command: 'refresh' });
        }
        
        function pullStream(streamId) {
            vscode.postMessage({ command: 'pullStream', streamId: streamId });
        }
        
        function getStreamStatus(streamId) {
            vscode.postMessage({ command: 'getStreamStatus', streamId: streamId });
        }
        
        function renderStreams(streamList) {
            streams = streamList;
            const content = document.getElementById('content');
            
            if (streams.length === 0) {
                content.innerHTML = '<div class="empty">没有可用的代码流<br>请在内网环境中注册代码流后刷新</div>';
                return;
            }
            
            const grid = document.createElement('div');
            grid.className = 'stream-grid';
            
            streams.forEach(stream => {
                const card = createStreamCard(stream);
                grid.appendChild(card);
            });
            
            content.innerHTML = '';
            content.appendChild(grid);
        }
        
        function createStreamCard(stream) {
            const card = document.createElement('div');
            card.className = 'stream-card';
            
            const statusClass = 'status-' + stream.status;
            const statusText = stream.status === 'active' ? '活跃' : 
                             stream.status === 'paused' ? '暂停' : '已归档';
            
            card.innerHTML = \`
                <div class="stream-header">
                    <div class="stream-name">\${stream.name}</div>
                    <div class="stream-status \${statusClass}">\${statusText}</div>
                </div>
                <div class="stream-info">
                    <div class="info-row">
                        <span class="info-label">仓库类型:</span>
                        <span>\${stream.repoType.toUpperCase()}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">最后同步:</span>
                        <span>\${new Date(stream.lastSyncAt).toLocaleString()}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">创建时间:</span>
                        <span>\${new Date(stream.createdAt).toLocaleDateString()}</span>
                    </div>
                </div>
                <div class="stream-actions">
                    <button class="action-btn primary" onclick="pullStream('\${stream.id}')">拉取代码</button>
                    <button class="action-btn" onclick="getStreamStatus('\${stream.id}')">查看状态</button>
                </div>
            \`;
            
            return card;
        }
        
        function showMessage(message, type) {
            const messagesDiv = document.getElementById('messages');
            const messageDiv = document.createElement('div');
            messageDiv.className = \`message \${type}\`;
            messageDiv.textContent = message;
            
            messagesDiv.appendChild(messageDiv);
            
            setTimeout(() => {
                messagesDiv.removeChild(messageDiv);
            }, 5000);
        }
        
        // 监听来自扩展的消息
        window.addEventListener('message', event => {
            const message = event.data;
            
            switch (message.command) {
                case 'updateStreams':
                    renderStreams(message.streams);
                    break;
                case 'showSuccess':
                    showMessage(message.message, 'success');
                    break;
                case 'showError':
                    showMessage(message.message, 'error');
                    break;
                case 'updateStreamStatus':
                    // 更新特定代码流的状态显示
                    console.log('Stream status updated:', message.streamId, message.status);
                    break;
            }
        });
        
        // 初始加载
        refreshStreams();
    </script>
</body>
</html>`;
    }
    
    public dispose() {
        StreamManagementPanel.currentPanel = undefined;
        
        this._panel.dispose();
        
        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }
}
