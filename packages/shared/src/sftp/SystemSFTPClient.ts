/**
 * 系统SFTP客户端 - 基于成功的test-totp-fix.js方案重写
 * 使用SSH2库实现稳定的TOTP双因素认证
 */

import { Client } from 'ssh2';
import * as fs from 'fs';
import * as path from 'path';
import * as posixPath from 'path/posix';
import { QRCodeDynamicTokenProvider } from './DynamicTokenProvider';
import { log } from '../utils/Logger';
export interface ProgressInfo {
    transferred: number;
    total: number;
    percentage: number;
    speed: number; // bytes per second
    eta: number; // estimated time remaining in seconds
    startTime: number;
    currentTime: number;
}

export interface SystemSFTPConfig {
    host: string;
    port: number;
    username: string;
    password?: string;
    privateKey?: string;
    totpSecret?: string;
    authMethod?: 'password' | 'dynamic-token' | 'key';
    dynamicTokenProvider?: () => Promise<string>;
    timeout?: number;
    retries?: number;
    retryDelay?: number;
    qrCodeImagePath?: string;
    basePath?: string;
    // 进度监控回调
    onProgress?: (progress: ProgressInfo) => void;
    onUploadProgress?: (progress: ProgressInfo) => void;
    onDownloadProgress?: (progress: ProgressInfo) => void;
}

export class SystemSFTPClient {
    private client: Client | null = null;
    private config: SystemSFTPConfig;
    private isConnected: boolean = false;
    private sftp: any = null;
    private connectionAttempts: number = 0;

    constructor(config: SystemSFTPConfig) {
        this.config = {
            timeout: 30000,
            retries: 3,
            retryDelay: 2000,
            ...config
        };
    }

    /**
     * 连接到SFTP服务器
     */
    async connect(): Promise<void> {
        this.connectionAttempts++;
        
        // 清理任何现有连接
        if (this.client) {
            this.client.destroy();
        }
        
        this.client = new Client();
        
        return new Promise((resolve, reject) => {
            let timeoutId: NodeJS.Timeout;
            let isResolved = false;
            
            const cleanup = () => {
                if (timeoutId) {
                    clearTimeout(timeoutId);
                }
                if (this.client && !isResolved) {
                    this.client.removeAllListeners();
                }
            };

            const resolveOnce = (result?: any) => {
                if (!isResolved) {
                    isResolved = true;
                    cleanup();
                    resolve(result);
                }
            };

            const rejectOnce = (error: Error) => {
                if (!isResolved) {
                    isResolved = true;
                    cleanup();
                    if (this.client) {
                        this.client.destroy();
                    }
                    reject(error);
                }
            };

            timeoutId = setTimeout(() => {
                rejectOnce(new Error(`连接超时 (尝试 ${this.connectionAttempts}/${this.config.retries})`));
            }, this.config.timeout!);

            this.client!.on('ready', () => {
                log.info('SFTP', 'SSH连接已建立，正在创建SFTP会话...');
                this.client!.sftp((err: any, sftp: any) => {
                    if (err) {
                        log.error('SFTP', 'SFTP会话创建失败', { error: err.message });
                        rejectOnce(new Error(`SFTP会话创建失败: ${err.message}`));
                        return;
                    }
                    this.sftp = sftp;
                    this.isConnected = true;
                    log.info('SFTP', 'SFTP 连接成功');
                    resolveOnce(sftp);
                });
            });

            this.client!.on('keyboard-interactive', (_name: string, _instructions: string, _instructionsLang: string, prompts: any[], finish: Function) => {
                log.info('SFTP', '处理双因素认证...');
                this.handleAuth(prompts, finish).catch(error => {
                    log.error('SFTP', '认证处理失败', { error: error.message });
                    rejectOnce(error);
                });
            });

            this.client!.on('error', (err: Error) => {
                log.error('SFTP', 'SSH连接错误', { error: err.message, attempt: this.connectionAttempts });
                
                // 处理特定的SSH2协议错误
                if (err.message.includes('decrypt') || err.message.includes('AES')) {
                    log.warn('SFTP', '检测到加密协议错误，尝试重连', { attempt: this.connectionAttempts, maxRetries: this.config.retries });
                    if (this.connectionAttempts < this.config.retries!) {
                        setTimeout(() => {
                            this.connect().then(resolveOnce).catch(rejectOnce);
                        }, this.config.retryDelay);
                        return;
                    }
                }
                
                rejectOnce(err);
            });

            this.client!.on('close', () => {
                log.info('SFTP', 'SSH连接已关闭');
                this.isConnected = false;
            });

            // 构建连接配置 - 使用与成功的test.js相同的简单配置
            const config: any = {
                host: this.config.host,
                port: this.config.port || 22,
                username: this.config.username,
                tryKeyboard: true,
                readyTimeout: this.config.timeout || 30000
            };

            // 添加认证信息
            if (this.config.privateKey) {
                try {
                    config.privateKey = fs.readFileSync(this.config.privateKey);
                } catch (keyError: any) {
                    rejectOnce(new Error(`私钥读取失败: ${keyError.message}`));
                    return;
                }
            }
            // if (this.config.password) {
            //     config.password = this.config.password;
            // }

            //console.log(`🚀 正在连接到 ${this.config.host}:${this.config.port} (尝试 ${this.connectionAttempts}/${this.config.retries})...`);
            
            try {
                this.client!.connect(config);
            } catch (connectError: any) {
                rejectOnce(connectError);
            }
        });
    }

