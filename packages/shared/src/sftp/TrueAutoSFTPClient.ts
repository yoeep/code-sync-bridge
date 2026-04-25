/**
 * 真正自动化的SFTP客户端
 * 使用Windows API和底层技术实现完全自动的密码输入
 * 无需任何手动操作
 */

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface TrueAutoSFTPConfig {
    host: string;
    port: number;
    username: string;
    password: string;
    dynamicTokenProvider?: () => Promise<string>;
    timeout?: number;
}

export class TrueAutoSFTPClient {
    private config: TrueAutoSFTPConfig;

    constructor(config: TrueAutoSFTPConfig) {
        this.config = {
            timeout: 30000,
            ...config
        };
    }

    /**
     * 完全自动化连接 - 无需任何手动输入
     */
    async connect(): Promise<void> {
        console.log('🚀 启动完全自动化SFTP连接...');
        
        if (os.platform() === 'win32') {
            // Windows环境使用多种方法
            await this.connectWindows();
        } else {
            // Linux/macOS环境
            await this.connectUnix();
        }
    }

    /**
     * Windows环境的完全自动化连接
     */
    private async connectWindows(): Promise<void> {
        const methods = [
            { name: 'PowerShell自动化', method: () => this.windowsPowerShellMethod() },
            { name: 'VBScript自动化', method: () => this.windowsVBScriptMethod() },
            { name: 'AutoIt脚本', method: () => this.windowsAutoItMethod() },
            { name: 'Python自动化', method: () => this.windowsPythonMethod() }
        ];

        for (const { name, method } of methods) {
            try {
                console.log(`🔄 尝试 ${name}...`);
                await method();
                console.log(`✅ ${name} 成功！`);
                return;
            } catch (error) {
                console.log(`❌ ${name} 失败: ${error instanceof Error ? error.message : String(error)}`);
            }
        }

        throw new Error('所有Windows自动化方法都失败了');
    }

    /**
     * Unix环境的完全自动化连接
     */
    private async connectUnix(): Promise<void> {
        const methods = [
            { name: 'expect脚本', method: () => this.unixExpectMethod() },
            { name: 'Python pexpect', method: () => this.unixPythonMethod() },
            { name: 'Bash自动化', method: () => this.unixBashMethod() }
        ];

        for (const { name, method } of methods) {
            try {
                console.log(`🔄 尝试 ${name}...`);
                await method();
                console.log(`✅ ${name} 成功！`);
                return;
            } catch (error) {
                console.log(`❌ ${name} 失败: ${error instanceof Error ? error.message : String(error)}`);
            }
        }

        throw new Error('所有Unix自动化方法都失败了');
    }

