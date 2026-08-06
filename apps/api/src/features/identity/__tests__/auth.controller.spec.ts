import { describe, it, expect, vi } from 'vitest';
import { AuthController } from '../auth.controller';
import { GlobalRole, UserStatus } from '@prisma/client';
import { ConflictException, HttpException, HttpStatus } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth.service';

type OidcStrategyLike = {
  isEnabled: ReturnType<typeof vi.fn>;
  getStatus: ReturnType<typeof vi.fn>;
  getAuthorizationUrl: ReturnType<typeof vi.fn>;
  callbackParams: ReturnType<typeof vi.fn>;
  validateCallback: ReturnType<typeof vi.fn>;
  exchangeIdentity: ReturnType<typeof vi.fn>;
};

type AuthServiceLike = {
  localLogin: ReturnType<typeof vi.fn>;
  registerLocalAccount: ReturnType<typeof vi.fn>;
  getOidcBinding: ReturnType<typeof vi.fn>;
  bindOidcIdentityForUser: ReturnType<typeof vi.fn>;
  unbindOidcIdentityForUser: ReturnType<typeof vi.fn>;
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
  oidcLinkMode?: boolean;
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
    isEnabled: vi.fn().mockResolvedValue(true),
    getStatus: vi.fn().mockResolvedValue({ ready: true, error: null }),
    getAuthorizationUrl: vi.fn().mockReturnValue({
      url: 'https://provider.example.com/auth',
      codeVerifier: 'verifier',
      state: 'state',
    }),
    callbackParams: vi.fn().mockReturnValue({ code: 'auth-code', state: 'state' }),
    validateCallback: vi.fn().mockResolvedValue(mockUser),
    exchangeIdentity: vi.fn().mockResolvedValue({
      issuer: 'https://provider.example.com',
      subject: 'sub-1',
    }),
  };
}

