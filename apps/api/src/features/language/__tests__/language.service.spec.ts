import { describe, it, expect, vi } from 'vitest';
import { GlobalRole } from '@prisma/client';
import type { AuthenticatedUser } from '../../identity/auth.service';
import { LanguageService, type LanguageSessionData } from '../language.service';

type UserRecord = { id: string; locale: string | null };

function createMockDb() {
  return {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  };
}

function createUser(role: GlobalRole): AuthenticatedUser {
  return {
    id: 'user-1',
    username: 'alice',
    displayName: 'Alice',
    role,
    status: 'ACTIVE' as never,
    memberships: [],
  };
}

describe('LanguageService', () => {
  describe('resolveLanguage fuer READ_ONLY', () => {
    it('nutzt die in der Sitzung gewaehlte Sprache vor der Browserpraeferenz', async () => {
      const db = createMockDb();
      const service = new LanguageService(db as never);
      const session: LanguageSessionData = { language: 'de' };

      const result = await service.resolveLanguage(
        createUser(GlobalRole.READ_ONLY),
        session,
        'en-US,en;q=0.9',
      );

      expect(result).toEqual({ language: 'de', persistence: 'session' });
      expect(db.user.findUnique).not.toHaveBeenCalled();
    });

    it('nutzt die Browserpraeferenz, wenn keine Sprache in der Sitzung liegt', async () => {
      const db = createMockDb();
      const service = new LanguageService(db as never);

      const result = await service.resolveLanguage(
        createUser(GlobalRole.READ_ONLY),
        {},
        'de-DE,de;q=0.9,en;q=0.8',
      );

      expect(result).toEqual({ language: 'de', persistence: 'session' });
    });

    it('faellt ohne Sitzungs- und Browserpraeferenz auf Englisch zurueck', async () => {
      const db = createMockDb();
      const service = new LanguageService(db as never);

      const result = await service.resolveLanguage(
        createUser(GlobalRole.READ_ONLY),
        undefined,
        undefined,
      );

      expect(result).toEqual({ language: 'en', persistence: 'session' });
    });

    it('behandelt ungueltige Sitzungswerte als unbekannt (Fallback Browser/Englisch)', async () => {
      const db = createMockDb();
      const service = new LanguageService(db as never);

      const withInvalid = await service.resolveLanguage(
        createUser(GlobalRole.READ_ONLY),
        { language: 'fr-FR' },
        undefined,
      );
      expect(withInvalid.language).toBe('en');

      const withBrowser = await service.resolveLanguage(
        createUser(GlobalRole.READ_ONLY),
        { language: 'it-IT' },
        'de;q=1',
      );
      expect(withBrowser).toEqual({ language: 'de', persistence: 'session' });
    });

    it('liest fuer READ_ONLY niemals die Datenbank', async () => {
      const db = createMockDb();
      const service = new LanguageService(db as never);

      await service.resolveLanguage(createUser(GlobalRole.READ_ONLY), {}, 'en;q=1');

      expect(db.user.findUnique).not.toHaveBeenCalled();
      expect(db.user.update).not.toHaveBeenCalled();
    });
  });

  describe('resolveLanguage fuer USER/ADMIN', () => {
    it('nutzt die gespeicherte Kontoeinstellung', async () => {
      const db = createMockDb();
      db.user.findUnique.mockResolvedValue({ id: 'user-1', locale: 'de' } as UserRecord);
      const service = new LanguageService(db as never);

      const result = await service.resolveLanguage(
        createUser(GlobalRole.USER),
        undefined,
        'en-US,en;q=0.9',
      );

      expect(result).toEqual({ language: 'de', persistence: 'persistent' });
    });

    it('nutzt die Browserpraeferenz, wenn keine Einstellung gespeichert ist', async () => {
      const db = createMockDb();
      db.user.findUnique.mockResolvedValue({ id: 'user-1', locale: null } as UserRecord);
      const service = new LanguageService(db as never);

      const result = await service.resolveLanguage(
        createUser(GlobalRole.ADMIN),
        undefined,
        'de-DE,de;q=0.9',
      );

      expect(result).toEqual({ language: 'de', persistence: 'persistent' });
    });

    it('faellt auf Englisch zurueck, wenn weder gespeichert noch Browser praeferiert', async () => {
      const db = createMockDb();
      db.user.findUnique.mockResolvedValue({ id: 'user-1', locale: null } as UserRecord);
      const service = new LanguageService(db as never);

      const result = await service.resolveLanguage(
        createUser(GlobalRole.USER),
        undefined,
        'fr-FR,fr;q=0.9',
      );

      expect(result).toEqual({ language: 'en', persistence: 'persistent' });
    });

    it('normalisiert gespeicherte Legacy-Werte sicher auf Englisch', async () => {
      const db = createMockDb();
      db.user.findUnique.mockResolvedValue({ id: 'user-1', locale: 'de-DE' } as UserRecord);
      const service = new LanguageService(db as never);

      const result = await service.resolveLanguage(createUser(GlobalRole.USER), undefined, undefined);

      expect(result.language).toBe('en');
    });
  });

  describe('setLanguage fuer READ_ONLY', () => {
    it('speichert die Sprache ausschliesslich in der Sitzung, nie in der Datenbank', async () => {
      const db = createMockDb();
      const service = new LanguageService(db as never);
      const session: LanguageSessionData = {};

      const result = await service.setLanguage(
        createUser(GlobalRole.READ_ONLY),
        session,
        'de',
      );

      expect(result).toEqual({ language: 'de', persistence: 'session' });
      expect(session.language).toBe('de');
      expect(db.user.update).not.toHaveBeenCalled();
      expect(db.user.findUnique).not.toHaveBeenCalled();
    });

    it('lehnt ungueltige Sprachwerte ab und persistiert nichts', async () => {
      const db = createMockDb();
      const service = new LanguageService(db as never);
      const session: LanguageSessionData = {};

      await expect(
        service.setLanguage(createUser(GlobalRole.READ_ONLY), session, 'fr-FR'),
      ).rejects.toThrow();

      expect(session.language).toBeUndefined();
      expect(db.user.update).not.toHaveBeenCalled();
    });
  });

  describe('setLanguage fuer USER/ADMIN', () => {
    it('speichert die Sprache dauerhaft in users.locale', async () => {
      const db = createMockDb();
      db.user.update.mockResolvedValue({ id: 'user-1', locale: 'de' } as UserRecord);
      const service = new LanguageService(db as never);

      const result = await service.setLanguage(
        createUser(GlobalRole.USER),
        undefined,
        'de',
      );

      expect(result).toEqual({ language: 'de', persistence: 'persistent' });
      expect(db.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { locale: 'de' },
      });
    });

    it('schreibt nichts in die Sitzung fuer USER/ADMIN', async () => {
      const db = createMockDb();
      db.user.update.mockResolvedValue({ id: 'user-1', locale: 'en' } as UserRecord);
      const service = new LanguageService(db as never);
      const session: LanguageSessionData = {};

      await service.setLanguage(createUser(GlobalRole.USER), session, 'en');

      expect(session.language).toBeUndefined();
    });

    it('lehnt ungueltige Sprachwerte ab und schreibt nicht in die Datenbank', async () => {
      const db = createMockDb();
      const service = new LanguageService(db as never);

      await expect(
        service.setLanguage(createUser(GlobalRole.USER), undefined, 'de-DE'),
      ).rejects.toThrow();
      expect(db.user.update).not.toHaveBeenCalled();
    });
  });
});
