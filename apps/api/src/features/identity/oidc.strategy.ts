import { Injectable, Logger, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import {
  AppConfigService,
  CapabilityFlagsService,
  SettingsResolverService,
  type AppConfig,
} from '@versigo/foundation';
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
    private readonly settings: SettingsResolverService,
    private readonly authService: AuthService,
  ) {}

  async onModuleInit(): Promise<void> {
    // BugFix-05: Capability-Aufloesung ist seit der Resolver-Umstellung
    // asynchron; OIDC ist restart-Kategorie, der DB-Wert wurde vom
    // Boot-Preload bereits in process.env uebernommen. Ist die Datenbank
    // beim Boot nicht erreichbar (Prisma-Verbindung lazy), faellt die
    // Entscheidung auf den Umgebungs-Snapshot zurueck (Verhalten vor
    // BugFix-05), damit der Boot nicht abgebrochen wird.
    let oidcEnabled: boolean;
    try {
      oidcEnabled = await this.capabilities.isEnabled('oidc');
    } catch (error) {
      this.logger.warn(
        'OIDC-Capability-Aufloesung fehlgeschlagen (DB nicht erreichbar?) – ' +
          'Fallback auf Umgebungs-Konfiguration: ' +
          `${error instanceof Error ? error.message : String(error)}`,
      );
      oidcEnabled = Boolean(this.config.get('OIDC_ENABLED' as keyof AppConfig));
    }
    if (!oidcEnabled) {
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
      // BugFix-06 (Teil 2): TLS-/Endpoint-Lockerung fuer lokale IdPs mit
      // selbst signierten Zertifikaten. Beide Flags sind Admin-Einstellungen
      // der Kategorie `runtime` (Default false). Ist die Datenbank beim Boot
      // nicht erreichbar, faellt die Aufloesung wie bei den Capabilities auf
      // den Umgebungs-Snapshot zurueck (strikt, d.h. Lockerung deaktiviert).
      const flags = await this.resolveConnectivityFlags();
      const options: DiscoveryRequestOptions = {};
      if (flags.allowPrivate) {
        // Erlaubt http://-Issuer-URLs (typisch fuer IdPs im LAN).
        // openid-client v6: die Lockerung erfolgt ueber die `execute`-Liste
        // (Konfigurations-Mutator), NICHT ueber ein Boolean-Feld.
        options.execute = [allowInsecureRequests];
      }
      if (flags.allowSelfSigned) {
        // Selbst signierte Provider-Zertifikate: Alle OIDC-Requests
        // (Discovery, Token, Userinfo) laufen dann ueber den TLS-lockernden
        // relaxedFetch; alle uebrigen App-Requests behalten strikte Pruefung.
        // `customFetch` ist in openid-client v6 ein Unique-Symbol-Schluessel
        // (kein String-Feld) – daher die Computed-Property-Syntax.
        options[customFetch] = relaxedFetch;
      }
      // Ohne explizites clientAuthentication waehlt die Configuration bei
      // gesetztem client_secret automatisch ClientSecretPost (vgl. v5:
      // client_secret im Client-Objekt). Ein public Client ohne Secret
      // ergibt None() (Client-Credentials-freier Flow).
      this.client = await discovery(new URL(issuerUrl), clientId, {
        redirect_uris: [callbackUrl],
        client_secret: this.config.get('OIDC_CLIENT_SECRET'),
      }, undefined, options);
      if (Object.keys(options).length > 0) {
        this.logger.log(
          `OIDC-Client mit Lockerungen konfiguriert (allowInsecure=${flags.allowPrivate}, allowSelfSigned=${flags.allowSelfSigned})`,
        );
      }
      this.logger.log(`OIDC-Client konfiguriert fuer Issuer ${issuerUrl}`);
    } catch (err) {
      this.logger.error('OIDC-Client-Initialisierung fehlgeschlagen', (err as Error).message);
    }
  }

  /**
   * Loeest die Konnektivitaets-Lockerungsflags der Kategorie `runtime` auf.
   * Fallback bei DB-/Resolver-Ausfall: strikte Defaults (false) – eine
   * fehlgeschlagene Aufloesung darf NIE zu einer ungewollten Lockerung
   * der TLS-/Endpoint-Pruefung fuehren (Fail-Closed).
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
        'Konnektivitaets-Flags nicht aufloesbar (DB nicht erreichbar?) – ' +
          'OIDC ohne Lockerungen (strikt): ' +
          `${error instanceof Error ? error.message : String(error)}`,
      );
      return { allowPrivate: false, allowSelfSigned: false };
    }
  }

  async isEnabled(): Promise<boolean> {
    // BugFix-05: async (Resolver-basierte Capability-Aufloesung).
    return (await this.capabilities.isEnabled('oidc')) && this.client !== null;
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