function createMockAuthService(): AuthServiceLike {
  return {
    localLogin: vi.fn(),
    registerLocalAccount: vi.fn().mockResolvedValue(undefined),
    getOidcBinding: vi.fn().mockResolvedValue(null),
    bindOidcIdentityForUser: vi.fn().mockResolvedValue({
      oidcIssuer: 'https://provider.example.com',
      oidcSubject: 'sub-1',
    }),
    unbindOidcIdentityForUser: vi.fn().mockResolvedValue(undefined),
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
      oidc.isEnabled.mockResolvedValue(true);
      const controller = createController({ oidc });
      const regenerate = vi.fn();
      const req = {
        session: { regenerate, oidcLinkMode: true },
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
      // BugFix-07 (Code-Review, R2): Stale oidcLinkMode aus einem abgebrochenen
      // Self-Service-Link-Flow darf den Login-Callback nicht in den Link-Modus
      // versetzen.
      expect(req.session.oidcLinkMode).toBeUndefined();
    });

    it('gibt 501 wenn OIDC deaktiviert ist (bleibt unabhaengig von lokaler Auth)', async () => {
      const oidc = createMockOidc();
      oidc.isEnabled.mockResolvedValue(false);
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
    it('gibt verfuegbare Authentifizierungsmethoden zurueck', async () => {
      const capabilities = createMockCapabilities();
      capabilities.isEnabled.mockImplementation(async (key: string) => key === 'local');
      const oidc = createMockOidc();
      oidc.getStatus.mockResolvedValue({ ready: false, error: null });
      const controller = createController({ capabilities, oidc });

      const result = await controller.getAuthConfig();
      expect(result).toEqual({
        oidcEnabled: false,
        oidcReady: false,
        oidcConfigured: false,
        oidcError: null,
        localEnabled: true,
        registrationEnabled: true,
      });
    });

    it('zeigt beide Methoden wenn aktiviert', async () => {
      const capabilities = createMockCapabilities();
      capabilities.isEnabled.mockResolvedValue(true);
      const oidc = createMockOidc();
      oidc.getStatus.mockResolvedValue({ ready: true, error: null });
      const controller = createController({ capabilities, oidc });

      const result = await controller.getAuthConfig();
      expect(result).toEqual({
        oidcEnabled: true,
        oidcReady: true,
        oidcConfigured: true,
        oidcError: null,
        localEnabled: true,
        registrationEnabled: true,
      });
    });

    it('meldet OIDC als deaktiviert, wenn die Strategie trotz Capability nicht bereit ist (Discovery fehlgeschlagen)', async () => {
      const capabilities = createMockCapabilities();
      capabilities.isEnabled.mockImplementation(async (key: string) => key === 'oidc');
      const oidc = createMockOidc();
      oidc.getStatus.mockResolvedValue({ ready: false, error: 'Discovery fehlgeschlagen' });
      const controller = createController({ capabilities, oidc });

      const result = await controller.getAuthConfig();
      expect(result).toEqual({
        oidcEnabled: false,
        oidcReady: false,
        oidcConfigured: true,
        oidcError: 'OIDC ist nicht verfuegbar (Details im Server-Log)',
        localEnabled: false,
        registrationEnabled: false,
      });
    });

    it('BugFix-07: meldet oidcReady=true NUR wenn der Client tatsaechlich bereit ist', async () => {
      const capabilities = createMockCapabilities();
      capabilities.isEnabled.mockImplementation(async (key: string) => key === 'oidc');
      const oidc = createMockOidc();
      // Capability aktiv, Client aber nicht initialisiert (z.B. Neustart
      // fehlt nach Aktivieren von OIDC) => Button darf NICHT erscheinen.
      oidc.getStatus.mockResolvedValue({ ready: false, error: 'OIDC_ISSUER_URL fehlt' });
      const controller = createController({ capabilities, oidc });

      const result = await controller.getAuthConfig();
      expect(result.oidcEnabled).toBe(false);
      expect(result.oidcReady).toBe(false);
      expect(result.oidcConfigured).toBe(true);
      // BugFix-07 (Code-Review): Oeffentlicher Endpunkt leakt keine internen
      // Diagnose-Details mehr, nur noch einen generischen Hinweis.
      expect(result.oidcError).toBe('OIDC ist nicht verfuegbar (Details im Server-Log)');
    });
  });

  describe('Self-Service-OIDC-Verknuepfung (BugFix-07)', () => {
    it('GET /auth/oidc/link liefert den Bindungsstatus', async () => {
      const authService = createMockAuthService();
      authService.getOidcBinding.mockResolvedValue({
        oidcIssuer: 'https://provider.example.com',
        oidcSubject: 'sub-1',
      });
      const oidc = createMockOidc();
      const controller = createController({ authService, oidc });

      const result = await controller.getOidcLink(mockUser);
      expect(result).toEqual({
        linked: true,
        oidcIssuer: 'https://provider.example.com',
        oidcSubject: 'sub-1',
        oidcReady: true,
        oidcError: null,
      });
    });

    it('GET /auth/oidc/link meldet linked=false ohne Bindung', async () => {
      const controller = createController();
      const result = await controller.getOidcLink(mockUser);
      expect(result.linked).toBe(false);
      expect(result.oidcIssuer).toBeNull();
    });

    it('POST /auth/oidc/link setzt den Link-Modus und liefert die Provider-URL', async () => {
      const oidc = createMockOidc();
      const controller = createController({ oidc });
      const session: SessionLike & { oidcLinkMode?: boolean } = {
        oidcCodeVerifier: undefined,
        oidcState: undefined,
        oidcLinkMode: false,
        regenerate: vi.fn(),
        destroy: vi.fn(),
      };
      const req = { session } as unknown as RequestLike;

      const result = await controller.startOidcLink(mockUser, req as never);
      expect(result.url).toBe('https://provider.example.com/auth');
      expect(session.oidcCodeVerifier).toBe('verifier');
      expect(session.oidcState).toBe('state');
      expect(session.oidcLinkMode).toBe(true);
    });

    it('POST /auth/oidc/link gibt 501, wenn OIDC nicht einsatzbereit ist', async () => {
      const oidc = createMockOidc();
      oidc.getStatus.mockResolvedValue({ ready: false, error: 'Discovery fehlgeschlagen' });
      const controller = createController({ oidc });
      const req = { session: {} } as unknown as RequestLike;

      await expect(controller.startOidcLink(mockUser, req as never)).rejects.toMatchObject({
        status: HttpStatus.NOT_IMPLEMENTED,
      });
    });

    it('DELETE /auth/oidc/link loest die Bindung des angemeldeten Users', async () => {
      const authService = createMockAuthService();
      const controller = createController({ authService });
      await controller.unlinkOidc(mockUser);
      expect(authService.unbindOidcIdentityForUser).toHaveBeenCalledWith('user-1');
    });

    it('Callback im Link-Modus bindet die Identitaet an den Session-User (ohne Session-Rotation)', async () => {
      const oidc = createMockOidc();
      const authService = createMockAuthService();
      const controller = createController({ oidc, authService });
      const regenerate = vi.fn((cb: () => void) => cb());
      const destroy = vi.fn((cb: () => void) => cb());
      const session: SessionLike & { oidcLinkMode?: boolean } = {
        userId: 'user-1',
        oidcCodeVerifier: 'verifier',
        oidcState: 'state',
        oidcLinkMode: true,
        regenerate,
        destroy,
      };
      const req = { session } as unknown as RequestLike;
      const res = {
        redirect: vi.fn(),
        clearCookie: vi.fn(),
        status: vi.fn().mockReturnThis(),
        send: vi.fn(),
        json: vi.fn(),
      } as ResponseLike;

      await controller.callback(req as never, res as never);

      expect(oidc.exchangeIdentity).toHaveBeenCalled();
      expect(authService.bindOidcIdentityForUser).toHaveBeenCalledWith(
        'user-1',
        'https://provider.example.com',
        'sub-1',
      );
      // Keine Session-Rotation im Link-Modus (User bleibt eingeloggt).
      expect(regenerate).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith('/settings?oidc=linked');
      expect(session.oidcLinkMode).toBeUndefined();
    });

    it('Callback im Link-Modus ohne Session-User lehnt ab (kein Binden an Unbekannte)', async () => {
      const oidc = createMockOidc();
      const authService = createMockAuthService();
      const controller = createController({ oidc, authService });
      const session = {
        oidcCodeVerifier: 'verifier',
        oidcState: 'state',
        oidcLinkMode: true,
        regenerate: vi.fn(),
        destroy: vi.fn(),
      };
      const req = { session } as unknown as RequestLike;
      const res = {
        redirect: vi.fn(),
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      } as ResponseLike;

      await controller.callback(req as never, res as never);

      expect(authService.bindOidcIdentityForUser).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith('/auth/login?error=not-authenticated');
    });

    it('Callback im Link-Modus leitet bei Konflikt (Identitaet anderweitig gebunden) zu /settings?error=oidc-link-conflict', async () => {
      const oidc = createMockOidc();
      const authService = createMockAuthService();
      authService.bindOidcIdentityForUser.mockRejectedValue(
        new ConflictException('Diese OIDC-Identitaet ist bereits an ein anderes Konto gebunden'),
      );
      const controller = createController({ oidc, authService });
      const session = {
        userId: 'user-1',
        oidcCodeVerifier: 'verifier',
        oidcState: 'state',
        oidcLinkMode: true,
        regenerate: vi.fn(),
        destroy: vi.fn(),
      };
      const req = { session } as unknown as RequestLike;
      const res = {
        redirect: vi.fn(),
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      } as ResponseLike;

      await controller.callback(req as never, res as never);

      expect(res.redirect).toHaveBeenCalledWith('/settings?error=oidc-link-conflict');
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
      capabilities.isEnabled.mockResolvedValue(true);
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
      capabilities.isEnabled.mockResolvedValue(false);
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
      capabilities.isEnabled.mockResolvedValue(true);
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
      capabilities.isEnabled.mockResolvedValue(true);
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
      capabilities.isEnabled.mockResolvedValue(false);
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
      capabilities.isEnabled.mockResolvedValue(true);
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
      capabilities.isEnabled.mockResolvedValue(true);
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
      capabilities.isEnabled.mockResolvedValue(true);
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
      capabilities.isEnabled.mockResolvedValue(true);
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
      capabilities.isEnabled.mockResolvedValue(true);
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