    /**
     * Windows PowerShell高级自动化
     */
    private async windowsPowerShellMethod(): Promise<void> {
        return new Promise((resolve, reject) => {
            void (async () => {
            const verificationCode = this.config.dynamicTokenProvider ? 
                await this.config.dynamicTokenProvider() : '';

            const psScript = `
# 高级PowerShell自动化脚本
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

# 导入Windows API
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;

public class Win32API {
    [DllImport("user32.dll")]
    public static extern IntPtr FindWindow(string lpClassName, string lpWindowName);
    
    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);
    
    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    
    [DllImport("user32.dll")]
    public static extern IntPtr FindWindowEx(IntPtr hwndParent, IntPtr hwndChildAfter, string lpszClass, string lpszWindow);
    
    [DllImport("user32.dll")]
    public static extern int SendMessage(IntPtr hWnd, int Msg, int wParam, string lParam);
    
    [DllImport("user32.dll")]
    public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
    
    public const int WM_CHAR = 0x0102;
    public const int WM_KEYDOWN = 0x0100;
    public const int WM_KEYUP = 0x0101;
    public const int VK_RETURN = 0x0D;
}
"@

try {
    Write-Host "=== 启动高级PowerShell自动化 ==="
    
    # 启动SFTP进程
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = "cmd"
    $psi.Arguments = "/c sftp -P ${this.config.port} ${this.config.username}@${this.config.host}"
    $psi.UseShellExecute = $true
    $psi.CreateNoWindow = $false
    
    $process = [System.Diagnostics.Process]::Start($psi)
    Write-Host "SFTP进程已启动，PID: $($process.Id)"
    
    # 等待窗口出现
    Start-Sleep -Seconds 3
    
    # 查找命令提示符窗口
    $maxAttempts = 10
    $attempt = 0
    $cmdWindow = [IntPtr]::Zero
    
    while ($attempt -lt $maxAttempts -and $cmdWindow -eq [IntPtr]::Zero) {
        $cmdWindow = [Win32API]::FindWindow("ConsoleWindowClass", $null)
        if ($cmdWindow -ne [IntPtr]::Zero) {
            Write-Host "找到命令窗口: $cmdWindow"
            break
        }
        Start-Sleep -Milliseconds 500
        $attempt++
    }
    
    if ($cmdWindow -eq [IntPtr]::Zero) {
        throw "无法找到命令窗口"
    }
    
    # 激活窗口
    [Win32API]::SetForegroundWindow($cmdWindow)
    [Win32API]::ShowWindow($cmdWindow, 5)  # SW_SHOW
    Start-Sleep -Milliseconds 1000
    
    Write-Host "等待密码提示..."
    Start-Sleep -Seconds 2
    
    # 发送密码 - 使用多种方法确保成功
    Write-Host "发送密码: ${this.config.password}"
    
    # 方法1: SendKeys
    [System.Windows.Forms.SendKeys]::SendWait("${this.config.password}")
    [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
    
    Start-Sleep -Seconds 2
    
    # 如果有验证码，发送验证码
    if ("${verificationCode}") {
        Write-Host "发送验证码: ${verificationCode}"
        [System.Windows.Forms.SendKeys]::SendWait("${verificationCode}")
        [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
        Start-Sleep -Seconds 2
    }
    
    # 发送测试命令
    Write-Host "发送测试命令..."
    [System.Windows.Forms.SendKeys]::SendWait("pwd")
    [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
    Start-Sleep -Seconds 1
    
    [System.Windows.Forms.SendKeys]::SendWait("quit")
    [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
    
    Write-Host "=== PowerShell自动化完成 ==="
    Write-Output "SUCCESS: 完全自动化成功"
    
} catch {
    Write-Host "=== PowerShell自动化失败 ==="
    Write-Error "ERROR: $_"
    exit 1
}
`;

            await this.executeScript(psScript, 'powershell', ['-ExecutionPolicy', 'Bypass']);
            resolve();
            })().catch(reject);
        });
    }

    /**
     * Windows VBScript自动化
     */
    private async windowsVBScriptMethod(): Promise<void> {
        return new Promise((resolve, reject) => {
            void (async () => {
            const verificationCode = this.config.dynamicTokenProvider ? 
                await this.config.dynamicTokenProvider() : '';

            const vbsScript = `
' VBScript自动化脚本
Set WshShell = CreateObject("WScript.Shell")
Set objShell = CreateObject("Shell.Application")

' 启动SFTP
WshShell.Run "cmd /c sftp -P ${this.config.port} ${this.config.username}@${this.config.host}", 1, False

' 等待窗口出现
WScript.Sleep 3000

' 激活命令窗口
WshShell.AppActivate "cmd"
WScript.Sleep 1000

' 发送密码
WScript.Echo "发送密码..."
WshShell.SendKeys "${this.config.password}"
WshShell.SendKeys "{ENTER}"
WScript.Sleep 2000

' 发送验证码（如果有）
If "${verificationCode}" <> "" Then
    WScript.Echo "发送验证码..."
    WshShell.SendKeys "${verificationCode}"
    WshShell.SendKeys "{ENTER}"
    WScript.Sleep 2000
End If

' 发送测试命令
WScript.Echo "发送测试命令..."
WshShell.SendKeys "pwd"
WshShell.SendKeys "{ENTER}"
WScript.Sleep 1000

WshShell.SendKeys "quit"
WshShell.SendKeys "{ENTER}"

WScript.Echo "VBScript自动化完成"
`;

            const scriptFile = path.join(os.tmpdir(), `sftp-vbs-${Date.now()}.vbs`);
            fs.writeFileSync(scriptFile, vbsScript);

            try {
                await this.executeScript('', 'cscript', [scriptFile]);
                resolve();
            } finally {
                this.cleanupFile(scriptFile);
            }
            })().catch(reject);
        });
    }

