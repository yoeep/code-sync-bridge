/**
 * 动态令牌认证示例
 * 演示如何使用不同的动态令牌提供器
 */

const { SystemSFTPClient, SFTPClientFactory } = require('../packages/shared/dist/sftp/SystemSFTPClient');
const { 
    ConsoleDynamicTokenProvider,
    EnvironmentDynamicTokenProvider,
    FileDynamicTokenProvider,
    HttpDynamicTokenProvider,
    CustomDynamicTokenProvider,
    DynamicTokenProviderFactory
} = require('../packages/shared/dist/sftp/DynamicTokenProvider');

/**
 * 示例1：控制台输入验证码
 */
async function example1_ConsoleInput() {
    console.log('=== 示例1：控制台输入验证码 ===');
    
    const config = {
        host: 'your-sftp-server.com',
        port: 22,
        username: 'your-username',
        authMethod: 'dynamic-token',
        dynamicTokenProvider: async () => {
            const provider = new ConsoleDynamicTokenProvider('请输入6位验证码: ');
            return await provider.getToken();
        },
        timeout: 30000
    };

    try {
        const client = await SFTPClientFactory.createClient(config);
        await client.connect();
        console.log('✅ 连接成功！');
        await client.disconnect();
    } catch (error) {
        console.error('❌ 连接失败:', error.message);
    }
}

/**
 * 示例2：环境变量验证码
 */
async function example2_EnvironmentVariable() {
    console.log('=== 示例2：环境变量验证码 ===');
    
    // 设置环境变量: set SFTP_DYNAMIC_TOKEN=123456
    const config = {
        host: 'your-sftp-server.com',
        port: 22,
        username: 'your-username',
        authMethod: 'dynamic-token',
        dynamicTokenProvider: async () => {
            const provider = new EnvironmentDynamicTokenProvider('SFTP_DYNAMIC_TOKEN');
            return await provider.getToken();
        },
        timeout: 30000
    };

    try {
        const client = await SFTPClientFactory.createClient(config);
        await client.connect();
        console.log('✅ 连接成功！');
        await client.disconnect();
    } catch (error) {
        console.error('❌ 连接失败:', error.message);
    }
}

/**
 * 示例3：文件验证码
 */
async function example3_FileToken() {
    console.log('=== 示例3：文件验证码 ===');
    
    const config = {
        host: 'your-sftp-server.com',
        port: 22,
        username: 'your-username',
        authMethod: 'dynamic-token',
        dynamicTokenProvider: async () => {
            const provider = new FileDynamicTokenProvider('./token.txt');
            return await provider.getToken();
        },
        timeout: 30000
    };

    try {
        const client = await SFTPClientFactory.createClient(config);
        await client.connect();
        console.log('✅ 连接成功！');
        await client.disconnect();
    } catch (error) {
        console.error('❌ 连接失败:', error.message);
    }
}

/**
 * 示例4：HTTP API验证码
 */
async function example4_HttpApi() {
    console.log('=== 示例4：HTTP API验证码 ===');
    
    const config = {
        host: 'your-sftp-server.com',
        port: 22,
        username: 'your-username',
        authMethod: 'dynamic-token',
        dynamicTokenProvider: async () => {
            const provider = new HttpDynamicTokenProvider(
                'https://api.company.com/get-token',
                { 'Authorization': 'Bearer your-api-key' }
            );
            return await provider.getToken();
        },
        timeout: 30000
    };

    try {
        const client = await SFTPClientFactory.createClient(config);
        await client.connect();
        console.log('✅ 连接成功！');
        await client.disconnect();
    } catch (error) {
        console.error('❌ 连接失败:', error.message);
    }
}

/**
 * 示例5：自定义验证码函数
 */
async function example5_CustomFunction() {
    console.log('=== 示例5：自定义验证码函数 ===');
    
    const config = {
        host: 'your-sftp-server.com',
        port: 22,
        username: 'your-username',
        authMethod: 'dynamic-token',
        dynamicTokenProvider: async () => {
            // 自定义逻辑：从数据库、缓存或其他来源获取验证码
            const customToken = await getTokenFromCustomSource();
            return customToken;
        },
        timeout: 30000
    };

    try {
        const client = await SFTPClientFactory.createClient(config);
        await client.connect();
        console.log('✅ 连接成功！');
        await client.disconnect();
    } catch (error) {
        console.error('❌ 连接失败:', error.message);
    }
}

/**
 * 自定义令牌获取函数示例
 */
async function getTokenFromCustomSource() {
    // 这里可以实现您的自定义逻辑
    // 例如：从数据库查询、调用内部API、读取硬件令牌等
    
    // 模拟异步操作
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // 返回6位数字验证码
    return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * 示例6：使用工厂方法
 */
async function example6_FactoryMethods() {
    console.log('=== 示例6：使用工厂方法 ===');
    
    // 使用工厂方法创建不同类型的令牌提供器
    const providers = {
        console: DynamicTokenProviderFactory.createConsoleProvider('输入验证码: '),
        env: DynamicTokenProviderFactory.createEnvironmentProvider('MY_TOKEN'),
        file: DynamicTokenProviderFactory.createFileProvider('./my-token.txt'),
        http: DynamicTokenProviderFactory.createHttpProvider('https://api.example.com/token'),
        custom: DynamicTokenProviderFactory.createCustomProvider(getTokenFromCustomSource)
    };

    console.log('可用的令牌提供器:', Object.keys(providers));
    
    // 选择一个提供器进行测试
    const selectedProvider = providers.custom;
    
    try {
        const token = await selectedProvider.getToken();
        console.log('✅ 获取到验证码:', token);
    } catch (error) {
        console.error('❌ 获取验证码失败:', error.message);
    }
}

/**
 * 主函数
 */
async function main() {
    const args = process.argv.slice(2);
    const exampleNumber = args[0] || '6';

    console.log('🚀 动态令牌认证示例\n');

    switch (exampleNumber) {
        case '1':
            await example1_ConsoleInput();
            break;
        case '2':
            await example2_EnvironmentVariable();
            break;
        case '3':
            await example3_FileToken();
            break;
        case '4':
            await example4_HttpApi();
            break;
        case '5':
            await example5_CustomFunction();
            break;
        case '6':
            await example6_FactoryMethods();
            break;
        default:
            console.log('用法: node examples/dynamic-token-auth.js [1-6]');
            console.log('1 - 控制台输入验证码');
            console.log('2 - 环境变量验证码');
            console.log('3 - 文件验证码');
            console.log('4 - HTTP API验证码');
            console.log('5 - 自定义验证码函数');
            console.log('6 - 工厂方法示例');
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
    example1_ConsoleInput,
    example2_EnvironmentVariable,
    example3_FileToken,
    example4_HttpApi,
    example5_CustomFunction,
    example6_FactoryMethods
};