import { describe, it, expect, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { FamilySharingGuard } from '../family-sharing.guard';

function createGuard(enabled: boolean): FamilySharingGuard {
  const capabilities = {
    isEnabled: vi.fn().mockResolvedValue(enabled),
  };
  return new FamilySharingGuard(capabilities as never);
}

describe('FamilySharingGuard (BugFix-05 feature flag)', () => {
  it('allows access while family sharing is active (default true)', async () => {
    const guard = createGuard(true);
    await expect(guard.canActivate({} as never)).resolves.toBe(true);
  });

  it('returns 403 when FAMILY_SHARING_ENABLED=false', async () => {
    const guard = createGuard(false);
    await expect(guard.canActivate({} as never)).rejects.toThrow(ForbiddenException);
  });

  it('queries the capability through the resolver', async () => {
    const capabilities = {
      isEnabled: vi.fn().mockResolvedValue(true),
    };
    const guard = new FamilySharingGuard(capabilities as never);
    await guard.canActivate({} as never);
    expect(capabilities.isEnabled).toHaveBeenCalledWith('familySharing');
  });
});
