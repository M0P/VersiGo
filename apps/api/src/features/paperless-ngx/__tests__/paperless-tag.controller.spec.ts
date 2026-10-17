import { describe, it, expect, vi } from 'vitest';
import { GlobalRole } from '@prisma/client';
import { PaperlessTagController } from '../paperless-tag.controller';
import { ROLES_KEY } from '../../identity/roles.decorator';
import type { PaperlessTagService } from '../paperless-tag.service';
import type { AuthenticatedUser } from '../../identity/auth.service';

/**
 * AP-22: the controller is a thin, household-scoped facade. These tests pin
 * the delegation contract (arguments forwarded, safe defaults applied) and
 * the permission decorators that keep read-only roles out of mutations.
 */
describe('PaperlessTagController', () => {
  const householdId = '11111111-1111-4111-8111-111111111111';
  const policyId = '22222222-2222-4222-8222-222222222222';
  const user = { id: 'user-1', email: 'a@example.com' } as unknown as AuthenticatedUser;

  function createMockService() {
    return {
      searchTags: vi.fn().mockResolvedValue({ items: [], page: 1, pageCount: 0 }),
      createTag: vi.fn().mockResolvedValue({ tagId: 1, name: 'KFZ' }),
      getConfig: vi.fn().mockResolvedValue(null),
      setTag: vi.fn().mockResolvedValue({ tagRemoved: false }),
      removeTag: vi.fn().mockResolvedValue({ tagRemoved: true }),
      getStatus: vi.fn().mockResolvedValue({ configured: false }),
      requestSync: vi.fn().mockResolvedValue({ scheduled: 0 }),
      retryTagging: vi.fn().mockResolvedValue({ scheduled: 1 }),
    } as unknown as PaperlessTagService;
  }

  it('forwards the tag search with safe defaults', async () => {
    const service = createMockService();
    const controller = new PaperlessTagController(service);

    await controller.searchTags(householdId, user, {});

    expect(service.searchTags).toHaveBeenCalledWith(householdId, user, '', 1);
  });

  it('forwards the create request', async () => {
    const service = createMockService();
    const controller = new PaperlessTagController(service);

    await controller.createTag(householdId, user, { name: 'KFZ' });

    expect(service.createTag).toHaveBeenCalledWith(householdId, user, 'KFZ');
  });

  it('forwards read access with the full user for the config and status', async () => {
    const service = createMockService();
    const controller = new PaperlessTagController(service);

    await controller.getConfig(householdId, policyId, user);
    await controller.getStatus(householdId, policyId, user);

    expect(service.getConfig).toHaveBeenCalledWith(householdId, user, policyId);
    expect(service.getStatus).toHaveBeenCalledWith(householdId, user, policyId);
  });

  it('forwards the user id (not the full user) for mutations', async () => {
    const service = createMockService();
    const controller = new PaperlessTagController(service);

    await controller.setTag(householdId, policyId, user, { tagId: 7 });
    await controller.removeTag(householdId, policyId, user);
    await controller.requestSync(householdId, policyId, user);
    await controller.retryTagging(householdId, policyId, user, { documentId: 'doc-1' });

    expect(service.setTag).toHaveBeenCalledWith(householdId, 'user-1', policyId, 7, undefined);
    expect(service.removeTag).toHaveBeenCalledWith(householdId, 'user-1', policyId);
    expect(service.requestSync).toHaveBeenCalledWith(householdId, 'user-1', policyId);
    expect(service.retryTagging).toHaveBeenCalledWith(householdId, 'user-1', policyId, 'doc-1');
  });

  it('restricts mutations to USER and ADMIN roles', () => {
    const service = createMockService();
    const controller = new PaperlessTagController(service);
    const proto = Object.getPrototypeOf(controller) as PaperlessTagController;

    const rolesOf = (name: keyof PaperlessTagController) =>
      Reflect.getMetadata(ROLES_KEY, proto[name] as object) as GlobalRole[] | undefined;

    expect(rolesOf('setTag')).toEqual([GlobalRole.USER, GlobalRole.ADMIN]);
    expect(rolesOf('removeTag')).toEqual([GlobalRole.USER, GlobalRole.ADMIN]);
    expect(rolesOf('retryTagging')).toEqual([GlobalRole.USER, GlobalRole.ADMIN]);
    // Read endpoints additionally allow READ_ONLY.
    expect(rolesOf('getConfig')).toEqual([
      GlobalRole.READ_ONLY,
      GlobalRole.USER,
      GlobalRole.ADMIN,
    ]);
  });
});
