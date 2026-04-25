/**
 * 动态令牌提供器
 * 支持多种动态令牌获取方式
 */

import { createInterface } from 'readline';
const { log } = require('../utils/logger');

/**
 * 动态令牌提供器接口
 */
export interface DynamicTokenProvider {
    /**
     * 获取动态令牌
     */
    getToken(): Promise<string>;
}

/**
 * 控制台输入令牌提供器
 * 通过控制台提示用户输入验证码
 */
export class ConsoleDynamicTokenProvider implements DynamicTokenProvider {
    private prompt: string;

    constructor(prompt: string = '请输入验证码: ') {
        this.prompt = prompt;
    }

    async getToken(): Promise<string> {
        return new Promise((resolve, reject) => {
            const rl = createInterface({
                input: process.stdin,
                output: process.stdout
            });

            rl.question(this.prompt, (token) => {
                rl.close();
                
                if (!token || token.trim().length === 0) {
                    reject(new Error('验证码不能为空'));
                } else {
                    resolve(token.trim());
                }
            });

            // 设置超时
            setTimeout(() => {
                rl.close();
                reject(new Error('输入验证码超时'));
            }, 60000); // 60秒超时
        });
    }
}

/**
 * 环境变量令牌提供器
 * 从环境变量获取动态令牌
 */
export class EnvironmentDynamicTokenProvider implements DynamicTokenProvider {
    private envVarName: string;

    constructor(envVarName: string = 'SFTP_DYNAMIC_TOKEN') {
        this.envVarName = envVarName;
    }

    async getToken(): Promise<string> {
        const token = process.env[this.envVarName];
        
        if (!token || token.trim().length === 0) {
            throw new Error(`环境变量 ${this.envVarName} 未设置或为空`);
        }

        return token.trim();
    }
}

/**
 * 文件令牌提供器
 * 从文件读取动态令牌
 */
export class FileDynamicTokenProvider implements DynamicTokenProvider {
    private filePath: string;

    constructor(filePath: string) {
        this.filePath = filePath;
    }

