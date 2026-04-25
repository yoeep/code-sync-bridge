import { EventEmitter } from 'events';
import { ConflictDetail, ConflictResolutionStrategy } from './ConflictResolver';

/**
 * 通知类型
 */
export enum NotificationType {
  INFO = 'info',
  WARNING = 'warning',
  ERROR = 'error',
  SUCCESS = 'success'
}

/**
 * 通知优先级
 */
export enum NotificationPriority {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical'
}

/**
 * 通知信息
 */
export interface ConflictNotification {
  id: string;
  type: NotificationType;
  priority: NotificationPriority;
  title: string;
  message: string;
  conflictId?: string;
  timestamp: Date;
  read: boolean;
  actions?: NotificationAction[];
  metadata?: Record<string, any>;
}

/**
 * 通知操作
 */
export interface NotificationAction {
  id: string;
  label: string;
  action: string;
  style?: 'primary' | 'secondary' | 'danger';
  data?: any;
}

/**
 * 通知配置
 */
export interface NotificationConfig {
  enableDesktopNotifications: boolean;
  enableSoundNotifications: boolean;
  autoMarkReadAfter: number; // 毫秒
  maxNotifications: number;
  groupSimilarNotifications: boolean;
}

/**
 * 冲突通知管理器
 * 管理冲突相关的通知和用户交互
 */
export class ConflictNotificationManager extends EventEmitter {
  private notifications: Map<string, ConflictNotification> = new Map();
  private config: NotificationConfig;

  constructor(config?: Partial<NotificationConfig>) {
    super();
    
    this.config = {
      enableDesktopNotifications: true,
      enableSoundNotifications: false,
      autoMarkReadAfter: 30000, // 30秒
      maxNotifications: 100,
      groupSimilarNotifications: true,
      ...config
    };
  }

  /**
   * 创建冲突检测通知
   */
  notifyConflictDetected(conflict: ConflictDetail): string {
    const notification: ConflictNotification = {
      id: this.generateNotificationId(),
      type: NotificationType.WARNING,
      priority: NotificationPriority.HIGH,
      title: 'Conflict Detected',
      message: `A conflict was detected in ${conflict.filePath}. Manual resolution may be required.`,
      conflictId: conflict.id,
      timestamp: new Date(),
      read: false,
      actions: [
        {
          id: 'resolve-accept-local',
          label: 'Accept Local',
          action: 'resolve-conflict',
          style: 'primary',
          data: { strategy: ConflictResolutionStrategy.ACCEPT_LOCAL }
        },
        {
          id: 'resolve-accept-remote',
          label: 'Accept Remote',
          action: 'resolve-conflict',
          style: 'secondary',
          data: { strategy: ConflictResolutionStrategy.ACCEPT_REMOTE }
        },
        {
          id: 'resolve-manual',
          label: 'Manual Merge',
          action: 'open-merge-editor',
          style: 'secondary'
        },
        {
          id: 'view-details',
          label: 'View Details',
          action: 'view-conflict-details',
          style: 'secondary'
        }
      ],
      metadata: {
        conflictType: conflict.type,
        filePath: conflict.filePath
      }
    };

    this.addNotification(notification);
    this.sendDesktopNotification(notification);
    
    return notification.id;
  }

  /**
   * 创建冲突解决通知
   */
  notifyConflictResolved(conflictId: string, strategy: ConflictResolutionStrategy, filePath: string): string {
    const notification: ConflictNotification = {
      id: this.generateNotificationId(),
      type: NotificationType.SUCCESS,
      priority: NotificationPriority.MEDIUM,
      title: 'Conflict Resolved',
      message: `Conflict in ${filePath} has been resolved using ${this.getStrategyDisplayName(strategy)}.`,
      conflictId,
      timestamp: new Date(),
      read: false,
      actions: [
        {
          id: 'view-result',
          label: 'View Result',
          action: 'view-resolved-file',
          style: 'primary',
          data: { filePath }
        }
      ],
      metadata: {
        strategy,
        filePath
      }
    };

    this.addNotification(notification);
    this.sendDesktopNotification(notification);
    
    return notification.id;
  }

  /**
   * 创建合并失败通知
   */
  notifyMergeFailed(filePath: string, error: string): string {
    const notification: ConflictNotification = {
      id: this.generateNotificationId(),
      type: NotificationType.ERROR,
      priority: NotificationPriority.HIGH,
      title: 'Merge Failed',
      message: `Failed to merge ${filePath}: ${error}`,
      timestamp: new Date(),
      read: false,
      actions: [
        {
          id: 'retry-merge',
          label: 'Retry',
          action: 'retry-merge',
          style: 'primary',
          data: { filePath }
        },
        {
          id: 'manual-resolve',
          label: 'Manual Resolve',
          action: 'open-merge-editor',
          style: 'secondary',
          data: { filePath }
        }
      ],
      metadata: {
        filePath,
        error
      }
    };

    this.addNotification(notification);
    this.sendDesktopNotification(notification);
    
    return notification.id;
  }

