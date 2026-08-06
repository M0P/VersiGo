import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { OidcStrategy, normalizeIssuerUrl } from '../oidc.strategy';
import { GlobalRole, UserStatus } from '@prisma/client';

// openid-client v6-Funktionen werden gemockt, damit kein echter
// Discovery-HTTP-Request noetig ist und die Fehlerpfade isoliert testbar sind.
vi.mock('openid-client', () => ({
  discovery: vi.fn(),
  buildAuthorizationUrl: vi.fn(),
  calculatePKCECodeChallenge: vi.fn(),
  randomPKCECodeVerifier: vi.fn(),
  randomState: vi.fn(),
  authorizationCodeGrant: vi.fn(),
  allowInsecureRequests: vi.fn(),
  customFetch: Symbol.for('customFetch'),
}));

import {
  allowInsecureRequests,
  authorizationCodeGrant,
  buildAuthorizationUrl,
  calculatePKCECodeChallenge,
  customFetch,
  discovery,
  randomPKCECodeVerifier,
  randomState,
} from 'openid-client';
import { relaxedFetch } from '../../../common/connectivity/relaxed-fetch';

const mockedAuthorizationCodeGrant = vi.mocked(authorizationCodeGrant);
const mockedBuildAuthorizationUrl = vi.mocked(buildAuthorizationUrl);
const mockedCalculatePKCECodeChallenge = vi.mocked(calculatePKCECodeChallenge);
const mockedDiscovery = vi.mocked(discovery);
const mockedRandomPKCECodeVerifier = vi.mocked(randomPKCECodeVerifier);
const mockedRandomState = vi.mocked(randomState);
const mockedAllowInsecureRequests = vi.mocked(allowInsecureRequests);

function createMockConfig() {
  return {
    get: vi.fn(),
  };
}

function createMockCapabilities() {
  return {
    isEnabled: vi.fn(),
  };
}

function createMockSettingsResolver() {
  return {
    getEffectiveBoolean: vi.fn().mockResolvedValue(false),
  };
}

function createMockAuthService() {
  return {
    findByOidcIdentity: vi.fn(),
  };
}

type Strategy = OidcStrategy;

/** Greift testweise auf das private `client`-Feld zu (kein OIDC-Happy-Path
 *  ohne gecallten onModuleInit). */
function setClient(strategy: Strategy, client: unknown): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (strategy as unknown as { client: any }).client = client;
}

function createStrategy() {
  const config = createMockConfig();
  const capabilities = createMockCapabilities();
  const settings = createMockSettingsResolver();
  const authService = createMockAuthService();
  const strategy = new OidcStrategy(
    config as never,
    capabilities as never,
    settings as never,
    authService as never,
  );
  return { strategy, config, capabilities, settings, authService };
}

const mockUser = {
  id: 'user-1',
  username: 'alice',
  displayName: 'Alice',
  role: GlobalRole.USER,
  status: UserStatus.ACTIVE,
  memberships: [],
};

describe('normalizeIssuerUrl', () => {
  it('entfernt nachgestellte Slashes', () => {
    expect(normalizeIssuerUrl('https://idp.example.com/')).toBe('https://idp.example.com');
    expect(normalizeIssuerUrl('https://idp.example.com////')).toBe('https://idp.example.com');
  });

  it('laesst URLs ohne Slash unveraendert und trimmt Whitespace', () => {
    expect(normalizeIssuerUrl('  https://idp.example.com  ')).toBe('https://idp.example.com');
    expect(normalizeIssuerUrl('https://idp.example.com')).toBe('https://idp.example.com');
  });
});

