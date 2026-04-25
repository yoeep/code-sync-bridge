#!/usr/bin/env node

/**
 * 配置文件验证脚本
 * 验证代码同步桥接服务的配置文件格式和内容
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// 颜色定义
const colors = {
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    reset: '\x1b[0m'
};

// 日志函数
const log = {
    info: (msg) => console.log(`${colors.blue}[INFO]${colors.reset} ${msg}`),
    success: (msg) => console.log(`${colors.green}[SUCCESS]${colors.reset} ${msg}`),
    warning: (msg) => console.log(`${colors.yellow}[WARNING]${colors.reset} ${msg}`),
    error: (msg) => console.log(`${colors.red}[ERROR]${colors.reset} ${msg}`)
};

// 配置文件模式定义
const configSchemas = {
    intranet: {
        required: ['sftp', 'sync', 'repository', 'logging'],
        sftp: {
            required: ['host', 'port', 'username', 'authMethod'],
            optional: ['timeout', 'retryAttempts', 'keepAliveInterval']
        },
        sync: {
            required: ['monitorInterval'],
            optional: ['maxFileSize', 'excludePatterns']
        },
        repository: {
            required: ['tempDir'],
            optional: ['maxConcurrentStreams']
        },
        logging: {
            required: ['level', 'file'],
            optional: ['maxFileSize', 'maxFiles']
        }
    },
    extranet: {
        required: ['sftp', 'local', 'sync', 'logging'],
        sftp: {
            required: ['host', 'port', 'username', 'authMethod'],
            optional: ['timeout', 'retryAttempts', 'keepAliveInterval']
        },
        local: {
            required: ['workspaceDir'],
            optional: ['maxFileSize', 'excludePatterns']
        },
        sync: {
            required: [],
            optional: ['autoCommit', 'commitInterval', 'maxConcurrentStreams']
        },
        logging: {
            required: ['level', 'file'],
            optional: ['maxFileSize', 'maxFiles']
        }
    }
};

// 验证函数
class ConfigValidator {
    constructor() {
        this.errors = [];
        this.warnings = [];
    }

    // 验证JSON格式
    validateJSON(filePath) {
        try {
            const content = fs.readFileSync(filePath, 'utf8');
            return JSON.parse(content);
        } catch (error) {
            this.errors.push(`JSON格式错误: ${error.message}`);
            return null;
        }
    }

    // 验证必需字段
    validateRequiredFields(config, schema, prefix = '') {
        for (const field of schema.required) {
            if (!(field in config)) {
                this.errors.push(`缺少必需字段: ${prefix}${field}`);
            } else if (typeof config[field] === 'object' && config[field] !== null) {
                // 递归验证嵌套对象
                if (schema[field]) {
                    this.validateRequiredFields(config[field], schema[field], `${prefix}${field}.`);
                }
            }
        }
    }

    // 验证字段类型
    validateFieldTypes(config) {
        // 验证端口号
        if (config.sftp && config.sftp.port) {
            const port = config.sftp.port;
            if (!Number.isInteger(port) || port < 1 || port > 65535) {
                this.errors.push('SFTP端口必须是1-65535之间的整数');
            }
        }

        // 验证超时时间
        if (config.sftp && config.sftp.timeout) {
            const timeout = config.sftp.timeout;
            if (!Number.isInteger(timeout) || timeout < 1000) {
                this.warnings.push('SFTP超时时间建议设置为至少1000毫秒');
            }
        }

        // 验证监控间隔
        if (config.sync && config.sync.monitorInterval) {
            const interval = config.sync.monitorInterval;
            if (!Number.isInteger(interval) || interval < 60) {
                this.warnings.push('监控间隔建议设置为至少60秒');
            }
        }

        // 验证日志级别
        if (config.logging && config.logging.level) {
            const validLevels = ['error', 'warn', 'info', 'debug'];
            if (!validLevels.includes(config.logging.level)) {
                this.errors.push(`无效的日志级别: ${config.logging.level}，有效值: ${validLevels.join(', ')}`);
            }
        }
    }

    // 验证路径
    validatePaths(config) {
        // 验证临时目录
        if (config.repository && config.repository.tempDir) {
            const tempDir = config.repository.tempDir.replace('~', os.homedir());
            try {
                if (!fs.existsSync(path.dirname(tempDir))) {
                    this.warnings.push(`临时目录的父目录不存在: ${path.dirname(tempDir)}`);
                }
            } catch (error) {
                this.warnings.push(`无法验证临时目录路径: ${error.message}`);
            }
        }

        // 验证工作空间目录
        if (config.local && config.local.workspaceDir) {
            const workspaceDir = config.local.workspaceDir.replace('~', os.homedir());
            try {
                if (!fs.existsSync(path.dirname(workspaceDir))) {
                    this.warnings.push(`工作空间目录的父目录不存在: ${path.dirname(workspaceDir)}`);
                }
            } catch (error) {
                this.warnings.push(`无法验证工作空间目录路径: ${error.message}`);
            }
        }

        // 验证日志文件路径
        if (config.logging && config.logging.file) {
            const logFile = config.logging.file.replace('~', os.homedir());
            try {
                if (!fs.existsSync(path.dirname(logFile))) {
                    this.warnings.push(`日志文件目录不存在: ${path.dirname(logFile)}`);
                }
            } catch (error) {
                this.warnings.push(`无法验证日志文件路径: ${error.message}`);
            }
        }
    }

    // 验证网络配置
    validateNetworkConfig(config) {
        if (config.sftp) {
            // 验证主机名
            if (config.sftp.host) {
                const host = config.sftp.host;
                if (host.includes(' ') || host.length === 0) {
                    this.errors.push('SFTP主机名不能为空或包含空格');
                }
            }

            // 验证认证方法
            if (config.sftp.authMethod) {
                const validMethods = ['password', 'key', 'dynamic-token'];
                if (!validMethods.includes(config.sftp.authMethod)) {
                    this.errors.push(`无效的认证方法: ${config.sftp.authMethod}，有效值: ${validMethods.join(', ')}`);
                }
            }

            // 验证重试次数
            if (config.sftp.retryAttempts !== undefined) {
                const retries = config.sftp.retryAttempts;
                if (!Number.isInteger(retries) || retries < 0 || retries > 10) {
                    this.warnings.push('重试次数建议设置为0-10之间的整数');
                }
            }
        }
    }

    // 验证性能配置
    validatePerformanceConfig(config) {
        // 验证最大文件大小
        if (config.sync && config.sync.maxFileSize) {
            const sizeStr = config.sync.maxFileSize;
            if (typeof sizeStr === 'string') {
                const match = sizeStr.match(/^(\d+)(MB|GB|KB)?$/i);
                if (!match) {
                    this.errors.push(`无效的文件大小格式: ${sizeStr}，示例: 100MB, 1GB`);
                }
            }
        }

        // 验证并发流数量
        if (config.repository && config.repository.maxConcurrentStreams) {
            const streams = config.repository.maxConcurrentStreams;
            if (!Number.isInteger(streams) || streams < 1 || streams > 20) {
                this.warnings.push('最大并发流数量建议设置为1-20之间');
            }
        }

        // 验证排除模式
        if (config.sync && config.sync.excludePatterns) {
            if (!Array.isArray(config.sync.excludePatterns)) {
                this.errors.push('excludePatterns必须是数组格式');
            } else {
                config.sync.excludePatterns.forEach((pattern, index) => {
                    if (typeof pattern !== 'string') {
                        this.errors.push(`excludePatterns[${index}]必须是字符串`);
                    }
                });
            }
        }
    }

    // 验证单个配置文件
    validateConfig(filePath, type) {
        log.info(`验证${type}配置文件: ${filePath}`);

        if (!fs.existsSync(filePath)) {
            this.errors.push(`配置文件不存在: ${filePath}`);
            return false;
        }

        const config = this.validateJSON(filePath);
        if (!config) {
            return false;
        }

        const schema = configSchemas[type];
        if (!schema) {
            this.errors.push(`未知的配置类型: ${type}`);
            return false;
        }

        // 执行各种验证
        this.validateRequiredFields(config, schema);
        this.validateFieldTypes(config);
        this.validatePaths(config);
        this.validateNetworkConfig(config);
        this.validatePerformanceConfig(config);

        return this.errors.length === 0;
    }

    // 生成验证报告
    generateReport() {
        console.log('\n=== 配置验证报告 ===\n');

        if (this.errors.length > 0) {
            log.error(`发现 ${this.errors.length} 个错误:`);
            this.errors.forEach((error, index) => {
                console.log(`  ${index + 1}. ${error}`);
            });
            console.log();
        }

        if (this.warnings.length > 0) {
            log.warning(`发现 ${this.warnings.length} 个警告:`);
            this.warnings.forEach((warning, index) => {
                console.log(`  ${index + 1}. ${warning}`);
            });
            console.log();
        }

        if (this.errors.length === 0 && this.warnings.length === 0) {
            log.success('配置验证通过，未发现问题');
        } else if (this.errors.length === 0) {
            log.success('配置验证通过，但有一些建议优化的地方');
        } else {
            log.error('配置验证失败，请修复错误后重试');
        }

        return this.errors.length === 0;
    }
}

// 主函数
function main() {
    const args = process.argv.slice(2);
    
    if (args.length === 0) {
        console.log('用法: node validate-config.js [配置文件路径] [配置类型]');
        console.log('');
        console.log('配置类型:');
        console.log('  intranet  - 内网客户端配置');
        console.log('  extranet  - 外网客户端配置');
        console.log('');
        console.log('示例:');
        console.log('  node validate-config.js ~/.code-sync-bridge/config/intranet-config.json intranet');
        console.log('  node validate-config.js ~/.code-sync-bridge/config/extranet-config.json extranet');
        console.log('');
        console.log('如果不指定参数，将自动验证默认位置的配置文件');
        
        // 自动验证默认配置
        const homeDir = os.homedir();
        const configDir = path.join(homeDir, '.code-sync-bridge', 'config');
        const configs = [
            { file: path.join(configDir, 'intranet-config.json'), type: 'intranet' },
            { file: path.join(configDir, 'extranet-config.json'), type: 'extranet' }
        ];
        
        console.log('\n自动验证默认配置文件...\n');
        
        const validator = new ConfigValidator();
        let allValid = true;
        
        for (const config of configs) {
            if (fs.existsSync(config.file)) {
                const isValid = validator.validateConfig(config.file, config.type);
                allValid = allValid && isValid;
            } else {
                log.warning(`配置文件不存在: ${config.file}`);
            }
        }
        
        const success = validator.generateReport();
        process.exit(success ? 0 : 1);
        
    } else if (args.length === 2) {
        const [configFile, configType] = args;
        const validator = new ConfigValidator();
        
        validator.validateConfig(configFile, configType);
        const success = validator.generateReport();
        process.exit(success ? 0 : 1);
        
    } else {
        console.error('参数错误，请查看使用说明');
        process.exit(1);
    }
}

// 运行主函数
if (require.main === module) {
    main();
}

module.exports = { ConfigValidator, configSchemas };