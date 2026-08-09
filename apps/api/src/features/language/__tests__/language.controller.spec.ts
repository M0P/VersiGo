import { describe, it, expect, vi } from 'vitest';
import { GlobalRole } from '@prisma/client';
import { ROLES_KEY } from '../../identity/roles.decorator';
import type { AuthenticatedUser } from '../../identity/auth.service';
import { LanguageController } from '../language.controller';

type ServiceLike = {
  resolveLanguage: ReturnType<typeof vi.fn>;
  setLanguage: ReturnType<typeof vi.fn>;
};

function createMockService(): ServiceLike {
  return { resolveLanguage: vi.fn(), setLanguage: vi.fn() };
}

const mockUser: AuthenticatedUser = {
  id: 'user-1',
  username: 'alice',
  displayName: 'Alice',
  role: GlobalRole.READ_ONLY,
  status: 'ACTIVE' as never,
  memberships: [],
};

describe('LanguageController', () => {
  it('already allows READ_ONLY at the controller level (lowest role)', () => {
    const roles = Reflect.getMetadata(ROLES_KEY, LanguageController);
    expect(roles).toContain(GlobalRole.READ_ONLY);
  });

  it('get delegates user, session and Accept-Language to the service', async () => {
    const service = createMockService();
    const controller = new LanguageController(service as never);
    service.resolveLanguage.mockResolvedValue({ language: 'de', persistence: 'session' });

    const result = await controller.get(mockUser, {
      session: { language: 'de' },
      headers: { 'accept-language': 'de-DE,de;q=0.9' },
    });

    expect(result).toEqual({ language: 'de', persistence: 'session' });
    expect(service.resolveLanguage).toHaveBeenCalledWith(
      mockUser,
      { language: 'de' },
      'de-DE,de;q=0.9',
    );
  });

  it('get tolerates a missing session and a missing Accept-Language header', async () => {
    const service = createMockService();
    const controller = new LanguageController(service as never);
    service.resolveLanguage.mockResolvedValue({ language: 'en', persistence: 'session' });

    const result = await controller.get(mockUser, {});

    expect(result.language).toBe('en');
    expect(service.resolveLanguage).toHaveBeenCalledWith(mockUser, undefined, undefined);
  });

  it('set delegates user, session and DTO to the service', async () => {
    const service = createMockService();
    const controller = new LanguageController(service as never);
    service.setLanguage.mockResolvedValue({ language: 'de', persistence: 'session' });

    const result = await controller.set(mockUser, { session: {} }, { language: 'de' });

    expect(result).toEqual({ language: 'de', persistence: 'session' });
    expect(service.setLanguage).toHaveBeenCalledWith(mockUser, {}, 'de');
  });
});
