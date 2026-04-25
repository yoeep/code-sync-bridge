/**
 * 二维码生成工具
 * 用于生成包含验证码的测试二维码
 */

const fs = require('fs');
const path = require('path');

/**
 * 生成验证码二维码
 */
async function generateVerificationQR(code, outputPath, format = 'json') {
    try {
        const QRCode = await import('qrcode');
        
        let qrData;
        
        switch (format.toLowerCase()) {
            case 'plain':
                qrData = code;
                break;
            case 'json':
                qrData = JSON.stringify({
                    code: code,
                    timestamp: Date.now(),
                    type: 'sftp_verification'
                });
                break;
            case 'url':
                qrData = `https://auth.example.com/verify?code=${code}&timestamp=${Date.now()}`;
                break;
            case 'kv':
                qrData = `CODE:${code}`;
                break;
            default:
                qrData = code;
        }
        
        await QRCode.toFile(outputPath, qrData, {
            width: 300,
            margin: 2,
            color: {
                dark: '#000000',
                light: '#FFFFFF'
            }
        });
        
        console.log('✅ 二维码已生成:', outputPath);
        console.log('验证码:', code);
        console.log('数据格式:', format);
        console.log('二维码数据:', qrData);
        
        return { code, qrData, outputPath };
    } catch (error) {
        console.error('❌ 生成二维码失败:', error.message);
        if (error.message.includes('Cannot resolve module')) {
            console.log('请安装qrcode库: npm install qrcode');
        }
        throw error;
    }
}

/**
 * 生成随机验证码
 */
function generateRandomCode(length = 6) {
    const digits = '0123456789';
    let code = '';
    
    for (let i = 0; i < length; i++) {
        code += digits.charAt(Math.floor(Math.random() * digits.length));
    }
    
    return code;
}

/**
 * 批量生成二维码
 */
async function generateBatchQRCodes(count = 5, outputDir = './qr-codes') {
    try {
        // 确保输出目录存在
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }
        
        const results = [];
        const formats = ['plain', 'json', 'url', 'kv'];
        
        for (let i = 0; i < count; i++) {
            const code = generateRandomCode();
            const format = formats[i % formats.length];
            const outputPath = path.join(outputDir, `qr-${i + 1}-${format}.png`);
            
            const result = await generateVerificationQR(code, outputPath, format);
            results.push(result);
            
            // 添加延迟避免时间戳重复
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        console.log(`\n✅ 批量生成完成，共生成 ${count} 个二维码`);
        console.log('输出目录:', outputDir);
        
        return results;
    } catch (error) {
        console.error('❌ 批量生成失败:', error.message);
        throw error;
    }
}

/**
 * 测试二维码识别
 */
async function testQRCodeRecognition(imagePath) {
    try {
        const { QRCodeDynamicTokenProvider } = require('../packages/shared/dist/sftp/DynamicTokenProvider');
        
        console.log('🔍 测试二维码识别...');
        console.log('图片路径:', imagePath);
        
        const provider = new QRCodeDynamicTokenProvider(imagePath);
        const token = await provider.getToken();
        
        console.log('✅ 识别成功！');
        console.log('提取的验证码:', token);
        
        return token;
    } catch (error) {
        console.error('❌ 识别失败:', error.message);
        throw error;
    }
}

/**
 * 创建动态更新的二维码
 */
async function createDynamicQRCode(outputPath, updateInterval = 30000) {
    console.log('🔄 启动动态二维码生成器...');
    console.log('输出路径:', outputPath);
    console.log('更新间隔:', updateInterval / 1000, '秒');
    
    let updateCount = 0;
    
    const updateQR = async () => {
        try {
            const code = generateRandomCode();
            await generateVerificationQR(code, outputPath, 'json');
            
            updateCount++;
            console.log(`🔄 第${updateCount}次更新 - 新验证码: ${code}`);
            
            // 安排下次更新
            setTimeout(updateQR, updateInterval);
        } catch (error) {
            console.error('❌ 更新二维码失败:', error.message);
        }
    };
    
    // 立即生成第一个二维码
    await updateQR();
    
    console.log('动态二维码生成器已启动，按 Ctrl+C 停止');
}

/**
 * 主函数
 */
async function main() {
    const args = process.argv.slice(2);
    const command = args[0] || 'help';

    console.log('🔐 二维码生成工具\n');

    try {
        switch (command) {
            case 'generate':
                const code = args[1] || generateRandomCode();
                const outputPath = args[2] || './qr-code.png';
                const format = args[3] || 'json';
                await generateVerificationQR(code, outputPath, format);
                break;
                
            case 'batch':
                const count = parseInt(args[1]) || 5;
                const outputDir = args[2] || './qr-codes';
                await generateBatchQRCodes(count, outputDir);
                break;
                
            case 'test':
                const imagePath = args[1] || './qr-code.png';
                await testQRCodeRecognition(imagePath);
                break;
                
            case 'dynamic':
                const dynamicPath = args[1] || './dynamic-qr.png';
                const interval = parseInt(args[2]) || 30000;
                await createDynamicQRCode(dynamicPath, interval);
                break;
                
            case 'random':
                const length = parseInt(args[1]) || 6;
                const randomCode = generateRandomCode(length);
                console.log('随机验证码:', randomCode);
                break;
                
            default:
                console.log('用法: node tools/qr-code-generator.js <命令> [参数]');
                console.log('');
                console.log('命令:');
                console.log('  generate <验证码> [输出路径] [格式]  - 生成单个二维码');
                console.log('  batch [数量] [输出目录]            - 批量生成二维码');
                console.log('  test <图片路径>                   - 测试二维码识别');
                console.log('  dynamic [输出路径] [更新间隔]      - 创建动态更新的二维码');
                console.log('  random [长度]                     - 生成随机验证码');
                console.log('');
                console.log('格式选项:');
                console.log('  plain  - 纯数字格式');
                console.log('  json   - JSON格式 (默认)');
                console.log('  url    - URL参数格式');
                console.log('  kv     - 键值对格式');
                console.log('');
                console.log('示例:');
                console.log('  node tools/qr-code-generator.js generate 123456');
                console.log('  node tools/qr-code-generator.js generate 123456 ./my-qr.png json');
                console.log('  node tools/qr-code-generator.js batch 10 ./test-qrs');
                console.log('  node tools/qr-code-generator.js test ./qr-code.png');
                console.log('  node tools/qr-code-generator.js dynamic ./live-qr.png 10000');
                console.log('  node tools/qr-code-generator.js random 8');
                console.log('');
                console.log('依赖库:');
                console.log('  npm install qrcode jimp jsqr');
        }
    } catch (error) {
        console.error('执行失败:', error.message);
        process.exit(1);
    }
}

// 运行工具
if (require.main === module) {
    main().catch(error => {
        console.error('工具执行失败:', error.message);
        process.exit(1);
    });
}

module.exports = {
    generateVerificationQR,
    generateRandomCode,
    generateBatchQRCodes,
    testQRCodeRecognition,
    createDynamicQRCode
};