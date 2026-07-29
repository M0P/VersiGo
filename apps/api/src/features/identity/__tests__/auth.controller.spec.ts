import { describe, it, expect, vi } from 'vitest';
import { AuthController } from '../auth.controller';
import { UserStatus } from '@prisma/client';
import type { AuthenticatedUser } from '../auth.service';

type OidcStrategyLike = {
  isEnabled: ReturnType<typeof vi.fn>;
  getAuthorizationUrl: ReturnType<typeof vi.fn>;
  callbackParams: ReturnType<typeof vi.fn>;
  validateCallback: ReturnType<typeof vi.fn>;
};

type SessionLike = {
  userId?: string;
  oidcCodeVerifier?: string;
  oidcState?: string;
  regenerate: (callback: () => void) => void;
  destroy: (callback: () => void) => void;
};

type RequestLike = {
  user?: AuthenticatedUser | { id: string };
  session: SessionLike;
  query: Record<string, unknown>;
};

type ResponseLike = {
  redirect: ReturnType<typeof vi.fn>;
  clearCookie: ReturnType<typeof vi.fn>;
  status: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
};

const mockUser: AuthenticatedUser = {
  id: 'user-1',
  email: 'a@example.com',
  displayName: 'A',
  status: UserStatus.ACTIVE,
  memberships: [],
};

function createMockOidc(): OidcStrategyLike {
  return {
    isEnabled: vi.fn().mockReturnValue(true),
    getAuthorizationUrl: vi.fn().mockReturnValue({
      url: 'https://provider.example.com/auth',
      codeVerifier: 'verifier',
      state: 'state',
    }),
    callbackParams: vi.fn().mockReturnValue({ code: 'auth-code', state: 'state' }),
    validateCallback: vi.fn().mockResolvedValue(mockUser),
  };
}

describe('AuthController', () => {
  it('/auth/me liefert den authentifizierten User aus dem Request-Kontext zurueck', () => {
    const controller = new AuthController(createMockOidc() as never);
    const user: AuthenticatedUser = {
      id: 'user-1',
      email: 'a@example.com',
      displayName: 'A',
      status: 'ACTIVE' as never,
      memberships: [],
    };
    expect(controller.me(user)).toEqual(user);
  });

  it('/auth/callback rotiert die Session vor dem Setzen der userId (Session-Fixation-Schutz)', async () => {
    const oidc = createMockOidc();
    const controller = new AuthController(oidc as never);
    const regenerate = vi.fn((cb: () => void) => cb());
    const destroy = vi.fn((cb: () => void) => cb());
    const req = {
      user: { id: 'user-1' },
      session: {
        regenerate,
        destroy,
        oidcCodeVerifier: 'verifier',
        oidcState: 'state',
      },
      query: { code: 'auth-code', state: 'state' },
    } as unknown as RequestLike;
    const res = {
      redirect: vi.fn(),
      clearCookie: vi.fn(),
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
      json: vi.fn(),
    } as ResponseLike;

    await controller.callback(req as never, res as never);

    expect(oidc.validateCallback).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'auth-code' }),
      'verifier',
      'state',
    );
    expect(regenerate).toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith('/');
  });

  it('/auth/logout zerstoert die Session und loescht das Cookie', () => {
    const controller = new AuthController(createMockOidc() as never);
    const regenerate = vi.fn((cb: () => void) => cb());
    const destroy = vi.fn((cb: () => void) => cb());
    const req = {
      session: { regenerate, destroy },
    } as unknown as RequestLike;
    const res = {
      redirect: vi.fn(),
      clearCookie: vi.fn(),
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
      json: vi.fn(),
    } as ResponseLike;

    controller.logout(req as never, res as never);

    expect(destroy).toHaveBeenCalled();
    expect(res.clearCookie).toHaveBeenCalledWith('insura.sid');
    expect(res.status).toHaveBeenCalledWith(204);
  });
});
