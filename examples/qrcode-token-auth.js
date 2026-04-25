/**
 * 二维码动态令牌认证示例
 * 演示如何使用二维码图片获取动态令牌
 */

const { SystemSFTPClient, SFTPClientFactory } = require('../packages/shared/dist/sftp/SystemSFTPClient');
const { 
    QRCodeDynamicTokenProvider,
    ScreenshotQRCodeProvider,
    DynamicTokenProviderFactory
} = require('../packages/shared/dist/sftp/DynamicTokenProvider');

/**
 * 示例1：从二维码图片文件获取验证码
 */
async function example1_QRCodeFromFile() {
    console.log('=== 示例1：从二维码图片文件获取验证码 ===');
    
    const config = {
        host: 'your-sftp-server.com',
        port: 22,
        username: 'your-username',
        authMethod: 'dynamic-token',
        password: 'your-password-for-test-only',
        autoReconnect: true,
        dynamicTokenProvider: async () => {
            const provider = new QRCodeDynamicTokenProvider('./qr-code.png');
            return await provider.getToken();
        },
        timeout: 30000
    };

    try {
        const client = await SFTPClientFactory.createClient(config);
        await client.connect();
        console.log('✅ 连接成功！');
        
        // 测试文件操作
        const files = await client.listDirectory('/');
        console.log(`目录文件数量: ${files.length}`);
        
        await client.disconnect();
    } catch (error) {
        console.error('❌ 连接失败:', error.message);
    }
}

/**
 * 示例2：监控二维码图片变化
 */
async function example2_WatchQRCode() {
    console.log('=== 示例2：监控二维码图片变化 ===');
    
    const config = {
        host: 'your-sftp-server.com',
        port: 22,
        username: 'your-username',
        authMethod: 'dynamic-token',
        autoReconnect: true,
        dynamicTokenProvider: async () => {
            // 启用监控模式，每5秒检查一次图片更新
            const provider = new QRCodeDynamicTokenProvider('./qr-code.png', true, 5000);
            return await provider.watchForToken();
        },
        timeout: 60000
    };

    try {
        console.log('开始监控二维码图片变化...');
        console.log('请更新 ./qr-code.png 文件');
        
        const client = await SFTPClientFactory.createClient(config);
        await client.connect();
        console.log('✅ 连接成功！');
        
        await client.disconnect();
    } catch (error) {
        console.error('❌ 连接失败:', error.message);
    }
}

/**
 * 示例3：屏幕截图识别二维码
 */
async function example3_ScreenshotQRCode() {
    console.log('=== 示例3：屏幕截图识别二维码 ===');
    
    const config = {
        host: 'your-sftp-server.com',
        port: 22,
        username: 'your-username',
        authMethod: 'dynamic-token',
        autoReconnect: true,
        dynamicTokenProvider: async () => {
            const provider = new ScreenshotQRCodeProvider();
            return await provider.getToken();
        },
        timeout: 30000
    };

    try {
        console.log('准备截取屏幕并识别二维码...');
        console.log('请确保屏幕上显示有二维码');
        
        const client = await SFTPClientFactory.createClient(config);
        await client.connect();
        console.log('✅ 连接成功！');
        
        await client.disconnect();
    } catch (error) {
        console.error('❌ 连接失败:', error.message);
    }
}

/**
 * 示例4：指定区域截图识别二维码
 */
async function example4_RegionScreenshotQRCode() {
    console.log('=== 示例4：指定区域截图识别二维码 ===');
    
    const config = {
        host: 'your-sftp-server.com',
        port: 22,
        username: 'your-username',
        authMethod: 'dynamic-token',
        autoReconnect: true,
        dynamicTokenProvider: async () => {
            // 只截取屏幕右上角 300x300 区域
            const region = { x: 1000, y: 100, width: 300, height: 300 };
            const provider = new ScreenshotQRCodeProvider('./temp_qr.png', region);
            return await provider.getToken();
        },
        timeout: 30000
    };

    try {
        console.log('截取屏幕指定区域并识别二维码...');
        
        const client = await SFTPClientFactory.createClient(config);
        await client.connect();
        console.log('✅ 连接成功！');
        
        await client.disconnect();
    } catch (error) {
        console.error('❌ 连接失败:', error.message);
    }
}

/**
 * 示例5：自动重连测试
 */
