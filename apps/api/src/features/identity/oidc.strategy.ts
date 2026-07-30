import { Injectable, Logger, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { AppConfigService, CapabilityFlagsService } from '@insura/foundation';
import { AuthService, AuthenticatedUser } from './auth.service';

import * as oidc from 'openid-client';

// openid-client v6 verwendet eine komplett neue API (discovery, Configuration, etc.).
// Die alten v5-Exporte (Issuer, Client, generators) existieren nicht mehr und sind
// zur Laufzeit undefined. Dies muss in einem separaten Arbeitspaket auf die v6-API
// migriert werden (siehe openid-client/UPGRADE.md).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Issuer: any = (oidc as any).Issuer;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Client: any = (oidc as any).Client;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const generators: any = (oidc as any).generators;

@Injectable()
export class OidcStrategy implements OnModuleInit {
  private readonly logger = new Logger(OidcStrategy.name);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private client: any | null = null;

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
      const issuer = await Issuer.discover(issuerUrl);
      const callbackUrl = this.config.get('OIDC_CALLBACK_URL');
      if (!callbackUrl) {
        throw new Error('OIDC_CALLBACK_URL nicht konfiguriert');
      }
      this.client = new issuer.Client({
        client_id: this.config.get('OIDC_CLIENT_ID') ?? '',
        client_secret: this.config.get('OIDC_CLIENT_SECRET'),
        redirect_uris: [callbackUrl],
        response_types: ['code'],
      });
      this.logger.log(`OIDC-Client konfiguriert fuer Issuer ${issuerUrl}`);
    } catch (err) {
      this.logger.error('OIDC-Client-Initialisierung fehlgeschlagen', (err as Error).message);
    }
  }

  isEnabled(): boolean {
    return this.capabilities.isEnabled('oidc') && this.client !== null;
  }

  callbackParams(req: { query?: Record<string, unknown> }): Record<string, unknown> | null {
    const params = Client.callbackParams(req);
    return params ?? null;
  }

  getAuthorizationUrl(): { url: string; codeVerifier: string; state: string } {
    if (!this.client) {
      throw new Error('OIDC nicht konfiguriert');
    }
    const codeVerifier = generators.codeVerifier();
    const codeChallenge = generators.codeChallenge(codeVerifier);
    const state = generators.state();
    const url = this.client.authorizationUrl({
      scope: 'openid email profile',
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state,
    });
    return { url, codeVerifier, state };
  }

  async validateCallback(
    callbackParams: Record<string, unknown>,
    codeVerifier: string,
    expectedState: string,
  ): Promise<AuthenticatedUser> {
    if (!this.client) {
      throw new UnauthorizedException('OIDC nicht konfiguriert');
    }

    const returnedState = callbackParams.state as string | undefined;
    if (!returnedState || returnedState !== expectedState) {
      throw new UnauthorizedException('OIDC state-Parameter stimmt nicht ueberein');
    }

    const callbackUrl = this.config.get('OIDC_CALLBACK_URL');
    if (!callbackUrl) {
      throw new UnauthorizedException('OIDC_CALLBACK_URL nicht konfiguriert');
    }

    const tokenSet = await this.client.callback(callbackUrl, callbackParams, {
      code_verifier: codeVerifier,
    });

    const claims = tokenSet.claims();
    if (!claims.sub) {
      throw new UnauthorizedException('OIDC-Token enthaelt keinen sub-Wert');
    }

    const user = await this.authService.upsertFromOidcClaims({
      oidcIssuer: claims.iss ?? 'unknown',
      oidcSubject: claims.sub,
      email: (claims.email as string) ?? '',
      displayName: (claims.name as string) ?? (claims.email as string) ?? claims.sub,
      locale: (claims.locale as string) ?? 'de-DE',
    });

    return user;
  }
}
