import * as crypto from 'crypto';
import { EventEmitter } from 'events';

/**
 * 加密算法
 */
export enum EncryptionAlgorithm {
  AES_256_GCM = 'aes-256-gcm',
  AES_256_CBC = 'aes-256-cbc',
  CHACHA20_POLY1305 = 'chacha20-poly1305'
}

/**
 * 密钥派生算法
 */
export enum KeyDerivationAlgorithm {
  PBKDF2 = 'pbkdf2',
  SCRYPT = 'scrypt',
  ARGON2 = 'argon2'
}

/**
 * 加密配置
 */
export interface EncryptionConfig {
  algorithm: EncryptionAlgorithm;
  keyDerivation: KeyDerivationAlgorithm;
  keyLength: number;
  ivLength: number;
  tagLength: number;
  saltLength: number;
  iterations: number;
}

/**
 * 加密结果
 */
export interface EncryptionResult {
  encryptedData: Buffer;
  iv: Buffer;
  salt: Buffer;
  tag?: Buffer;
  algorithm: EncryptionAlgorithm;
}

/**
 * 解密结果
 */
export interface DecryptionResult {
  decryptedData: Buffer;
  verified: boolean;
}

/**
 * 密钥信息
 */
export interface KeyInfo {
  key: Buffer;
  salt: Buffer;
  algorithm: KeyDerivationAlgorithm;
  iterations: number;
}

/**
 * 传输加密管理器
 * 提供文件和数据的加密/解密功能
 */
export class TransferEncryption extends EventEmitter {
  private config: EncryptionConfig;
  private keyCache: Map<string, KeyInfo> = new Map();

  constructor(config?: Partial<EncryptionConfig>) {
    super();
    
    this.config = {
      algorithm: EncryptionAlgorithm.AES_256_GCM,
      keyDerivation: KeyDerivationAlgorithm.PBKDF2,
      keyLength: 32, // 256 bits
      ivLength: 16,  // 128 bits
      tagLength: 16, // 128 bits
      saltLength: 32, // 256 bits
      iterations: 100000,
      ...config
    };
  }

  /**
   * 加密数据
   */
  async encryptData(data: Buffer, password: string): Promise<EncryptionResult> {
    try {
      // 生成随机盐和IV
      const salt = crypto.randomBytes(this.config.saltLength);
      const iv = crypto.randomBytes(this.config.ivLength);

      // 派生密钥
      const key = await this.deriveKey(password, salt);

      // 创建加密器
      const cipher = crypto.createCipher(this.config.algorithm, key);
      if (this.config.algorithm === EncryptionAlgorithm.AES_256_GCM) {
        (cipher as crypto.CipherGCM).setAAD(salt); // 使用盐作为附加认证数据
      }

      // 加密数据
      const encryptedChunks: Buffer[] = [];
      encryptedChunks.push(cipher.update(data));
      encryptedChunks.push(cipher.final());
      
      const encryptedData = Buffer.concat(encryptedChunks);

      const result: EncryptionResult = {
        encryptedData,
        iv,
        salt,
        algorithm: this.config.algorithm
      };

      // 获取认证标签（如果支持）
      if (this.config.algorithm === EncryptionAlgorithm.AES_256_GCM) {
        result.tag = (cipher as crypto.CipherGCM).getAuthTag();
      }

      this.emit('dataEncrypted', {
        originalSize: data.length,
        encryptedSize: encryptedData.length,
        algorithm: this.config.algorithm
      });

      return result;
    } catch (error) {
      this.emit('encryptionError', error);
      throw error;
    }
  }

  /**
   * 解密数据
   */
  async decryptData(encryptionResult: EncryptionResult, password: string): Promise<DecryptionResult> {
    try {
      // 派生密钥
      const key = await this.deriveKey(password, encryptionResult.salt);

      // 创建解密器
      const decipher = crypto.createDecipher(encryptionResult.algorithm, key);
      
      if (encryptionResult.algorithm === EncryptionAlgorithm.AES_256_GCM) {
        if (!encryptionResult.tag) {
          throw new Error('Authentication tag is required for GCM mode');
        }
        (decipher as crypto.DecipherGCM).setAuthTag(encryptionResult.tag);
        (decipher as crypto.DecipherGCM).setAAD(encryptionResult.salt);
      }

      // 解密数据
      const decryptedChunks: Buffer[] = [];
      decryptedChunks.push(decipher.update(encryptionResult.encryptedData));
      decryptedChunks.push(decipher.final());
      
      const decryptedData = Buffer.concat(decryptedChunks);

      const result: DecryptionResult = {
        decryptedData,
        verified: true // 如果到这里说明认证成功
      };

      this.emit('dataDecrypted', {
        encryptedSize: encryptionResult.encryptedData.length,
        decryptedSize: decryptedData.length,
        algorithm: encryptionResult.algorithm
      });

      return result;
    } catch (error) {
      this.emit('decryptionError', error);
      
      return {
        decryptedData: Buffer.alloc(0),
        verified: false
      };
    }
  }

  /**
   * 加密文件
   */
  async encryptFile(inputPath: string, outputPath: string, password: string): Promise<EncryptionResult> {
    const fs = await import('fs');
    
    try {
      const data = fs.readFileSync(inputPath);
      const result = await this.encryptData(data, password);
      
      // 创建加密文件格式：salt + iv + tag + encrypted_data
      const fileData = Buffer.concat([
        result.salt,
        result.iv,
        result.tag || Buffer.alloc(0),
        result.encryptedData
      ]);
      
      fs.writeFileSync(outputPath, fileData);
      
      this.emit('fileEncrypted', {
        inputPath,
        outputPath,
        originalSize: data.length,
        encryptedSize: fileData.length
      });

      return result;
    } catch (error) {
      this.emit('fileEncryptionError', { inputPath, outputPath, error });
      throw error;
    }
  }

