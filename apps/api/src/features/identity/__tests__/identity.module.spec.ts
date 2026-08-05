import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IdentityModule } from '../identity.module';
import { AppConfigService, CapabilityFlagsService } from '@versigo/foundation';
import { LocalAdminBootstrapService } from '../local-admin.bootstrap';

type Flags = { oidc: boolean; local: boolean };

describe('IdentityModule.onModuleInit', () => {
  let module: IdentityModule;
  let capabilities: { isEnabled: ReturnType<typeof vi.fn> };
  let bootstrap: ReturnType<typeof vi.fn>;

  function createModule(flags: Flags): void {
    capabilities = {
      isEnabled: vi.fn(
        async (capability: keyof Flags) => flags[capability] ?? false,
      ),
    };
    bootstrap = vi.fn().mockResolvedValue(undefined);
    module = new IdentityModule(
      capabilities as unknown as CapabilityFlagsService,
      { get: vi.fn().mockReturnValue(false) } as unknown as AppConfigService,
      { bootstrap } as unknown as LocalAdminBootstrapService,
    );
  }

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('throws when neither OIDC nor local authentication is enabled', async () => {
    createModule({ oidc: false, local: false });

    await expect(module.onModuleInit()).rejects.toThrow(
      'No authentication method configured',
    );
    expect(bootstrap).not.toHaveBeenCalled();
  });

  it('bootstraps the local admin when local authentication is enabled', async () => {
    createModule({ oidc: false, local: true });

    await expect(module.onModuleInit()).resolves.toBeUndefined();
    expect(bootstrap).toHaveBeenCalledTimes(1);
  });

  it('skips the local admin bootstrap when only OIDC is enabled', async () => {
    createModule({ oidc: true, local: false });

    await expect(module.onModuleInit()).resolves.toBeUndefined();
    expect(bootstrap).not.toHaveBeenCalled();
  });

  it('bootstraps the local admin when both methods are enabled', async () => {
    createModule({ oidc: true, local: true });

    await expect(module.onModuleInit()).resolves.toBeUndefined();
    expect(bootstrap).toHaveBeenCalledTimes(1);
  });

  it('falls back to the env snapshot when capability resolution fails (DB down)', async () => {
    capabilities = {
      isEnabled: vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED')),
    };
    bootstrap = vi.fn().mockResolvedValue(undefined);
    module = new IdentityModule(
      capabilities as unknown as CapabilityFlagsService,
      {
        get: vi.fn((key: string) => key === 'LOCAL_AUTH_ENABLED'),
      } as unknown as AppConfigService,
      { bootstrap } as unknown as LocalAdminBootstrapService,
    );

    await expect(module.onModuleInit()).resolves.toBeUndefined();
    expect(bootstrap).toHaveBeenCalledTimes(1);
  });

  it('throws from the env fallback when no auth method is configured', async () => {
    capabilities = {
      isEnabled: vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED')),
    };
    bootstrap = vi.fn().mockResolvedValue(undefined);
    module = new IdentityModule(
      capabilities as unknown as CapabilityFlagsService,
      { get: vi.fn().mockReturnValue(false) } as unknown as AppConfigService,
      { bootstrap } as unknown as LocalAdminBootstrapService,
    );

    await expect(module.onModuleInit()).rejects.toThrow(
      'No authentication method configured',
    );
    expect(bootstrap).not.toHaveBeenCalled();
  });
});
