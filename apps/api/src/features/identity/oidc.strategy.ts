import { Injectable, UnauthorizedException } from '@nestjs/common';
import { AppConfigService } from '@insura/foundation';
import { AuthService } from './auth.service';

type OidcClaims = {
  iss?: string;
  sub?: string;
  email?: string;
  name?: string;
  locale?: string;
};

@Injectable()
export class OidcStrategy {
  constructor(
    private readonly config: AppConfigService,
    private readonly authService: AuthService,
  ) {}

  isEnabled(): boolean {
    return this.config.get('OIDC_ENABLED');
  }

  async validate(claims: OidcClaims): Promise<unknown> {
    if (!claims?.sub) {
      throw new UnauthorizedException('OIDC claims ohne sub-Wert');
    }

    if (!claims?.iss) {
      throw new UnauthorizedException('OIDC claims ohne iss-Wert');
    }

    return this.authService.upsertFromOidcClaims({
      oidcIssuer: claims.iss,
      oidcSubject: claims.sub,
      email: claims.email ?? '',
      displayName: claims.name ?? claims.email ?? claims.sub,
      locale: claims.locale ?? 'de-DE',
    });
  }
}
