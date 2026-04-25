import { SFTPConfig } from '../interfaces';
import { LocalCacheManager } from '../cache/LocalCacheManager';
import { NetworkErrorHandler } from '../network/NetworkErrorHandler';
import { NetworkMonitor } from '../network/NetworkMonitor';
import { PerformanceManager } from '../performance/PerformanceManager';
import { FileIntegrityChecker, ChecksumAlgorithm } from '../security/FileIntegrityChecker';
import { ResumableTransfer } from '../transfer/ResumableTransfer';
import { TransferEncryption, EncryptionAlgorithm } from '../security/TransferEncryption';
import { getAppPath } from '../runtime';

export interface SFTPRuntimeServices {
  errorHandler: NetworkErrorHandler;
  networkMonitor: NetworkMonitor;
  cacheManager: LocalCacheManager;
  integrityChecker: FileIntegrityChecker;
  performanceManager: PerformanceManager;
  resumableTransfer: ResumableTransfer;
  transferEncryption: TransferEncryption;
}

export class SFTPRuntimeFactory {
  static create(config: SFTPConfig): SFTPRuntimeServices {
    return {
      errorHandler: new NetworkErrorHandler({
        maxAttempts: config.retryAttempts || 3,
        baseDelay: 1000,
        maxDelay: 30000,
        backoffMultiplier: 2,
        jitterEnabled: true
      }),
      networkMonitor: new NetworkMonitor(config, {
        checkInterval: 30000,
        timeoutThreshold: 10000,
        unstableThreshold: 0.3,
        historySize: 100
      }),
      cacheManager: new LocalCacheManager({
        cacheDir: getAppPath('cache', 'sftp'),
        maxSize: 50 * 1024 * 1024,
        maxAge: 60 * 60 * 1000,
        cleanupInterval: 30 * 60 * 1000,
        compressionEnabled: false
      }),
      integrityChecker: new FileIntegrityChecker(ChecksumAlgorithm.SHA256),
      performanceManager: new PerformanceManager({
        enableAutoOptimization: true,
        reportInterval: 60000,
        largeFile: {
          largeFileThreshold: 100 * 1024 * 1024,
          chunkSize: 100 * 1024 * 1024,
          maxConcurrency: 3,
          enableCompression: false
        },
        memory: {
          memoryThreshold: 0.8
        }
      }),
      resumableTransfer: new ResumableTransfer({
        chunkSize: 100 * 1024 * 1024,
        maxConcurrentChunks: 3,
        sessionDir: getAppPath('transfer-sessions'),
        checksumAlgorithm: ChecksumAlgorithm.SHA256,
        retryAttempts: 3,
        retryDelay: 1000
      }),
      transferEncryption: new TransferEncryption({
        algorithm: EncryptionAlgorithm.AES_256_GCM,
        keyLength: 32,
        ivLength: 16,
        tagLength: 16,
        saltLength: 32,
        iterations: 100000
      })
    };
  }
}
