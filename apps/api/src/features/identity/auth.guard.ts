import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserStatus } from '@prisma/client';
import { PUBLIC_ROUTE_KEY } from '@insura/foundation';
import { AuthService } from './auth.service';

// Global-Guard: verweigert jeden Request ohne gueltige Session, ausser die
// Route ist explizit mit @Public() markiert (z. B. /auth/login, /health).
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
      throw new UnauthorizedException('Keine gueltige Session');
    }

    const user = await this.authService.findById(userId);
    if (!user || user.status === UserStatus.DISABLED) {
      throw new UnauthorizedException('Benutzer nicht aktiv');
    }

    request.user = user;
    return true;
  }
}
