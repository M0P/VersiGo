import { Injectable, Logger, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import {
  AppConfigService,
  CapabilityFlagsService,
  SettingsResolverService,
  type AppConfig,
} from '@versigo/foundation';
// WICHTIG (BugFix-07, Code-Review R3): `AuthService` muss ein VALUE-Import
// bleiben — mit `emitDecoratorMetadata: true` referenziert `design:paramtypes`
// die Klasse zur Laufzeit fuer die NestJS-DI. Nicht auf `import type`
// umstellen (wuerde die DI-Aufloesung beim Bootstrap brechen). Damit ist die
// Kante `oidc.strategy -> auth.service` zur Laufzeit real und bildet zusammen
// mit `auth.service.ts`'s Import von `normalizeIssuerUrl` einen zyklischen
// Modulgraphen, dessen Sicherheit von der Lade-Reihenfolge abhaengt (heute
// verifiziert: voller API-Boot + 813 Tests gruen). `auth.service.ts` darf
// daher KEINE Modul-Auswertungszeit-Abhaengigkeit von oidc.strategy-Exports
// einfuehren (nur Methoden-Level-Nutzung wie normalizeIssuerUrl).
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
  /** BugFix-07: Diagnose-Daten fuer GET /auth/config (oidcReady/oidcError). */
  private initError: string | null = null;
  private initAttempted = false;

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
    this.initAttempted = true;
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
      this.initError = null;
    } catch (err) {
      this.initError = err instanceof Error ? err.message : String(err);
      this.logger.error('OIDC-Client-Initialisierung fehlgeschlagen', this.initError);
    }
  }

  /**
   * BugFix-07 (Befund 2): Diagnose fuer die Login-Seite und die
   * Self-Service-Verknuepfung. Liefert, ob der OIDC-Client tatsaechlich
   * einsatzbereit ist (Capability aktiv UND Discovery/Client-Setup ok) und
   * eine fehlertolerante Kurzbeschreibung, warum nicht. `ready === false`
   * ist der einzige Grund, warum die Login-Seite den OIDC-Button ausblendet –
   * vor BugFix-07 fehlte diese Unterscheidung, sodass z.B. nach dem
   * Aktivieren von OIDC ohne Neustart (Restart-Kategorie) oder bei einem
   * Discovery-Fehler kein erklaerbarer Zustand entstand.
   */
  async getStatus(): Promise<{ ready: boolean; error: string | null }> {
    if (!(await this.capabilities.isEnabled('oidc'))) {
      return { ready: false, error: null };
    }
    if (this.client !== null) {
      return { ready: true, error: null };
    }
    // Capability ist aktiv, aber der Client fehlt. `initAttempted` trennt
    // "Boot noch nicht durchgelaufen" (unwahrscheinlich, aber moeglich)
    // von "Discovery/Client-Setup fehlgeschlagen".
    return {
      ready: false,
      error: this.initAttempted
        ? (this.initError ?? 'OIDC-Client-Initialisierung fehlgeschlagen')
        : 'OIDC-Client wird noch initialisiert',
    };
  }

  async isEnabled(): Promise<boolean> {
    // BugFix-05: async (Resolver-basierte Capability-Aufloesung).
    return (await this.capabilities.isEnabled('oidc')) && this.client !== null;
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

    const { issuer, subject } = await this.exchangeAndGetClaims(currentUrl, codeVerifier, expectedState);

    const user = await this.authService.findByOidcIdentity(normalizeIssuerUrl(issuer), subject);
    if (!user) {
      // Generischer Fehler: verraet weder Existenz noch Bindungsstatus.
      throw new UnauthorizedException('OIDC-Anmeldung fehlgeschlagen');
    }

    return user;
  }

  /**
   * BugFix-07: Fuehrt den PKCE-Code-Austausch durch und extrahiert die
   * Identitaets-Claims (iss, sub) OHNE Bindungs-Aufloesung. Wird vom
   * Self-Service-Link-Callback genutzt, der eine noch ungebundene
   * Identitaet an den angemeldeten Session-User binden muss. Der Ablauf
   * (state-Check + PKCE) ist identisch zur Login-Validierung.
   */
  async exchangeIdentity(
    currentUrl: URL,
    codeVerifier: string,
    expectedState: string,
  ): Promise<{ issuer: string; subject: string }> {
    if (!this.client) {
      throw new UnauthorizedException('OIDC nicht konfiguriert');
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
      // authorizationCodeGrant validiert intern den state-Parameter
      // (checks.expectedState) und fuehrt den PKCE-Code-Austausch durch.
      tokenSet = await authorizationCodeGrant(this.client!, currentUrl, {
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

    return { issuer, subject: claims.sub };
  }
}
