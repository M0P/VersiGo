import {
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Logger,
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
import { ChangePasswordDto, LocalLoginDto, RegisterLocalAccountDto } from './auth.dto';

type SessionRequest = Request & {
  user?: AuthenticatedUser;
  session: {
    userId?: string;
    oidcCodeVerifier?: string;
    oidcState?: string;
    // BugFix-07: self-service linking – the callback binds the identity
    // to the already logged-in user instead of logging in.
    oidcLinkMode?: boolean;
    regenerate: (callback: (err?: Error | null) => void) => void;
    destroy: (callback: () => void) => void;
  };
};

@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly oidc: OidcStrategy,
    private readonly authService: AuthService,
    private readonly capabilities: CapabilityFlagsService,
    private readonly rateLimiter: LoginRateLimiterService,
  ) {}

  @Public()
  @Get('login')
  async login(@Req() req: SessionRequest, @Res() res: Response): Promise<void> {
    // BugFix-05: oidc.isEnabled() has been async since the resolver change.
    if (!(await this.oidc.isEnabled())) {
      res.status(501).json({
        message:
          'OIDC is not configured. Set OIDC_ENABLED=true and configure issuer/client/callback.',
      });
      return;
    }

    const { url, codeVerifier, state } = await this.oidc.getAuthorizationUrl();
    req.session.oidcCodeVerifier = codeVerifier;
    req.session.oidcState = state;
    // BugFix-07 (code review, R2): an oidcLinkMode left behind by the
    // self-service link flow (POST /auth/oidc/link) must not put a later
    // login callback into link mode; delete it defensively here.
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
      // BugFix-07 (finding 2): getStatus() separates "capability active, but
      // client/discovery failed or restart missing" (oidcReady=false
      // + oidcError) from "OIDC fully disabled" (oidcEnabled=false).
      this.oidc.getStatus(),
      this.capabilities.isEnabled('oidc'),
      this.capabilities.isEnabled('local'),
    ]);
    return {
      // AP-16/review-4: oidcEnabled must not only report the capability flag
      // but must show whether the strategy is actually ready (discovery
      // succeeded, client set). Otherwise the login page would offer the
      // OIDC button even though /auth/login returns 501.
      oidcEnabled: oidcStatus.ready,
      oidcReady: oidcStatus.ready,
      // BugFix-07: raw capability so the UI can distinguish "disabled" (no
      // button, no warning) from "enabled, but restart/discovery missing"
      // (warning + no button).
      oidcConfigured,
      // BugFix-07 (code review, minor): the public endpoint must not leak
      // internal diagnostic details (discovery URL, issuer configuration,
      // etc.). Only a generic hint; detailed error handling stays visible in
      // the server log and in the authenticated GET /auth/oidc/link
      // (settings area).
      oidcError: oidcStatus.error
        ? 'OIDC is unavailable (see server log)'
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
      // 501 (not 409): registration is NOT enabled. The status deliberately
      // differs from a name conflict (409, "username already taken") and
      // mirrors the 501 behavior of the login endpoint – so the web UI can
      // map errors to localized messages via the HTTP status (AP-21).
      throw new HttpException(
        'Local registration is not configured',
        HttpStatus.NOT_IMPLEMENTED,
      );
    }

    // AP-16/ADR-007: per-IP rate limit on registration so the admin
    // approval queue cannot be flooded by mass registrations (scope
    // "register", separate from the login counter).
    const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown';
    const blocked = await this.rateLimiter.isBlocked(ip, 'register');
    if (blocked) {
      throw new HttpException(
        'Too many registration attempts. Please try again later.',
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
      // Only conflict/enumeration hits (409, e.g. "username already taken")
      // count: they reveal that an account exists or the name is taken.
      // Validation errors (400) and unexpected errors are deliberately not
      // counted.
      if (error instanceof ConflictException) {
        await this.rateLimiter.recordAttempt(ip, 'register');
      }
      throw error;
    }

    // Successful registrations also count: an IP can only create a limited
    // number of new pending accounts per window (no reset here, otherwise
    // the approval queue would remain floodable).
    await this.rateLimiter.recordAttempt(ip, 'register');

    // No account details in the response: registration always results in
    // status PENDING_APPROVAL; only admins approve.
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
          'Local login is not configured. Set LOCAL_AUTH_ENABLED=true.',
      });
      return;
    }

    const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown';
    const blocked = await this.rateLimiter.isBlocked(ip);
    if (blocked) {
      // Return generic error without revealing account existence
      res.status(429).json({
        message: 'Login attempt failed. Please try again later.',
      });
      return;
    }

    const username = body?.username ?? '';
    const password = body?.password ?? '';

    if (!username || !password) {
      res.status(400).json({ message: 'Username and password are required' });
      return;
    }

    const user = await this.authService.localLogin(username, password);

    if (!user) {
      await this.rateLimiter.recordAttempt(ip);
      // Generic error - does not reveal whether the username exists
      res.status(401).json({
        message: 'Invalid credentials.',
      });
      return;
    }

    // Success: the counter is only reset after confirmed session rotation
    // (only on successful regeneration), so an error during session rebuild
    // does not lift the lockout prematurely.
    req.session.regenerate(async (err?: Error | null) => {
      if (err) {
        res.status(500).json({ message: 'Session error' });
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
      // BugFix-18: redirect to the web login route (/login), NOT the API
      // route /auth/login – the latter has no web page and produced a 404.
      res.redirect('/login?error=oidc-not-configured');
      return;
    }

    const codeVerifier = req.session.oidcCodeVerifier;
    if (!codeVerifier) {
      res.redirect('/login?error=missing-code-verifier');
      return;
    }

    const params = this.oidc.callbackParams(req);
    if (!params) {
      res.redirect('/login?error=invalid-callback');
      return;
    }

    const expectedState = req.session.oidcState;
    if (!expectedState) {
      res.redirect('/login?error=missing-state');
      return;
    }

    // BugFix-07: self-service linking. The callback runs in "link mode"
    // when POST /auth/oidc/link started it: the verified identity (iss, sub)
    // is bound to the already logged-in user – NO session rotation, NO
    // login. Without a logged-in user the link mode is invalid (the flow
    // was started from a logged-out session or the session was replaced).
    if (req.session.oidcLinkMode) {
      const userId = req.session.userId;
      delete req.session.oidcCodeVerifier;
      delete req.session.oidcState;
      delete req.session.oidcLinkMode;
      if (!userId) {
        res.redirect('/login?error=not-authenticated');
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
        // 409: identity already bound to another account – an expected
        // user-flow outcome, no log noise (BugFix-18 review round 1).
        if (error instanceof ConflictException) {
          res.redirect('/settings?error=oidc-link-conflict');
          return;
        }
        // BugFix-18: log the underlying failure (no secrets) so production
        // issues can be diagnosed.
        this.logger.warn(
          `OIDC self-service link failed: ` +
            `${error instanceof Error ? error.constructor.name : typeof error}: ` +
            `${error instanceof Error ? error.message : String(error)}`,
        );
        res.redirect('/settings?error=oidc-link-failed');
      }
      return;
    }

    try {
      const user = await this.oidc.validateCallback(params, codeVerifier, expectedState);
      req.session.regenerate((err?: Error | null) => {
        if (err) {
          this.logger.warn(
            `OIDC login session rotation failed: ` +
              `${err instanceof Error ? err.constructor.name : typeof err}: ` +
              `${err instanceof Error ? err.message : String(err)}`,
          );
          res.redirect('/login?error=session');
          return;
        }
        req.session.userId = user.id;
        delete req.session.oidcCodeVerifier;
        delete req.session.oidcState;
        res.redirect('/');
      });
    } catch (error) {
      // BugFix-18: log the underlying failure (no secrets) so production
      // issues can be diagnosed.
      this.logger.warn(
        `OIDC login failed: ` +
          `${error instanceof Error ? error.constructor.name : typeof error}: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
      res.redirect('/login?error=authentication-failed');
    }
  }

  /**
   * BugFix-07: self-service linking (Q2). Status of the OIDC binding of
   * the logged-in user. Authenticated (no @Public).
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
   * BugFix-07: starts the link flow. Returns the provider URL; the session
   * remembers the link mode so the callback binds the identity instead of
   * logging in. 501 when OIDC is not ready.
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
        'OIDC is not configured or the client could not be initialized',
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
   * BugFix-07: removes the OIDC binding of the logged-in user (only the
   * binding, never the account). 409 when no binding exists.
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

  /**
   * BugFix-16: password change for the signed-in user. Authenticated (no
   * @Public). 403 when the current password is wrong, 409 when the account
   * has no local credential (OIDC-only). Failed current-password
   * verifications are rate-limited per IP (scope "change-password"), so a
   * stolen session cannot be used to brute-force the current password. The
   * session stays valid.
   */
  @Post('change-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  async changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: ChangePasswordDto,
    @Req() req: SessionRequest,
  ): Promise<void> {
    const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown';
    if (await this.rateLimiter.isBlocked(ip, 'change-password')) {
      // Generic message – does not reveal anything about the account.
      throw new HttpException(
        'Too many failed attempts. Please try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    try {
      await this.authService.changePassword(
        user.id,
        body.currentPassword,
        body.newPassword,
      );
      // Success: lift the counter again so a later typo in the same window
      // is not punished with a spurious 429 (mirrors localLogin).
      await this.rateLimiter.resetAttempts(ip, 'change-password');
    } catch (error) {
      if (error instanceof ForbiddenException) {
        await this.rateLimiter.recordAttempt(ip, 'change-password');
      }
      throw error;
    }
  }
}
