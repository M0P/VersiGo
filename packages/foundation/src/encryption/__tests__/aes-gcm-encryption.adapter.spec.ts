import { describe, expect, it } from 'vitest';
import { AppConfigService } from '../../config';
import { AesGcmEncryptionAdapter } from '../aes-gcm-encryption.adapter';

const validKey = 'b'.repeat(64);

function buildConfig(): AppConfigService {
  return new AppConfigService({
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/insura',
    REDIS_URL: 'redis://localhost:6379',
    SETTINGS_ENCRYPTION_KEY: validKey,
    SESSION_SECRET: 'a'.repeat(32),
  });
}

describe('AesGcmEncryptionAdapter', () => {
  it('verschluesselt und entschluesselt einen Klartext korrekt', async () => {
    const adapter = new AesGcmEncryptionAdapter(buildConfig());
    const plain = 'geheimer-api-key-12345';

    const cipherText = await adapter.encrypt(plain);
    expect(cipherText).not.toContain(plain);

    const decrypted = await adapter.decrypt(cipherText);
    expect(decrypted).toBe(plain);
  });

  it('erzeugt unterschiedliche Chiffrate fuer denselben Klartext (zufaelliger IV)', async () => {
    const adapter = new AesGcmEncryptionAdapter(buildConfig());
    const plain = 'gleicher-wert';

    const c1 = await adapter.encrypt(plain);
    const c2 = await adapter.encrypt(plain);

    expect(c1).not.toBe(c2);
  });

  it('wirft einen Fehler bei manipuliertem Chiffrat', async () => {
    const adapter = new AesGcmEncryptionAdapter(buildConfig());
    const cipherText = await adapter.encrypt('wert');
    const tampered = cipherText.slice(0, -4) + 'abcd';

    await expect(adapter.decrypt(tampered)).rejects.toThrow();
  });

  it('wirft einen Fehler bei ungueltigem Format', async () => {
    const adapter = new AesGcmEncryptionAdapter(buildConfig());
    await expect(adapter.decrypt('kein-gueltiges-format')).rejects.toThrow(
      /Ungueltiges Chiffrat-Format/,
    );
  });
});