describe('OidcStrategy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('onModuleInit', () => {
    it('laesst den Client unkonfiguriert, wenn OIDC deaktiviert ist', async () => {
      const { strategy, capabilities } = createStrategy();
      capabilities.isEnabled.mockResolvedValue(false);

      await strategy.onModuleInit();

      expect(mockedDiscovery).not.toHaveBeenCalled();
      await expect(strategy.isEnabled()).resolves.toBe(false);
    });

    it('konfiguriert den Client per discovery() wenn OIDC aktiv ist', async () => {
      const { strategy, config, capabilities } = createStrategy();
      capabilities.isEnabled.mockResolvedValue(true);
      config.get.mockImplementation((key: string) => {
        switch (key) {
          case 'OIDC_ISSUER_URL':
            return 'https://idp.example.com';
          case 'OIDC_CALLBACK_URL':
            return 'https://app.example.com/auth/callback';
          case 'OIDC_CLIENT_ID':
            return 'versigo';
          case 'OIDC_CLIENT_SECRET':
            return 'secret';
          default:
            return undefined;
        }
      });
      mockedDiscovery.mockResolvedValue({} as never);

      await strategy.onModuleInit();

      expect(mockedDiscovery).toHaveBeenCalledWith(
        new URL('https://idp.example.com'),
        'versigo',
        expect.objectContaining({
          redirect_uris: ['https://app.example.com/auth/callback'],
          client_secret: 'secret',
        }),
        // BugFix-06 (Teil 2): discovery() erhaelt jetzt immer die
        // (leeren) DiscoveryRequestOptions als 5. Argument – ohne
        // aktivierte Lockerungs-Flags bleiben sie leer.
        undefined,
        expect.objectContaining({}),
      );
      await expect(strategy.isEnabled()).resolves.toBe(true);
    });

    it('faehrt fail-closed weiter, wenn discovery fehlschlaegt', async () => {
      const { strategy, config, capabilities } = createStrategy();
      capabilities.isEnabled.mockResolvedValue(true);
      config.get.mockImplementation((key: string) => {
        switch (key) {
          case 'OIDC_ISSUER_URL':
            return 'https://idp.example.com';
          case 'OIDC_CALLBACK_URL':
            return 'https://app.example.com/auth/callback';
          case 'OIDC_CLIENT_ID':
            return 'versigo';
          default:
            return undefined;
        }
      });
      mockedDiscovery.mockRejectedValue(new Error('network down'));

      await strategy.onModuleInit();

      await expect(strategy.isEnabled()).resolves.toBe(false);
    });

    it('setzt allowInsecureRequests (execute), wenn CONNECTIVITY_ALLOW_PRIVATE_ENDPOINTS aktiv ist', async () => {
      const { strategy, config, capabilities, settings } = createStrategy();
      capabilities.isEnabled.mockResolvedValue(true);
      config.get.mockImplementation((key: string) => {
        switch (key) {
          case 'OIDC_ISSUER_URL':
            return 'http://idp.lan';
          case 'OIDC_CALLBACK_URL':
            return 'https://app.example.com/auth/callback';
          case 'OIDC_CLIENT_ID':
            return 'versigo';
          default:
            return undefined;
        }
      });
      settings.getEffectiveBoolean.mockImplementation((key: string) =>
        key === 'CONNECTIVITY_ALLOW_PRIVATE_ENDPOINTS'
          ? Promise.resolve(true)
          : Promise.resolve(false),
      );
      mockedDiscovery.mockResolvedValue({} as never);

      await strategy.onModuleInit();

      expect(mockedDiscovery).toHaveBeenCalledWith(
        new URL('http://idp.lan'),
        'versigo',
        expect.objectContaining({ redirect_uris: ['https://app.example.com/auth/callback'] }),
        undefined,
        expect.objectContaining({ execute: [mockedAllowInsecureRequests] }),
      );
      await expect(strategy.isEnabled()).resolves.toBe(true);
    });

    it('setzt customFetch=relaxedFetch, wenn CONNECTIVITY_ALLOW_SELF_SIGNED aktiv ist', async () => {
      const { strategy, config, capabilities, settings } = createStrategy();
      capabilities.isEnabled.mockResolvedValue(true);
      config.get.mockImplementation((key: string) => {
        switch (key) {
          case 'OIDC_ISSUER_URL':
            return 'https://idp.lan';
          case 'OIDC_CALLBACK_URL':
            return 'https://app.example.com/auth/callback';
          case 'OIDC_CLIENT_ID':
            return 'versigo';
          default:
            return undefined;
        }
      });
      settings.getEffectiveBoolean.mockImplementation((key: string) =>
        key === 'CONNECTIVITY_ALLOW_SELF_SIGNED' ? Promise.resolve(true) : Promise.resolve(false),
      );
      mockedDiscovery.mockResolvedValue({} as never);

      await strategy.onModuleInit();

      const options = mockedDiscovery.mock.calls[0][4] as Record<PropertyKey, unknown>;
      expect(options).toMatchObject({ [customFetch]: relaxedFetch });
      // Kein execute-Eintrag ohne allowPrivate-Flag.
      expect(options.execute).toBeUndefined();
      await expect(strategy.isEnabled()).resolves.toBe(true);
    });

    it('laesst die Lockerungs-Optionen leer, wenn beide Flags deaktiviert sind', async () => {
      const { strategy, config, capabilities } = createStrategy();
      capabilities.isEnabled.mockResolvedValue(true);
      config.get.mockImplementation((key: string) => {
        switch (key) {
          case 'OIDC_ISSUER_URL':
            return 'https://idp.example.com';
          case 'OIDC_CALLBACK_URL':
            return 'https://app.example.com/auth/callback';
          case 'OIDC_CLIENT_ID':
            return 'versigo';
          default:
            return undefined;
        }
      });
      mockedDiscovery.mockResolvedValue({} as never);

      await strategy.onModuleInit();

      const options = mockedDiscovery.mock.calls[0][4] as Record<PropertyKey, unknown>;
      expect(options.execute).toBeUndefined();
      expect(options[customFetch]).toBeUndefined();
    });

    it('faellt auf den Umgebungs-Snapshot zurueck, wenn die Capability-Aufloesung fehlschlaegt (DB down)', async () => {
      const { strategy, config, capabilities } = createStrategy();
      capabilities.isEnabled.mockRejectedValue(new Error('connect ECONNREFUSED'));
      // DB down + OIDC_ENABLED im Env deaktiviert -> kein discovery, Boot ok.
      config.get.mockImplementation((key: string) => {
        switch (key) {
          case 'OIDC_ENABLED':
            return false;
          default:
            return undefined;
        }
      });

      await expect(strategy.onModuleInit()).resolves.toBeUndefined();

      expect(mockedDiscovery).not.toHaveBeenCalled();
    });

    it('faellt auf den Umgebungs-Snapshot zurueck und konfiguriert den Client, wenn OIDC im Env aktiv ist (DB down)', async () => {
      const { strategy, config, capabilities } = createStrategy();
      capabilities.isEnabled.mockRejectedValue(new Error('connect ECONNREFUSED'));
      config.get.mockImplementation((key: string) => {
        switch (key) {
          case 'OIDC_ENABLED':
            return true;
          case 'OIDC_ISSUER_URL':
            return 'https://idp.example.com';
          case 'OIDC_CALLBACK_URL':
            return 'https://app.example.com/auth/callback';
          case 'OIDC_CLIENT_ID':
            return 'versigo';
          default:
            return undefined;
        }
      });
      mockedDiscovery.mockResolvedValue({} as never);

      await expect(strategy.onModuleInit()).resolves.toBeUndefined();

      expect(mockedDiscovery).toHaveBeenCalledTimes(1);
    });
  });

  describe('getStatus (BugFix-07)', () => {
    it('meldet ready=true, wenn Capability aktiv und Client initialisiert', async () => {
      const { strategy, capabilities } = createStrategy();
      capabilities.isEnabled.mockResolvedValue(true);
      setClient(strategy, {});

      await expect(strategy.getStatus()).resolves.toEqual({ ready: true, error: null });
    });

    it('meldet ready=false ohne Fehler, wenn OIDC komplett deaktiviert ist', async () => {
      const { strategy, capabilities } = createStrategy();
      capabilities.isEnabled.mockResolvedValue(false);

      await expect(strategy.getStatus()).resolves.toEqual({ ready: false, error: null });
    });

    it('meldet den Init-Fehler, wenn die Capability aktiv, der Client aber nicht bereit ist', async () => {
      const { strategy, config, capabilities } = createStrategy();
      capabilities.isEnabled.mockResolvedValue(true);
      config.get.mockImplementation((key: string) => {
        switch (key) {
          case 'OIDC_ISSUER_URL':
            return 'https://idp.example.com';
          case 'OIDC_CALLBACK_URL':
            return 'https://app.example.com/auth/callback';
          case 'OIDC_CLIENT_ID':
            return 'versigo';
          default:
            return undefined;
        }
      });
      mockedDiscovery.mockRejectedValue(new Error('network down'));

      await strategy.onModuleInit();

      await expect(strategy.getStatus()).resolves.toEqual({
        ready: false,
        error: 'network down',
      });
      await expect(strategy.isEnabled()).resolves.toBe(false);
    });
  });

  describe('callbackParams', () => {
    it('baut die vollstaendige Callback-URL aus dem Express-Request', () => {
      const { strategy } = createStrategy();
      const url = strategy.callbackParams({
        protocol: 'https',
        get: (name: string) => (name === 'host' ? 'app.example.com' : undefined),
        originalUrl: '/auth/callback?code=abc&state=xyz',
      });

      expect(url).toBeInstanceOf(URL);
      expect(url?.toString()).toBe(
        'https://app.example.com/auth/callback?code=abc&state=xyz',
      );
    });

    it('liefert null bei fehlendem Host (ungueltige Callback-URL)', () => {
      const { strategy } = createStrategy();
      expect(
        strategy.callbackParams({
          protocol: 'https',
          get: () => undefined,
          originalUrl: '/auth/callback',
        }),
      ).toBeNull();
    });

    it('liefert null bei fehlendem originalUrl', () => {
      const { strategy } = createStrategy();
      expect(
        strategy.callbackParams({
          protocol: 'https',
          get: (name: string) => (name === 'host' ? 'app.example.com' : undefined),
        }),
      ).toBeNull();
    });
  });

  describe('getAuthorizationUrl', () => {
    it('baut die Authorization-URL mit PKCE und state', async () => {
      const { strategy, config } = createStrategy();
      setClient(strategy, {});
      config.get.mockReturnValue('https://app.example.com/auth/callback');
      mockedRandomPKCECodeVerifier.mockReturnValue('verifier-123');
      mockedCalculatePKCECodeChallenge.mockResolvedValue('challenge-abc');
      mockedRandomState.mockReturnValue('state-456');
      mockedBuildAuthorizationUrl.mockReturnValue(
        new URL('https://idp.example.com/authorize?state=state-456'),
      );

      const result = await strategy.getAuthorizationUrl();

      expect(mockedCalculatePKCECodeChallenge).toHaveBeenCalledWith('verifier-123');
      expect(mockedBuildAuthorizationUrl).toHaveBeenCalledWith(
        {},
        expect.objectContaining({
          scope: 'openid email profile',
          redirect_uri: 'https://app.example.com/auth/callback',
          code_challenge: 'challenge-abc',
          code_challenge_method: 'S256',
          state: 'state-456',
        }),
      );
      expect(result).toEqual({
        url: 'https://idp.example.com/authorize?state=state-456',
        codeVerifier: 'verifier-123',
        state: 'state-456',
      });
    });

    it('wirft, wenn kein Client konfiguriert ist', async () => {
      const { strategy } = createStrategy();
      await expect(strategy.getAuthorizationUrl()).rejects.toThrow('OIDC nicht konfiguriert');
    });
  });

  describe('validateCallback', () => {
    it('wirft UnauthorizedException ohne konfigurierten Client (fail-closed)', async () => {
      const { strategy } = createStrategy();
      const url = new URL('https://app.example.com/auth/callback?code=abc');
      await expect(strategy.validateCallback(url, 'verifier', 'state')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('leitet Token-Austausch-Fehler als generisches UnauthorizedException weiter', async () => {
      const { strategy, authService } = createStrategy();
      setClient(strategy, {});
      mockedAuthorizationCodeGrant.mockRejectedValue(new Error('state mismatch'));
      const url = new URL('https://app.example.com/auth/callback?code=abc');

      await expect(strategy.validateCallback(url, 'verifier', 'state')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(authService.findByOidcIdentity).not.toHaveBeenCalled();
    });

    it('findet den User ueber normalisierten Issuer und Subject', async () => {
      const { strategy, authService } = createStrategy();
      setClient(strategy, {});
      authService.findByOidcIdentity.mockResolvedValue(mockUser);
      mockedAuthorizationCodeGrant.mockResolvedValue({
        claims: () => ({ iss: 'https://idp.example.com/', sub: 'sub-1' }),
      } as never);
      const url = new URL('https://app.example.com/auth/callback?code=abc&state=state');

      await expect(
        strategy.validateCallback(url, 'verifier', 'state'),
      ).resolves.toEqual(mockUser);

      // claims.iss mit Trailing-Slash wird auf die gespeicherte Form normalisiert
      expect(authService.findByOidcIdentity).toHaveBeenCalledWith(
        'https://idp.example.com',
        'sub-1',
      );
      expect(mockedAuthorizationCodeGrant).toHaveBeenCalledWith(
        {},
        url,
        { expectedState: 'state', pkceCodeVerifier: 'verifier' },
      );
    });

    it('lehnt Token ohne iss-Wert ab', async () => {
      const { strategy, authService } = createStrategy();
      setClient(strategy, {});
      mockedAuthorizationCodeGrant.mockResolvedValue({
        claims: () => ({ sub: 'sub-1' }),
      } as never);

      await expect(
        strategy.validateCallback(
          new URL('https://app.example.com/auth/callback?code=abc'),
          'verifier',
          'state',
        ),
      ).rejects.toThrow('iss-Wert');
      expect(authService.findByOidcIdentity).not.toHaveBeenCalled();
    });

    it('lehnt ungebundene Identitaeten generisch ab', async () => {
      const { strategy, authService } = createStrategy();
      setClient(strategy, {});
      authService.findByOidcIdentity.mockResolvedValue(null);
      mockedAuthorizationCodeGrant.mockResolvedValue({
        claims: () => ({ iss: 'https://idp.example.com', sub: 'unbound' }),
      } as never);

      await expect(
        strategy.validateCallback(
          new URL('https://app.example.com/auth/callback?code=abc'),
          'verifier',
          'state',
        ),
      ).rejects.toThrow('OIDC-Anmeldung fehlgeschlagen');
    });
  });
});