  /**
   * 创建批量冲突通知
   */
  notifyBatchConflicts(conflicts: ConflictDetail[]): string {
    const notification: ConflictNotification = {
      id: this.generateNotificationId(),
      type: NotificationType.WARNING,
      priority: NotificationPriority.HIGH,
      title: 'Multiple Conflicts Detected',
      message: `${conflicts.length} conflicts detected across multiple files. Review and resolve each conflict.`,
      timestamp: new Date(),
      read: false,
      actions: [
        {
          id: 'resolve-all-local',
          label: 'Accept All Local',
          action: 'resolve-all-conflicts',
          style: 'primary',
          data: { strategy: ConflictResolutionStrategy.ACCEPT_LOCAL }
        },
        {
          id: 'resolve-all-remote',
          label: 'Accept All Remote',
          action: 'resolve-all-conflicts',
          style: 'secondary',
          data: { strategy: ConflictResolutionStrategy.ACCEPT_REMOTE }
        },
        {
          id: 'review-individually',
          label: 'Review Each',
          action: 'open-conflict-manager',
          style: 'secondary'
        }
      ],
      metadata: {
        conflictCount: conflicts.length,
        conflictIds: conflicts.map(c => c.id),
        filePaths: conflicts.map(c => c.filePath)
      }
    };

    this.addNotification(notification);
    this.sendDesktopNotification(notification);
    
    return notification.id;
  }

  /**
   * 创建自动合并成功通知
   */
  notifyAutoMergeSuccess(filePath: string, mergedLines: number): string {
    const notification: ConflictNotification = {
      id: this.generateNotificationId(),
      type: NotificationType.SUCCESS,
      priority: NotificationPriority.LOW,
      title: 'Auto Merge Successful',
      message: `Successfully merged ${filePath} with ${mergedLines} lines.`,
      timestamp: new Date(),
      read: false,
      actions: [
        {
          id: 'view-merged',
          label: 'View File',
          action: 'view-file',
          style: 'primary',
          data: { filePath }
        }
      ],
      metadata: {
        filePath,
        mergedLines
      }
    };

    this.addNotification(notification);
    
    return notification.id;
  }