    async getToken(): Promise<string> {
        try {
            const fs = await import('fs');
            const token = fs.readFileSync(this.filePath, 'utf8').trim();
            
            if (!token || token.length === 0) {
                throw new Error(`令牌文件 ${this.filePath} 为空`);
            }

            return token;
        } catch (error) {
            throw new Error(`读取令牌文件失败: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
}

/**
 * HTTP API令牌提供器
 * 通过HTTP API获取动态令牌
 */
export class HttpDynamicTokenProvider implements DynamicTokenProvider {
    private apiUrl: string;
    private headers: Record<string, string>;

    constructor(apiUrl: string, headers: Record<string, string> = {}) {
        this.apiUrl = apiUrl;
        this.headers = {
            'Content-Type': 'application/json',
            ...headers
        };
    }

    async getToken(): Promise<string> {
        try {
            const https = await import('https');
            const http = await import('http');
            const url = await import('url');
            
            const parsedUrl = new url.URL(this.apiUrl);
            const client = parsedUrl.protocol === 'https:' ? https : http;

            return new Promise((resolve, reject) => {
                const req = client.request({
                    hostname: parsedUrl.hostname,
                    port: parsedUrl.port,
                    path: parsedUrl.pathname + parsedUrl.search,
                    method: 'GET',
                    headers: this.headers
                }, (res) => {
                    let data = '';
                    
                    res.on('data', (chunk) => {
                        data += chunk;
                    });
                    
                    res.on('end', () => {
                        try {
                            if (res.statusCode !== 200) {
                                reject(new Error(`HTTP请求失败: ${res.statusCode} ${res.statusMessage}`));
                                return;
                            }

                            const response = JSON.parse(data);
                            const token = response.token || response.code || response.verification_code;
                            
                            if (!token) {
                                reject(new Error('API响应中未找到令牌字段'));
                                return;
                            }

                            resolve(token.toString().trim());
                        } catch (error) {
                            reject(new Error(`解析API响应失败: ${error instanceof Error ? error.message : String(error)}`));
                        }
                    });
                });

                req.on('error', (error) => {
                    reject(new Error(`HTTP请求错误: ${error.message}`));
                });

                req.setTimeout(10000, () => {
                    req.destroy();
                    reject(new Error('HTTP请求超时'));
                });

                req.end();
            });
        } catch (error) {
            throw new Error(`HTTP令牌提供器错误: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
}

/**
 * 二维码令牌提供器
 * 通过识别二维码图片获取动态令牌
 */
export class QRCodeDynamicTokenProvider implements DynamicTokenProvider {
    private imagePath: string;
    private watchMode: boolean;
    private watchInterval: number;

    constructor(imagePath: string, watchMode: boolean = false, watchInterval: number = 5000) {
        this.imagePath = imagePath;
        this.watchMode = watchMode;
        this.watchInterval = watchInterval;
    }

    async getToken(): Promise<string> {
        try {
            // 检查图片文件是否存在
            const fs = await import('fs');
            if (!fs.existsSync(this.imagePath)) {
                throw new Error(`二维码图片文件不存在: ${this.imagePath}`);
            }

            // 使用jimp读取图片并进行二维码识别
            const jimp = await this.loadJimp();
            const jsQR = await this.loadJsQR();

            const image = await jimp.Jimp.read(this.imagePath);
            const imageData = {
                data: new Uint8ClampedArray(image.bitmap.data),
                width: image.bitmap.width,
                height: image.bitmap.height
            };

            const code = jsQR(imageData.data, imageData.width, imageData.height);
            
            if (!code) {
                throw new Error('无法识别二维码，请确保图片清晰且包含有效的二维码');
            }

            // 从二维码数据中提取验证码
            const token = await this.extractTokenFromQRData(code.data);
            
            if (!token || token.trim().length === 0) {
                throw new Error('二维码中未找到有效的验证码');
            }

            return token.trim();
        } catch (error) {
            throw new Error(`二维码识别失败: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * 监控模式：持续监控二维码图片变化
     */
    async watchForToken(): Promise<string> {
        if (!this.watchMode) {
            return this.getToken();
        }

        return new Promise((resolve, reject) => {
            let lastModified = 0;
            
            const checkImage = async () => {
                try {
                    const fs = await import('fs');
                    const stats = fs.statSync(this.imagePath);
                    
                    // 检查文件是否有更新
                    if (stats.mtime.getTime() > lastModified) {
                        lastModified = stats.mtime.getTime();
                        
                        try {
                            const token = await this.getToken();
                            resolve(token);
                            return;
                        } catch (error) {
                            log.error(`二维码识别失败，继续监控: ${error instanceof Error ? error.message : String(error)}`);
                        }
                    }
                    
                    // 继续监控
                    setTimeout(checkImage, this.watchInterval);
                } catch (error) {
                    reject(new Error(`监控二维码图片失败: ${error instanceof Error ? error.message : String(error)}`));
                }
            };

            checkImage();
            
            // 设置总超时时间
            setTimeout(() => {
                reject(new Error('二维码监控超时'));
            }, 300000); // 5分钟超时
        });
    }

    /**
     * 从二维码数据中提取验证码
     */
    private async extractTokenFromQRData(qrData: string): Promise<string> {
        // 支持多种二维码格式
        
        // 格式1: 纯数字验证码
        const numericMatch = qrData.match(/^\d{4,8}$/);
        if (numericMatch) {
            return numericMatch[0];
        }

        // 格式2: JSON格式 {"code": "123456"}
        try {
            const jsonData = JSON.parse(qrData);
            if (jsonData.code || jsonData.token || jsonData.verification_code) {
                return jsonData.code || jsonData.token || jsonData.verification_code;
            }
        } catch {
            // 不是JSON格式，继续其他匹配
        }

        // 格式3: TOTP格式 otpauth://totp/...?secret=...
        if (qrData.startsWith('otpauth://totp/')) {
            try {
                const url = new URL(qrData);
                const secret = url.searchParams.get('secret');
                const issuer = url.searchParams.get('issuer');
                const algorithm = url.searchParams.get('algorithm') || 'SHA1';
                const digits = parseInt(url.searchParams.get('digits') || '6');
                const period = parseInt(url.searchParams.get('period') || '30');
                
                if (!secret) {
                    throw new Error('TOTP URI缺少secret参数');
                }
                
                log.info('🔍 TOTP参数解析:', {
                    issuer: issuer ? decodeURIComponent(issuer) : '未指定',
                    algorithm,
                    digits,
                    period,
                    secret: secret.substring(0, 4) + '***'
                });
                
                // 使用otplib生成TOTP验证码
                const totp = await this.generateTOTPWithOtplib(secret, algorithm, digits, period);
                log.info('✅ TOTP验证码生成成功:', totp);
                return totp;
            } catch (error) {
                log.error('❌ TOTP处理失败:', error instanceof Error ? error.message : String(error));
                throw new Error(`TOTP处理失败: ${error instanceof Error ? error.message : String(error)}`);
            }
        }

        // 格式4: URL参数格式 https://example.com?code=123456
        const urlMatch = qrData.match(/[?&](?:code|token|verification_code)=([^&]+)/i);
        if (urlMatch) {
            return decodeURIComponent(urlMatch[1]);
        }

        // 格式5: 键值对格式 CODE:123456
        const kvMatch = qrData.match(/(?:CODE|TOKEN|VERIFICATION_CODE)[:=]\s*([^\s]+)/i);
        if (kvMatch) {
            return kvMatch[1];
        }

        // 格式6: 提取所有数字（作为最后的尝试）
        const digitsMatch = qrData.match(/\d{4,8}/);
       

        log.info('🔍 提取所有数字:', digitsMatch);
        if (digitsMatch) {
            return digitsMatch[0];
        }

        throw new Error(`无法从二维码数据中提取验证码: ${qrData}`);
    }

    /**
     * 动态加载jimp库
     */
    private async loadJimp(): Promise<any> {
        try {
            // 使用require来避免TypeScript编译时检查
            return require('jimp');
        } catch (error) {
            throw new Error('请安装jimp库: npm install jimp');
        }
    }

    /**
     * 动态加载jsqr库
     */
    private async loadJsQR(): Promise<any> {
        try {
            // 使用require来避免TypeScript编译时检查
            const jsQR = require('jsqr');
            return jsQR.default || jsQR;
        } catch (error) {
            throw new Error('请安装jsqr库: npm install jsqr');
        }
    }

    /**
     * 使用otplib生成TOTP验证码
     */
    private async generateTOTPWithOtplib(
        secret: string, 
        algorithm: string = 'SHA1', 
        digits: number = 6, 
        period: number = 30
    ): Promise<string> {
        try {
            // 动态加载otplib库
            const otplib = await this.loadOtplib();
            
            // 验证参数
            if (!secret || secret.trim().length === 0) {
                throw new Error('TOTP密钥不能为空');
            }
            
            // 验证Base32格式
            if (!/^[A-Z2-7]+=*$/i.test(secret)) {
                throw new Error('无效的Base32密钥格式');
            }
            
            // 支持的算法
            const supportedAlgorithms = ['SHA1', 'SHA256', 'SHA512'];
            const normalizedAlgorithm = algorithm.toUpperCase();
            if (!supportedAlgorithms.includes(normalizedAlgorithm)) {
                log.warn(`不支持的算法 ${algorithm}，使用默认的SHA1`);
                algorithm = 'SHA1';
            }
            
            // 验证digits和period
            if (digits < 4 || digits > 10) {
                log.warn(`无效的digits值 ${digits}，使用默认的6`);
                digits = 6;
            }
            
            if (period < 1 || period > 300) {
                log.warn(`无效的period值 ${period}，使用默认的30`);
                period = 30;
            }
            
            // 生成TOTP验证码
            const token = otplib.authenticator.generate(secret);
            
            // 验证生成的验证码
            if (!token || token.length !== digits) {
                throw new Error('生成的TOTP验证码格式无效');
            }
            
            log.info('🔢 TOTP验证码生成成功');
            return token;
        } catch (error) {
            throw new Error(`TOTP验证码生成失败: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * 动态加载otplib库
     */
    private async loadOtplib(): Promise<any> {
        try {
            // 使用require来避免TypeScript编译时检查
            const otplib = require('otplib');
            
            // 验证库是否正确加载
            if (!otplib || !otplib.authenticator) {
                throw new Error('otplib库加载失败或版本不兼容');
            }
            
            return otplib;
        } catch (error) {
            if (error instanceof Error && error.message.includes('Cannot find module')) {
                throw new Error('请安装otplib库: npm install otplib');
            }
            throw error;
        }
    }
}

/**
 * 屏幕截图二维码令牌提供器
 * 自动截图并识别屏幕上的二维码
 */
export class ScreenshotQRCodeProvider implements DynamicTokenProvider {
    private screenshotPath: string;
    private region?: { x: number; y: number; width: number; height: number };

    constructor(screenshotPath: string = './temp_qr_screenshot.png', region?: { x: number; y: number; width: number; height: number }) {
        this.screenshotPath = screenshotPath;
        this.region = region;
    }

    async getToken(): Promise<string> {
        try {
            // 截取屏幕
            await this.takeScreenshot();
            
            // 使用二维码提供器识别
            const qrProvider = new QRCodeDynamicTokenProvider(this.screenshotPath);
            const token = await qrProvider.getToken();
            
            // 清理临时文件
            await this.cleanup();
            
            return token;
        } catch (error) {
            await this.cleanup();
            throw new Error(`屏幕截图二维码识别失败: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * 截取屏幕
     */
    private async takeScreenshot(): Promise<void> {
        try {
            const screenshot = await this.loadScreenshot();
            
            if (this.region) {
                // 截取指定区域
                await screenshot.captureRegion(
                    this.screenshotPath,
                    this.region.x,
                    this.region.y,
                    this.region.width,
                    this.region.height
                );
            } else {
                // 截取全屏
                await screenshot.capture(this.screenshotPath);
            }
        } catch (error) {
            throw new Error(`屏幕截图失败: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * 动态加载screenshot库
     */
    private async loadScreenshot(): Promise<any> {
        try {
            // 使用require来避免TypeScript编译时检查
            return require('screenshot-desktop');
        } catch (error) {
            throw new Error('请安装screenshot-desktop库: npm install screenshot-desktop');
        }
    }

    /**
     * 清理临时文件
     */
    private async cleanup(): Promise<void> {
        try {
            const fs = await import('fs');
            if (fs.existsSync(this.screenshotPath)) {
                fs.unlinkSync(this.screenshotPath);
            }
        } catch {
            // 忽略清理错误
        }
    }
}

/**
 * 自定义函数令牌提供器
 * 使用用户提供的自定义函数获取令牌
 */
export class CustomDynamicTokenProvider implements DynamicTokenProvider {
    private tokenFunction: () => Promise<string>;

    constructor(tokenFunction: () => Promise<string>) {
        this.tokenFunction = tokenFunction;
    }

    async getToken(): Promise<string> {
        try {
            const token = await this.tokenFunction();
            
            if (!token || token.trim().length === 0) {
                throw new Error('自定义函数返回的令牌为空');
            }

            return token.trim();
        } catch (error) {
            throw new Error(`自定义令牌函数执行失败: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
}

/**
 * 令牌提供器工厂
 */
export class DynamicTokenProviderFactory {
    /**
     * 创建控制台输入提供器
     */
    static createConsoleProvider(prompt?: string): DynamicTokenProvider {
        return new ConsoleDynamicTokenProvider(prompt);
    }

    /**
     * 创建环境变量提供器
     */
    static createEnvironmentProvider(envVarName?: string): DynamicTokenProvider {
        return new EnvironmentDynamicTokenProvider(envVarName);
    }

    /**
     * 创建文件提供器
     */
    static createFileProvider(filePath: string): DynamicTokenProvider {
        return new FileDynamicTokenProvider(filePath);
    }

    /**
     * 创建HTTP API提供器
     */
    static createHttpProvider(apiUrl: string, headers?: Record<string, string>): DynamicTokenProvider {
        return new HttpDynamicTokenProvider(apiUrl, headers);
    }

    /**
     * 创建二维码图片提供器
     */
    static createQRCodeProvider(imagePath: string, watchMode?: boolean, watchInterval?: number): DynamicTokenProvider {
        return new QRCodeDynamicTokenProvider(imagePath, watchMode, watchInterval);
    }

    /**
     * 创建屏幕截图二维码提供器
     */
    static createScreenshotQRProvider(screenshotPath?: string, region?: { x: number; y: number; width: number; height: number }): DynamicTokenProvider {
        return new ScreenshotQRCodeProvider(screenshotPath, region);
    }

    /**
     * 创建自定义函数提供器
     */
    static createCustomProvider(tokenFunction: () => Promise<string>): DynamicTokenProvider {
        return new CustomDynamicTokenProvider(tokenFunction);
    }
}