    /**
     * 处理认证 - 基于成功的test-totp-fix.js方案
     */
    private async handleAuth(prompts: any[], finish: Function): Promise<void> {
        log.info('SFTP-Auth', `收到 ${prompts.length} 个认证提示`);
        
        const responses: string[] = [];
        
        for (const [index, prompt] of prompts.entries()) {
            const promptText = prompt.prompt.toLowerCase();
            log.debug('SFTP-Auth', `提示 ${index + 1}: ${promptText}`);
            
            let response = '';
            
            // 认证逻辑
            if (promptText.includes('password') || promptText.includes('密码')) {
                response = this.config.password || '';
                log.debug('SFTP-Auth', '使用密码认证');
            } else if (promptText.includes('verification') || promptText.includes('验证码') || 
                      promptText.includes('code') || promptText.includes('otp')) {
                if (this.config.totpSecret) {
                    try {
                        const { authenticator } = require('otplib');
                        response = authenticator.generate(this.config.totpSecret);
                        log.debug('SFTP-Auth', `生成TOTP验证码: ${response}`);
                        
                        // 确保是字符串
                        if (typeof response !== 'string') {
                            response = String(response);
                        }
                    } catch (totpError: any) {
                        log.error('SFTP-Auth', 'TOTP生成失败', { error: totpError.message });
                        response = '';
                    }
                } else if (this.config.dynamicTokenProvider) {
                    try {
                        const token = await this.config.dynamicTokenProvider();
                        response = String(token || '').trim();
                        log.debug('SFTP-Auth', `使用动态令牌: ${response}`);
                    } catch (tokenError: any) {
                        log.error('SFTP-Auth', '动态令牌获取失败', { error: tokenError.message });
                        response = '';
                    }
                } else if(this.config.qrCodeImagePath){
                     const provider = new QRCodeDynamicTokenProvider(this.config.qrCodeImagePath);
                     response = await provider.getToken();
                     log.debug('SFTP-Auth', `使用二维码动态令牌: ${response}`);
                }else {
                    log.warn('SFTP-Auth', '未配置TOTP密钥或动态令牌提供器');
                    response = '';
                }
            } else {
                // 对于未知提示，记录详细信息
                log.warn('SFTP-Auth', `未知认证提示: "${prompt.prompt}"`, { echo: prompt.echo });
                response = '';
            }
            
            // 确保响应总是字符串
            responses.push(String(response));
        }
        
        log.debug('SFTP-Auth', `发送 ${responses.length} 个认证响应`);
        
        try {
            finish(responses);
        } catch (finishError: any) {
            log.error('SFTP-Auth', '认证响应发送失败', { error: finishError.message });
            throw finishError;
        }
    }