  /**
   * 获取所有通知
   */
  getAllNotifications(): ConflictNotification[] {
    return Array.from(this.notifications.values())
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  /**
   * 获取未读通知
   */
  getUnreadNotifications(): ConflictNotification[] {
    return this.getAllNotifications().filter(n => !n.read);
  }

  /**
   * 获取特定冲突的通知
   */
  getConflictNotifications(conflictId: string): ConflictNotification[] {
    return this.getAllNotifications().filter(n => n.conflictId === conflictId);
  }

  /**
   * 标记通知为已读
   */
  markAsRead(notificationId: string): boolean {
    const notification = this.notifications.get(notificationId);
    if (notification && !notification.read) {
      notification.read = true;
      this.emit('notificationRead', { notificationId });
      return true;
    }
    return false;
  }

  /**
   * 标记所有通知为已读
   */
  markAllAsRead(): number {
    let count = 0;
    for (const notification of this.notifications.values()) {
      if (!notification.read) {
        notification.read = true;
        count++;
      }
    }
    
    if (count > 0) {
      this.emit('allNotificationsRead', { count });
    }
    
    return count;
  }

  /**
   * 删除通知
   */
  removeNotification(notificationId: string): boolean {
    const deleted = this.notifications.delete(notificationId);
    if (deleted) {
      this.emit('notificationRemoved', { notificationId });
    }
    return deleted;
  }

  /**
   * 清除所有已读通知
   */
  clearReadNotifications(): number {
    const readNotifications = Array.from(this.notifications.entries())
      .filter(([, notification]) => notification.read);
    
    for (const [id] of readNotifications) {
      this.notifications.delete(id);
    }

    if (readNotifications.length > 0) {
      this.emit('readNotificationsCleared', { count: readNotifications.length });
    }

    return readNotifications.length;
  }

  /**
   * 清除所有通知
   */
  clearAllNotifications(): number {
    const count = this.notifications.size;
    this.notifications.clear();
    
    if (count > 0) {
      this.emit('allNotificationsCleared', { count });
    }
    
    return count;
  }

  /**
   * 执行通知操作
   */
  executeNotificationAction(notificationId: string, actionId: string): void {
    const notification = this.notifications.get(notificationId);
    if (!notification) {
      throw new Error(`Notification ${notificationId} not found`);
    }

    const action = notification.actions?.find(a => a.id === actionId);
    if (!action) {
      throw new Error(`Action ${actionId} not found in notification ${notificationId}`);
    }

    this.emit('notificationActionExecuted', {
      notificationId,
      actionId,
      action: action.action,
      data: action.data,
      notification
    });

    // 自动标记为已读
    this.markAsRead(notificationId);
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<NotificationConfig>): void {
    this.config = { ...this.config, ...config };
    this.emit('configUpdated', this.config);
  }

  /**
   * 获取通知统计
   */
  getNotificationStats(): {
    total: number;
    unread: number;
    byType: Record<NotificationType, number>;
    byPriority: Record<NotificationPriority, number>;
  } {
    const notifications = this.getAllNotifications();
    const byType = {} as Record<NotificationType, number>;
    const byPriority = {} as Record<NotificationPriority, number>;

    // 初始化计数器
    Object.values(NotificationType).forEach(type => byType[type] = 0);
    Object.values(NotificationPriority).forEach(priority => byPriority[priority] = 0);

    // 统计
    notifications.forEach(notification => {
      byType[notification.type]++;
      byPriority[notification.priority]++;
    });

    return {
      total: notifications.length,
      unread: notifications.filter(n => !n.read).length,
      byType,
      byPriority
    };
  }

  /**
   * 添加通知
   */
  private addNotification(notification: ConflictNotification): void {
    // 检查是否需要分组相似通知
    if (this.config.groupSimilarNotifications) {
      const similar = this.findSimilarNotification(notification);
      if (similar) {
        this.updateSimilarNotification(similar, notification);
        return;
      }
    }

    this.notifications.set(notification.id, notification);

    // 限制通知数量
    if (this.notifications.size > this.config.maxNotifications) {
      const oldest = this.getOldestNotification();
      if (oldest) {
        this.notifications.delete(oldest.id);
      }
    }

    // 设置自动标记为已读
    if (this.config.autoMarkReadAfter > 0) {
      setTimeout(() => {
        this.markAsRead(notification.id);
      }, this.config.autoMarkReadAfter);
    }

    this.emit('notificationAdded', notification);
  }

  /**
   * 发送桌面通知
   */
  private sendDesktopNotification(notification: ConflictNotification): void {
    if (!this.config.enableDesktopNotifications) {
      return;
    }

    // 在Node.js环境中，桌面通知功能暂不支持
    // 在浏览器环境中可以通过扩展实现
    console.log(`🔔 桌面通知: ${notification.title} - ${notification.message}`);

    // 播放通知声音
    if (this.config.enableSoundNotifications) {
      this.playNotificationSound(notification.type);
    }
  }

  /**
   * 查找相似通知
   */
  private findSimilarNotification(notification: ConflictNotification): ConflictNotification | null {
    for (const existing of this.notifications.values()) {
      if (existing.type === notification.type &&
          existing.title === notification.title &&
          !existing.read &&
          (Date.now() - existing.timestamp.getTime()) < 60000) { // 1分钟内
        return existing;
      }
    }
    return null;
  }

  /**
   * 更新相似通知
   */
  private updateSimilarNotification(existing: ConflictNotification, newNotification: ConflictNotification): void {
    existing.message = `${existing.message} (and ${(existing.metadata?.count || 1) + 1} more)`;
    existing.metadata = {
      ...existing.metadata,
      count: (existing.metadata?.count || 1) + 1,
      latestTimestamp: newNotification.timestamp
    };
    existing.timestamp = newNotification.timestamp;

    this.emit('notificationUpdated', existing);
  }

  /**
   * 获取最旧的通知
   */
  private getOldestNotification(): ConflictNotification | null {
    let oldest: ConflictNotification | null = null;
    
    for (const notification of this.notifications.values()) {
      if (!oldest || notification.timestamp < oldest.timestamp) {
        oldest = notification;
      }
    }
    
    return oldest;
  }

  /**
   * 获取通知图标
   */
  private getNotificationIcon(type: NotificationType): string {
    switch (type) {
      case NotificationType.ERROR:
        return '❌';
      case NotificationType.WARNING:
        return '⚠️';
      case NotificationType.SUCCESS:
        return '✅';
      case NotificationType.INFO:
      default:
        return 'ℹ️';
    }
  }

  /**
   * 播放通知声音
   */
  private playNotificationSound(type: NotificationType): void {
    // 在Node.js环境中，声音通知功能暂不支持
    // 在浏览器环境中可以通过Web Audio API实现
    console.log(`🔊 通知声音: ${type}`);
  }

  /**
   * 获取策略显示名称
   */
  private getStrategyDisplayName(strategy: ConflictResolutionStrategy): string {
    switch (strategy) {
      case ConflictResolutionStrategy.ACCEPT_LOCAL:
        return 'Accept Local Changes';
      case ConflictResolutionStrategy.ACCEPT_REMOTE:
        return 'Accept Remote Changes';
      case ConflictResolutionStrategy.MERGE_AUTO:
        return 'Automatic Merge';
      case ConflictResolutionStrategy.MERGE_MANUAL:
        return 'Manual Merge';
      default:
        return 'Unknown Strategy';
    }
  }

  /**
   * 生成通知ID
   */
  private generateNotificationId(): string {
    return `notification_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }
}