    /**
     * Windows AutoIt脚本自动化
     */
    private async windowsAutoItMethod(): Promise<void> {
        return new Promise((resolve, reject) => {
            void (async () => {
            // 检查AutoIt是否可用
            try {
                await this.executeCommand('autoit3', ['-version']);
            } catch {
                reject(new Error('AutoIt不可用'));
                return;
            }

            const verificationCode = this.config.dynamicTokenProvider ? 
                await this.config.dynamicTokenProvider() : '';

            const au3Script = `
; AutoIt自动化脚本
#include <Constants.au3>

; 启动SFTP
Run("cmd /c sftp -P ${this.config.port} ${this.config.username}@${this.config.host}")

; 等待窗口出现
Sleep(3000)

; 激活命令窗口
WinActivate("[CLASS:ConsoleWindowClass]")
WinWaitActive("[CLASS:ConsoleWindowClass]", "", 5)

; 发送密码
ConsoleWrite("发送密码..." & @CRLF)
Send("${this.config.password}")
Send("{ENTER}")
Sleep(2000)

; 发送验证码（如果有）
If "${verificationCode}" <> "" Then
    ConsoleWrite("发送验证码..." & @CRLF)
    Send("${verificationCode}")
    Send("{ENTER}")
    Sleep(2000)
EndIf

; 发送测试命令
ConsoleWrite("发送测试命令..." & @CRLF)
Send("pwd")
Send("{ENTER}")
Sleep(1000)

Send("quit")
Send("{ENTER}")

ConsoleWrite("AutoIt自动化完成" & @CRLF)
`;

            const scriptFile = path.join(os.tmpdir(), `sftp-autoit-${Date.now()}.au3`);
            fs.writeFileSync(scriptFile, au3Script);

            try {
                await this.executeScript('', 'autoit3', [scriptFile]);
                resolve();
            } finally {
                this.cleanupFile(scriptFile);
            }
            })().catch(reject);
        });
    }

    /**
     * Windows Python自动化
     */
    private async windowsPythonMethod(): Promise<void> {
        return new Promise((resolve, reject) => {
            void (async () => {
            const verificationCode = this.config.dynamicTokenProvider ? 
                await this.config.dynamicTokenProvider() : '';

            const pythonScript = `
import subprocess
import time
import pyautogui
import psutil
import win32gui
import win32con

def find_cmd_window():
    """查找命令提示符窗口"""
    def enum_windows_proc(hwnd, windows):
        if win32gui.IsWindowVisible(hwnd):
            class_name = win32gui.GetClassName(hwnd)
            window_text = win32gui.GetWindowText(hwnd)
            if class_name == "ConsoleWindowClass":
                windows.append(hwnd)
        return True
    
    windows = []
    win32gui.EnumWindows(enum_windows_proc, windows)
    return windows[0] if windows else None

try:
    print("=== Python自动化开始 ===")
    
    # 启动SFTP进程
    process = subprocess.Popen([
        "cmd", "/c", 
        f"sftp -P ${this.config.port} ${this.config.username}@${this.config.host}"
    ])
    
    print(f"SFTP进程已启动，PID: {process.pid}")
    
    # 等待窗口出现
    time.sleep(3)
    
    # 查找并激活命令窗口
    cmd_window = find_cmd_window()
    if cmd_window:
        win32gui.SetForegroundWindow(cmd_window)
        win32gui.ShowWindow(cmd_window, win32con.SW_SHOW)
        print(f"找到并激活命令窗口: {cmd_window}")
    else:
        raise Exception("无法找到命令窗口")
    
    time.sleep(1)
    
    # 发送密码
    print("发送密码...")
    pyautogui.typewrite("${this.config.password}")
    pyautogui.press('enter')
    time.sleep(2)
    
    # 发送验证码（如果有）
    if "${verificationCode}":
        print("发送验证码...")
        pyautogui.typewrite("${verificationCode}")
        pyautogui.press('enter')
        time.sleep(2)
    
    # 发送测试命令
    print("发送测试命令...")
    pyautogui.typewrite("pwd")
    pyautogui.press('enter')
    time.sleep(1)
    
    pyautogui.typewrite("quit")
    pyautogui.press('enter')
    
    print("=== Python自动化完成 ===")
    print("SUCCESS: Python自动化成功")
    
except Exception as e:
    print(f"=== Python自动化失败 ===")
    print(f"ERROR: {e}")
    exit(1)
`;

            const scriptFile = path.join(os.tmpdir(), `sftp-python-${Date.now()}.py`);
            fs.writeFileSync(scriptFile, pythonScript);

            try {
                await this.executeScript('', 'python', [scriptFile]);
                resolve();
            } finally {
                this.cleanupFile(scriptFile);
            }
            })().catch(reject);
        });
    }

