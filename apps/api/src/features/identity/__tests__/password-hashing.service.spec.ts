import { describe, it, expect } from 'vitest';
import { PasswordHashingService } from '../password-hashing.service';

describe('PasswordHashingService', () => {
  const service = new PasswordHashingService();

  describe('hash', () => {
    it('produces a hash for a valid password', async () => {
      const hash = await service.hash('mein-sicheres-passwort');
      expect(hash).toBeTruthy();
      expect(typeof hash).toBe('string');
      // bcrypt hashes start with $2b$ or $2a$
      expect(hash).toMatch(/^\$2[aby]\$\d{2}\$/);
    });

    it('generates different hashes for the same password (different salts)', async () => {
      const hash1 = await service.hash('passwort');
      const hash2 = await service.hash('passwort');
      expect(hash1).not.toBe(hash2);
    });
  });

  describe('verify', () => {
    it('verifies a correct password', async () => {
      const hash = await service.hash('mein-passwort');
      const result = await service.verify('mein-passwort', hash);
      expect(result).toBe(true);
    });

    it('rejects a wrong password', async () => {
      const hash = await service.hash('richtiges-passwort');
      const result = await service.verify('falsches-passwort', hash);
      expect(result).toBe(false);
    });

    it('returns false for a malformed hash (no throw)', async () => {
      const result = await service.verify('passwort', 'ungueltiger-hash');
      expect(result).toBe(false);
    });

    it('returns false for an empty hash', async () => {
      const result = await service.verify('passwort', '');
      expect(result).toBe(false);
    });

    it('returns false for an empty password', async () => {
      const hash = await service.hash('passwort');
      const result = await service.verify('', hash);
      expect(result).toBe(false);
    });
  });
});
