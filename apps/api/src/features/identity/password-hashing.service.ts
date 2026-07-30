import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';

/**
 * Service for password hashing and verification using bcrypt.
 *
 * Uses a cost factor of 12 as a balanced default between security and
 * performance. Each password gets a unique salt (bcrypt built-in).
 *
 * Never stores or logs plaintext passwords.
 */
@Injectable()
export class PasswordHashingService {
  private readonly saltRounds = 12;

  /**
   * Hash a plaintext password.
   * Returns the bcrypt hash string including the embedded salt.
   */
  async hash(plaintext: string): Promise<string> {
    return bcrypt.hash(plaintext, this.saltRounds);
  }

  /**
   * Verify a plaintext password against a bcrypt hash.
   * Returns true if the password matches the hash.
   *
   * Handles malformed or unsupported hash values gracefully
   * by returning false instead of throwing.
   */
  async verify(plaintext: string, hash: string): Promise<boolean> {
    try {
      return await bcrypt.compare(plaintext, hash);
    } catch {
      return false;
    }
  }
}