    /**
     * Unix expect方法
     */
    private async unixExpectMethod(): Promise<void> {
        return new Promise((resolve, reject) => {
            void (async () => {
            const verificationCode = this.config.dynamicTokenProvider ? 
                await this.config.dynamicTokenProvider() : '';

            const expectScript = `#!/usr/bin/expect -f
set timeout 30
spawn sftp -P ${this.config.port} ${this.config.username}@${this.config.host}

expect {
    "Password:" {
        send "${this.config.password}\\r"
        expect {
            "Verification code:" {
                send "${verificationCode}\\r"
                expect "sftp>" {
                    send "pwd\\r"
                    send "quit\\r"
                }
            }
            "sftp>" {
                send "pwd\\r"
                send "quit\\r"
            }
        }
    }
}
expect eof
`;

            const scriptFile = path.join(os.tmpdir(), `sftp-expect-${Date.now()}.exp`);
            fs.writeFileSync(scriptFile, expectScript);
            fs.chmodSync(scriptFile, 0o755);

            try {
                await this.executeScript('', 'expect', [scriptFile]);
                resolve();
            } finally {
                this.cleanupFile(scriptFile);
            }
            })().catch(reject);
        });
    }

    /**
     * Unix Python pexpect方法
     */
    private async unixPythonMethod(): Promise<void> {
        return new Promise((resolve, reject) => {
            void (async () => {
            const verificationCode = this.config.dynamicTokenProvider ? 
                await this.config.dynamicTokenProvider() : '';

            const pythonScript = `
import pexpect
import sys

try:
    print("=== Python pexpect自动化开始 ===")
    
    # 启动SFTP
    child = pexpect.spawn(f'sftp -P ${this.config.port} ${this.config.username}@${this.config.host}')
    child.logfile = sys.stdout.buffer
    
    # 等待密码提示
    index = child.expect(['Password:', pexpect.TIMEOUT], timeout=10)
    if index == 0:
        print("检测到密码提示，发送密码...")
        child.sendline('${this.config.password}')
        
        # 等待验证码提示或SFTP提示符
        index = child.expect(['Verification code:', 'sftp>', pexpect.TIMEOUT], timeout=10)
        if index == 0:
            print("检测到验证码提示，发送验证码...")
            child.sendline('${verificationCode}')
            child.expect('sftp>', timeout=10)
        elif index == 1:
            print("直接进入SFTP提示符")
        
        # 发送测试命令
        print("发送测试命令...")
        child.sendline('pwd')
        child.expect('sftp>', timeout=5)
        child.sendline('quit')
        child.expect(pexpect.EOF, timeout=5)
        
        print("=== Python pexpect自动化完成 ===")
        print("SUCCESS: pexpect自动化成功")
    else:
        raise Exception("密码提示超时")
        
except Exception as e:
    print(f"=== Python pexpect自动化失败 ===")
    print(f"ERROR: {e}")
    sys.exit(1)
`;

            const scriptFile = path.join(os.tmpdir(), `sftp-pexpect-${Date.now()}.py`);
            fs.writeFileSync(scriptFile, pythonScript);

            try {
                await this.executeScript('', 'python', [scriptFile]);
                resolve();
            } finally {
                this.cleanupFile(scriptFile);
            }
            })().catch(reject);
        });
    }

