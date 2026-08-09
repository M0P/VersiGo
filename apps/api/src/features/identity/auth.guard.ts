import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserStatus } from '@prisma/client';
import { PUBLIC_ROUTE_KEY } from '@versigo/foundation';
import { AuthService } from './auth.service';

// Global guard: rejects every request without a valid session, unless the
// route is explicitly marked with @Public() (e.g. /auth/login, /health).
// Only active accounts (ACTIVE) may use protected resources - disabled
// (DISABLED) and not yet approved (PENDING_APPROVAL) accounts are
// rejected.
@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authService: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();
    const userId: string | undefined = request.session?.userId;

    if (!userId) {
      throw new UnauthorizedException('No valid session');
    }

    const user = await this.authService.findById(userId);
    if (!user || user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('User is not active');
    }

    request.user = user;
    return true;
  }
}
