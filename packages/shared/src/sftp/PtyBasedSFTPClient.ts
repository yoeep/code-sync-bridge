/**
 * 基于伪终端的SFTP客户端
 * 使用spawn + 环境变量方式实现自动密码输入
 * 避免node-pty等原生模块依赖
 */

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface PtyBasedSFTPConfig {
    host: string;
    port: number;
    username: string;
    password: string;
    dynamicTokenProvider?: () => Promise<string>;
    timeout?: number;
}

export class PtyBasedSFTPClient {
    private config: PtyBasedSFTPConfig;

    constructor(config: PtyBasedSFTPConfig) {
        this.config = {
            timeout: 30000,
            ...config
        };
    }

    /**
     * 使用sshpass方式连接（如果可用）
     */
    async connectWithSSHPass(): Promise<void> {
        try {
            // 检查sshpass是否可用
            const sshpassAvailable = await this.checkSSHPassAvailable();
            if (!sshpassAvailable) {
                throw new Error('sshpass不可用');
            }

            const commands = ['pwd'];
            const result = await this.executeSFTPWithSSHPass(commands);
            console.log('✅ sshpass连接成功:', result);
        } catch (error) {
            throw new Error(`sshpass连接失败: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * 使用expect脚本方式连接
     */
    async connectWithExpectScript(): Promise<void> {
        try {
            const expectAvailable = await this.checkExpectAvailable();
            if (!expectAvailable) {
                throw new Error('expect工具不可用');
            }

            const commands = ['pwd'];
            const result = await this.executeSFTPWithExpect(commands);
            console.log('✅ expect脚本连接成功:', result);
        } catch (error) {
            throw new Error(`expect脚本连接失败: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * 使用PowerShell expect风格脚本（Windows）
     */
    async connectWithPowerShellExpect(): Promise<void> {
        if (os.platform() !== 'win32') {
            throw new Error('PowerShell expect仅支持Windows');
        }

        try {
            const commands = ['pwd'];
            const result = await this.executeSFTPWithPowerShellExpect(commands);
            console.log('✅ PowerShell expect连接成功:', result);
        } catch (error) {
            throw new Error(`PowerShell expect连接失败: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * 智能连接 - 自动选择最佳方法
     */
    async connect(): Promise<void> {
        const methods = [
            { name: 'sshpass', method: () => this.connectWithSSHPass() },
            { name: 'expect', method: () => this.connectWithExpectScript() },
            { name: 'powershell', method: () => this.connectWithPowerShellExpect() }
        ];

        let lastError: Error | null = null;

        for (const { name, method } of methods) {
            try {
                console.log(`🔄 尝试使用 ${name} 方法连接...`);
                await method();
                console.log(`✅ ${name} 方法连接成功`);
                return;
            } catch (error) {
                console.log(`❌ ${name} 方法失败: ${error instanceof Error ? error.message : String(error)}`);
                lastError = error instanceof Error ? error : new Error(String(error));
            }
        }

        throw new Error(`所有连接方法都失败了。最后错误: ${lastError?.message}`);
    }

    /**
     * 检查sshpass是否可用
     */
    private async checkSSHPassAvailable(): Promise<boolean> {
        return new Promise((resolve) => {
            const process = spawn('sshpass', ['-V'], { stdio: 'pipe' });
            process.on('close', (code) => {
                resolve(code === 0);
            });
            process.on('error', () => {
                resolve(false);
            });
        });
    }

    /**
     * 检查expect是否可用
     */
    private async checkExpectAvailable(): Promise<boolean> {
        return new Promise((resolve) => {
            const process = spawn('expect', ['-v'], { stdio: 'pipe' });
            process.on('close', (code) => {
                resolve(code === 0);
            });
            process.on('error', () => {
                resolve(false);
            });
        });
    }

    /**
     * 使用sshpass执行SFTP命令
     */
    private async executeSFTPWithSSHPass(commands: string[]): Promise<string> {
        return new Promise((resolve, reject) => {
            // 创建临时批处理文件
            const batchFile = this.createTempBatchFile(commands);

            const args = [
                '-p', this.config.password,
                'sftp',
                '-b', batchFile,
                '-P', this.config.port.toString(),
                '-o', 'StrictHostKeyChecking=no',
                `${this.config.username}@${this.config.host}`
            ];

            const process = spawn('sshpass', args, {
                stdio: ['pipe', 'pipe', 'pipe']
            });

            let stdout = '';
            let stderr = '';

            process.stdout?.on('data', (data) => {
                stdout += data.toString();
            });

            process.stderr?.on('data', (data) => {
                stderr += data.toString();
            });

            process.on('close', (code) => {
                // 清理临时文件
                this.cleanupTempFile(batchFile);

                if (code === 0) {
                    resolve(stdout);
                } else {
                    reject(new Error(`sshpass执行失败 (退出码: ${code}): ${stderr}`));
                }
            });

            process.on('error', (error) => {
                this.cleanupTempFile(batchFile);
                reject(error);
            });

            // 超时处理
            setTimeout(() => {
                process.kill();
                this.cleanupTempFile(batchFile);
                reject(new Error('sshpass执行超时'));
            }, this.config.timeout);
        });
    }

    /**
     * 使用expect脚本执行SFTP命令
     */
    private async executeSFTPWithExpect(commands: string[]): Promise<string> {
        return new Promise((resolve, reject) => {
            void (async () => {
            // 获取动态验证码
            let verificationCode = '';
            if (this.config.dynamicTokenProvider) {
                try {
                    verificationCode = await this.config.dynamicTokenProvider();
                } catch (error) {
                    reject(new Error(`获取验证码失败: ${error instanceof Error ? error.message : String(error)}`));
                    return;
                }
            }

            // 创建expect脚本
            const expectScript = this.createExpectScript(commands, verificationCode);
            const scriptFile = path.join(os.tmpdir(), `sftp-expect-${Date.now()}.exp`);

            try {
                fs.writeFileSync(scriptFile, expectScript);
                fs.chmodSync(scriptFile, 0o755);

                const process = spawn('expect', [scriptFile], {
                    stdio: ['pipe', 'pipe', 'pipe']
                });

                let stdout = '';
                let stderr = '';

                process.stdout?.on('data', (data) => {
                    stdout += data.toString();
                });

                process.stderr?.on('data', (data) => {
                    stderr += data.toString();
                });

                process.on('close', (code) => {
                    this.cleanupTempFile(scriptFile);

                    if (code === 0) {
                        resolve(stdout);
                    } else {
                        reject(new Error(`expect脚本执行失败 (退出码: ${code}): ${stderr}`));
                    }
                });

                process.on('error', (error) => {
                    this.cleanupTempFile(scriptFile);
                    reject(error);
                });

                // 超时处理
                setTimeout(() => {
                    process.kill();
                    this.cleanupTempFile(scriptFile);
                    reject(new Error('expect脚本执行超时'));
                }, this.config.timeout);

            } catch (error) {
                this.cleanupTempFile(scriptFile);
                reject(error);
            }
            })().catch(reject);
        });
    }

    /**
     * 使用PowerShell expect风格脚本
     */
    private async executeSFTPWithPowerShellExpect(commands: string[]): Promise<string> {
        return new Promise((resolve, reject) => {
            void (async () => {
            // 获取动态验证码
            let verificationCode = '';
            if (this.config.dynamicTokenProvider) {
                try {
                    verificationCode = await this.config.dynamicTokenProvider();
                } catch (error) {
                    reject(new Error(`获取验证码失败: ${error instanceof Error ? error.message : String(error)}`));
                    return;
                }
            }

            // 创建PowerShell脚本
            const psScript = this.createPowerShellExpectScript(commands, verificationCode);
            const scriptFile = path.join(os.tmpdir(), `sftp-ps-${Date.now()}.ps1`);

            try {
                fs.writeFileSync(scriptFile, psScript);

                const process = spawn('powershell', [
                    '-ExecutionPolicy', 'Bypass',
                    '-File', scriptFile
                ], {
                    stdio: ['pipe', 'pipe', 'pipe']
                });

                let stdout = '';
                let stderr = '';

                process.stdout?.on('data', (data) => {
                    stdout += data.toString();
                });

                process.stderr?.on('data', (data) => {
                    stderr += data.toString();
                });

                process.on('close', (code) => {
                    this.cleanupTempFile(scriptFile);

                    if (code === 0) {
                        resolve(stdout);
                    } else {
                        reject(new Error(`PowerShell脚本执行失败 (退出码: ${code}): ${stderr}`));
                    }
                });

                process.on('error', (error) => {
                    this.cleanupTempFile(scriptFile);
                    reject(error);
                });

                // 超时处理
                setTimeout(() => {
                    process.kill();
                    this.cleanupTempFile(scriptFile);
                    reject(new Error('PowerShell脚本执行超时'));
                }, this.config.timeout);

            } catch (error) {
                this.cleanupTempFile(scriptFile);
                reject(error);
            }
            })().catch(reject);
        });
    }

    /**
     * 创建临时批处理文件
     */
    private createTempBatchFile(commands: string[]): string {
        const batchFile = path.join(os.tmpdir(), `sftp-batch-${Date.now()}.txt`);
        const content = commands.join('\n') + '\nquit\n';
        fs.writeFileSync(batchFile, content);
        return batchFile;
    }

    /**
     * 创建expect脚本
     */
    private createExpectScript(commands: string[], verificationCode: string): string {
        const commandsStr = commands.map(cmd => `send "${cmd}\\r"`).join('\n                ');
        
        return `#!/usr/bin/expect -f
set timeout ${Math.floor(this.config.timeout! / 1000)}
set host "${this.config.host}"
set port "${this.config.port}"
set username "${this.config.username}"
set password "${this.config.password}"
set verification_code "${verificationCode}"

spawn sftp -P $port $username@$host

expect {
    "Password:" {
        send "$password\\r"
        expect {
            "Verification code:" {
                send "$verification_code\\r"
                expect "sftp>" {
                    ${commandsStr}
                    send "quit\\r"
                }
            }
            "sftp>" {
                ${commandsStr}
                send "quit\\r"
            }
            timeout {
                puts "Password authentication timeout"
                exit 1
            }
        }
    }
    timeout {
        puts "Connection timeout"
        exit 1
    }
}

expect eof
`;
    }

    /**
     * 创建PowerShell expect风格脚本
     */
    private createPowerShellExpectScript(commands: string[], verificationCode: string): string {
        const commandsStr = commands.map(cmd => `"${cmd}"`).join(', ');
        
        return `
# PowerShell expect风格SFTP自动化脚本
$host = "${this.config.host}"
$port = "${this.config.port}"
$username = "${this.config.username}"
$password = "${this.config.password}"
$verificationCode = "${verificationCode}"
$commands = @(${commandsStr}, "quit")

try {
    # 启动SFTP进程
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = "sftp"
    $psi.Arguments = "-P $port $username@$host"
    $psi.UseShellExecute = $false
    $psi.RedirectStandardInput = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.CreateNoWindow = $true

    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $psi
    $process.Start()

    # 发送密码
    Start-Sleep -Milliseconds 1000
    $process.StandardInput.WriteLine($password)

    # 如果有验证码，发送验证码
    if ($verificationCode) {
        Start-Sleep -Milliseconds 1000
        $process.StandardInput.WriteLine($verificationCode)
    }

    # 等待连接建立
    Start-Sleep -Milliseconds 2000

    # 发送命令
    foreach ($cmd in $commands) {
        $process.StandardInput.WriteLine($cmd)
        Start-Sleep -Milliseconds 500
    }

    # 等待完成
    $process.WaitForExit(${this.config.timeout})

    # 输出结果
    $output = $process.StandardOutput.ReadToEnd()
    $error = $process.StandardError.ReadToEnd()

    if ($process.ExitCode -eq 0) {
        Write-Output $output
    } else {
        Write-Error "SFTP执行失败: $error"
        exit $process.ExitCode
    }

} catch {
    Write-Error "PowerShell SFTP脚本执行失败: $_"
    exit 1
}
`;
    }

    /**
     * 清理临时文件
     */
    private cleanupTempFile(filePath: string): void {
        try {
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        } catch {
            // 忽略清理错误
        }
    }

    /**
     * 列出目录内容
     */
    async listDirectory(_remotePath: string): Promise<string[]> {
        // 这里需要实现具体的目录列表逻辑
        // 可以复用现有的SystemSFTPClient的实现
        throw new Error('listDirectory方法需要实现');
    }

    /**
     * 上传文件
     */
    async uploadFile(_localPath: string, _remotePath: string): Promise<void> {
        // 这里需要实现具体的文件上传逻辑
        throw new Error('uploadFile方法需要实现');
    }

    /**
     * 下载文件
     */
    async downloadFile(_remotePath: string, _localPath: string): Promise<void> {
        // 这里需要实现具体的文件下载逻辑
        throw new Error('downloadFile方法需要实现');
    }
}
