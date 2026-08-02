import { describe, it, expect, vi } from 'vitest';
import { AuthController } from '../auth.controller';
import { GlobalRole, UserStatus } from '@prisma/client';
import { ConflictException, HttpException, HttpStatus } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth.service';

type OidcStrategyLike = {
  isEnabled: ReturnType<typeof vi.fn>;
  getAuthorizationUrl: ReturnType<typeof vi.fn>;
  callbackParams: ReturnType<typeof vi.fn>;
  validateCallback: ReturnType<typeof vi.fn>;
};

type AuthServiceLike = {
  localLogin: ReturnType<typeof vi.fn>;
  registerLocalAccount: ReturnType<typeof vi.fn>;
};

type CapabilitiesLike = {
  isEnabled: ReturnType<typeof vi.fn>;
  snapshot: ReturnType<typeof vi.fn>;
};

type RateLimiterLike = {
  isBlocked: ReturnType<typeof vi.fn>;
  recordAttempt: ReturnType<typeof vi.fn>;
  resetAttempts: ReturnType<typeof vi.fn>;
};

type SessionLike = {
  userId?: string;
  oidcCodeVerifier?: string;
  oidcState?: string;
  regenerate: (callback: (err?: Error | null) => void) => void;
  destroy: (callback: () => void) => void;
};

