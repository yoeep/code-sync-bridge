/**
 * Windows自动化SFTP客户端
 * 使用Windows特有的技术实现密码自动输入
 * 无需SSH密钥，适用于受限的SFTP服务器环境
 */

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface WindowsAutoSFTPConfig {
    host: string;
    port: number;
    username: string;
    password: string;
    dynamicTokenProvider?: () => Promise<string>;
    timeout?: number;
}

export class WindowsAutoSFTPClient {
    private config: WindowsAutoSFTPConfig;

    constructor(config: WindowsAutoSFTPConfig) {
        this.config = {
            timeout: 30000,
            ...config
        };
    }

    /**
     * 使用Windows SendKeys自动化
     */
    async connectWithSendKeys(): Promise<void> {
        if (os.platform() !== 'win32') {
            throw new Error('SendKeys方法仅支持Windows');
        }

        try {
            const result = await this.executeSFTPWithSendKeys(['pwd', 'ls']);
            console.log('✅ SendKeys自动化成功:', result);
        } catch (error) {
            throw new Error(`SendKeys自动化失败: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * 使用Windows COM自动化
     */
    async connectWithCOMAutomation(): Promise<void> {
        if (os.platform() !== 'win32') {
            throw new Error('COM自动化仅支持Windows');
        }

        try {
            const result = await this.executeSFTPWithCOM(['pwd', 'ls']);
            console.log('✅ COM自动化成功:', result);
        } catch (error) {
            throw new Error(`COM自动化失败: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * 使用PowerShell UI自动化
     */
    async connectWithUIAutomation(): Promise<void> {
        if (os.platform() !== 'win32') {
            throw new Error('UI自动化仅支持Windows');
        }

        try {
            const result = await this.executeSFTPWithUIAutomation(['pwd', 'ls']);
            console.log('✅ UI自动化成功:', result);
        } catch (error) {
            throw new Error(`UI自动化失败: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * 智能连接 - 尝试所有Windows方法
     */
    async connect(): Promise<void> {
        if (os.platform() !== 'win32') {
            throw new Error('此客户端仅支持Windows环境');
        }

        const methods = [
            { name: 'UI自动化', method: () => this.connectWithUIAutomation() },
            { name: 'SendKeys', method: () => this.connectWithSendKeys() },
            { name: 'COM自动化', method: () => this.connectWithCOMAutomation() }
        ];

        let lastError: Error | null = null;

        for (const { name, method } of methods) {
            try {
                console.log(`🔄 尝试使用 ${name} 方法...`);
                await method();
                console.log(`✅ ${name} 方法成功`);
                return;
            } catch (error) {
                console.log(`❌ ${name} 方法失败: ${error instanceof Error ? error.message : String(error)}`);
                lastError = error instanceof Error ? error : new Error(String(error));
            }
        }

        throw new Error(`所有Windows自动化方法都失败了。最后错误: ${lastError?.message}`);
    }

    /**
     * 使用SendKeys实现自动输入
     */
    private async executeSFTPWithSendKeys(commands: string[]): Promise<string> {
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

            // 创建PowerShell SendKeys脚本
            const psScript = this.createSendKeysScript(commands, verificationCode);
            const scriptFile = path.join(os.tmpdir(), `sftp-sendkeys-${Date.now()}.ps1`);

            try {
                fs.writeFileSync(scriptFile, psScript);

                const process = spawn('powershell', [
                    '-ExecutionPolicy', 'Bypass',
                    '-WindowStyle', 'Hidden',
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
                        reject(new Error(`SendKeys脚本执行失败 (退出码: ${code}): ${stderr}`));
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
                    reject(new Error('SendKeys脚本执行超时'));
                }, this.config.timeout);

            } catch (error) {
                this.cleanupTempFile(scriptFile);
                reject(error);
            }
            })().catch(reject);
        });
    }

    /**
     * 使用COM自动化
     */
    private async executeSFTPWithCOM(commands: string[]): Promise<string> {
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

            // 创建COM自动化脚本
            const psScript = this.createCOMScript(commands, verificationCode);
            const scriptFile = path.join(os.tmpdir(), `sftp-com-${Date.now()}.ps1`);

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
                        reject(new Error(`COM脚本执行失败 (退出码: ${code}): ${stderr}`));
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
                    reject(new Error('COM脚本执行超时'));
                }, this.config.timeout);

            } catch (error) {
                this.cleanupTempFile(scriptFile);
                reject(error);
            }
            })().catch(reject);
        });
    }

    /**
     * 使用UI自动化
     */
    private async executeSFTPWithUIAutomation(commands: string[]): Promise<string> {
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

            // 创建UI自动化脚本
            const psScript = this.createUIAutomationScript(commands, verificationCode);
            const scriptFile = path.join(os.tmpdir(), `sftp-ui-${Date.now()}.ps1`);

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
                        reject(new Error(`UI自动化脚本执行失败 (退出码: ${code}): ${stderr}`));
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
                    reject(new Error('UI自动化脚本执行超时'));
                }, this.config.timeout);

            } catch (error) {
                this.cleanupTempFile(scriptFile);
                reject(error);
            }
            })().catch(reject);
        });
    }

    /**
     * 创建SendKeys脚本
     */
    private createSendKeysScript(commands: string[], verificationCode: string): string {
        const commandsStr = commands.map(cmd => `"${cmd}"`).join(', ');
        
        return `
# PowerShell SendKeys自动化脚本
Add-Type -AssemblyName System.Windows.Forms

$host = "${this.config.host}"
$port = "${this.config.port}"
$username = "${this.config.username}"
$password = "${this.config.password}"
$verificationCode = "${verificationCode}"
$commands = @(${commandsStr}, "quit")

try {
    Write-Host "启动SFTP进程..."
    
    # 启动SFTP进程
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = "sftp"
    $psi.Arguments = "-P $port $username@$host"
    $psi.UseShellExecute = $true
    $psi.CreateNoWindow = $false
    
    $process = [System.Diagnostics.Process]::Start($psi)
    
    # 等待窗口出现
    Start-Sleep -Seconds 3
    
    # 查找SFTP窗口
    $sftpWindow = Get-Process | Where-Object { $_.ProcessName -eq "sftp" -and $_.Id -eq $process.Id }
    
    if ($sftpWindow) {
        Write-Host "找到SFTP窗口，发送密码..."
        
        # 激活窗口
        [Microsoft.VisualBasic.Interaction]::AppActivate($process.Id)
        Start-Sleep -Milliseconds 500
        
        # 发送密码
        [System.Windows.Forms.SendKeys]::SendWait($password)
        [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
        
        Start-Sleep -Seconds 2
        
        # 如果需要验证码
        if ($verificationCode) {
            Write-Host "发送验证码..."
            [System.Windows.Forms.SendKeys]::SendWait($verificationCode)
            [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
            Start-Sleep -Seconds 2
        }
        
        # 发送命令
        foreach ($cmd in $commands) {
            Write-Host "发送命令: $cmd"
            [System.Windows.Forms.SendKeys]::SendWait($cmd)
            [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
            Start-Sleep -Milliseconds 1000
        }
        
        Write-Host "SendKeys自动化完成"
        
    } else {
        throw "无法找到SFTP窗口"
    }
    
} catch {
    Write-Error "SendKeys自动化失败: $_"
    exit 1
}
`;
    }

    /**
     * 创建COM自动化脚本
     */
    private createCOMScript(commands: string[], verificationCode: string): string {
        const commandsStr = commands.map(cmd => `"${cmd}"`).join(', ');
        
        return `
# PowerShell COM自动化脚本
$host = "${this.config.host}"
$port = "${this.config.port}"
$username = "${this.config.username}"
$password = "${this.config.password}"
$verificationCode = "${verificationCode}"
$commands = @(${commandsStr}, "quit")

try {
    Write-Host "使用COM自动化..."
    
    # 创建WScript.Shell对象
    $shell = New-Object -ComObject WScript.Shell
    
    # 启动SFTP
    $process = Start-Process -FilePath "sftp" -ArgumentList "-P $port $username@$host" -PassThru
    
    # 等待进程启动
    Start-Sleep -Seconds 3
    
    # 激活SFTP窗口
    $shell.AppActivate($process.Id)
    Start-Sleep -Milliseconds 500
    
    # 发送密码
    Write-Host "发送密码..."
    $shell.SendKeys($password)
    $shell.SendKeys("{ENTER}")
    
    Start-Sleep -Seconds 2
    
    # 如果需要验证码
    if ($verificationCode) {
        Write-Host "发送验证码..."
        $shell.SendKeys($verificationCode)
        $shell.SendKeys("{ENTER}")
        Start-Sleep -Seconds 2
    }
    
    # 发送命令
    foreach ($cmd in $commands) {
        Write-Host "发送命令: $cmd"
        $shell.SendKeys($cmd)
        $shell.SendKeys("{ENTER}")
        Start-Sleep -Milliseconds 1000
    }
    
    Write-Host "COM自动化完成"
    
} catch {
    Write-Error "COM自动化失败: $_"
    exit 1
}
`;
    }

    /**
     * 创建UI自动化脚本
     */
    private createUIAutomationScript(commands: string[], verificationCode: string): string {
        const commandsStr = commands.map(cmd => `"${cmd}"`).join(', ');
        
        return `
# PowerShell UI自动化脚本
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$host = "${this.config.host}"
$port = "${this.config.port}"
$username = "${this.config.username}"
$password = "${this.config.password}"
$verificationCode = "${verificationCode}"
$commands = @(${commandsStr}, "quit")

try {
    Write-Host "使用UI自动化..."
    
    # 启动SFTP进程
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = "cmd"
    $psi.Arguments = "/c sftp -P $port $username@$host"
    $psi.UseShellExecute = $true
    $psi.CreateNoWindow = $false
    
    $process = [System.Diagnostics.Process]::Start($psi)
    
    # 等待窗口出现
    Start-Sleep -Seconds 3
    
    # 获取UI自动化根元素
    $automation = [System.Windows.Automation.AutomationElement]::RootElement
    
    # 查找命令提示符窗口
    $condition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $process.Id)
    $cmdWindow = $automation.FindFirst([System.Windows.Automation.TreeScope]::Children, $condition)
    
    if ($cmdWindow) {
        Write-Host "找到命令窗口，设置焦点..."
        $cmdWindow.SetFocus()
        
        # 使用SendKeys发送输入
        Add-Type -AssemblyName System.Windows.Forms
        
        Start-Sleep -Milliseconds 500
        
        # 发送密码
        Write-Host "发送密码..."
        [System.Windows.Forms.SendKeys]::SendWait($password)
        [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
        
        Start-Sleep -Seconds 2
        
        # 如果需要验证码
        if ($verificationCode) {
            Write-Host "发送验证码..."
            [System.Windows.Forms.SendKeys]::SendWait($verificationCode)
            [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
            Start-Sleep -Seconds 2
        }
        
        # 发送命令
        foreach ($cmd in $commands) {
            Write-Host "发送命令: $cmd"
            [System.Windows.Forms.SendKeys]::SendWait($cmd)
            [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
            Start-Sleep -Milliseconds 1000
        }
        
        Write-Host "UI自动化完成"
        
    } else {
        throw "无法找到命令窗口"
    }
    
} catch {
    Write-Error "UI自动化失败: $_"
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
}
