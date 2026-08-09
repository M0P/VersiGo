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
  describe('resolveLanguage for READ_ONLY', () => {
    it('uses the language selected in the session over the browser preference', async () => {
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

    it('uses the browser preference when the session holds no language', async () => {
      const db = createMockDb();
      const service = new LanguageService(db as never);

      const result = await service.resolveLanguage(
        createUser(GlobalRole.READ_ONLY),
        {},
        'de-DE,de;q=0.9,en;q=0.8',
      );

      expect(result).toEqual({ language: 'de', persistence: 'session' });
    });

    it('falls back to English without a session or browser preference', async () => {
      const db = createMockDb();
      const service = new LanguageService(db as never);

      const result = await service.resolveLanguage(
        createUser(GlobalRole.READ_ONLY),
        undefined,
        undefined,
      );

      expect(result).toEqual({ language: 'en', persistence: 'session' });
    });

    it('treats invalid session values as unknown (browser/English fallback)', async () => {
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

    it('never reads the database for READ_ONLY', async () => {
      const db = createMockDb();
      const service = new LanguageService(db as never);

      await service.resolveLanguage(createUser(GlobalRole.READ_ONLY), {}, 'en;q=1');

      expect(db.user.findUnique).not.toHaveBeenCalled();
      expect(db.user.update).not.toHaveBeenCalled();
    });
  });

  describe('resolveLanguage for USER/ADMIN', () => {
    it('uses the stored account preference', async () => {
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

    it('uses the browser preference when no preference is stored', async () => {
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

    it('falls back to English when neither a stored preference nor the browser prefers one', async () => {
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

    it('safely normalizes stored legacy values to English', async () => {
      const db = createMockDb();
      db.user.findUnique.mockResolvedValue({ id: 'user-1', locale: 'de-DE' } as UserRecord);
      const service = new LanguageService(db as never);

      const result = await service.resolveLanguage(createUser(GlobalRole.USER), undefined, undefined);

      expect(result.language).toBe('en');
    });
  });

  describe('setLanguage for READ_ONLY', () => {
    it('stores the language only in the session, never in the database', async () => {
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

    it('rejects invalid language values and persists nothing', async () => {
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

  describe('setLanguage for USER/ADMIN', () => {
    it('persists the language in users.locale', async () => {
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

    it('writes nothing to the session for USER/ADMIN', async () => {
      const db = createMockDb();
      db.user.update.mockResolvedValue({ id: 'user-1', locale: 'en' } as UserRecord);
      const service = new LanguageService(db as never);
      const session: LanguageSessionData = {};

      await service.setLanguage(createUser(GlobalRole.USER), session, 'en');

      expect(session.language).toBeUndefined();
    });

    it('rejects invalid language values and writes nothing to the database', async () => {
      const db = createMockDb();
      const service = new LanguageService(db as never);

      await expect(
        service.setLanguage(createUser(GlobalRole.USER), undefined, 'de-DE'),
      ).rejects.toThrow();
      expect(db.user.update).not.toHaveBeenCalled();
    });
  });
});
