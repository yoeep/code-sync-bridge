import * as vscode from 'vscode';
import { CodeStream } from '@code-sync-bridge/shared';
import { ExtranetClientBridge } from '../services/ExtranetClientBridge';

/**
 * 代码流浏览器数据提供者
 * 实现VSCode树视图，显示可用的代码流
 */
export class StreamExplorerProvider implements vscode.TreeDataProvider<StreamTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<StreamTreeItem | undefined | null | void> = new vscode.EventEmitter<StreamTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<StreamTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;
    
    private streams: CodeStream[] = [];
    private loading: boolean = false;
    
    constructor(private extranetClientBridge: ExtranetClientBridge) {}
    
    /**
     * 刷新代码流列表
     */
    async refresh(): Promise<void> {
        this.loading = true;
        this._onDidChangeTreeData.fire();
        
        try {
            this.streams = await this.extranetClientBridge.listAvailableStreams();
        } catch (error) {
            console.error('刷新代码流失败:', error);
            this.streams = [];
            throw error;
        } finally {
            this.loading = false;
            this._onDidChangeTreeData.fire();
        }
    }
    
    getTreeItem(element: StreamTreeItem): vscode.TreeItem {
        return element;
    }
    
    getChildren(element?: StreamTreeItem): Thenable<StreamTreeItem[]> {
        if (this.loading) {
            return Promise.resolve([new LoadingTreeItem()]);
        }
        
        if (!element) {
            // 根节点，返回所有代码流
            if (this.streams.length === 0) {
                return Promise.resolve([new EmptyTreeItem()]);
            }
            
            return Promise.resolve(
                this.streams.map(stream => new CodeStreamTreeItem(stream, this.extranetClientBridge))
            );
        }
        
        if (element instanceof CodeStreamTreeItem) {
            // 代码流节点，返回其详细信息
            return Promise.resolve(element.getChildren());
        }
        
        return Promise.resolve([]);
    }
    
    /**
     * 获取指定代码流
     */
    getStream(streamId: string): CodeStream | undefined {
        return this.streams.find(stream => stream.id === streamId);
    }
    
    /**
     * 获取所有代码流
     */
    getAllStreams(): CodeStream[] {
        return [...this.streams];
    }
}

/**
 * 树视图项基类
 */
abstract class StreamTreeItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        super(label, collapsibleState);
    }
}

/**
 * 代码流树视图项
 */
class CodeStreamTreeItem extends StreamTreeItem {
    constructor(
        public readonly stream: CodeStream,
        private extranetClientBridge: ExtranetClientBridge
    ) {
        super(stream.name, vscode.TreeItemCollapsibleState.Collapsed);
        
        this.tooltip = this.buildTooltip();
        this.description = this.buildDescription();
        this.contextValue = 'codeStream';
        this.iconPath = this.getIcon();
    }
    
    private buildTooltip(): string {
        const lastSync = this.stream.lastSyncAt.toLocaleString();
        return `代码流: ${this.stream.name}\n` +
               `仓库类型: ${this.stream.repoType.toUpperCase()}\n` +
               `状态: ${this.getStatusText()}\n` +
               `最后同步: ${lastSync}\n` +
               `仓库地址: ${this.stream.repoUrl}`;
    }
    
    private buildDescription(): string {
        const status = this.getStatusText();
        const syncTime = this.formatRelativeTime(this.stream.lastSyncAt);
        return `${status} • ${syncTime}`;
    }
    
    private getStatusText(): string {
        switch (this.stream.status) {
            case 'active': return '活跃';
            case 'paused': return '暂停';
            case 'archived': return '已归档';
            default: return '未知';
        }
    }
    
    private formatRelativeTime(date: Date): string {
        const now = new Date();
        const diffMs = now.getTime() - date.getTime();
        const diffMinutes = Math.floor(diffMs / (1000 * 60));
        const diffHours = Math.floor(diffMinutes / 60);
        const diffDays = Math.floor(diffHours / 24);
        
        if (diffMinutes < 1) return '刚刚';
        if (diffMinutes < 60) return `${diffMinutes}分钟前`;
        if (diffHours < 24) return `${diffHours}小时前`;
        if (diffDays < 7) return `${diffDays}天前`;
        
        return date.toLocaleDateString();
    }
    
    private getIcon(): vscode.ThemeIcon {
        switch (this.stream.status) {
            case 'active':
                return new vscode.ThemeIcon('repo', new vscode.ThemeColor('charts.green'));
            case 'paused':
                return new vscode.ThemeIcon('repo', new vscode.ThemeColor('charts.yellow'));
            case 'archived':
                return new vscode.ThemeIcon('archive', new vscode.ThemeColor('charts.gray'));
            default:
                return new vscode.ThemeIcon('repo');
        }
    }
    
    async getChildren(): Promise<StreamTreeItem[]> {
        const children: StreamTreeItem[] = [];
        
        // 基本信息
        children.push(new InfoTreeItem('仓库类型', this.stream.repoType.toUpperCase()));
        children.push(new InfoTreeItem('创建时间', this.stream.createdAt.toLocaleString()));
        children.push(new InfoTreeItem('最后同步', this.stream.lastSyncAt.toLocaleString()));
        
        // 元数据信息
        if (this.stream.metadata) {
            if (this.stream.metadata.version) {
                children.push(new InfoTreeItem('版本', this.stream.metadata.version));
            }
            if (this.stream.metadata.description) {
                children.push(new InfoTreeItem('描述', this.stream.metadata.description));
            }
            if (this.stream.metadata.tags && this.stream.metadata.tags.length > 0) {
                children.push(new InfoTreeItem('标签', this.stream.metadata.tags.join(', ')));
            }
        }
        
        // 获取实时状态
        try {
            const status = await this.extranetClientBridge.getStreamStatus(this.stream.id);
            children.push(new InfoTreeItem('待提交变更', status.pendingChanges.toString()));
            children.push(new InfoTreeItem('有未同步变更', status.hasChanges ? '是' : '否'));
        } catch (error) {
            children.push(new InfoTreeItem('状态', '获取失败'));
        }
        
        return children;
    }
}

/**
 * 信息树视图项
 */
class InfoTreeItem extends StreamTreeItem {
    constructor(
        public readonly key: string,
        public readonly value: string
    ) {
        super(`${key}: ${value}`, vscode.TreeItemCollapsibleState.None);
        
        this.tooltip = `${key}: ${value}`;
        this.contextValue = 'streamInfo';
        this.iconPath = new vscode.ThemeIcon('info');
    }
}

/**
 * 加载中树视图项
 */
class LoadingTreeItem extends StreamTreeItem {
    constructor() {
        super('正在加载代码流...', vscode.TreeItemCollapsibleState.None);
        this.iconPath = new vscode.ThemeIcon('loading~spin');
        this.contextValue = 'loading';
    }
}

/**
 * 空状态树视图项
 */
class EmptyTreeItem extends StreamTreeItem {
    constructor() {
        super('没有可用的代码流', vscode.TreeItemCollapsibleState.None);
        this.tooltip = '当前没有注册的代码流\n请在内网环境中注册代码流后刷新';
        this.iconPath = new vscode.ThemeIcon('info');
        this.contextValue = 'empty';
    }
}