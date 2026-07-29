import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthService } from './auth.service';

export const PUBLIC_ROUTE_KEY = 'isPublicRoute';
export const Public = () => Reflect.metadata(PUBLIC_ROUTE_KEY, true);

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
    if (!user || user.status === 'DISABLED') {
      throw new UnauthorizedException('Benutzer nicht aktiv');
    }

    request.user = user;
    return true;
  }
}
