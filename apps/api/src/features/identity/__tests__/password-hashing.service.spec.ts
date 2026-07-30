import { describe, it, expect } from 'vitest';
import { PasswordHashingService } from '../password-hashing.service';

describe('PasswordHashingService', () => {
  const service = new PasswordHashingService();

  describe('hash', () => {
    it('produziert einen Hash fuer ein gueltiges Passwort', async () => {
      const hash = await service.hash('mein-sicheres-passwort');
      expect(hash).toBeTruthy();
      expect(typeof hash).toBe('string');
      // bcrypt Hashes beginnen mit $2b$ oder $2a$
      expect(hash).toMatch(/^\$2[aby]\$\d{2}\$/);
    });

    it('erzeugt unterschiedliche Hashes fuer dasselbe Passwort (unterschiedliche Salts)', async () => {
      const hash1 = await service.hash('passwort');
      const hash2 = await service.hash('passwort');
      expect(hash1).not.toBe(hash2);
    });
  });

  describe('verify', () => {
    it('bestaeigt ein korrektes Passwort', async () => {
      const hash = await service.hash('mein-passwort');
      const result = await service.verify('mein-passwort', hash);
      expect(result).toBe(true);
    });

    it('weist ein falsches Passwort zurueck', async () => {
      const hash = await service.hash('richtiges-passwort');
      const result = await service.verify('falsches-passwort', hash);
      expect(result).toBe(false);
    });

    it('gibt false bei malformiertem Hash zurueck (kein Throw)', async () => {
      const result = await service.verify('passwort', 'ungueltiger-hash');
      expect(result).toBe(false);
    });

    it('gibt false bei leerem Hash zurueck', async () => {
      const result = await service.verify('passwort', '');
      expect(result).toBe(false);
    });

    it('gibt false bei leerem Passwort zurueck', async () => {
      const hash = await service.hash('passwort');
      const result = await service.verify('', hash);
      expect(result).toBe(false);
    });
  });
});
