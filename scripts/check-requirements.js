#!/usr/bin/env node

/**
 * 系统要求检查脚本
 * 检查代码同步桥接服务的系统要求和依赖
 */

const { execSync, spawn } = require('child_process');
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
    success: (msg) => console.log(`${colors.green}[✓]${colors.reset} ${msg}`),
    warning: (msg) => console.log(`${colors.yellow}[⚠]${colors.reset} ${msg}`),
    error: (msg) => console.log(`${colors.red}[✗]${colors.reset} ${msg}`)
};

// 系统要求检查器
class RequirementsChecker {
    constructor() {
        this.results = {
            passed: 0,
            failed: 0,
            warnings: 0,
            details: []
        };
    }

    // 执行命令并返回结果
    execCommand(command, options = {}) {
        try {
            const result = execSync(command, {
                encoding: 'utf8',
                stdio: 'pipe',
                ...options
            });
            return { success: true, output: result.trim() };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    // 检查命令是否存在
    checkCommand(command, name, required = true) {
        const result = this.execCommand(`${command} --version`);

        if (result.success) {
            log.success(`${name}: ${result.output.split('\n')[0]}`);
            this.results.passed++;
            this.results.details.push({
                name,
                status: 'passed',
                version: result.output.split('\n')[0]
            });
            return true;
        } else {
            if (required) {
                log.error(`${name}: 未安装或不可用`);
                this.results.failed++;
                this.results.details.push({
                    name,
                    status: 'failed',
                    error: '未安装或不可用'
                });
            } else {
                log.warning(`${name}: 未安装（可选）`);
                this.results.warnings++;
                this.results.details.push({
                    name,
                    status: 'warning',
                    error: '未安装（可选）'
                });
            }
            return false;
        }
    }

    // 检查Node.js版本
    checkNodeVersion() {
        log.info('检查Node.js版本...');

        const result = this.execCommand('node --version');
        if (!result.success) {
            log.error('Node.js: 未安装');
            this.results.failed++;
            this.results.details.push({
                name: 'Node.js',
                status: 'failed',
                error: '未安装'
            });
            return false;
        }

        const version = result.output.replace('v', '');
        const [major, minor] = version.split('.').map(Number);
        const requiredMajor = 18;

        if (major >= requiredMajor && major % 2 === 0) {
            log.success(`Node.js: v${version} (符合要求 >= v${requiredMajor}.0.0 LTS)`);
            this.results.passed++;
            this.results.details.push({
                name: 'Node.js',
                status: 'passed',
                version: `v${version}`
            });
            return true;
        } else if (major >= requiredMajor && major % 2 !== 0) {
            log.warning(`Node.js: v${version} (建议使用LTS版本，当前为非LTS版本)`);
            this.results.warnings++;
            this.results.details.push({
                name: 'Node.js',
                status: 'warning',
                version: `v${version}`,
                error: '建议使用LTS版本以获得更好的稳定性'
            });
            return true;
        } else {
            log.error(`Node.js: v${version} (版本过低，需要 >= v${requiredMajor}.0.0)`);
            this.results.failed++;
            this.results.details.push({
                name: 'Node.js',
                status: 'failed',
                version: `v${version}`,
                error: `版本过低，需要 >= v${requiredMajor}.0.0`
            });
            return false;
        }
    }

    // 检查Windows构建工具
    checkWindowsBuildTools() {
        if (os.platform() !== 'win32') {
            return true; // 非Windows系统跳过
        }

        log.info('检查Windows构建工具...');

        // 检查Visual Studio
        const vsResult = this.execCommand('where cl', { timeout: 5000 });
        if (vsResult.success) {
            log.success('Visual Studio构建工具: 已安装');
            this.results.passed++;
            return true;
        }

        // 检查windows-build-tools
        const buildToolsResult = this.execCommand('npm list -g windows-build-tools', { timeout: 5000 });
        if (buildToolsResult.success && !buildToolsResult.output.includes('empty')) {
            log.success('Windows构建工具: 已安装 (windows-build-tools)');
            this.results.passed++;
            return true;
        }

        log.error('Windows构建工具: 未安装');
        log.error('请安装Visual Studio Community或运行: npm install -g windows-build-tools');
        this.results.failed++;
        this.results.details.push({
            name: 'Windows构建工具',
            status: 'failed',
            error: '缺少Visual Studio构建工具，无法编译原生模块'
        });
        return false;
    }

    // 检查npm版本
    checkNpmVersion() {
        log.info('检查npm版本...');

        const result = this.execCommand('npm --version');
        if (!result.success) {
            log.error('npm: 未安装');
            this.results.failed++;
            this.results.details.push({
                name: 'npm',
                status: 'failed',
                error: '未安装'
            });
            return false;
        }

        const version = result.output;
        const [major] = version.split('.').map(Number);
        const requiredMajor = 8;

        if (major >= requiredMajor) {
            log.success(`npm: v${version} (符合要求 >= v${requiredMajor}.0.0)`);
            this.results.passed++;
            this.results.details.push({
                name: 'npm',
                status: 'passed',
                version: `v${version}`
            });
            return true;
        } else {
            log.warning(`npm: v${version} (建议升级到 >= v${requiredMajor}.0.0)`);
            this.results.warnings++;
            this.results.details.push({
                name: 'npm',
                status: 'warning',
                version: `v${version}`,
                error: `建议升级到 >= v${requiredMajor}.0.0`
            });
            return true;
        }
    }

    // 检查系统信息
    checkSystemInfo() {
        log.info('检查系统信息...');

        const platform = os.platform();
        const arch = os.arch();
        const release = os.release();
        const totalMem = Math.round(os.totalmem() / 1024 / 1024 / 1024 * 100) / 100;
        const freeMem = Math.round(os.freemem() / 1024 / 1024 / 1024 * 100) / 100;

        log.info(`操作系统: ${platform} ${arch} (${release})`);
        log.info(`总内存: ${totalMem}GB`);
        log.info(`可用内存: ${freeMem}GB`);

        // 检查内存要求
        if (totalMem >= 2) {
            log.success(`内存: ${totalMem}GB (符合要求 >= 2GB)`);
            this.results.passed++;
        } else {
            log.warning(`内存: ${totalMem}GB (建议 >= 2GB)`);
            this.results.warnings++;
        }

        // 检查可用内存
        if (freeMem >= 0.5) {
            log.success(`可用内存: ${freeMem}GB (符合要求 >= 0.5GB)`);
            this.results.passed++;
        } else {
            log.warning(`可用内存: ${freeMem}GB (建议 >= 0.5GB)`);
            this.results.warnings++;
        }

        this.results.details.push({
            name: '系统信息',
            status: 'info',
            details: {
                platform: `${platform} ${arch}`,
                release,
                totalMemory: `${totalMem}GB`,
                freeMemory: `${freeMem}GB`
            }
        });
    }

    // 检查磁盘空间
    checkDiskSpace() {
        log.info('检查磁盘空间...');

        try {
            const homeDir = os.homedir();
            const stats = fs.statSync(homeDir);

            // 在不同平台上检查磁盘空间
            let diskInfo;
            if (os.platform() === 'win32') {
                const result = this.execCommand(`dir /-c "${homeDir}"`);
                if (result.success) {
                    // Windows磁盘空间检查逻辑
                    log.info('磁盘空间检查（Windows）');
                }
            } else {
                const result = this.execCommand(`df -h "${homeDir}"`);
                if (result.success) {
                    const lines = result.output.split('\n');
                    if (lines.length > 1) {
                        const diskLine = lines[1];
                        const parts = diskLine.split(/\s+/);
                        const available = parts[3];
                        log.info(`可用磁盘空间: ${available}`);

                        // 简单检查是否有足够空间（至少1GB）
                        const availableNum = parseFloat(available);
                        const unit = available.slice(-1).toUpperCase();

                        let availableGB;
                        if (unit === 'G') {
                            availableGB = availableNum;
                        } else if (unit === 'M') {
                            availableGB = availableNum / 1024;
                        } else if (unit === 'T') {
                            availableGB = availableNum * 1024;
                        } else {
                            availableGB = 0;
                        }

                        if (availableGB >= 1) {
                            log.success(`磁盘空间: ${available} (符合要求 >= 1GB)`);
                            this.results.passed++;
                        } else {
                            log.warning(`磁盘空间: ${available} (建议 >= 1GB)`);
                            this.results.warnings++;
                        }
                    }
                }
            }
        } catch (error) {
            log.warning(`无法检查磁盘空间: ${error.message}`);
            this.results.warnings++;
        }
    }

    // 检查网络连接
    async checkNetworkConnectivity() {
        log.info('检查网络连接...');

        const testHosts = [
            'google.com',
            'github.com',
            'npmjs.org'
        ];

        for (const host of testHosts) {
            try {
                const result = this.execCommand(`ping -c 1 ${host}`, { timeout: 5000 });
                if (result.success) {
                    log.success(`网络连接: ${host} 可达`);
                } else {
                    log.warning(`网络连接: ${host} 不可达`);
                }
            } catch (error) {
                log.warning(`网络连接: 无法测试 ${host}`);
            }
        }
    }

    // 检查项目依赖
    checkProjectDependencies() {
        log.info('检查项目依赖...');

        const packageJsonPath = path.join(process.cwd(), 'package.json');
        if (!fs.existsSync(packageJsonPath)) {
            log.warning('package.json不存在，跳过项目依赖检查');
            return;
        }

        try {
            const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

            // 检查是否安装了依赖
            const nodeModulesPath = path.join(process.cwd(), 'node_modules');
            if (fs.existsSync(nodeModulesPath)) {
                log.success('项目依赖: node_modules存在');
                this.results.passed++;

                // 检查关键依赖
                const keyDependencies = [
                    'ssh2',
                    'simple-git',
                    'commander',
                    'typescript'
                ];

                for (const dep of keyDependencies) {
                    const depPath = path.join(nodeModulesPath, dep);
                    if (fs.existsSync(depPath)) {
                        log.success(`依赖: ${dep} 已安装`);
                    } else {
                        log.warning(`依赖: ${dep} 未安装`);
                    }
                }
            } else {
                log.warning('项目依赖: node_modules不存在，请运行 npm install');
                this.results.warnings++;
            }
        } catch (error) {
            log.error(`检查项目依赖失败: ${error.message}`);
            this.results.failed++;
        }
    }

    // 检查端口可用性
    checkPortAvailability() {
        log.info('检查常用端口可用性...');

        const ports = [22, 80, 443, 8080];

        for (const port of ports) {
            try {
                const result = this.execCommand(`netstat -an | grep :${port}`, { timeout: 2000 });
                if (result.success && result.output.includes(`:${port}`)) {
                    log.info(`端口 ${port}: 正在使用`);
                } else {
                    log.info(`端口 ${port}: 可用`);
                }
            } catch (error) {
                log.info(`端口 ${port}: 无法检查`);
            }
        }
    }

    // 生成安装建议
    generateInstallationSuggestions() {
        const suggestions = [];

        for (const detail of this.results.details) {
            if (detail.status === 'failed') {
                switch (detail.name) {
                    case 'Node.js':
                        if (detail.version && detail.version.includes('v19')) {
                            suggestions.push({
                                component: 'Node.js',
                                suggestion: '当前使用非LTS版本，建议安装Node.js 18.x LTS版本: https://nodejs.org'
                            });
                        } else {
                            suggestions.push({
                                component: 'Node.js',
                                suggestion: '请从 https://nodejs.org 下载并安装 Node.js 18.x LTS版本'
                            });
                        }
                        break;
                    case 'npm':
                        suggestions.push({
                            component: 'npm',
                            suggestion: 'npm通常随Node.js一起安装，请重新安装Node.js'
                        });
                        break;
                    case 'Git':
                        suggestions.push({
                            component: 'Git',
                            suggestion: '请从 https://git-scm.com 下载并安装Git'
                        });
                        break;
                    case 'Windows构建工具':
                        suggestions.push({
                            component: 'Windows构建工具',
                            suggestion: '请安装Visual Studio Community (https://visualstudio.microsoft.com/zh-hans/vs/community/) 并选择"使用C++的桌面开发"工作负载，或运行: npm install -g windows-build-tools'
                        });
                        break;
                }
            }
        }

        return suggestions;
    }

    // 生成系统报告
    generateReport() {
        console.log('\n' + '='.repeat(50));
        console.log('           系统要求检查报告');
        console.log('='.repeat(50));

        console.log(`\n检查结果:`);
        console.log(`  ✓ 通过: ${this.results.passed}`);
        console.log(`  ⚠ 警告: ${this.results.warnings}`);
        console.log(`  ✗ 失败: ${this.results.failed}`);

        if (this.results.failed > 0) {
            console.log(`\n${colors.red}系统要求检查失败${colors.reset}`);
            console.log('请解决以下问题后重试:');

            const suggestions = this.generateInstallationSuggestions();
            suggestions.forEach((suggestion, index) => {
                console.log(`  ${index + 1}. ${suggestion.component}: ${suggestion.suggestion}`);
            });
        } else if (this.results.warnings > 0) {
            console.log(`\n${colors.yellow}系统要求基本满足，但有一些建议${colors.reset}`);
            console.log('建议解决以下问题以获得更好的体验:');

            this.results.details
                .filter(detail => detail.status === 'warning')
                .forEach((detail, index) => {
                    console.log(`  ${index + 1}. ${detail.name}: ${detail.error || '需要注意'}`);
                });
        } else {
            console.log(`\n${colors.green}系统要求检查通过！${colors.reset}`);
            console.log('您的系统满足运行代码同步桥接服务的所有要求。');
        }

        console.log('\n下一步:');
        if (this.results.failed === 0) {
            console.log('  1. 运行部署脚本: ./scripts/deploy.sh (Linux/macOS) 或 .\\scripts\\deploy.bat (Windows)');
            console.log('  2. 配置SFTP服务器连接信息');
            console.log('  3. 测试连接并开始使用');
        } else {
            console.log('  1. 安装缺失的依赖');
            console.log('  2. 重新运行此检查脚本');
            console.log('  3. 运行部署脚本');
        }

        console.log('\n' + '='.repeat(50));

        return this.results.failed === 0;
    }

    // 运行所有检查
    async runAllChecks() {
        console.log('代码同步桥接服务 - 系统要求检查');
        console.log('='.repeat(50));

        // 基础要求检查
        this.checkNodeVersion();
        this.checkNpmVersion();
        this.checkCommand('git', 'Git', true);

        // Windows特定检查
        this.checkWindowsBuildTools();

        // 可选工具检查
        this.checkCommand('code', 'VSCode', false);
        this.checkCommand('ssh', 'SSH客户端', false);

        // 系统资源检查
        this.checkSystemInfo();
        this.checkDiskSpace();

        // 网络和项目检查
        await this.checkNetworkConnectivity();
        this.checkProjectDependencies();
        this.checkPortAvailability();

        return this.generateReport();
    }
}

// 主函数
async function main() {
    const checker = new RequirementsChecker();
    const success = await checker.runAllChecks();
    process.exit(success ? 0 : 1);
}

// 运行主函数
if (require.main === module) {
    main().catch(error => {
        console.error('检查过程中发生错误:', error);
        process.exit(1);
    });
}

module.exports = { RequirementsChecker };