    /**
     * 带重试机制的连接
     */
    async connectWithRetry(): Promise<void> {
        let lastError: Error;
        
        for (let attempt = 1; attempt <= this.config.retries!; attempt++) {
            try {
                this.connectionAttempts = attempt;
                await this.connect();
                return; // 成功
            } catch (error: any) {
                lastError = error;
                log.error('SFTP', `连接尝试 ${attempt}/${this.config.retries} 失败`, { error: error.message });
                
                if (attempt < this.config.retries!) {
                    log.info('SFTP', `${this.config.retryDelay}ms 后重试...`);
                    await new Promise(resolve => setTimeout(resolve, this.config.retryDelay));
                }
            }
        }
        
        throw new Error(`所有连接尝试失败。最后错误: ${lastError!.message}`);
    }

    /**
     * 断开连接
     */
    disconnect(): void {
        if (this.client) {
            try {
                this.client.end();
            } catch (error: any) {
                log.warn('SFTP', '断开连接时出现警告', { error: error.message });
                // 强制销毁如果end()失败
                this.client.destroy();
            }
            this.client = null;
            this.isConnected = false;
            this.sftp = null;
            log.info('SFTP', 'SFTP 连接已关闭');
        }
    }

    /**
     * 安全操作包装器
     */
    private async safeOperation<T>(operation: Function, ...args: any[]): Promise<T> {
        if (!this.isConnected || !this.sftp) {
            throw new Error('SFTP 未连接');
        }
        
        return new Promise((resolve, reject) => {
            operation.call(this.sftp, ...args, (err: any, result: T) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve(result);
            });
        });
    }

    /**
     * 列出目录内容
     */
    async listDirectory(dirPath: string = '.'): Promise<any[]> {
        
        const remotePath = posixPath.join(this.config.basePath || '', dirPath);
        return this.safeOperation(this.sftp.readdir, remotePath);
    }

    /**
     * 上传文件（带进度监控）
     */
    async uploadFile(localPath: string, remotePath: string): Promise<void> {
        // 确保远程路径包含基础路径，使用posix路径分隔符（/）
        remotePath = posixPath.join(this.config.basePath || '', remotePath);

        if (!fs.existsSync(localPath)) {
            throw new Error(`本地文件不存在: ${localPath}`);
        }

        // 确保远程目录存在
        const remoteDir = posixPath.dirname(remotePath);
        try {
            await this.directoryExists(remoteDir,false);
        } catch {
            // 目录不存在，创建它
            await this.createDirectory(remoteDir);
        }

        // 获取文件大小
        const stats = fs.statSync(localPath);
        const totalSize = stats.size;

        // 创建进度监控器
        const progressMonitor = this.createProgressMonitor(
            totalSize,
            this.config.onUploadProgress || this.config.onProgress
        );

        log.info('SFTP-Upload', `开始上传文件: ${localPath} -> ${remotePath}`, { 
            size: this.formatBytes(totalSize) 
        });

        return new Promise((resolve, reject) => {
            if (!this.sftp) {
                reject(new Error('SFTP 未连接'));
                return;
            }

            // 使用fastPut方法并监控进度
            this.sftp.fastPut(localPath, remotePath, {
                step: (totalTransferred: number) => {
                    progressMonitor(totalTransferred);
                }
            }, (err: any) => {
                if (err) {
                    log.error('SFTP-Upload', '上传失败', { error: err.message, remotePath });
                    reject(err);
                } else {
                    console.log(`✅ 上传完成: ${remotePath}`); // 保留关键进程监控信息
                    log.info('SFTP-Upload', `上传完成: ${remotePath}`);
                    resolve();
                }
            });
        });
    }

    /**
     * 下载文件（带进度监控）
     */
    async downloadFile(remotePath: string, localPath: string): Promise<void> {
        // 确保远程路径包含基础路径，使用posix路径分隔符（/）
        remotePath = posixPath.join(this.config.basePath || '', remotePath);

        // 确保本地目录存在
        const localDir = path.dirname(localPath);
        if (!fs.existsSync(localDir)) {
            fs.mkdirSync(localDir, { recursive: true });
        }

        // 获取远程文件大小
        let totalSize = 0;
        try {
            const stats: any = await this.safeOperation(this.sftp.stat, remotePath);
            totalSize = stats && stats.size ? stats.size : 0;
        } catch (error) {
            log.warn('SFTP-Download', '无法获取远程文件大小，将无法显示准确进度');
        }

        // 创建进度监控器
        const progressMonitor = this.createProgressMonitor(
            totalSize,
            this.config.onDownloadProgress || this.config.onProgress
        );

        log.info('SFTP-Download', `开始下载文件: ${remotePath} -> ${localPath}`, { 
            size: totalSize > 0 ? this.formatBytes(totalSize) : 'unknown' 
        });

        return new Promise((resolve, reject) => {
            if (!this.sftp) {
                reject(new Error('SFTP 未连接'));
                return;
            }

            // 使用fastGet方法并监控进度
            this.sftp.fastGet(remotePath, localPath, {
                step: (totalTransferred: number) => {
                    progressMonitor(totalTransferred);
                }
            }, (err: any) => {
                if (err) {
                    log.error('SFTP-Download', '下载失败', { error: err.message, remotePath });
                    reject(err);
                } else {
                    console.log(`✅ 下载完成: ${localPath}`); // 保留关键进程监控信息
                    log.info('SFTP-Download', `下载完成: ${localPath}`);
                    resolve();
                }
            });
        });
    }

    /**
     * 创建目录（递归创建所有不存在的父目录）
     */
    async createDirectory(remotePath: string): Promise<void> {
        // 确保远程路径包含基础路径，使用posix路径分隔符（/）
        remotePath = posixPath.join(this.config.basePath || '', remotePath);
        
        // 递归创建目录
        await this.createDirectoryRecursive(remotePath);
    }

    /**
     * 递归创建目录（私有方法）
     */
    private async createDirectoryRecursive(remotePath: string): Promise<void> {
        log.info('SFTP-Mkdir', `递归创建目录: ${remotePath}`);
        try {
            // 检查目录是否已存在
            const exists = await this.directoryExists(remotePath, false);
            if (exists) {
                return;
            }
        } catch {
            // 目录不存在，继续创建
        }

        // 获取父目录路径
        const parentPath = posixPath.dirname(remotePath);
        
        // 如果父目录不是根目录且不是当前目录，先创建父目录
        if (parentPath !== '/' && parentPath !== '.' && parentPath !== remotePath
            && parentPath != this.config.basePath
        ) {
            await this.createDirectoryRecursive(parentPath);
        }

        try {
            // 创建当前目录
            await this.safeOperation(this.sftp.mkdir, remotePath);
            log.info('SFTP-Mkdir', `创建远程目录: ${remotePath}`);
        } catch (error: any) {
            // 如果目录已存在（可能是并发创建），忽略错误
            if (error.code !== 'EEXIST' && !error.message.includes('File exists')) {
                throw error;
            }
        }
    }

    /**
     * 删除目录
     */
    async deleteDirectory(remotePath: string): Promise<void> {
        // 确保远程路径包含基础路径，使用posix路径分隔符（/）
        remotePath = posixPath.join(this.config.basePath || '', remotePath);
        return this.safeOperation(this.sftp.rmdir, remotePath);
    }

    /**
     * 删除文件
     */
    async deleteFile(remotePath: string): Promise<void> {
        // 确保远程路径包含基础路径，使用posix路径分隔符（/）
        remotePath = posixPath.join(this.config.basePath || '', remotePath);
        return this.safeOperation(this.sftp.unlink, remotePath);
    }

    /**
     * 检查文件是否存在
     */
    async fileExists(remotePath: string): Promise<boolean> {
        // 确保远程路径包含基础路径，使用posix路径分隔符（/）
        remotePath = posixPath.join(this.config.basePath || '', remotePath);
        try {
            await this.safeOperation(this.sftp.stat, remotePath);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * 检查目录是否存在
     */
    async directoryExists(remotePath: string, withBasePath: boolean = true): Promise<boolean> {
        // 如果不包含基础路径，直接检查
        if (withBasePath) {
             // 确保远程路径包含基础路径，使用posix路径分隔符（/）
            remotePath = posixPath.join(this.config.basePath || '', remotePath);
        }
        try {
            const stats: any = await this.safeOperation(this.sftp.stat, remotePath);
            return stats && typeof stats.isDirectory === 'function' ? stats.isDirectory() : false;
        } catch {
            return false;
        }
    }

    /**
     * 获取文件统计信息
     */
    async getFileStats(remotePath: string): Promise<any> {
        // 确保远程路径包含基础路径，使用posix路径分隔符（/）
        remotePath = posixPath.join(this.config.basePath || '', remotePath);
        return this.safeOperation(this.sftp.stat, remotePath);
    }

    /**
     * 重命名文件或目录
     */
    async rename(oldPath: string, newPath: string): Promise<void> {
        // 确保旧路径包含基础路径，使用posix路径分隔符（/）
        oldPath = posixPath.join(this.config.basePath || '', oldPath);
        // 确保新路径包含基础路径，使用posix路径分隔符（/）
        newPath = posixPath.join(this.config.basePath || '', newPath);
        return this.safeOperation(this.sftp.rename, oldPath, newPath);
    }

    /**
     * 检查连接状态
     */
    isConnectionActive(): boolean {
        return this.isConnected && this.client !== null && this.sftp !== null;
    }

    /**
     * 刷新动态令牌
     */
    async refreshDynamicToken(): Promise<void> {
        if (this.config.authMethod !== 'dynamic-token') {
            return;
        }

        if (!this.config.dynamicTokenProvider) {
            throw new Error('动态令牌认证需要提供 dynamicTokenProvider 函数');
        }

        try {
            const token = await this.config.dynamicTokenProvider();
            if (!token || token.trim().length === 0) {
                throw new Error('动态令牌不能为空');
            }
            
            // 将动态令牌作为密码使用
            this.config.password = token.trim();
        } catch (error: any) {
            throw new Error(`获取动态令牌失败: ${error.message}`);
        }
    }

    /**
     * 检查系统是否支持SSH2
     */
    static async checkSystemSupport(): Promise<boolean> {
        try {
            // 尝试加载ssh2模块
            require('ssh2');
            return true;
        } catch (error) {
            return false;
        }
    }

    /**
     * 获取SSH2版本信息
     */
    static getSSH2Version(): string {
        try {
            const ssh2 = require('ssh2');
            return ssh2.version || 'unknown';
        } catch (error) {
            throw new Error('SSH2模块未安装');
        }
    }

    /**
     * 创建进度监控器
     */
    private createProgressMonitor(
        total: number, 
        callback?: (progress: ProgressInfo) => void
    ): (transferred: number) => void {
        const startTime = Date.now();
        let lastTime = startTime;
        let lastTransferred = 0;

        return (transferred: number) => {
            const currentTime = Date.now();
            const timeDiff = (currentTime - lastTime) / 1000;
            
            // 计算速度 (bytes per second)
            const speed = timeDiff > 0 ? (transferred - lastTransferred) / timeDiff : 0;
            
            // 计算百分比
            const percentage = total > 0 ? Math.round((transferred / total) * 100) : 0;
            
            // 估算剩余时间 (seconds)
            const eta = speed > 0 ? (total - transferred) / speed : 0;

            const progress: ProgressInfo = {
                transferred,
                total,
                percentage,
                speed,
                eta,
                startTime,
                currentTime
            };

            // 调用回调函数
            if (callback) {
                callback(progress);
            }

            // 输出进度信息
            this.logProgress(progress);

            lastTime = currentTime;
            lastTransferred = transferred;
        };
    }

    /**
     * 格式化字节大小
     */
    private formatBytes(bytes: number): string {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    /**
     * 格式化速度
     */
    private formatSpeed(bytesPerSec: number): string {
        return this.formatBytes(bytesPerSec) + '/s';
    }

    /**
     * 格式化时间
     */
    private formatTime(seconds: number): string {
        if (seconds < 60) return `${Math.round(seconds)}s`;
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = Math.round(seconds % 60);
        return `${minutes}m ${remainingSeconds}s`;
    }

    /**
     * 输出进度信息
     */
    private logProgress(progress: ProgressInfo): void {
        const { transferred, total, percentage, speed, eta } = progress;

        // 创建进度条
        const barLength = 30;
        const filledLength = Math.round((percentage / 100) * barLength);
        const bar = '█'.repeat(filledLength) + '░'.repeat(barLength - filledLength);

        log.debug('SFTP-Progress', `[${bar}] ${percentage}%`, {
            transferred: this.formatBytes(transferred),
            total: this.formatBytes(total),
            speed: this.formatSpeed(speed),
            eta: this.formatTime(eta)
        });
    }
}

/**
 * SFTP客户端工厂
 */
export class SFTPClientFactory {
    /**
     * 创建SFTP客户端
     */
    static async createClient(config: SystemSFTPConfig): Promise<SystemSFTPClient> {
        // 检查系统是否支持SSH2
        const systemSupported = await SystemSFTPClient.checkSystemSupport();
        
        if (!systemSupported) {
            throw new Error('系统不支持SSH2模块，请安装: npm install ssh2');
        }

        return new SystemSFTPClient(config);
    }

    /**
     * 验证配置
     */
    static validateConfig(config: SystemSFTPConfig): void {
        if (!config.host || !config.username) {
            throw new Error('SFTP配置缺少必需的host和username');
        }

        if (config.authMethod === 'key' && !config.privateKey) {
            throw new Error('SSH密钥认证需要提供privateKey路径');
        }

        if (config.authMethod === 'password' && !config.password) {
            throw new Error('密码认证需要提供password');
        }

        if (config.authMethod === 'dynamic-token' && !config.dynamicTokenProvider && !config.totpSecret && !config.qrCodeImagePath) {
            throw new Error('动态令牌认证需要提供dynamicTokenProvider函数或totpSecret或者qrCodeImagePath');
        }
    }

    /**
     * 测试系统环境
     */
    static async testEnvironment(): Promise<{
        ssh2Supported: boolean;
        ssh2Version?: string;
        otplibSupported: boolean;
        recommendations: string[];
    }> {
        const result = {
            ssh2Supported: false,
            ssh2Version: undefined as string | undefined,
            otplibSupported: false,
            recommendations: [] as string[]
        };

        try {
            result.ssh2Supported = await SystemSFTPClient.checkSystemSupport();
            if (result.ssh2Supported) {
                result.ssh2Version = SystemSFTPClient.getSSH2Version();
            }
        } catch {
            result.recommendations.push('请安装SSH2模块: npm install ssh2');
        }

        try {
            require('otplib');
            result.otplibSupported = true;
        } catch {
            result.recommendations.push('请安装OTPLIB模块: npm install otplib');
        }

        if (!result.ssh2Supported || !result.otplibSupported) {
            result.recommendations.push('运行: npm install ssh2 otplib');
        }

        return result;
    }
}