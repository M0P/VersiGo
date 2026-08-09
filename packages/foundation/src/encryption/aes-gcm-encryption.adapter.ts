import { Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { AppConfigService } from '../config';
import { EncryptionPort } from './encryption.port';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH_BYTES = 12;

/**
 * AES-256-GCM adapter for the EncryptionPort.
 * The key is read exclusively from the validated configuration
 * (SETTINGS_ENCRYPTION_KEY), never hardcoded.
 * Cipher format: base64(iv):base64(authTag):base64(ciphertext)
 */
@Injectable()
export class AesGcmEncryptionAdapter implements EncryptionPort {
  private readonly key: Buffer;

  constructor(config: AppConfigService) {
    this.key = Buffer.from(config.encryptionKeyHex, 'hex');
  }

  async encrypt(plainText: string): Promise<string> {
    const iv = randomBytes(IV_LENGTH_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return [iv.toString('base64'), authTag.toString('base64'), ciphertext.toString('base64')].join(':');
  }

  async decrypt(cipherText: string): Promise<string> {
    const [ivB64, authTagB64, dataB64] = cipherText.split(':');
    if (!ivB64 || !authTagB64 || !dataB64) {
      throw new Error('Invalid ciphertext format');
    }

    const iv = Buffer.from(ivB64, 'base64');
    const authTag = Buffer.from(authTagB64, 'base64');
    const data = Buffer.from(dataB64, 'base64');

    const decipher = createDecipheriv(ALGORITHM, this.key, iv);
    decipher.setAuthTag(authTag);

    const plainBuffer = Buffer.concat([decipher.update(data), decipher.final()]);
    return plainBuffer.toString('utf8');
  }
}