type RequestLike = {
  ip?: string;
  socket?: { remoteAddress?: string };
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
  username: 'alice',
  displayName: 'A',
  role: GlobalRole.USER,
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

function createMockAuthService(): AuthServiceLike {
  return {
    localLogin: vi.fn(),
    registerLocalAccount: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockCapabilities(): CapabilitiesLike {
  return {
    isEnabled: vi.fn(),
    snapshot: vi.fn(),
  };
}

function createMockRateLimiter(): RateLimiterLike {
  return {
    isBlocked: vi.fn().mockResolvedValue(false),
    recordAttempt: vi.fn().mockResolvedValue(1),
    resetAttempts: vi.fn().mockResolvedValue(undefined),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createController(overrides?: Record<string, any>): AuthController {
  return new AuthController(
    overrides?.oidc ?? createMockOidc(),
    overrides?.authService ?? createMockAuthService(),
    overrides?.capabilities ?? createMockCapabilities(),
    overrides?.rateLimiter ?? createMockRateLimiter(),
  ) as unknown as AuthController;
}

describe('AuthController', () => {
  it('/auth/me liefert den authentifizierten User aus dem Request-Kontext zurueck', () => {
    const controller = createController();
    const user: AuthenticatedUser = {
      id: 'user-1',
      username: 'alice',
      displayName: 'A',
      role: GlobalRole.USER,
      status: 'ACTIVE' as never,
      memberships: [],
    };
    expect(controller.me(user)).toEqual(user);
  });

  it('/auth/callback rotiert die Session vor dem Setzen der userId (Session-Fixation-Schutz)', async () => {
    const oidc = createMockOidc();
    const controller = createController({ oidc });
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
    const controller = createController();
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
    expect(res.clearCookie).toHaveBeenCalledWith('versigo.sid');
    expect(res.status).toHaveBeenCalledWith(204);
  });

  describe('GET /auth/login (OIDC redirect)', () => {
    it('leitet zur OIDC-Provider-URL weiter und speichert codeVerifier/state in der Session', async () => {
      const oidc = createMockOidc();
      oidc.isEnabled.mockReturnValue(true);
      const controller = createController({ oidc });
      const regenerate = vi.fn();
      const req = {
        session: { regenerate },
      } as unknown as RequestLike;
      const res = {
        redirect: vi.fn(),
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      } as ResponseLike;

      await controller.login(req as never, res as never);

      expect(oidc.getAuthorizationUrl).toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith('https://provider.example.com/auth');
      expect(req.session.oidcCodeVerifier).toBe('verifier');
      expect(req.session.oidcState).toBe('state');
    });

    it('gibt 501 wenn OIDC deaktiviert ist (bleibt unabhaengig von lokaler Auth)', async () => {
      const oidc = createMockOidc();
      oidc.isEnabled.mockReturnValue(false);
      const controller = createController({ oidc });
      const req = { session: { regenerate: vi.fn() } } as unknown as RequestLike;
      const res = {
        redirect: vi.fn(),
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      } as ResponseLike;

      await controller.login(req as never, res as never);

      expect(res.status).toHaveBeenCalledWith(501);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining('OIDC') }),
      );
    });
  });

  describe('GET /auth/config', () => {
    it('gibt verfuegbare Authentifizierungsmethoden zurueck', () => {
      const capabilities = createMockCapabilities();
      capabilities.isEnabled.mockImplementation((key: string) => key === 'local');
      const oidc = createMockOidc();
      oidc.isEnabled.mockReturnValue(false);
      const controller = createController({ capabilities, oidc });

      const result = controller.getAuthConfig();
      expect(result).toEqual({ oidcEnabled: false, localEnabled: true, registrationEnabled: true });
    });

    it('zeigt beide Methoden wenn aktiviert', () => {
      const capabilities = createMockCapabilities();
      capabilities.isEnabled.mockReturnValue(true);
      const oidc = createMockOidc();
      oidc.isEnabled.mockReturnValue(true);
      const controller = createController({ capabilities, oidc });

      const result = controller.getAuthConfig();
      expect(result).toEqual({ oidcEnabled: true, localEnabled: true, registrationEnabled: true });
    });

    it('meldet OIDC als deaktiviert, wenn die Strategie trotz Capability nicht bereit ist (Discovery fehlgeschlagen)', () => {
      const capabilities = createMockCapabilities();
      capabilities.isEnabled.mockImplementation((key: string) => key === 'oidc');
      const oidc = createMockOidc();
      oidc.isEnabled.mockReturnValue(false);
      const controller = createController({ capabilities, oidc });

      const result = controller.getAuthConfig();
      expect(result).toEqual({ oidcEnabled: false, localEnabled: false, registrationEnabled: false });
    });
  });

  describe('POST /auth/register', () => {
    const registerReq = {
      ip: '1.2.3.4',
      socket: { remoteAddress: '1.2.3.4' },
      session: { regenerate: vi.fn() },
    };

    it('registriert einen lokalen Account und meldet PENDING_APPROVAL', async () => {
      const capabilities = createMockCapabilities();
      capabilities.isEnabled.mockReturnValue(true);
      const authService = createMockAuthService();
      const rateLimiter = createMockRateLimiter();
      const controller = createController({ capabilities, authService, rateLimiter });

      const result = await controller.register(
        registerReq as never,
        {
          username: 'newuser',
          displayName: 'New User',
          password: 'supersecret123',
        },
      );

      expect(authService.registerLocalAccount).toHaveBeenCalledWith({
        username: 'newuser',
        displayName: 'New User',
        password: 'supersecret123',
      });
      expect(rateLimiter.isBlocked).toHaveBeenCalledWith('1.2.3.4', 'register');
      expect(rateLimiter.recordAttempt).toHaveBeenCalledWith('1.2.3.4', 'register');
      expect(result).toEqual({ status: 'PENDING_APPROVAL' });
    });

    it('gibt 501 wenn lokale Registrierung nicht konfiguriert ist', async () => {
      const capabilities = createMockCapabilities();
      capabilities.isEnabled.mockReturnValue(false);
      const authService = createMockAuthService();
      const controller = createController({ capabilities, authService });

      await expect(
        controller.register(
          registerReq as never,
          {
            username: 'newuser',
            displayName: 'New User',
            password: 'supersecret123',
          },
        ),
      ).rejects.toMatchObject({ status: HttpStatus.NOT_IMPLEMENTED });
      expect(authService.registerLocalAccount).not.toHaveBeenCalled();
    });

    it('gibt 429 wenn die IP registrierungs-limitiert ist (Scope register)', async () => {
      const capabilities = createMockCapabilities();
      capabilities.isEnabled.mockReturnValue(true);
      const authService = createMockAuthService();
      const rateLimiter = createMockRateLimiter();
      rateLimiter.isBlocked.mockResolvedValue(true);
      const controller = createController({ capabilities, authService, rateLimiter });

      await expect(
        controller.register(
          registerReq as never,
          {
            username: 'newuser',
            displayName: 'New User',
            password: 'supersecret123',
          },
        ),
      ).rejects.toThrow(HttpException);
      expect(rateLimiter.isBlocked).toHaveBeenCalledWith('1.2.3.4', 'register');
      expect(authService.registerLocalAccount).not.toHaveBeenCalled();
    });

    it('zaehlt fehlgeschlagene Registrierungen (409) im Scope register', async () => {
      const capabilities = createMockCapabilities();
      capabilities.isEnabled.mockReturnValue(true);
      const authService = createMockAuthService();
      authService.registerLocalAccount.mockRejectedValue(
        new ConflictException('Benutzername ist bereits vergeben'),
      );
      const rateLimiter = createMockRateLimiter();
      const controller = createController({ capabilities, authService, rateLimiter });

      await expect(
        controller.register(
          registerReq as never,
          {
            username: 'newuser',
            displayName: 'New User',
            password: 'supersecret123',
          },
        ),
      ).rejects.toThrow(ConflictException);
      expect(rateLimiter.recordAttempt).toHaveBeenCalledWith('1.2.3.4', 'register');
    });
  });

  describe('POST /auth/local/login', () => {
    it('gibt 501 wenn lokale Auth deaktiviert ist', async () => {
      const capabilities = createMockCapabilities();
      capabilities.isEnabled.mockReturnValue(false);
      const controller = createController({ capabilities });
      const req = { session: { regenerate: vi.fn() } } as unknown as RequestLike;
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      } as ResponseLike;

      await controller.localLogin(req as never, res as never, { username: 'test', password: 'pass' });
      expect(res.status).toHaveBeenCalledWith(501);
    });

    it('gibt 429 wenn IP rate-limitiert ist', async () => {
      const capabilities = createMockCapabilities();
      capabilities.isEnabled.mockReturnValue(true);
      const rateLimiter = createMockRateLimiter();
      rateLimiter.isBlocked.mockResolvedValue(true);
      const controller = createController({ capabilities, rateLimiter });
      const req = { ip: '1.2.3.4', socket: {}, session: { regenerate: vi.fn() } } as unknown as RequestLike;
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      } as ResponseLike;

      await controller.localLogin(req as never, res as never, { username: 'test', password: 'pass' });
      expect(res.status).toHaveBeenCalledWith(429);
    });

    it('gibt 400 bei fehlenden Feldern', async () => {
      const capabilities = createMockCapabilities();
      capabilities.isEnabled.mockReturnValue(true);
      const controller = createController({ capabilities });
      const req = { ip: '1.2.3.4', socket: {}, session: { regenerate: vi.fn() } } as unknown as RequestLike;
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      } as ResponseLike;

      await controller.localLogin(req as never, res as never, { username: '', password: '' });
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('gibt 401 bei ungueltigen Anmeldedaten (generic)', async () => {
      const capabilities = createMockCapabilities();
      capabilities.isEnabled.mockReturnValue(true);
      const authService = createMockAuthService();
      authService.localLogin.mockResolvedValue(null);
      const controller = createController({ capabilities, authService });
      const req = { ip: '1.2.3.4', socket: {}, session: { regenerate: vi.fn() } } as unknown as RequestLike;
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      } as ResponseLike;

      await controller.localLogin(req as never, res as never, { username: 'test', password: 'wrong' });
      expect(res.status).toHaveBeenCalledWith(401);
    });

    it('gibt 200 und User bei erfolgreichem Login', async () => {
      const capabilities = createMockCapabilities();
      capabilities.isEnabled.mockReturnValue(true);
      const authService = createMockAuthService();
      authService.localLogin.mockResolvedValue(mockUser);
      const rateLimiter = createMockRateLimiter();
      const controller = createController({ capabilities, authService, rateLimiter });
      const regenerate = vi.fn((cb: (err?: Error | null) => void) => cb());
      const req = { ip: '1.2.3.4', socket: {}, session: { regenerate } } as unknown as RequestLike;
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      } as ResponseLike;

      await controller.localLogin(req as never, res as never, { username: 'test', password: 'correct' });
      expect(regenerate).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(rateLimiter.resetAttempts).toHaveBeenCalledWith('1.2.3.4');
    });

    it('zaehlt fehlgeschlagene Versuche im Rate-Limiter', async () => {
      const capabilities = createMockCapabilities();
      capabilities.isEnabled.mockReturnValue(true);
      const authService = createMockAuthService();
      authService.localLogin.mockResolvedValue(null);
      const rateLimiter = createMockRateLimiter();
      const controller = createController({ capabilities, authService, rateLimiter });
      const req = { ip: '1.2.3.4', socket: {}, session: { regenerate: vi.fn() } } as unknown as RequestLike;
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      } as ResponseLike;

      await controller.localLogin(req as never, res as never, { username: 'test', password: 'wrong' });
      expect(rateLimiter.recordAttempt).toHaveBeenCalledWith('1.2.3.4');
    });
  });
});
