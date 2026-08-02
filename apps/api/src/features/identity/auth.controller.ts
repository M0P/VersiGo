import {
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { CurrentUser } from './current-user.decorator';
import { AuthenticatedUser, AuthService } from './auth.service';
import { Public } from '@versigo/foundation';
import { OidcStrategy } from './oidc.strategy';
import { CapabilityFlagsService } from '@versigo/foundation';
import { LoginRateLimiterService } from './login-rate-limiter.service';
import { LocalLoginDto, RegisterLocalAccountDto } from './auth.dto';

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
  async login(@Req() req: SessionRequest, @Res() res: Response): Promise<void> {
    if (!this.oidc.isEnabled()) {
      res.status(501).json({
        message:
          'OIDC ist nicht konfiguriert. Setze OIDC_ENABLED=true und konfiguriere Issuer/Client/Callback.',
      });
      return;
    }

    const { url, codeVerifier, state } = await this.oidc.getAuthorizationUrl();
    req.session.oidcCodeVerifier = codeVerifier;
    req.session.oidcState = state;
    res.redirect(url);
  }

  @Public()
  @Get('config')
  getAuthConfig(): { oidcEnabled: boolean; localEnabled: boolean; registrationEnabled: boolean } {
    return {
      // AP-16/Review-4: oidcEnabled darf nicht nur das Capability-Flag melden,
      // sondern muss anzeigen, ob die Strategie tatsaechlich einsatzbereit ist
      // (Discovery erfolgreich, Client gesetzt). Sonst wuerde die Login-Seite
      // den OIDC-Button anbieten, obwohl /auth/login 501 liefert.
      oidcEnabled: this.oidc.isEnabled(),
      localEnabled: this.capabilities.isEnabled('local'),
      registrationEnabled: this.capabilities.isEnabled('local'),
    };
  }

  @Public()
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async register(
    @Req() req: SessionRequest,
    @Body() body: RegisterLocalAccountDto,
  ): Promise<{ status: 'PENDING_APPROVAL' }> {
    if (!this.capabilities.isEnabled('local')) {
      throw new ConflictException('Lokale Registrierung ist nicht konfiguriert');
    }

    // AP-16/ADR-007: Per-IP-Rate-Limit auf die Registrierung, damit die
    // Admin-Freischalt-Warteschlange nicht durch Massen-Registrierungen
    // ueberflutet werden kann (Scope "register", getrennt vom Login-Zaehler).
    const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown';
    const blocked = await this.rateLimiter.isBlocked(ip, 'register');
    if (blocked) {
      throw new HttpException(
        'Zu viele Registrierungsversuche. Bitte versuchen Sie es spaeter erneut.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    try {
      await this.authService.registerLocalAccount({
        username: body.username,
        displayName: body.displayName,
        password: body.password,
      });
    } catch (error) {
      // Nur Konflikt-/Enumerationstreffer (409, z.B. "Benutzername bereits
      // vergeben") zaehlen mit: Sie verraten, dass ein Konto existiert bzw.
      // der Name belegt ist. Validierungsfehler (400) und unerwartete Fehler
      // werden bewusst nicht gezahlt.
      if (error instanceof ConflictException) {
        await this.rateLimiter.recordAttempt(ip, 'register');
      }
      throw error;
    }

    // Auch erfolgreiche Registrierungen zaehlen: Eine IP kann pro Fenster nur
    // eine begrenzte Anzahl neuer Pending-Konten erzeugen (kein Reset hier,
    // sonst waere die Freischalt-Warteschlange weiterhin ueberflutbar).
    await this.rateLimiter.recordAttempt(ip, 'register');

    // Kein Account-Detail in der Antwort: Die Registrierung ist immer mit
    // Status PENDING_APPROVAL; erst Admins schalten frei.
    return { status: 'PENDING_APPROVAL' };
  }

  @Public()
  @Post('local/login')
  async localLogin(
    @Req() req: SessionRequest,
    @Res() res: Response,
    @Body() body: LocalLoginDto,
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

    const username = body?.username ?? '';
    const password = body?.password ?? '';

    if (!username || !password) {
      res.status(400).json({ message: 'Benutzername und Passwort sind erforderlich' });
      return;
    }

    const user = await this.authService.localLogin(username, password);

    if (!user) {
      await this.rateLimiter.recordAttempt(ip);
      // Generic error - does not reveal whether the username exists
      res.status(401).json({
        message: 'Anmeldedaten sind ungueltig.',
      });
      return;
    }

    // Success: Der Zaehler wird erst nach bestaetigter Session-Rotation
    // zurueckgesetzt (nur bei erfolgreicher Regeneration), damit ein Fehler
    // beim Session-Neuaufbau den Lockout nicht vorzeitig aufhebt.
    req.session.regenerate(async (err?: Error | null) => {
      if (err) {
        res.status(500).json({ message: 'Session-Fehler' });
        return;
      }
      await this.rateLimiter.resetAttempts(ip);
      req.session.userId = user.id;
      // Clean up any stale OIDC flow data from previous session
      delete req.session.oidcCodeVerifier;
      delete req.session.oidcState;
      res.status(200).json({
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        role: user.role,
        status: user.status,
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
      res.clearCookie('versigo.sid');
      res.status(204).send();
    });
  }

  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser): AuthenticatedUser {
    return user;
  }
}
