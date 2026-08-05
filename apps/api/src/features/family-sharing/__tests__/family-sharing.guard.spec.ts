import { describe, it, expect, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { FamilySharingGuard } from '../family-sharing.guard';

function createGuard(enabled: boolean): FamilySharingGuard {
  const capabilities = {
    isEnabled: vi.fn().mockResolvedValue(enabled),
  };
  return new FamilySharingGuard(capabilities as never);
}

describe('FamilySharingGuard (BugFix-05 Feature-Schalter)', () => {
  it('erlaubt Zugriff, solange Familien-Freigaben aktiv sind (Default true)', async () => {
    const guard = createGuard(true);
    await expect(guard.canActivate({} as never)).resolves.toBe(true);
  });

  it('liefert 403, wenn FAMILY_SHARING_ENABLED=false', async () => {
    const guard = createGuard(false);
    await expect(guard.canActivate({} as never)).rejects.toThrow(ForbiddenException);
  });

  it('fragt die Capability ueber den Resolver ab', async () => {
    const capabilities = {
      isEnabled: vi.fn().mockResolvedValue(true),
    };
    const guard = new FamilySharingGuard(capabilities as never);
    await guard.canActivate({} as never);
    expect(capabilities.isEnabled).toHaveBeenCalledWith('familySharing');
  });
});
