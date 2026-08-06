import { describe, it, expect, vi, afterEach } from 'vitest';
import { Logger } from '@nestjs/common';
import { GlobalRole, UserStatus } from '@prisma/client';
import { RestartService } from '../restart.service';
import type { AuthenticatedUser } from '../../identity/auth.service';

const mockUser: AuthenticatedUser = {
  id: 'user-1',
  username: 'admin',
  displayName: 'Admin',
  role: GlobalRole.ADMIN,
  status: UserStatus.ACTIVE,
  memberships: [],
};

function createMockCoordinator() {
  return {
    requestRestart: vi.fn().mockResolvedValue(undefined),
  };
}

describe('RestartService (BugFix-06, Teil 3.4)', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('hinterlegt die Anforderung mit Metadaten und beendet den Prozess', async () => {
    vi.useFakeTimers();
    const coordinator = createMockCoordinator();
    const service = new RestartService(coordinator as never);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

    await service.requestRestart(mockUser, '  OIDC aktiviert  ');

    expect(coordinator.requestRestart).toHaveBeenCalledWith(
      expect.objectContaining({
        requestedBy: 'admin',
        reason: 'OIDC aktiviert',
        services: ['api', 'worker'],
      }),
    );
    // Die HTTP-Antwort soll den Client erreichen, bevor der Prozess exitet.
    vi.advanceTimersByTime(2000);
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('beendet den Prozess auch bei nicht erreichbarem Redis (fail-soft)', async () => {
    vi.useFakeTimers();
    const coordinator = createMockCoordinator();
    coordinator.requestRestart.mockRejectedValue(new Error('ECONNREFUSED'));
    const service = new RestartService(coordinator as never);
    const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

    await service.requestRestart(mockUser);

    expect(warnSpy).toHaveBeenCalled();
    vi.advanceTimersByTime(2000);
    expect(exitSpy).toHaveBeenCalledWith(0);
  });
});
