import { Injectable, Logger, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import {
  AppConfigService,
  CapabilityFlagsService,
  SettingsResolverService,
  type AppConfig,
} from '@versigo/foundation';
// IMPORTANT (BugFix-07, code review R3): `AuthService` must remain a VALUE
// import — with `emitDecoratorMetadata: true`, `design:paramtypes` references
// the class so it is available at runtime for NestJS DI. Do not switch it to
// `import type` (would break DI resolution at bootstrap). This makes the edge
// `oidc.strategy -> auth.service` real at runtime and, together with
// `auth.service.ts`'s import of `normalizeIssuerUrl`, forms a cyclic module
// graph whose safety depends on the load order (verified today: full API boot
// + 813 tests green). `auth.service.ts` must therefore NOT introduce a module
// evaluation-time dependency on oidc.strategy exports (only method-level
// usage such as normalizeIssuerUrl).
import { AuthService, AuthenticatedUser } from './auth.service';
import { relaxedFetch } from '../../common/connectivity/relaxed-fetch';

import {
  allowInsecureRequests,
  authorizationCodeGrant,
  buildAuthorizationUrl,
  calculatePKCECodeChallenge,
  customFetch,
  discovery,
  randomPKCECodeVerifier,
  randomState,
  type Configuration,
  type DiscoveryRequestOptions,
} from 'openid-client';

// openid-client v6 (pinned with ^6.8.0) no longer provides the v5 exports
// (Issuer, Client, generators) and uses a completely new API:
//   discovery()     -> Configuration
//   buildAuthorizationUrl(config, params)  -> URL
//   authorizationCodeGrant(config, currentUrl, checks) -> TokenSet (+ claims())
//   randomState() / randomPKCECodeVerifier() / calculatePKCECodeChallenge()
// The state check (checks.expectedState) and the PKCE code exchange are
// performed internally by authorizationCodeGrant (see openid-client/UPGRADE.md).

export interface OidcCallbackRequest {
  protocol?: string;
  get?: (name: string) => string | undefined;
  originalUrl?: string;
}

/**
 * Normalizes an OIDC issuer URL for comparison and storage: trims and
 * removes trailing slashes. "https://idp.example.com/" and
 * "https://idp.example.com" are treated identically; without this
 * normalization the trailing-slash variance decides whether a binding
 * (admin input) is findable again at login (claims.iss) (ADR-007).
 */
export function normalizeIssuerUrl(issuer: string): string {
  return issuer.trim().replace(/\/+$/, '');
}

// ADR-007: OIDC is an optional second login path bound to a local account.
// This strategy does not provision accounts (no upsert): a login only
// succeeds when (issuer, subject) is mapped to an active local account.
// Only an admin performs the binding (POST /admin/users/:id/oidc-binding).
@Injectable()
export class OidcStrategy implements OnModuleInit {
  private readonly logger = new Logger(OidcStrategy.name);
  private client: Configuration | null = null;
  /** BugFix-07: diagnostic data for GET /auth/config (oidcReady/oidcError). */
  private initError: string | null = null;
  private initAttempted = false;

  constructor(
    private readonly config: AppConfigService,
    private readonly capabilities: CapabilityFlagsService,
    private readonly settings: SettingsResolverService,
    private readonly authService: AuthService,
  ) {}

  async onModuleInit(): Promise<void> {
    // BugFix-05: capability resolution has been async since the resolver
    // change; OIDC is a restart category, the DB value was already applied
    // to process.env by the boot preload. If the database is not reachable
    // at boot (Prisma connection lazy), the decision falls back to the
    // environment snapshot (behavior before BugFix-05) so the boot is not
    // aborted.
    let oidcEnabled: boolean;
    try {
      oidcEnabled = await this.capabilities.isEnabled('oidc');
    } catch (error) {
      this.logger.warn(
        'OIDC capability resolution failed (DB unreachable?) – ' +
          'fallback to environment configuration: ' +
          `${error instanceof Error ? error.message : String(error)}`,
      );
      oidcEnabled = Boolean(this.config.get('OIDC_ENABLED' as keyof AppConfig));
    }
    if (!oidcEnabled) {
      this.logger.log('OIDC disabled (OIDC_ENABLED=false)');
      return;
    }
    await this.discoverClient();
  }

  private async discoverClient(): Promise<void> {
    this.initAttempted = true;
    try {
      const issuerUrl = this.config.get('OIDC_ISSUER_URL');
      if (!issuerUrl) {
        throw new Error('OIDC_ISSUER_URL not configured');
      }
      const callbackUrl = this.config.get('OIDC_CALLBACK_URL');
      if (!callbackUrl) {
        throw new Error('OIDC_CALLBACK_URL not configured');
      }
      const clientId = this.config.get('OIDC_CLIENT_ID');
      if (!clientId) {
        throw new Error('OIDC_CLIENT_ID not configured');
      }
      // BugFix-06 (part 2): TLS/endpoint relaxation for local IdPs with
      // self-signed certificates. Both flags are admin settings of the
      // `runtime` category (default false). If the database is not reachable
      // at boot, the resolution falls back to the environment snapshot like
      // the capabilities (strict, i.e. relaxation disabled).
      const flags = await this.resolveConnectivityFlags();
      const options: DiscoveryRequestOptions = {};
      if (flags.allowPrivate) {
        // Allows http:// issuer URLs (typical for LAN IdPs).
        // openid-client v6: the relaxation happens via the `execute` list
        // (configuration mutator), NOT via a boolean field.
        options.execute = [allowInsecureRequests];
      }
      if (flags.allowSelfSigned) {
        // Self-signed provider certificates: all OIDC requests
        // (discovery, token, userinfo) run through the TLS-relaxing
        // relaxedFetch; all other app requests keep strict validation.
        // `customFetch` is a unique symbol key in openid-client v6
        // (no string field) – hence the computed property syntax.
        options[customFetch] = relaxedFetch;
      }
      // Without an explicit clientAuthentication the Configuration
      // automatically picks ClientSecretPost when client_secret is set
      // (cf. v5: client_secret on the Client object). A public client
      // without a secret yields None() (flow without client credentials).
      this.client = await discovery(new URL(issuerUrl), clientId, {
        redirect_uris: [callbackUrl],
        client_secret: this.config.get('OIDC_CLIENT_SECRET'),
      }, undefined, options);
      if (Object.keys(options).length > 0) {
        this.logger.log(
          `OIDC client configured with relaxations (allowInsecure=${flags.allowPrivate}, allowSelfSigned=${flags.allowSelfSigned})`,
        );
      }
      this.logger.log(`OIDC client configured for issuer ${issuerUrl}`);
      this.initError = null;
    } catch (err) {
      this.initError = err instanceof Error ? err.message : String(err);
      this.logger.error('OIDC client initialization failed', this.initError);
    }
  }

  /**
   * BugFix-07 (finding 2): diagnostics for the login page and the
   * self-service link flow. Returns whether the OIDC client is actually
   * ready (capability active AND discovery/client setup ok) and a
   * fault-tolerant short description of why not. `ready === false` is the
   * only reason the login page hides the OIDC button – before BugFix-07
   * this distinction was missing, so e.g. after enabling OIDC without a
   * restart (restart category) or with a discovery error no explainable
   * state existed.
   */
  async getStatus(): Promise<{ ready: boolean; error: string | null }> {
    if (!(await this.capabilities.isEnabled('oidc'))) {
      return { ready: false, error: null };
    }
    if (this.client !== null) {
      return { ready: true, error: null };
    }
    // Capability is active but the client is missing. `initAttempted`
    // separates "boot not yet completed" (unlikely but possible) from
    // "discovery/client setup failed".
    return {
      ready: false,
      error: this.initAttempted
        ? (this.initError ?? 'OIDC client initialization failed')
        : 'OIDC client is still initializing',
    };
  }

  async isEnabled(): Promise<boolean> {
    // BugFix-05: async (resolver-based capability resolution).
    return (await this.capabilities.isEnabled('oidc')) && this.client !== null;
  }

  /**
   * Resolves the connectivity relaxation flags of the `runtime` category.
   * Fallback on DB/resolver failure: strict defaults (false) - a failed
   * resolution must NEVER lead to an unintended relaxation of the
   * TLS/endpoint check (fail-closed).
   */
  private async resolveConnectivityFlags(): Promise<{ allowPrivate: boolean; allowSelfSigned: boolean }> {
    try {
      const [allowPrivate, allowSelfSigned] = await Promise.all([
        this.settings.getEffectiveBoolean('CONNECTIVITY_ALLOW_PRIVATE_ENDPOINTS'),
        this.settings.getEffectiveBoolean('CONNECTIVITY_ALLOW_SELF_SIGNED'),
      ]);
      return { allowPrivate: allowPrivate ?? false, allowSelfSigned: allowSelfSigned ?? false };
    } catch (error) {
      this.logger.warn(
        'Connectivity flags not resolvable (DB unreachable?) – ' +
          'OIDC without relaxations (strict): ' +
          `${error instanceof Error ? error.message : String(error)}`,
      );
      return { allowPrivate: false, allowSelfSigned: false };
    }
  }

  /**
   * Builds the callback URL passed to authorizationCodeGrant (openid-client
   * v6). BugFix-18: the token-exchange redirect_uri MUST always equal the
   * redirect_uri from the authorization request – that is by definition
   * OIDC_CALLBACK_URL. The base URL is therefore taken from the configured
   * OIDC_CALLBACK_URL and only the query parameters (code, state, …) are
   * carried over from the actual incoming request.
   *
   * This is robust against ANY reverse-proxy prefix stripping (Caddy
   * `uri strip_prefix /api`, nginx, subdomain proxies, direct-IP access):
   * the proxy-visible request path may differ from the public callback
   * path without breaking the token exchange. Previously the URL was
   * reconstructed from `protocol://host + originalUrl`, which under a
   * prefix-stripping proxy produced a redirect_uri WITHOUT the `/api`
   * prefix – the IdP then rejected the token request (redirect_uri
   * mismatch).
   *
   * Without a configured OIDC_CALLBACK_URL the old reconstruction from
   * the request is kept as a fallback. Returns null when the URL is not
   * constructible (then: invalid-callback).
   */
  callbackParams(req: OidcCallbackRequest): URL | null {
    try {
      const callbackUrl = this.config.get('OIDC_CALLBACK_URL');
      if (callbackUrl) {
        // The code/state query parameters can only come from the actual
        // request; without originalUrl the callback URL is not constructible
        // (consistent with the fallback path below).
        const originalUrl = req.originalUrl;
        if (!originalUrl) {
          return null;
        }
        const url = new URL(callbackUrl);
        const queryIndex = originalUrl.indexOf('?');
        if (queryIndex !== -1) {
          const incomingQuery = originalUrl.slice(queryIndex + 1);
          if (incomingQuery) {
            // Merge: keep any query the configured callback URL already has
            // and append the incoming parameters. A configured callback URL
            // should normally carry no query string of its own.
            url.search = url.search
              ? `${url.search}&${incomingQuery}`
              : `?${incomingQuery}`;
          }
        }
        return url;
      }
      const host = req.get?.('host');
      if (!req.protocol || !host || !req.originalUrl) {
        return null;
      }
      return new URL(`${req.protocol}://${host}${req.originalUrl}`);
    } catch {
      return null;
    }
  }

  async getAuthorizationUrl(): Promise<{ url: string; codeVerifier: string; state: string }> {
    if (!this.client) {
      throw new Error('OIDC not configured');
    }
    const callbackUrl = this.config.get('OIDC_CALLBACK_URL');
    if (!callbackUrl) {
      throw new Error('OIDC_CALLBACK_URL not configured');
    }
    const codeVerifier = randomPKCECodeVerifier();
    const codeChallenge = await calculatePKCECodeChallenge(codeVerifier);
    const state = randomState();
    const url = buildAuthorizationUrl(this.client, {
      scope: 'openid email profile',
      redirect_uri: callbackUrl,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state,
    }).toString();
    return { url, codeVerifier, state };
  }

  async validateCallback(
    currentUrl: URL,
    codeVerifier: string,
    expectedState: string,
  ): Promise<AuthenticatedUser> {
    if (!this.client) {
      throw new UnauthorizedException('OIDC not configured');
    }

    const { issuer, subject } = await this.exchangeAndGetClaims(currentUrl, codeVerifier, expectedState);

    const user = await this.authService.findByOidcIdentity(normalizeIssuerUrl(issuer), subject);
    if (!user) {
      // Generic error: reveals neither existence nor binding status.
      throw new UnauthorizedException('OIDC authentication failed');
    }

    return user;
  }

  /**
   * BugFix-07: performs the PKCE code exchange and extracts the identity
   * claims (iss, sub) WITHOUT binding resolution. Used by the self-service
   * link callback, which receives an as-yet-unbound identity and
   * must bind the identity to the logged-in session user. The flow
   * (state check + PKCE) is identical to the login validation.
   */
  async exchangeIdentity(
    currentUrl: URL,
    codeVerifier: string,
    expectedState: string,
  ): Promise<{ issuer: string; subject: string }> {
    if (!this.client) {
      throw new UnauthorizedException('OIDC not configured');
    }
    return this.exchangeAndGetClaims(currentUrl, codeVerifier, expectedState);
  }

  private async exchangeAndGetClaims(
    currentUrl: URL,
    codeVerifier: string,
    expectedState: string,
  ): Promise<{ issuer: string; subject: string }> {
    let tokenSet: Awaited<ReturnType<typeof authorizationCodeGrant>>;
    try {
      // authorizationCodeGrant internally validates the state parameter
      // (checks.expectedState) and performs the PKCE code exchange.
      tokenSet = await authorizationCodeGrant(this.client!, currentUrl, {
        expectedState,
        pkceCodeVerifier: codeVerifier,
      });
    } catch (error) {
      // BugFix-18: log the underlying failure for production diagnosis.
      // NEVER log sensitive material: no code, state, code_verifier,
      // tokens or secrets. currentUrl contains the code in its query
      // string, so only the callback base (origin + pathname) is logged.
      this.logger.warn(
        `OIDC token exchange failed ` +
          `(issuer=${this.config.get('OIDC_ISSUER_URL') ?? 'unknown'}, ` +
          `callbackBase=${currentUrl.origin}${currentUrl.pathname}): ` +
          `${error instanceof Error ? `${error.constructor.name}: ${error.message}` : String(error)}`,
      );
      // Generic error: reveals neither binding nor provider details.
      throw new UnauthorizedException('OIDC authentication failed');
    }

    const claims = tokenSet.claims();
    if (!claims?.sub) {
      this.logger.warn('OIDC token exchange succeeded but the token does not contain a sub claim');
      throw new UnauthorizedException('OIDC token does not contain a sub claim');
    }
    // ADR-007: no placeholder issuer ('unknown') – without iss there is no
    // binding. OIDC-spec-compliant tokens always contain iss.
    const issuer = claims.iss;
    if (!issuer) {
      this.logger.warn('OIDC token exchange succeeded but the token does not contain an iss claim');
      throw new UnauthorizedException('OIDC token does not contain an iss claim');
    }

    return { issuer, subject: claims.sub };
  }
}