async function example5_AutoReconnectTest() {
    console.log('=== 示例5：自动重连测试 ===');
    
    const config = {
        host: 'your-sftp-server.com',
        port: 22,
        username: 'your-username',
        authMethod: 'dynamic-token',
        autoReconnect: true,
        reconnectInterval: 10000, // 10秒重连间隔
        maxReconnectAttempts: 3,
        dynamicTokenProvider: async () => {
            console.log('🔄 获取新的验证码...');
            const provider = new QRCodeDynamicTokenProvider('./qr-code.png');
            return await provider.getToken();
        },
        timeout: 30000
    };

    try {
        const client = await SFTPClientFactory.createClient(config);
        await client.connect();
        console.log('✅ 初始连接成功！');
        
        // 模拟长时间运行，测试自动重连
        console.log('开始长时间运行测试...');
        console.log('如果连接断开，系统会自动重连并重新获取验证码');
        
        for (let i = 0; i < 10; i++) {
            try {
                await new Promise(resolve => setTimeout(resolve, 30000)); // 等待30秒
                
                // 测试连接是否正常
                const files = await client.listDirectory('/');
                console.log(`✅ 第${i + 1}次检查，连接正常，文件数量: ${files.length}`);
            } catch (error) {
                console.log(`⚠️ 第${i + 1}次检查失败: ${error.message}`);
            }
        }
        
        await client.disconnect();
        console.log('测试完成');
    } catch (error) {
        console.error('❌ 测试失败:', error.message);
    }
}

/**
 * 示例6：使用工厂方法创建二维码提供器
 */
async function example6_FactoryMethods() {
    console.log('=== 示例6：使用工厂方法创建二维码提供器 ===');
    
    // 使用工厂方法创建不同类型的二维码提供器
    const providers = {
        qrFile: DynamicTokenProviderFactory.createQRCodeProvider('./qr-code.png'),
        qrWatch: DynamicTokenProviderFactory.createQRCodeProvider('./qr-code.png', true, 3000),
        screenshot: DynamicTokenProviderFactory.createScreenshotQRProvider(),
        regionScreenshot: DynamicTokenProviderFactory.createScreenshotQRProvider('./temp.png', { x: 100, y: 100, width: 200, height: 200 })
    };

    console.log('可用的二维码提供器:', Object.keys(providers));
    
    // 测试文件二维码提供器
    try {
        console.log('测试文件二维码提供器...');
        const token = await providers.qrFile.getToken();
        console.log('✅ 获取到验证码:', token);
    } catch (error) {
        console.error('❌ 获取验证码失败:', error.message);
    }
}

/**
 * 创建测试二维码图片
 */
async function createTestQRCode() {
    console.log('=== 创建测试二维码图片 ===');
    
    try {
        const QRCode = await import('qrcode');
        
        // 生成包含验证码的二维码
        const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
        const qrData = JSON.stringify({
            code: verificationCode,
            timestamp: Date.now(),
            type: 'sftp_verification'
        });
        
        await QRCode.toFile('./qr-code.png', qrData, {
            width: 300,
            margin: 2
        });
        
        console.log('✅ 测试二维码已生成: ./qr-code.png');
        console.log('验证码:', verificationCode);
        console.log('二维码数据:', qrData);
    } catch (error) {
        console.error('❌ 生成二维码失败:', error.message);
        console.log('请安装qrcode库: npm install qrcode');
    }
}

/**
 * 主函数
 */
async function main() {
    const args = process.argv.slice(2);
    const exampleNumber = args[0] || 'help';

    console.log('🔐 二维码动态令牌认证示例\n');

    switch (exampleNumber) {
        case '1':
            await example1_QRCodeFromFile();
            break;
        case '2':
            await example2_WatchQRCode();
            break;
        case '3':
            await example3_ScreenshotQRCode();
            break;
        case '4':
            await example4_RegionScreenshotQRCode();
            break;
        case '5':
            await example5_AutoReconnectTest();
            break;
        case '6':
            await example6_FactoryMethods();
            break;
        case 'create-qr':
            await createTestQRCode();
            break;
        default:
            console.log('用法: node examples/qrcode-token-auth.js [选项]');
            console.log('');
            console.log('选项:');
            console.log('  1           - 从二维码图片文件获取验证码');
            console.log('  2           - 监控二维码图片变化');
            console.log('  3           - 屏幕截图识别二维码');
            console.log('  4           - 指定区域截图识别二维码');
            console.log('  5           - 自动重连测试');
            console.log('  6           - 工厂方法示例');
            console.log('  create-qr   - 创建测试二维码图片');
            console.log('');
            console.log('依赖库:');
            console.log('  npm install jimp jsqr qrcode screenshot-desktop');
            console.log('');
            console.log('支持的二维码格式:');
            console.log('  - 纯数字: 123456');
            console.log('  - JSON: {"code": "123456"}');
            console.log('  - URL参数: https://example.com?code=123456');
            console.log('  - 键值对: CODE:123456');
    }
}

// 运行示例
if (require.main === module) {
    main().catch(error => {
        console.error('示例执行失败:', error.message);
        process.exit(1);
    });
}

module.exports = {
    example1_QRCodeFromFile,
    example2_WatchQRCode,
    example3_ScreenshotQRCode,
    example4_RegionScreenshotQRCode,
    example5_AutoReconnectTest,
    example6_FactoryMethods,
    createTestQRCode
};
