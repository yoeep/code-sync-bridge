import * as crypto from 'crypto';
import * as fs from 'fs';
import { EventEmitter } from 'events';

/**
 * 文件完整性检查算法
 */
export enum ChecksumAlgorithm {
  MD5 = 'md5',
  SHA1 = 'sha1',
  SHA256 = 'sha256',
  SHA512 = 'sha512'
}

/**
 * 文件完整性信息
 */
export interface FileIntegrity {
  path: string;
  size: number;
  checksum: string;
  algorithm: ChecksumAlgorithm;
  timestamp: Date;
}

/**
 * 完整性验证结果
 */
export interface IntegrityVerificationResult {
  valid: boolean;
  expected: string;
  actual: string;
  algorithm: ChecksumAlgorithm;
  error?: string;
}

/**
 * 文件完整性检查器
 * 提供文件校验和计算和验证功能
 */
export class FileIntegrityChecker extends EventEmitter {
  private defaultAlgorithm: ChecksumAlgorithm;

  constructor(defaultAlgorithm: ChecksumAlgorithm = ChecksumAlgorithm.SHA256) {
    super();
    this.defaultAlgorithm = defaultAlgorithm;
  }

  /**
   * 计算文件校验和
   */
  async calculateFileChecksum(
    filePath: string,
    algorithm: ChecksumAlgorithm = this.defaultAlgorithm
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash(algorithm);
      const stream = fs.createReadStream(filePath);

      stream.on('data', (data) => {
        hash.update(data);
      });

      stream.on('end', () => {
        const checksum = hash.digest('hex');
        this.emit('checksumCalculated', { filePath, checksum, algorithm });
        resolve(checksum);
      });

      stream.on('error', (error) => {
        this.emit('checksumError', { filePath, error });
        reject(error);
      });
    });
  }

  /**
   * 计算Buffer校验和
   */
  calculateBufferChecksum(
    buffer: Buffer,
    algorithm: ChecksumAlgorithm = this.defaultAlgorithm
  ): string {
    const hash = crypto.createHash(algorithm);
    hash.update(buffer);
    const checksum = hash.digest('hex');
    
    this.emit('checksumCalculated', { 
      source: 'buffer', 
      size: buffer.length, 
      checksum, 
      algorithm 
    });
    
    return checksum;
  }

  /**
   * 验证文件完整性
   */
  async verifyFileIntegrity(
    filePath: string,
    expectedChecksum: string,
    algorithm: ChecksumAlgorithm = this.defaultAlgorithm
  ): Promise<IntegrityVerificationResult> {
    try {
      const actualChecksum = await this.calculateFileChecksum(filePath, algorithm);
      const valid = actualChecksum === expectedChecksum;

      const result: IntegrityVerificationResult = {
        valid,
        expected: expectedChecksum,
        actual: actualChecksum,
        algorithm
      };

      this.emit('integrityVerified', { filePath, result });
      return result;
    } catch (error) {
      const result: IntegrityVerificationResult = {
        valid: false,
        expected: expectedChecksum,
        actual: '',
        algorithm,
        error: (error as Error).message
      };

      this.emit('integrityVerificationFailed', { filePath, result });
      return result;
    }
  }

  /**
   * 验证Buffer完整性
   */
  verifyBufferIntegrity(
    buffer: Buffer,
    expectedChecksum: string,
    algorithm: ChecksumAlgorithm = this.defaultAlgorithm
  ): IntegrityVerificationResult {
    try {
      const actualChecksum = this.calculateBufferChecksum(buffer, algorithm);
      const valid = actualChecksum === expectedChecksum;

      const result: IntegrityVerificationResult = {
        valid,
        expected: expectedChecksum,
        actual: actualChecksum,
        algorithm
      };

      this.emit('integrityVerified', { source: 'buffer', result });
      return result;
    } catch (error) {
      const result: IntegrityVerificationResult = {
        valid: false,
        expected: expectedChecksum,
        actual: '',
        algorithm,
        error: (error as Error).message
      };

      this.emit('integrityVerificationFailed', { source: 'buffer', result });
      return result;
    }
  }

  /**
   * 生成文件完整性信息
   */
  async generateFileIntegrity(
    filePath: string,
    algorithm: ChecksumAlgorithm = this.defaultAlgorithm
  ): Promise<FileIntegrity> {
    const stats = fs.statSync(filePath);
    const checksum = await this.calculateFileChecksum(filePath, algorithm);

    const integrity: FileIntegrity = {
      path: filePath,
      size: stats.size,
      checksum,
      algorithm,
      timestamp: new Date()
    };

    this.emit('integrityGenerated', integrity);
    return integrity;
  }

  /**
   * 批量验证文件完整性
   */
  async verifyMultipleFiles(
    files: Array<{ path: string; expectedChecksum: string; algorithm?: ChecksumAlgorithm }>
  ): Promise<Map<string, IntegrityVerificationResult>> {
    const results = new Map<string, IntegrityVerificationResult>();

    for (const file of files) {
      const result = await this.verifyFileIntegrity(
        file.path,
        file.expectedChecksum,
        file.algorithm || this.defaultAlgorithm
      );
      results.set(file.path, result);
    }

    this.emit('batchVerificationCompleted', { 
      totalFiles: files.length,
      validFiles: Array.from(results.values()).filter(r => r.valid).length,
      results 
    });

    return results;
  }

  /**
   * 计算增量校验和（用于断点续传）
   */
  async calculateIncrementalChecksum(
    filePath: string,
    startOffset: number,
    endOffset?: number,
    algorithm: ChecksumAlgorithm = this.defaultAlgorithm
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash(algorithm);
      const stream = fs.createReadStream(filePath, { 
        start: startOffset, 
        end: endOffset 
      });

      stream.on('data', (data) => {
        hash.update(data);
      });

      stream.on('end', () => {
        const checksum = hash.digest('hex');
        this.emit('incrementalChecksumCalculated', { 
          filePath, 
          startOffset, 
          endOffset, 
          checksum, 
          algorithm 
        });
        resolve(checksum);
      });

      stream.on('error', (error) => {
        this.emit('incrementalChecksumError', { filePath, startOffset, endOffset, error });
        reject(error);
      });
    });
  }

  /**
   * 创建文件完整性清单
   */
  async createIntegrityManifest(
    filePaths: string[],
    algorithm: ChecksumAlgorithm = this.defaultAlgorithm
  ): Promise<Map<string, FileIntegrity>> {
    const manifest = new Map<string, FileIntegrity>();

    for (const filePath of filePaths) {
      try {
        const integrity = await this.generateFileIntegrity(filePath, algorithm);
        manifest.set(filePath, integrity);
      } catch (error) {
        this.emit('manifestError', { filePath, error });
      }
    }

    this.emit('manifestCreated', { 
      totalFiles: filePaths.length,
      successfulFiles: manifest.size,
      manifest 
    });

    return manifest;
  }

  /**
   * 验证完整性清单
   */
  async verifyIntegrityManifest(
    manifest: Map<string, FileIntegrity>
  ): Promise<Map<string, IntegrityVerificationResult>> {
    const results = new Map<string, IntegrityVerificationResult>();

    for (const [filePath, integrity] of manifest.entries()) {
      const result = await this.verifyFileIntegrity(
        filePath,
        integrity.checksum,
        integrity.algorithm
      );
      results.set(filePath, result);
    }

    this.emit('manifestVerified', {
      totalFiles: manifest.size,
      validFiles: Array.from(results.values()).filter(r => r.valid).length,
      results
    });

    return results;
  }
}