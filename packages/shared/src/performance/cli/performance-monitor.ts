#!/usr/bin/env node

import { PerformanceManager } from '../PerformanceManager';
import * as fs from 'fs';
import * as path from 'path';

/**
 * 性能监控CLI工具
 * 用于演示和测试性能监控功能
 */
class PerformanceMonitorCLI {
  private performanceManager: PerformanceManager;

  constructor() {
    this.performanceManager = new PerformanceManager({
      enableAutoOptimization: true,
      reportInterval: 10000, // 10秒报告间隔
      largeFile: {
        largeFileThreshold: 100 * 1024 * 1024, // 100MB
        chunkSize: 100 * 1024 * 1024, // 100MB
        maxConcurrency: 2
      },
      memory: {
        memoryThreshold: 0.7 // 70%
      }
    });

    this.setupEventHandlers();
  }

  /**
   * 启动性能监控
   */
  start(): void {
    console.log('🚀 启动性能监控...');
    this.performanceManager.start();
    
    // 显示初始状态
    this.displayStatus();
    
    // 定期显示状态
    setInterval(() => {
      this.displayStatus();
    }, 30000); // 30秒
  }

  /**
   * 停止性能监控
   */
  stop(): void {
    console.log('⏹️  停止性能监控...');
    this.performanceManager.stop();
  }

  /**
   * 模拟文件传输
   */
  async simulateTransfer(filePath: string, type: 'upload' | 'download' = 'upload'): Promise<void> {
    if (!fs.existsSync(filePath)) {
      console.error(`❌ 文件不存在: ${filePath}`);
      return;
    }

    const fileSize = fs.statSync(filePath).size;
    console.log(`📁 开始模拟${type === 'upload' ? '上传' : '下载'}: ${filePath} (${this.formatBytes(fileSize)})`);

    try {
      if (type === 'upload') {
        await this.performanceManager.optimizedUpload(
          filePath,
          async (chunk: Buffer, chunkIndex: number) => {
            // 模拟网络延迟
            await new Promise(resolve => setTimeout(resolve, Math.random() * 100 + 50));
            console.log(`  📤 上传块 ${chunkIndex}: ${this.formatBytes(chunk.length)}`);
          },
          {
            onProgress: (progress) => {
              console.log(`  📊 进度: ${(progress.progress * 100).toFixed(1)}% | 速度: ${this.formatBytes(progress.speed)}/s | 剩余: ${this.formatTime(progress.remainingTime)}`);
            }
          }
        );
      } else {
        await this.performanceManager.optimizedDownload(
          filePath,
          filePath + '.downloaded',
          async (chunkIndex: number) => {
            // 模拟网络延迟和数据生成
            await new Promise(resolve => setTimeout(resolve, Math.random() * 100 + 50));
            const chunkSize = Math.min(512 * 1024, fileSize - chunkIndex * 512 * 1024);
            console.log(`  📥 下载块 ${chunkIndex}: ${this.formatBytes(chunkSize)}`);
            return Buffer.alloc(chunkSize);
          },
          fileSize,
          {
            onProgress: (progress) => {
              console.log(`  📊 进度: ${(progress.progress * 100).toFixed(1)}% | 速度: ${this.formatBytes(progress.speed)}/s | 剩余: ${this.formatTime(progress.remainingTime)}`);
            }
          }
        );
      }

      console.log(`✅ ${type === 'upload' ? '上传' : '下载'}完成: ${filePath}`);
    } catch (error) {
      console.error(`❌ ${type === 'upload' ? '上传' : '下载'}失败:`, (error as Error).message);
    }
  }

  /**
   * 创建测试文件
   */
  createTestFile(size: number, filePath: string): void {
    console.log(`📝 创建测试文件: ${filePath} (${this.formatBytes(size)})`);
    
    const buffer = Buffer.alloc(size);
    // 填充随机数据
    for (let i = 0; i < size; i++) {
      buffer[i] = Math.floor(Math.random() * 256);
    }
    
    fs.writeFileSync(filePath, buffer);
    console.log(`✅ 测试文件创建完成`);
  }