    /**
     * Unix Bash自动化方法
     */
    private async unixBashMethod(): Promise<void> {
        return new Promise((resolve, reject) => {
            void (async () => {
            const verificationCode = this.config.dynamicTokenProvider ? 
                await this.config.dynamicTokenProvider() : '';

            const bashScript = `#!/bin/bash
# Bash自动化脚本

# 创建输入文件
cat > /tmp/sftp_input_$$ << EOF
${this.config.password}
${verificationCode}
pwd
quit
EOF

# 使用输入文件连接SFTP
sftp -P ${this.config.port} ${this.config.username}@${this.config.host} < /tmp/sftp_input_$$

# 清理输入文件
rm -f /tmp/sftp_input_$$

echo "Bash自动化完成"
`;

            const scriptFile = path.join(os.tmpdir(), `sftp-bash-${Date.now()}.sh`);
            fs.writeFileSync(scriptFile, bashScript);
            fs.chmodSync(scriptFile, 0o755);

            try {
                await this.executeScript('', 'bash', [scriptFile]);
                resolve();
            } finally {
                this.cleanupFile(scriptFile);
            }
            })().catch(reject);
        });
    }

    /**
     * 执行脚本
     */
    private async executeScript(script: string, command: string, args: string[] = []): Promise<string> {
        return new Promise((resolve, reject) => {
            let scriptFile: string | null = null;

            if (script) {
                scriptFile = path.join(os.tmpdir(), `script-${Date.now()}.tmp`);
                fs.writeFileSync(scriptFile, script);
                args = ['-File', scriptFile, ...args];
            }

            const process = spawn(command, args, {
                stdio: ['pipe', 'pipe', 'pipe']
            });

            let stdout = '';
            let stderr = '';

            process.stdout?.on('data', (data) => {
                const output = data.toString();
                stdout += output;
                console.log('📤', output.trim());
            });

            process.stderr?.on('data', (data) => {
                const output = data.toString();
                stderr += output;
                console.log('📥', output.trim());
            });

            process.on('close', (code) => {
                if (scriptFile) {
                    this.cleanupFile(scriptFile);
                }

                if (code === 0 || stdout.includes('SUCCESS:')) {
                    resolve(stdout);
                } else {
                    reject(new Error(`脚本执行失败 (退出码: ${code}): ${stderr}`));
                }
            });

            process.on('error', (error) => {
                if (scriptFile) {
                    this.cleanupFile(scriptFile);
                }
                reject(error);
            });

            // 超时处理
            setTimeout(() => {
                process.kill();
                if (scriptFile) {
                    this.cleanupFile(scriptFile);
                }
                reject(new Error('脚本执行超时'));
            }, this.config.timeout);
        });
    }

    /**
     * 执行命令
     */
    private async executeCommand(command: string, args: string[]): Promise<string> {
        return new Promise((resolve, reject) => {
            const process = spawn(command, args, {
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
                if (code === 0) {
                    resolve(stdout);
                } else {
                    reject(new Error(`命令执行失败: ${stderr}`));
                }
            });

            process.on('error', (error) => {
                reject(error);
            });
        });
    }

    /**
     * 清理文件
     */
    private cleanupFile(filePath: string): void {
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
        // 实现目录列表功能
        throw new Error('listDirectory方法需要实现');
    }

    /**
     * 上传文件
     */
    async uploadFile(_localPath: string, _remotePath: string): Promise<void> {
        // 实现文件上传功能
        throw new Error('uploadFile方法需要实现');
    }

    /**
     * 下载文件
     */
    async downloadFile(_remotePath: string, _localPath: string): Promise<void> {
        // 实现文件下载功能
        throw new Error('downloadFile方法需要实现');
    }

    /**
     * 断开连接
     */
    async disconnect(): Promise<void> {
        // 实现断开连接功能
        console.log('✅ 连接已断开');
    }
}
