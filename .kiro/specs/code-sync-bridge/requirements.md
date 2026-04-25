# 需求文档

## 介绍

代码同步桥接服务是一个解决内外网隔离环境下代码开发协作问题的系统。该系统通过SFTP作为唯一的内外网通信渠道，实现代码仓库的双向同步，使开发者能够在外网环境中使用AI编码工具，同时保持与内网代码仓库的同步。

## 术语表

- **CodeSyncBridge**: 代码同步桥接服务主系统
- **IntranetClient**: 内网客户端组件
- **ExtranetClient**: 外网客户端组件
- **CodeStream**: 注册在系统中的代码流，包含仓库信息和同步配置
- **SFTPBridge**: SFTP服务器作为内外网通信桥梁
- **VersionControlSystem**: 版本控制系统（Git/SVN）
- **DynamicToken**: 访问SFTP需要的动态验证码

## 需求

### 需求 1

**用户故事:** 作为内网开发者，我希望能够注册代码仓库到同步服务，以便外网环境可以访问和修改代码。

#### 验收标准

1. WHEN 内网开发者执行注册命令，THE IntranetClient SHALL 验证Git/SVN仓库URL的有效性
2. WHEN 仓库验证成功，THE IntranetClient SHALL 克隆完整代码到本地缓存目录
3. WHEN 代码克隆完成，THE IntranetClient SHALL 将代码打包上传到SFTPBridge指定目录
4. WHEN 上传成功，THE CodeSyncBridge SHALL 在配置文件中注册CodeStream信息
5. THE IntranetClient SHALL 返回注册成功确认和CodeStream标识符

### 需求 2

**用户故事:** 作为外网开发者，我希望能够拉取已注册的代码流，以便在外网环境中进行开发。

#### 验收标准

1. WHEN 外网开发者执行拉取命令，THE ExtranetClient SHALL 连接SFTPBridge并验证DynamicToken
2. WHEN 连接成功，THE ExtranetClient SHALL 列出所有可用的CodeStream
3. WHEN 用户选择特定CodeStream，THE ExtranetClient SHALL 从SFTPBridge下载最新代码包
4. WHEN 下载完成，THE ExtranetClient SHALL 解压代码到指定本地目录
5. THE ExtranetClient SHALL 初始化本地Git仓库用于版本跟踪

### 需求 3

**用户故事:** 作为内网开发者，我希望系统能够自动监控代码变更并同步到版本控制系统，以便保持代码仓库的最新状态。

#### 验收标准

1. THE IntranetClient SHALL 每5分钟检查SFTPBridge上的代码更新
2. WHEN 检测到外网提交的代码变更，THE IntranetClient SHALL 下载变更文件
3. WHEN 下载完成，THE IntranetClient SHALL 将变更应用到本地代码仓库
4. WHEN 变更应用成功，THE IntranetClient SHALL 提交变更到VersionControlSystem
5. IF 提交失败，THEN THE IntranetClient SHALL 记录错误日志并发送通知

### 需求 4

**用户故事:** 作为外网开发者，我希望能够提交代码变更，以便内网可以同步我的修改。

#### 验收标准

1. WHEN 外网开发者执行提交命令，THE ExtranetClient SHALL 检测本地代码变更
2. WHEN 检测到变更，THE ExtranetClient SHALL 创建变更包含差异信息
3. WHEN 变更包创建完成，THE ExtranetClient SHALL 连接SFTPBridge并验证DynamicToken
4. WHEN 连接成功，THE ExtranetClient SHALL 上传变更包到指定CodeStream目录
5. THE ExtranetClient SHALL 更新本地提交记录并返回提交确认

### 需求 5

**用户故事:** 作为系统管理员，我希望能够配置SFTP连接参数，以便系统能够适应不同的网络环境。

#### 验收标准

1. THE CodeSyncBridge SHALL 提供配置文件支持SFTP服务器地址设置
2. THE CodeSyncBridge SHALL 支持SFTP端口号配置
3. THE CodeSyncBridge SHALL 支持用户名和DynamicToken认证方式配置
4. THE CodeSyncBridge SHALL 支持连接超时和重试次数配置
5. WHEN 配置文件更新，THE CodeSyncBridge SHALL 验证配置有效性并应用新设置

### 需求 6

**用户故事:** 作为外网开发者，我希望通过VSCode插件进行代码同步，以便获得更好的开发体验。

#### 验收标准

1. THE VSCodeExtension SHALL 提供图形界面显示可用CodeStream列表
2. WHEN 用户选择CodeStream，THE VSCodeExtension SHALL 调用ExtranetClient拉取代码
3. THE VSCodeExtension SHALL 在状态栏显示同步状态和最后更新时间
4. WHEN 用户保存文件，THE VSCodeExtension SHALL 自动标记文件为待提交状态
5. THE VSCodeExtension SHALL 提供一键提交功能调用ExtranetClient上传变更