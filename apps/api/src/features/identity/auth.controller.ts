import {
  Controller,
  Get,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { CurrentUser } from './current-user.decorator';
import { AuthenticatedUser } from './auth.service';
import { Public } from './auth.guard';
import { OidcStrategy } from './oidc.strategy';

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
  constructor(private readonly oidc: OidcStrategy) {}

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
