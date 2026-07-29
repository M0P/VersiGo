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

type SessionRequest = Request & {
  user?: AuthenticatedUser;
  session: {
    userId?: string;
    regenerate: (callback: (err?: Error | null) => void) => void;
    destroy: (callback: () => void) => void;
  };
};

@Controller('auth')
export class AuthController {
  @Public()
  @Get('login')
  login(@Res() res: Response): void {
    res.status(501).json({ message: 'OIDC login endpoint vorbereitet, aber noch nicht an den Provider gebunden.' });
  }

  @Public()
  @Get('callback')
  callback(@Req() req: SessionRequest, @Res() res: Response): void {
    const user = req.user;
    if (!user) {
      res.redirect('/auth/login?error=missing-user');
      return;
    }

    req.session.regenerate((err?: Error | null) => {
      if (err) {
        res.redirect('/auth/login?error=session');
        return;
      }
      req.session.userId = user.id;
      res.redirect('/');
    });
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
