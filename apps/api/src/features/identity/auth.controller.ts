import {
  Body,
  ConflictException,
  Controller,
  Delete,
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
    // BugFix-07: Self-Service-Verknuepfung – der Callback bindet die
    // Identitaet an den bereits angemeldeten User statt einzuloggen.
    oidcLinkMode?: boolean;
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
    // BugFix-05: oidc.isEnabled() ist seit der Resolver-Umstellung async.
    if (!(await this.oidc.isEnabled())) {
      res.status(501).json({
        message:
          'OIDC ist nicht konfiguriert. Setze OIDC_ENABLED=true und konfiguriere Issuer/Client/Callback.',
      });
      return;
    }

    const { url, codeVerifier, state } = await this.oidc.getAuthorizationUrl();
    req.session.oidcCodeVerifier = codeVerifier;
    req.session.oidcState = state;
    // BugFix-07 (Code-Review, R2): Ein vom Self-Service-Link-Flow (POST
    // /auth/oidc/link) zurueckgelassener oidcLinkMode darf den spaeteren
    // Login-Callback nicht in den Link-Modus versetzen; hier defensiv loeschen.
    delete req.session.oidcLinkMode;
    res.redirect(url);
  }

  @Public()
  @Get('config')
  async getAuthConfig(): Promise<{
    oidcEnabled: boolean;
    oidcReady: boolean;
    oidcConfigured: boolean;
    oidcError: string | null;
    localEnabled: boolean;
    registrationEnabled: boolean;
  }> {
    const [oidcStatus, oidcConfigured, localEnabled] = await Promise.all([
      // BugFix-07 (Befund 2): getStatus() trennt "Capability aktiv, aber
      // Client/Discovery fehlgeschlagen oder Neustart fehlt" (oidcReady=false
      // + oidcError) von "OIDC komplett deaktiviert" (oidcEnabled=false).
      this.oidc.getStatus(),
      this.capabilities.isEnabled('oidc'),
      this.capabilities.isEnabled('local'),
    ]);
    return {
      // AP-16/Review-4: oidcEnabled darf nicht nur das Capability-Flag melden,
      // sondern muss anzeigen, ob die Strategie tatsaechlich einsatzbereit ist
      // (Discovery erfolgreich, Client gesetzt). Sonst wuerde die Login-Seite
      // den OIDC-Button anbieten, obwohl /auth/login 501 liefert.
      oidcEnabled: oidcStatus.ready,
      oidcReady: oidcStatus.ready,
      // BugFix-07: Roh-Capability, damit die UI "deaktiviert" (kein Button,
      // keine Warnung) von "aktiviert, aber Neustart/Discovery fehlt"
      // (Warnung + kein Button) unterscheiden kann.
      oidcConfigured,
      // BugFix-07 (Code-Review, Minor): Der Oeffentliche Endpunkt darf keine
      // internen Diagnose-Details (Discovery-URL, Issuer-Konfiguration etc.)
      // leaken. Nur ein generischer Hinweis; die Detail-Fehlerbehandlung
      // bleibt im Server-Log und im authentifizierten GET /auth/oidc/link
      // (Settings-Area) sichtbar.
      oidcError: oidcStatus.error
        ? 'OIDC ist nicht verfuegbar (Details im Server-Log)'
        : null,
      localEnabled,
      registrationEnabled: localEnabled,
    };
  }

  @Public()
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async register(
    @Req() req: SessionRequest,
    @Body() body: RegisterLocalAccountDto,
  ): Promise<{ status: 'PENDING_APPROVAL' }> {
    if (!(await this.capabilities.isEnabled('local'))) {
      // 501 (nicht 409): Registrierung ist NICHT aktiviert. Der Status
      // unterscheidet sich bewusst von einem Namens-Konflikt (409,
      // "Benutzername bereits vergeben") und spiegelt das 501-Verhalten des
      // Login-Endpunkts wider – so kann die Web-UI Fehler ueber den
      // HTTP-Status auf lokalisierte Meldungen abbilden (AP-21).
      throw new HttpException(
        'Lokale Registrierung ist nicht konfiguriert',
        HttpStatus.NOT_IMPLEMENTED,
      );
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
    if (!(await this.capabilities.isEnabled('local'))) {
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
    if (!(await this.oidc.isEnabled())) {
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

    // BugFix-07: Self-Service-Verknuepfung. Der Callback laeuft im
    // "Link-Modus", wenn POST /auth/oidc/link ihn gestartet hat: Die
    // bestaetigte Identitaet (iss, sub) wird an den bereits angemeldeten
    // User gebunden – KEINE Session-Rotation, KEIN Login. Ohne angemeldeten
    // User ist der Link-Modus ungueltig (der Flow wurde von einer
    // ausgeloggten Session gestartet oder die Session wurde ersetzt).
    if (req.session.oidcLinkMode) {
      const userId = req.session.userId;
      delete req.session.oidcCodeVerifier;
      delete req.session.oidcState;
      delete req.session.oidcLinkMode;
      if (!userId) {
        res.redirect('/auth/login?error=not-authenticated');
        return;
      }
      try {
        const { issuer, subject } = await this.oidc.exchangeIdentity(
          params,
          codeVerifier,
          expectedState,
        );
        await this.authService.bindOidcIdentityForUser(userId, issuer, subject);
        res.redirect('/settings?oidc=linked');
      } catch (error) {
        // 409: Identitaet bereits an ein anderes Konto gebunden.
        if (error instanceof ConflictException) {
          res.redirect('/settings?error=oidc-link-conflict');
          return;
        }
        res.redirect('/settings?error=oidc-link-failed');
      }
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

  /**
   * BugFix-07: Self-Service-Verknuepfung (Q2). Status der OIDC-Bindung des
   * angemeldeten Users. Authentifiziert (kein @Public).
   */
  @Get('oidc/link')
  async getOidcLink(@CurrentUser() user: AuthenticatedUser): Promise<{
    linked: boolean;
    oidcIssuer: string | null;
    oidcSubject: string | null;
    oidcReady: boolean;
    oidcError: string | null;
  }> {
    const [binding, status] = await Promise.all([
      this.authService.getOidcBinding(user.id),
      this.oidc.getStatus(),
    ]);
    return {
      linked: binding !== null,
      oidcIssuer: binding?.oidcIssuer ?? null,
      oidcSubject: binding?.oidcSubject ?? null,
      oidcReady: status.ready,
      oidcError: status.error,
    };
  }

  /**
   * BugFix-07: Startet den Link-Flow. Liefert die Provider-URL; die
   * Session merkt sich den Link-Modus, damit der Callback die Identitaet
   * bindet statt einzuloggen. 501, wenn OIDC nicht einsatzbereit ist.
   */
  @Post('oidc/link')
  @HttpCode(HttpStatus.OK)
  async startOidcLink(
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: SessionRequest,
  ): Promise<{ url: string }> {
    const status = await this.oidc.getStatus();
    if (!status.ready) {
      throw new HttpException(
        'OIDC ist nicht konfiguriert oder der Client konnte nicht initialisiert werden',
        HttpStatus.NOT_IMPLEMENTED,
      );
    }

    const { url, codeVerifier, state } = await this.oidc.getAuthorizationUrl();
    req.session.oidcCodeVerifier = codeVerifier;
    req.session.oidcState = state;
    req.session.oidcLinkMode = true;
    return { url };
  }

  /**
   * BugFix-07: Loest die OIDC-Bindung des angemeldeten Users (nur die
   * Bindung, nie das Konto). 409, wenn keine Bindung besteht.
   */
  @Delete('oidc/link')
  @HttpCode(HttpStatus.NO_CONTENT)
  async unlinkOidc(@CurrentUser() user: AuthenticatedUser): Promise<void> {
    await this.authService.unbindOidcIdentityForUser(user.id);
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
