import { RepositoryManager as IRepositoryManager } from '@code-sync-bridge/shared/interfaces';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';

const execAsync = promisify(exec);

/**
 * 仓库管理器实现
 * 支持Git和SVN仓库的操作
 */
export class RepositoryManager implements IRepositoryManager {
  /**
   * 验证仓库URL的有效性
   * @param repoUrl 仓库URL
   * @returns 是否有效
   */
  async validateRepoUrl(repoUrl: string): Promise<boolean> {
    try {
      // 检查URL格式
      if (!this.isValidUrl(repoUrl)) {
        return false;
      }

      const repoType = this.detectRepoType(repoUrl);
      
      if (repoType === 'git') {
        return await this.validateGitRepo(repoUrl);
      } else if (repoType === 'svn') {
        return await this.validateSvnRepo(repoUrl);
      }
      
      return false;
    } catch (error) {
      console.error('Repository validation failed:', error instanceof Error ? error.message : String(error));
      return false;
    }
  }

  /**
   * 克隆仓库到本地路径
   * @param repoUrl 仓库URL
   * @param localPath 本地路径
   */
  async cloneRepository(repoUrl: string, localPath: string): Promise<void> {
    try {
      // 确保本地目录存在
      await fs.mkdir(path.dirname(localPath), { recursive: true });
      
      const repoType = this.detectRepoType(repoUrl);
      
      if (repoType === 'git') {
        await this.cloneGitRepo(repoUrl, localPath);
      } else if (repoType === 'svn') {
        await this.cloneSvnRepo(repoUrl, localPath);
      } else {
        throw new Error(`Unsupported repository type for URL: ${repoUrl}`);
      }
    } catch (error) {
      throw new Error(`Failed to clone repository: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 获取仓库状态信息
   * @param localPath 本地路径
   * @returns 仓库状态
   */
  async getRepositoryStatus(localPath: string): Promise<any> {
    try {
      const repoType = await this.detectLocalRepoType(localPath);
      
      if (repoType === 'git') {
        return await this.getGitStatus(localPath);
      } else if (repoType === 'svn') {
        return await this.getSvnStatus(localPath);
      }
      
      throw new Error('Unknown repository type');
    } catch (error) {
      throw new Error(`Failed to get repository status: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 提交变更到仓库
   * @param localPath 本地路径
   * @param message 提交信息
   * @returns 提交哈希
   */
  async commitChanges(localPath: string, message: string): Promise<string> {
    try {
      const repoType = await this.detectLocalRepoType(localPath);
      
      if (repoType === 'git') {
        return await this.commitGitChanges(localPath, message);
      } else if (repoType === 'svn') {
        return await this.commitSvnChanges(localPath, message);
      }
      
      throw new Error('Unknown repository type');
    } catch (error) {
      throw new Error(`Failed to commit changes: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 检查URL格式是否有效
   */
  private isValidUrl(url: string): boolean {
    const urlPattern = /^(https?|git|ssh|svn):\/\/[^\s/$.?#].[^\s]*$/i;
    return urlPattern.test(url);
  }

  /**
   * 根据URL检测仓库类型
   */
  private detectRepoType(repoUrl: string): 'git' | 'svn' | 'unknown' {
    if (repoUrl.includes('.git') || repoUrl.startsWith('git@') || repoUrl.startsWith('ssh://git')) {
      return 'git';
    } else if (repoUrl.startsWith('svn://') || repoUrl.includes('/svn/')) {
      return 'svn';
    }
    return 'unknown';
  }

  /**
   * 检测本地仓库类型
   */
  private async detectLocalRepoType(localPath: string): Promise<'git' | 'svn' | 'unknown'> {
    try {
      // 检查是否为Git仓库
      await fs.access(path.join(localPath, '.git'));
      return 'git';
    } catch {
      try {
        // 检查是否为SVN仓库
        await fs.access(path.join(localPath, '.svn'));
        return 'svn';
      } catch {
        return 'unknown';
      }
    }
  }

  /**
   * 验证Git仓库
   */
  private async validateGitRepo(repoUrl: string): Promise<boolean> {
    try {
      const { stdout } = await execAsync(`git ls-remote --heads "${repoUrl}"`, {
        timeout: 30000
      });
      return stdout.trim().length > 0;
    } catch (error) {
      console.error('Git validation error:', error);
      return false;
    }
  }

  /**
   * 验证SVN仓库
   */
  private async validateSvnRepo(repoUrl: string): Promise<boolean> {
    try {
      await execAsync(`svn info "${repoUrl}"`, {
        timeout: 30000
      });
      return true;
    } catch (error) {
      console.error('SVN validation error:', error);
      return false;
    }
  }

  /**
   * 克隆Git仓库
   */
  private async cloneGitRepo(repoUrl: string, localPath: string): Promise<void> {
    const { stderr } = await execAsync(`git clone "${repoUrl}" "${localPath}"`, {
      timeout: 300000 // 5分钟超时
    });
    
    if (stderr && !stderr.includes('Cloning into')) {
      throw new Error(`Git clone failed: ${stderr}`);
    }
  }

  /**
   * 克隆SVN仓库
   */
  private async cloneSvnRepo(repoUrl: string, localPath: string): Promise<void> {
    const { stderr } = await execAsync(`svn checkout "${repoUrl}" "${localPath}"`, {
      timeout: 300000 // 5分钟超时
    });
    
    if (stderr && stderr.includes('Error')) {
      throw new Error(`SVN checkout failed: ${stderr}`);
    }
  }

  /**
   * 获取Git状态
   */
  private async getGitStatus(localPath: string): Promise<any> {
    const { stdout: statusOutput } = await execAsync('git status --porcelain', {
      cwd: localPath
    });
    
    const { stdout: branchOutput } = await execAsync('git branch --show-current', {
      cwd: localPath
    });
    
    const { stdout: commitOutput } = await execAsync('git rev-parse HEAD', {
      cwd: localPath
    });

    return {
      type: 'git',
      branch: branchOutput.trim(),
      commit: commitOutput.trim(),
      hasChanges: statusOutput.trim().length > 0,
      changes: statusOutput.trim().split('\n').filter(line => line.length > 0)
    };
  }

  /**
   * 获取SVN状态
   */
  private async getSvnStatus(localPath: string): Promise<any> {
    const { stdout: statusOutput } = await execAsync('svn status', {
      cwd: localPath
    });
    
    const { stdout: infoOutput } = await execAsync('svn info', {
      cwd: localPath
    });

    const revisionMatch = infoOutput.match(/Revision: (\d+)/);
    const revision = revisionMatch ? revisionMatch[1] : 'unknown';

    return {
      type: 'svn',
      revision,
      hasChanges: statusOutput.trim().length > 0,
      changes: statusOutput.trim().split('\n').filter(line => line.length > 0)
    };
  }

  /**
   * 提交Git变更
   */
  private async commitGitChanges(localPath: string, message: string): Promise<string> {
    // 添加所有变更
    await execAsync('git add .', { cwd: localPath });
    
    // 提交变更
    await execAsync(`git commit -m "${message}"`, { cwd: localPath });
    
    // 获取提交哈希
    const { stdout } = await execAsync('git rev-parse HEAD', { cwd: localPath });
    return stdout.trim();
  }

  /**
   * 提交SVN变更
   */
  private async commitSvnChanges(localPath: string, message: string): Promise<string> {
    // 提交变更
    const { stdout } = await execAsync(`svn commit -m "${message}"`, { cwd: localPath });
    
    // 从输出中提取修订号
    const revisionMatch = stdout.match(/Committed revision (\d+)/);
    return revisionMatch ? revisionMatch[1] : 'unknown';
  }
}
