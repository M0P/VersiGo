import { Injectable, Logger, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { AppConfigService, CapabilityFlagsService } from '@insura/foundation';
import { AuthService, AuthenticatedUser } from './auth.service';

import {
  authorizationCodeGrant,
  buildAuthorizationUrl,
  calculatePKCECodeChallenge,
  discovery,
  randomPKCECodeVerifier,
  randomState,
  type Configuration,
} from 'openid-client';

// openid-client v6 (gepinnt mit ^6.8.0) stellt die v5-Exporte (Issuer, Client,
// generators) nicht mehr bereit und nutzt eine komplett neue API:
//   discovery()     -> Configuration
//   buildAuthorizationUrl(config, params)  -> URL
//   authorizationCodeGrant(config, currentUrl, checks) -> TokenSet (+ claims())
//   randomState() / randomPKCECodeVerifier() / calculatePKCECodeChallenge()
// Der state-Check (checks.expectedState) und der PKCE-Code-Austausch werden
// von authorizationCodeGrant intern durchgefuehrt (siehe openid-client/UPGRADE.md).

export interface OidcCallbackRequest {
  protocol?: string;
  get?: (name: string) => string | undefined;
  originalUrl?: string;
}

/**
 * Normalisiert eine OIDC-Issuer-URL fuer Vergleich und Speicherung: trimmt
 * und entfernt nachgestellte Slashes. "https://idp.example.com/" und
 * "https://idp.example.com" werden identisch behandelt; ohne diese
 * Normalisierung bestimmt die Trailing-Slash-Varianz, ob eine Bindung
 * (Admin-Eingabe) beim Login (claims.iss) wiederfindbar ist (ADR-007).
 */
export function normalizeIssuerUrl(issuer: string): string {
  return issuer.trim().replace(/\/+$/, '');
}

// ADR-007: OIDC ist ein optionaler, an ein lokales Konto gebundener zweiter
// Login-Weg. Diese Strategie provisioniert keine Konten (kein Upsert): Ein
// Login ist nur erfolgreich, wenn (issuer, subject) einem aktiven lokalen
// Konto zugeordnet ist. Die Bindung nimmt ausschliesslich ein Admin vor
// (POST /admin/users/:id/oidc-binding).
@Injectable()
export class OidcStrategy implements OnModuleInit {
  private readonly logger = new Logger(OidcStrategy.name);
  private client: Configuration | null = null;

  constructor(
    private readonly config: AppConfigService,
    private readonly capabilities: CapabilityFlagsService,
    private readonly authService: AuthService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.capabilities.isEnabled('oidc')) {
      this.logger.log('OIDC deaktiviert (OIDC_ENABLED=false)');
      return;
    }
    await this.discoverClient();
  }

  private async discoverClient(): Promise<void> {
    try {
      const issuerUrl = this.config.get('OIDC_ISSUER_URL');
      if (!issuerUrl) {
        throw new Error('OIDC_ISSUER_URL nicht konfiguriert');
      }
      const callbackUrl = this.config.get('OIDC_CALLBACK_URL');
      if (!callbackUrl) {
        throw new Error('OIDC_CALLBACK_URL nicht konfiguriert');
      }
      const clientId = this.config.get('OIDC_CLIENT_ID');
      if (!clientId) {
        throw new Error('OIDC_CLIENT_ID nicht konfiguriert');
      }
      // Ohne explizites clientAuthentication waehlt die Configuration bei
      // gesetztem client_secret automatisch ClientSecretPost (vgl. v5:
      // client_secret im Client-Objekt). Ein public Client ohne Secret
      // ergibt None() (Client-Credentials-freier Flow).
      this.client = await discovery(new URL(issuerUrl), clientId, {
        redirect_uris: [callbackUrl],
        client_secret: this.config.get('OIDC_CLIENT_SECRET'),
      });
      this.logger.log(`OIDC-Client konfiguriert fuer Issuer ${issuerUrl}`);
    } catch (err) {
      this.logger.error('OIDC-Client-Initialisierung fehlgeschlagen', (err as Error).message);
    }
  }

  isEnabled(): boolean {
    return this.capabilities.isEnabled('oidc') && this.client !== null;
  }

  /**
   * Baut aus dem eingehenden Express-Request die vollstaendige Callback-URL.
   * authorizationCodeGrant erwartet in v6 die tatsaechlich aufgerufene
   * Redirect-URL (inkl. Query-Parameter) statt einer Parameter-Map. Unter
   * "trust proxy" liefert req.protocol/req.get('host') die x-forwarded-*-Werte.
   * Liefert null, wenn die URL nicht konstruierbar ist (dann: invalid-callback).
   */
  callbackParams(req: OidcCallbackRequest): URL | null {
    try {
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
      throw new Error('OIDC nicht konfiguriert');
    }
    const callbackUrl = this.config.get('OIDC_CALLBACK_URL');
    if (!callbackUrl) {
      throw new Error('OIDC_CALLBACK_URL nicht konfiguriert');
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
      throw new UnauthorizedException('OIDC nicht konfiguriert');
    }

    let tokenSet: Awaited<ReturnType<typeof authorizationCodeGrant>>;
    try {
      // authorizationCodeGrant validiert intern den state-Parameter
      // (checks.expectedState) und fuehrt den PKCE-Code-Austausch durch.
      tokenSet = await authorizationCodeGrant(this.client, currentUrl, {
        expectedState,
        pkceCodeVerifier: codeVerifier,
      });
    } catch {
      // Generischer Fehler: verraet weder Bindung noch Provider-Details.
      throw new UnauthorizedException('OIDC-Anmeldung fehlgeschlagen');
    }

    const claims = tokenSet.claims();
    if (!claims?.sub) {
      throw new UnauthorizedException('OIDC-Token enthaelt keinen sub-Wert');
    }
    // ADR-007: Kein Platzhalter-Issuer ('unknown') – ohne iss gibt es keine
    // Bindung. OIDC-spezifikationskonforme Token enthalten iss immer.
    const issuer = claims.iss;
    if (!issuer) {
      throw new UnauthorizedException('OIDC-Token enthaelt keinen iss-Wert');
    }

    // Normalisierung der Trailing-Slash-Varianz: Die Bindung (Admin-Eingabe)
    // und claims.iss muessen unabhaengig von einem abschliessenden Slash
    // uebereinstimmen.
    const user = await this.authService.findByOidcIdentity(normalizeIssuerUrl(issuer), claims.sub);
    if (!user) {
      // Generischer Fehler: verraet weder Existenz noch Bindungsstatus.
      throw new UnauthorizedException('OIDC-Anmeldung fehlgeschlagen');
    }

    return user;
  }
}
