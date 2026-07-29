import { describe, it, expect, vi } from 'vitest';
import { AuthController } from '../auth.controller';
import type { AuthenticatedUser } from '../auth.service';

type SessionLike = {
  userId?: string;
  regenerate: (callback: () => void) => void;
  destroy: (callback: () => void) => void;
};

type RequestLike = {
  user?: AuthenticatedUser | { id: string };
  session: SessionLike;
};

type ResponseLike = {
  redirect: ReturnType<typeof vi.fn>;
  clearCookie: ReturnType<typeof vi.fn>;
  status: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
};

describe('AuthController', () => {
  it('/auth/me liefert den authentifizierten User aus dem Request-Kontext zurueck', () => {
    const controller = new AuthController();
    const user: AuthenticatedUser = {
      id: 'user-1',
      email: 'a@example.com',
      displayName: 'A',
      status: 'ACTIVE',
      memberships: [],
    };
    expect(controller.me(user)).toEqual(user);
  });

  it('/auth/callback rotiert die Session vor dem Setzen der userId (Session-Fixation-Schutz)', () => {
    const controller = new AuthController();
    const regenerate = vi.fn((cb: () => void) => cb());
    const destroy = vi.fn((cb: () => void) => cb());
    const req = {
      user: { id: 'user-1' },
      session: { regenerate, destroy },
    } as unknown as RequestLike;
    const res = {
      redirect: vi.fn(),
      clearCookie: vi.fn(),
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
    } as ResponseLike;

    controller.callback(req as never, res as never);

    expect(regenerate).toHaveBeenCalled();
    expect(req.session.userId).toBe('user-1');
    expect(res.redirect).toHaveBeenCalledWith('/');
  });

  it('/auth/logout zerstoert die Session und loescht das Cookie', () => {
    const controller = new AuthController();
    const regenerate = vi.fn((cb: () => void) => cb());
    const destroy = vi.fn((cb: () => void) => cb());
    const req = {
      session: { regenerate, destroy },
    } as unknown as RequestLike;
    const res = {
      redirect: vi.fn(),
      clearCookie: vi.fn(),
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
    } as ResponseLike;

    controller.logout(req as never, res as never);

    expect(destroy).toHaveBeenCalled();
    expect(res.clearCookie).toHaveBeenCalledWith('insura.sid');
    expect(res.status).toHaveBeenCalledWith(204);
  });
});