  /**
   * 运行性能测试
   */
  async runPerformanceTest(): Promise<void> {
    console.log('🧪 开始性能测试...');
    
    // 创建不同大小的测试文件
    const testFiles = [
      { name: 'small.dat', size: 1024 * 1024 }, // 1MB
      { name: 'medium.dat', size: 5 * 1024 * 1024 }, // 5MB
      { name: 'large.dat', size: 20 * 1024 * 1024 } // 20MB
    ];

    const testDir = './performance-test';
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir);
    }

    for (const testFile of testFiles) {
      const filePath = path.join(testDir, testFile.name);
      
      // 创建测试文件
      this.createTestFile(testFile.size, filePath);
      
      // 测试上传
      await this.simulateTransfer(filePath, 'upload');
      
      // 等待一段时间
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // 测试下载
      await this.simulateTransfer(filePath, 'download');
      
      // 等待一段时间
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    console.log('🎉 性能测试完成');
    
    // 显示最终报告
    setTimeout(() => {
      this.displayDetailedReport();
    }, 5000);
  }

  /**
   * 显示状态
   */
  private displayStatus(): void {
    const summary = this.performanceManager.getPerformanceSummary();
    
    console.log('\n📊 性能状态:');
    console.log(`  运行时间: ${this.formatTime(summary.uptime)}`);
    console.log(`  活跃传输: ${summary.largeFile.activeTransfers}`);
    console.log(`  总传输数: ${summary.monitor.totalTransfers}`);
    console.log(`  内存使用: ${(summary.memory.utilizationRate * 100).toFixed(1)}%`);
    console.log(`  系统健康: ${summary.monitor.systemHealth}`);
  }

  /**
   * 显示详细报告
   */
  private displayDetailedReport(): void {
    const report = this.performanceManager.generatePerformanceReport();
    
    console.log('\n📈 详细性能报告:');
    console.log('=' .repeat(50));
    console.log(`报告时间: ${report.timestamp.toLocaleString()}`);
    console.log(`运行时间: ${this.formatTime(report.uptime)}`);
    console.log(`健康评分: ${report.healthScore}/100`);
    
    console.log('\n📡 传输性能:');
    console.log(`  平均速度: ${this.formatBytes(report.transferMetrics.transferSpeed)}/s`);
    console.log(`  成功率: ${(report.transferMetrics.successRate * 100).toFixed(1)}%`);
    console.log(`  错误率: ${(report.transferMetrics.errorRate * 100).toFixed(1)}%`);
    console.log(`  平均延迟: ${report.transferMetrics.latency}ms`);
    console.log(`  并发传输: ${report.transferMetrics.concurrentTransfers}`);
    
    console.log('\n💾 内存使用:');
    console.log(`  系统内存: ${this.formatBytes(report.memoryMetrics.usedMemory)} / ${this.formatBytes(report.memoryMetrics.totalMemory)} (${(report.memoryMetrics.memoryUsage * 100).toFixed(1)}%)`);
    console.log(`  堆内存: ${this.formatBytes(report.memoryMetrics.heapUsed)} / ${this.formatBytes(report.memoryMetrics.heapTotal)}`);
    console.log(`  外部内存: ${this.formatBytes(report.memoryMetrics.external)}`);
    
    console.log('\n🏊 内存池:');
    console.log(`  池大小: ${report.memoryPoolStats.poolSize} 块`);
    console.log(`  活跃块: ${report.memoryPoolStats.activeBlocks} 块`);
    console.log(`  利用率: ${(report.memoryPoolStats.utilizationRate * 100).toFixed(1)}%`);
    console.log(`  总分配: ${this.formatBytes(report.memoryPoolStats.totalAllocated)}`);
    
    if (report.recommendations.length > 0) {
      console.log('\n💡 优化建议:');
      report.recommendations.forEach((rec, index) => {
        console.log(`  ${index + 1}. ${rec}`);
      });
    }
    
    console.log('=' .repeat(50));
  }

  /**
   * 设置事件处理器
   */
  private setupEventHandlers(): void {
    this.performanceManager.on('memoryWarning', (data) => {
      console.log(`⚠️  内存警告: 使用率 ${(data.usage * 100).toFixed(1)}% (阈值: ${(data.threshold * 100).toFixed(1)}%)`);
    });

    this.performanceManager.on('speedWarning', (data) => {
      console.log(`⚠️  速度警告: ${this.formatBytes(data.speed)}/s (阈值: ${this.formatBytes(data.threshold)}/s)`);
    });

    this.performanceManager.on('memoryOptimized', (stats) => {
      console.log(`🔧 内存优化完成: 利用率 ${(stats.utilizationRate * 100).toFixed(1)}%`);
    });

    this.performanceManager.on('performanceReport', (report) => {
      console.log(`📊 性能报告生成: 健康评分 ${report.healthScore}/100`);
    });
  }

  /**
   * 格式化字节数
   */
  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  /**
   * 格式化时间
   */
  private formatTime(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    if (ms < 3600000) return `${(ms / 60000).toFixed(1)}m`;
    return `${(ms / 3600000).toFixed(1)}h`;
  }
}

// CLI 入口
if (require.main === module) {
  const cli = new PerformanceMonitorCLI();
  
  const command = process.argv[2];
  
  switch (command) {
    case 'start':
      cli.start();
      break;
      
    case 'test':
      cli.start();
      setTimeout(async () => {
        await cli.runPerformanceTest();
        setTimeout(() => {
          cli.stop();
          process.exit(0);
        }, 10000);
      }, 2000);
      break;
      
    case 'simulate': {
      const filePath = process.argv[3];
      const type = process.argv[4] as 'upload' | 'download' || 'upload';
      
      if (!filePath) {
        console.error('请提供文件路径');
        process.exit(1);
      }
      
      cli.start();
      setTimeout(async () => {
        await cli.simulateTransfer(filePath, type);
        setTimeout(() => {
          cli.stop();
          process.exit(0);
        }, 5000);
      }, 1000);
      break;
    }
      
    default:
      console.log('性能监控CLI工具');
      console.log('');
      console.log('用法:');
      console.log('  node performance-monitor.js start          # 启动监控');
      console.log('  node performance-monitor.js test           # 运行性能测试');
      console.log('  node performance-monitor.js simulate <file> [upload|download]  # 模拟传输');
      console.log('');
      break;
  }
}

export { PerformanceMonitorCLI };