  /**
   * 解密文件
   */
  async decryptFile(inputPath: string, outputPath: string, password: string): Promise<DecryptionResult> {
    const fs = await import('fs');
    
    try {
      const fileData = fs.readFileSync(inputPath);
      
      // 解析加密文件格式
      let offset = 0;
      const salt = fileData.subarray(offset, offset + this.config.saltLength);
      offset += this.config.saltLength;
      
      const iv = fileData.subarray(offset, offset + this.config.ivLength);
      offset += this.config.ivLength;
      
      let tag: Buffer | undefined;
      if (this.config.algorithm === EncryptionAlgorithm.AES_256_GCM) {
        tag = fileData.subarray(offset, offset + this.config.tagLength);
        offset += this.config.tagLength;
      }
      
      const encryptedData = fileData.subarray(offset);
      
      const encryptionResult: EncryptionResult = {
        encryptedData,
        iv,
        salt,
        tag,
        algorithm: this.config.algorithm
      };
      
      const result = await this.decryptData(encryptionResult, password);
      
      if (result.verified) {
        fs.writeFileSync(outputPath, result.decryptedData);
        
        this.emit('fileDecrypted', {
          inputPath,
          outputPath,
          encryptedSize: fileData.length,
          decryptedSize: result.decryptedData.length
        });
      }

      return result;
    } catch (error) {
      this.emit('fileDecryptionError', { inputPath, outputPath, error });
      throw error;
    }
  }

  /**
   * 生成随机密码
   */
  generateRandomPassword(length: number = 32): string {
    const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
    let password = '';
    
    for (let i = 0; i < length; i++) {
      const randomIndex = crypto.randomInt(0, charset.length);
      password += charset[randomIndex];
    }
    
    return password;
  }

  /**
   * 生成密钥对
   */
  generateKeyPair(): { publicKey: string; privateKey: string } {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: {
        type: 'spki',
        format: 'pem'
      },
      privateKeyEncoding: {
        type: 'pkcs8',
        format: 'pem'
      }
    });

    this.emit('keyPairGenerated');
    
    return { publicKey, privateKey };
  }

  /**
   * 使用公钥加密
   */
  encryptWithPublicKey(data: Buffer, publicKey: string): Buffer {
    try {
      const encrypted = crypto.publicEncrypt(
        {
          key: publicKey,
          padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
          oaepHash: 'sha256'
        },
        data
      );

      this.emit('publicKeyEncrypted', {
        originalSize: data.length,
        encryptedSize: encrypted.length
      });

      return encrypted;
    } catch (error) {
      this.emit('publicKeyEncryptionError', error);
      throw error;
    }
  }

  /**
   * 使用私钥解密
   */
  decryptWithPrivateKey(encryptedData: Buffer, privateKey: string): Buffer {
    try {
      const decrypted = crypto.privateDecrypt(
        {
          key: privateKey,
          padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
          oaepHash: 'sha256'
        },
        encryptedData
      );

      this.emit('privateKeyDecrypted', {
        encryptedSize: encryptedData.length,
        decryptedSize: decrypted.length
      });

      return decrypted;
    } catch (error) {
      this.emit('privateKeyDecryptionError', error);
      throw error;
    }
  }

  /**
   * 派生密钥
   */
  private async deriveKey(password: string, salt: Buffer): Promise<Buffer> {
    const cacheKey = `${password}:${salt.toString('hex')}`;
    const cached = this.keyCache.get(cacheKey);
    
    if (cached) {
      return cached.key;
    }

    let key: Buffer;

    switch (this.config.keyDerivation) {
      case KeyDerivationAlgorithm.PBKDF2:
        key = crypto.pbkdf2Sync(password, salt, this.config.iterations, this.config.keyLength, 'sha256');
        break;
        
      case KeyDerivationAlgorithm.SCRYPT:
        key = crypto.scryptSync(password, salt, this.config.keyLength, {
          N: 16384,
          r: 8,
          p: 1
        });
        break;
        
      default:
        throw new Error(`Unsupported key derivation algorithm: ${this.config.keyDerivation}`);
    }

    // 缓存密钥
    const keyInfo: KeyInfo = {
      key,
      salt,
      algorithm: this.config.keyDerivation,
      iterations: this.config.iterations
    };
    
    this.keyCache.set(cacheKey, keyInfo);

    // 限制缓存大小
    if (this.keyCache.size > 100) {
      const firstKey = this.keyCache.keys().next().value;
      if (firstKey) {
        this.keyCache.delete(firstKey);
      }
    }

    this.emit('keyDerived', {
      algorithm: this.config.keyDerivation,
      iterations: this.config.iterations,
      keyLength: key.length
    });

    return key;
  }

  /**
   * 清除密钥缓存
   */
  clearKeyCache(): void {
    this.keyCache.clear();
    this.emit('keyCacheCleared');
  }

  /**
   * 更新加密配置
   */
  updateConfig(config: Partial<EncryptionConfig>): void {
    this.config = { ...this.config, ...config };
    this.clearKeyCache(); // 清除缓存以使用新配置
    this.emit('configUpdated', this.config);
  }

  /**
   * 获取当前配置
   */
  getConfig(): EncryptionConfig {
    return { ...this.config };
  }
}