import { describe, it, expect, vi } from 'vitest';
import { AuthController } from '../auth.controller';
import { GlobalRole, UserStatus } from '@prisma/client';
import { ConflictException, ForbiddenException, HttpException, HttpStatus } from '@nestjs/common';
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
  changePassword: ReturnType<typeof vi.fn>;
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
    callbackParams: vi
      .fn()
      .mockReturnValue(
        new URL('https://app.example.com/auth/callback?code=auth-code&state=state'),
      ),
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
    changePassword: vi.fn().mockResolvedValue(undefined),
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
  it('/auth/me returns the authenticated user from the request context', () => {
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

  it('/auth/callback rotates the session before setting the userId (session fixation protection)', async () => {
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

    // BugFix-18: callbackParams now returns a URL (base from the configured
    // OIDC_CALLBACK_URL, query parameters carried over from the request).
    expect(oidc.validateCallback).toHaveBeenCalledWith(
      expect.any(URL),
      'verifier',
      'state',
    );
    const passedUrl = oidc.validateCallback.mock.calls[0][0] as URL;
    expect(passedUrl.searchParams.get('code')).toBe('auth-code');
    expect(passedUrl.searchParams.get('state')).toBe('state');
    expect(regenerate).toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith('/');
  });

  it('/auth/callback redirects to the web login route on an invalid callback (BugFix-18)', async () => {
    const oidc = createMockOidc();
    oidc.callbackParams.mockReturnValue(null);
    const controller = createController({ oidc });
    const req = {
      session: {
        regenerate: vi.fn(),
        oidcCodeVerifier: 'verifier',
        oidcState: 'state',
      },
    } as unknown as RequestLike;
    const res = {
      redirect: vi.fn(),
      clearCookie: vi.fn(),
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
      json: vi.fn(),
    } as ResponseLike;

    await controller.callback(req as never, res as never);

    expect(oidc.validateCallback).not.toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith('/login?error=invalid-callback');
  });

  it('/auth/callback redirects to /login?error=authentication-failed on a failed validation (BugFix-18)', async () => {
    const oidc = createMockOidc();
    oidc.validateCallback.mockRejectedValue(new Error('token exchange failed'));
    const controller = createController({ oidc });
    const req = {
      session: {
        regenerate: vi.fn(),
        oidcCodeVerifier: 'verifier',
        oidcState: 'state',
      },
    } as unknown as RequestLike;
    const res = {
      redirect: vi.fn(),
      clearCookie: vi.fn(),
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
      json: vi.fn(),
    } as ResponseLike;

    await controller.callback(req as never, res as never);

    expect(res.redirect).toHaveBeenCalledWith('/login?error=authentication-failed');
  });

  it('/auth/logout destroys the session and clears the cookie', () => {
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
    it('redirects to the OIDC provider URL and stores codeVerifier/state in the session', async () => {
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
      // BugFix-07 (code review, R2): a stale oidcLinkMode from an aborted
      // self-service link flow must not put the login callback into link mode.
      expect(req.session.oidcLinkMode).toBeUndefined();
    });

    it('returns 501 when OIDC is disabled (independent of local auth)', async () => {
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
    it('returns the available authentication methods', async () => {
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

    it('shows both methods when enabled', async () => {
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

    it('reports OIDC as disabled when the strategy is not ready despite the capability (discovery failed)', async () => {
      const capabilities = createMockCapabilities();
      capabilities.isEnabled.mockImplementation(async (key: string) => key === 'oidc');
      const oidc = createMockOidc();
      oidc.getStatus.mockResolvedValue({ ready: false, error: 'Discovery failed' });
      const controller = createController({ capabilities, oidc });

      const result = await controller.getAuthConfig();
      expect(result).toEqual({
        oidcEnabled: false,
        oidcReady: false,
        oidcConfigured: true,
        oidcError: 'OIDC is unavailable (see server log)',
        localEnabled: false,
        registrationEnabled: false,
      });
    });

    it('BugFix-07: reports oidcReady=true ONLY when the client is actually ready', async () => {
      const capabilities = createMockCapabilities();
      capabilities.isEnabled.mockImplementation(async (key: string) => key === 'oidc');
      const oidc = createMockOidc();
      // Capability active but client not initialized (e.g. restart
      // missing after enabling OIDC) => the button must NOT appear.
      oidc.getStatus.mockResolvedValue({ ready: false, error: 'OIDC_ISSUER_URL missing' });
      const controller = createController({ capabilities, oidc });

      const result = await controller.getAuthConfig();
      expect(result.oidcEnabled).toBe(false);
      expect(result.oidcReady).toBe(false);
      expect(result.oidcConfigured).toBe(true);
      // BugFix-07 (code review): the public endpoint no longer leaks
      // internal diagnostics, only a generic hint.
      expect(result.oidcError).toBe('OIDC is unavailable (see server log)');
    });
  });

  describe('Self-service OIDC linking (BugFix-07)', () => {
    it('GET /auth/oidc/link returns the binding status', async () => {
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

    it('GET /auth/oidc/link reports linked=false without a binding', async () => {
      const controller = createController();
      const result = await controller.getOidcLink(mockUser);
      expect(result.linked).toBe(false);
      expect(result.oidcIssuer).toBeNull();
    });

    it('POST /auth/oidc/link sets link mode and returns the provider URL', async () => {
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

    it('POST /auth/oidc/link returns 501 when OIDC is not ready', async () => {
      const oidc = createMockOidc();
      oidc.getStatus.mockResolvedValue({ ready: false, error: 'Discovery failed' });
      const controller = createController({ oidc });
      const req = { session: {} } as unknown as RequestLike;

      await expect(controller.startOidcLink(mockUser, req as never)).rejects.toMatchObject({
        status: HttpStatus.NOT_IMPLEMENTED,
      });
    });

    it('DELETE /auth/oidc/link removes the binding of the signed-in user', async () => {
      const authService = createMockAuthService();
      const controller = createController({ authService });
      await controller.unlinkOidc(mockUser);
      expect(authService.unbindOidcIdentityForUser).toHaveBeenCalledWith('user-1');
    });

    it('callback in link mode binds the identity to the session user (without session rotation)', async () => {
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
      // No session rotation in link mode (the user stays signed in).
      expect(regenerate).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith('/settings?oidc=linked');
      expect(session.oidcLinkMode).toBeUndefined();
    });

    it('callback in link mode without a session user rejects (no binding to unknown users)', async () => {
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
      expect(res.redirect).toHaveBeenCalledWith('/login?error=not-authenticated');
    });

    it('callback in link mode redirects on conflict (identity bound elsewhere) to /settings?error=oidc-link-conflict', async () => {
      const oidc = createMockOidc();
      const authService = createMockAuthService();
      authService.bindOidcIdentityForUser.mockRejectedValue(
        new ConflictException('This OIDC identity is already bound to another account'),
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

    it('registers a local account and reports PENDING_APPROVAL', async () => {
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

    it('returns 501 when local registration is not configured', async () => {
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

    it('returns 429 when the IP is registration-limited (scope register)', async () => {
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

    it('counts failed registrations (409) in the scope register', async () => {
      const capabilities = createMockCapabilities();
      capabilities.isEnabled.mockResolvedValue(true);
      const authService = createMockAuthService();
      authService.registerLocalAccount.mockRejectedValue(
        new ConflictException('Username is already taken'),
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
    it('returns 501 when local auth is disabled', async () => {
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

    it('returns 429 when the IP is rate-limited', async () => {
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

    it('returns 400 on missing fields', async () => {
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

    it('returns 401 on invalid credentials (generic)', async () => {
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

    it('returns 200 and the user on successful login', async () => {
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

    it('counts failed attempts in the rate limiter', async () => {
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

  describe('POST /auth/change-password', () => {
    const req = { ip: '1.2.3.4', socket: {} } as unknown as RequestLike;

    it('delegates to the service with the current user and the new password', async () => {
      const authService = createMockAuthService();
      const rateLimiter = createMockRateLimiter();
      const controller = createController({ authService, rateLimiter });

      await controller.changePassword(
        mockUser as never,
        { currentPassword: 'aktuell', newPassword: 'neues-passwort' } as never,
        req as never,
      );

      expect(authService.changePassword).toHaveBeenCalledWith(
        'user-1',
        'aktuell',
        'neues-passwort',
      );
      expect(rateLimiter.recordAttempt).not.toHaveBeenCalled();
      expect(rateLimiter.resetAttempts).toHaveBeenCalledWith('1.2.3.4', 'change-password');
    });

    it('propagates a 403 for a wrong current password and records the failed attempt', async () => {
      const authService = createMockAuthService();
      authService.changePassword.mockRejectedValue(
        new ForbiddenException('Current password is incorrect'),
      );
      const rateLimiter = createMockRateLimiter();
      const controller = createController({ authService, rateLimiter });

      await expect(
        controller.changePassword(
          mockUser as never,
          { currentPassword: 'falsch', newPassword: 'neues-passwort' } as never,
          req as never,
        ),
      ).rejects.toThrow('Current password is incorrect');
      expect(rateLimiter.recordAttempt).toHaveBeenCalledWith('1.2.3.4', 'change-password');
    });

    it('propagates a 409 for an account without a local credential without counting the attempt', async () => {
      const authService = createMockAuthService();
      authService.changePassword.mockRejectedValue(
        new ConflictException('Account has no local password'),
      );
      const rateLimiter = createMockRateLimiter();
      const controller = createController({ authService, rateLimiter });

      await expect(
        controller.changePassword(
          mockUser as never,
          { currentPassword: 'aktuell', newPassword: 'neues-passwort' } as never,
          req as never,
        ),
      ).rejects.toThrow('Account has no local password');
      expect(rateLimiter.recordAttempt).not.toHaveBeenCalled();
    });

    it('answers 429 without touching the service when the IP is rate-limited', async () => {
      const authService = createMockAuthService();
      const rateLimiter = createMockRateLimiter();
      rateLimiter.isBlocked.mockResolvedValue(true);
      const controller = createController({ authService, rateLimiter });

      await expect(
        controller.changePassword(
          mockUser as never,
          { currentPassword: 'aktuell', newPassword: 'neues-passwort' } as never,
          req as never,
        ),
      ).rejects.toMatchObject({
        status: HttpStatus.TOO_MANY_REQUESTS,
        message: 'Too many failed attempts. Please try again later.',
      });
      expect(authService.changePassword).not.toHaveBeenCalled();
    });
  });
});
