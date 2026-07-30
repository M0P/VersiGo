import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { CurrentUser } from './current-user.decorator';
import { AuthenticatedUser, AuthService } from './auth.service';
import { Public } from '@insura/foundation';
import { OidcStrategy } from './oidc.strategy';
import { CapabilityFlagsService } from '@insura/foundation';
import { LoginRateLimiterService } from './login-rate-limiter.service';

type SessionRequest = Request & {
  user?: AuthenticatedUser;
  session: {
    userId?: string;
    oidcCodeVerifier?: string;
    oidcState?: string;
    regenerate: (callback: (err?: Error | null) => void) => void;
    destroy: (callback: () => void) => void;
  };
};

@Controller('auth')
export class AuthController {
  constructor(
    private readonly oidc: OidcStrategy,
    private readonly authService: AuthService,
    private readonly capabilities: CapabilityFlagsService,
    private readonly rateLimiter: LoginRateLimiterService,
  ) {}

  @Public()
  @Get('login')
  login(@Req() req: SessionRequest, @Res() res: Response): void {
    if (!this.oidc.isEnabled()) {
      res.status(501).json({
        message:
          'OIDC ist nicht konfiguriert. Setze OIDC_ENABLED=true und konfiguriere Issuer/Client/Callback.',
      });
      return;
    }

    const { url, codeVerifier, state } = this.oidc.getAuthorizationUrl();
    req.session.oidcCodeVerifier = codeVerifier;
    req.session.oidcState = state;
    res.redirect(url);
  }

  @Public()
  @Get('config')
  getAuthConfig(): { oidcEnabled: boolean; localEnabled: boolean } {
    return {
      oidcEnabled: this.capabilities.isEnabled('oidc'),
      localEnabled: this.capabilities.isEnabled('local'),
    };
  }

  @Public()
  @Post('local/login')
  async localLogin(
    @Req() req: SessionRequest,
    @Res() res: Response,
    @Body() body: { identifier: string; password: string },
  ): Promise<void> {
    if (!this.capabilities.isEnabled('local')) {
      res.status(501).json({
        message:
          'Lokale Anmeldung ist nicht konfiguriert. Setze LOCAL_AUTH_ENABLED=true.',
      });
      return;
    }

    const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown';
    const blocked = await this.rateLimiter.isBlocked(ip);
    if (blocked) {
      // Return generic error without revealing account existence
      res.status(429).json({
        message: 'Anmeldeversuch fehlgeschlagen. Bitte versuchen Sie es spaeter erneut.',
      });
      return;
    }

    const identifier = body?.identifier ?? '';
    const password = body?.password ?? '';

    if (!identifier || !password) {
      res.status(400).json({ message: 'Benutzername und Passwort sind erforderlich' });
      return;
    }

    const user = await this.authService.localLogin(identifier, password);

    if (!user) {
      await this.rateLimiter.recordAttempt(ip);
      // Generic error - does not reveal whether identifier exists
      res.status(401).json({
        message: 'Anmeldedaten sind ungueltig.',
      });
      return;
    }

    // Success - reset rate limit counter
    await this.rateLimiter.resetAttempts(ip);

    req.session.regenerate((err?: Error | null) => {
      if (err) {
        res.status(500).json({ message: 'Session-Fehler' });
        return;
      }
      req.session.userId = user.id;
      // Clean up any stale OIDC flow data from previous session
      delete req.session.oidcCodeVerifier;
      delete req.session.oidcState;
      res.status(200).json({
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        memberships: user.memberships,
      });
    });
  }

  @Public()
  @Get('callback')
  async callback(@Req() req: SessionRequest, @Res() res: Response): Promise<void> {
    if (!this.oidc.isEnabled()) {
      res.redirect('/auth/login?error=oidc-not-configured');
      return;
    }

    const codeVerifier = req.session.oidcCodeVerifier;
    if (!codeVerifier) {
      res.redirect('/auth/login?error=missing-code-verifier');
      return;
    }

    const params = this.oidc.callbackParams(req);
    if (!params) {
      res.redirect('/auth/login?error=invalid-callback');
      return;
    }

    const expectedState = req.session.oidcState;
    if (!expectedState) {
      res.redirect('/auth/login?error=missing-state');
      return;
    }

    try {
      const user = await this.oidc.validateCallback(params, codeVerifier, expectedState);
      req.session.regenerate((err?: Error | null) => {
        if (err) {
          res.redirect('/auth/login?error=session');
          return;
        }
        req.session.userId = user.id;
        delete req.session.oidcCodeVerifier;
        delete req.session.oidcState;
        res.redirect('/');
      });
    } catch {
      res.redirect('/auth/login?error=authentication-failed');
    }
  }

  @Post('logout')
  logout(@Req() req: SessionRequest, @Res() res: Response): void {
    req.session.destroy(() => {
      res.clearCookie('insura.sid');
      res.status(204).send();
    });
  }

  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser): AuthenticatedUser {
    return user;
  }
}
