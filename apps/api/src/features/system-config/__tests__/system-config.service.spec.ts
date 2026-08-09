/* eslint-disable @typescript-eslint/no-explicit-any */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { getSettingDefinition } from '@versigo/foundation';
import { SystemConfigService } from '../system-config.service';

// The SSRF guard is mocked in the service spec (the dedicated guard spec
// tests the blocklist); here only the call path is verified.
// `UnsafeEndpointError` must be exported as a real error class so that the
// `instanceof` check in the service works.
const { assertSafeTestEndpoint, UnsafeEndpointError } = vi.hoisted(() => {
  class UnsafeEndpointError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'UnsafeEndpointError';
    }
  }
  return {
    assertSafeTestEndpoint: vi.fn().mockResolvedValue(undefined),
    UnsafeEndpointError,
  };
});
vi.mock('../../../common/connectivity/connectivity-guard', () => ({
  assertSafeTestEndpoint,
  UnsafeEndpointError,
}));

const ACTOR = { id: 'admin-1', username: 'admin', role: 'ADMIN' } as any;

function createMockDb() {
  return {
    globalIntegrationSetting: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue({
        id: 'gs-1',
        key: 'AI_ENABLED',
        valueEncrypted: null,
        valuePlain: 'true',
        isSecret: false,
        updatedByUserId: 'admin-1',
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-02'),
      }),
    },
    user: {
      findMany: vi.fn().mockResolvedValue([{ id: 'admin-1', username: 'admin' }]),
      findUnique: vi.fn().mockResolvedValue({ id: 'admin-1', username: 'admin' }),
    },
    auditEvent: { create: vi.fn().mockResolvedValue({}) },
  };
}

function createMockResolver() {
  const resolveImpl = async (key: string) => {
    const definition = getSettingDefinition(key)!;
    const resolution = {
      key,
      value: definition.defaultValue,
      source: 'DEFAULT' as const,
      reason: 'No value configured – safe code default active',
      uiValuePresent: false,
      uiValueInvalid: false,
      uiUpdatedAt: null,
    };
    if (definition.category === 'restart') {
      // Simplified mock: for restart keys a pending value exists
      // (the full semantics incl. the "already active" suppression are
      // covered by the resolver spec).
      return { ...resolution, pendingRestartValue: definition.defaultValue };
    }
    return resolution;
  };
  return {
    resolve: vi.fn(resolveImpl),
    resolveMany: vi.fn(async (keys: string[]) => {
      const map = new Map<string, any>();
      for (const key of keys) map.set(key, await resolveImpl(key));
      return map;
    }),
    getEffectiveString: vi.fn(async (key: string) => {
      const definition = getSettingDefinition(key)!;
      return typeof definition.defaultValue === 'string' ? definition.defaultValue : undefined;
    }),
    getEffectiveBoolean: vi.fn(async (key: string) => {
      const definition = getSettingDefinition(key)!;
      return typeof definition.defaultValue === 'boolean' ? definition.defaultValue : undefined;
    }),
    getEffectiveNumber: vi.fn(async (key: string) => {
      const definition = getSettingDefinition(key)!;
      return typeof definition.defaultValue === 'number' ? definition.defaultValue : undefined;
    }),
  };
}

function createMockSettingsStore() {
  return {
    createGlobalSetting: vi.fn().mockResolvedValue({ key: 'AI_ENABLED' }),
    updateGlobalSetting: vi.fn().mockResolvedValue({ key: 'AI_ENABLED' }),
    deleteGlobalSetting: vi.fn().mockResolvedValue({ success: true }),
  };
}

function createService() {
  const db = createMockDb();
  const resolver = createMockResolver();
  const store = createMockSettingsStore();
  const service = new SystemConfigService(db as never, resolver as never, store as never);
  return { db, resolver, store, service };
}

describe('SystemConfigService', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    assertSafeTestEndpoint.mockReset();
    assertSafeTestEndpoint.mockResolvedValue(undefined);
  });

  describe('list', () => {
    it('returns entries for all UI-configurable keys (no bootstrap keys)', async () => {
      const { db, service } = createService();
      const entries = await service.list();

      expect(entries.length).toBeGreaterThan(0);
      const keys = entries.map((e) => e.key);
      expect(keys).toContain('AI_ENABLED');
      expect(keys).toContain('AI_OPENAI_COMPAT_API_KEY');
      expect(keys).not.toContain('DATABASE_URL');
      expect(keys).not.toContain('SETTINGS_ENCRYPTION_KEY');
      expect(db.globalIntegrationSetting.findMany).toHaveBeenCalled();
    });

    it('marks secrets and masks their effective value', async () => {
      const { service } = createService();
      const entries = await service.list();
      const secretEntry = entries.find((e) => e.key === 'AI_OPENAI_COMPAT_API_KEY');

      expect(secretEntry).toBeDefined();
      expect(secretEntry!.secret).toBe(true);
      expect(secretEntry!.effectiveValue).toBeNull();
      expect(secretEntry!.secretSet).toBe(false);
    });

    it('marks restart settings as restartRequired only for a pending value', async () => {
      const { service } = createService();
      const entries = await service.list();
      const restartEntry = entries.find((e) => e.key === 'STORAGE_ENABLED');
      const runtimeEntry = entries.find((e) => e.key === 'AI_ENABLED');

      expect(restartEntry).toBeDefined();
      // m8: "restart required" + pendingRestartValue only for restart
      // keys with a pending (not yet active) value.
      expect(restartEntry!.restartRequired).toBe(true);
      expect(restartEntry!.pendingRestartValue).toBe(false);
      expect(runtimeEntry!.restartRequired).toBe(false);
      expect(runtimeEntry!.pendingRestartValue).toBeNull();
    });
  });

  describe('get', () => {
    it('throws NotFoundException for an unknown key', async () => {
      const { service } = createService();
      await expect(service.get('UNKNOWN_KEY')).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException for bootstrap keys', async () => {
      const { service } = createService();
      await expect(service.get('DATABASE_URL')).rejects.toThrow(ForbiddenException);
    });

    it('returns the catalog view of a known key', async () => {
      const { service } = createService();
      const entry = await service.get('AI_ENABLED');

      expect(entry.key).toBe('AI_ENABLED');
      expect(entry.type).toBe('boolean');
      expect(entry.source).toBe('DEFAULT');
      // Username instead of the raw user UUID (m6).
      expect(entry.uiUpdatedBy).toBe('admin');
    });
  });

  describe('update', () => {
    it('persists a valid value canonically and audits without values', async () => {
      const { db, store, service } = createService();

      db.globalIntegrationSetting.findUnique.mockResolvedValue(null); // Neuanlage
      const entry = await service.update('AI_ENABLED', 'true', ACTOR);

      expect(store.createGlobalSetting).toHaveBeenCalledWith(
        'AI_ENABLED',
        'true',
        false,
        'admin-1',
      );
      expect(store.updateGlobalSetting).not.toHaveBeenCalled();
      expect(db.auditEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'SYSTEM_CONFIG_UPSERTED',
            entityId: 'AI_ENABLED',
            actorUserId: 'admin-1',
          }),
        }),
      );
      // No value in the audit diff – only key + redaction flag
      const auditCall = db.auditEvent.create.mock.calls[0][0].data as any;
      expect(auditCall.diffJson).toEqual({ key: 'AI_ENABLED', redacted: true });
      expect(entry.key).toBe('AI_ENABLED');
    });

    it('updates an existing value via updateGlobalSetting', async () => {
      const { store, service } = createService();

      await service.update('AI_ENABLED', 'false', ACTOR);

      expect(store.updateGlobalSetting).toHaveBeenCalledWith(
        'AI_ENABLED',
        'false',
        false,
        'admin-1',
      );
      expect(store.createGlobalSetting).not.toHaveBeenCalled();
    });

    it('rejects invalid values and persists nothing', async () => {
      const { store, service } = createService();

      await expect(service.update('AI_ENABLED', 'yes', ACTOR)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.update('AI_EXTRACTION_TIMEOUT_MS', '10', ACTOR)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.update('AI_PROVIDER', 'nonsense', ACTOR)).rejects.toThrow(
        BadRequestException,
      );
      expect(store.createGlobalSetting).not.toHaveBeenCalled();
      expect(store.updateGlobalSetting).not.toHaveBeenCalled();
    });

    it('persists secrets encrypted (isSecret true) and audits without plain text', async () => {
      const { db, store, service } = createService();

      db.globalIntegrationSetting.findUnique.mockResolvedValue(null);
      await service.update('AI_OPENAI_COMPAT_API_KEY', 'sk-secret-123', ACTOR);

      expect(store.createGlobalSetting).toHaveBeenCalledWith(
        'AI_OPENAI_COMPAT_API_KEY',
        'sk-secret-123',
        true,
        'admin-1',
      );
      const auditCall = db.auditEvent.create.mock.calls[0][0].data as any;
      expect(JSON.stringify(auditCall.diffJson)).not.toContain('sk-secret-123');
    });

    it('rejects bootstrap keys', async () => {
      const { store, service } = createService();
      await expect(service.update('DATABASE_URL', 'postgres://x', ACTOR)).rejects.toThrow(
        ForbiddenException,
      );
      expect(store.createGlobalSetting).not.toHaveBeenCalled();
    });
  });

  describe('reset', () => {
    it('deletes the UI row and audits the reset', async () => {
      const { db, store, service } = createService();

      await service.reset('AI_ENABLED', ACTOR);

      expect(store.deleteGlobalSetting).toHaveBeenCalledWith('AI_ENABLED');
      expect(db.auditEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'SYSTEM_CONFIG_RESET' }),
        }),
      );
    });

    it('is idempotent when no UI row exists', async () => {
      const { db, store, service } = createService();
      db.globalIntegrationSetting.findUnique.mockResolvedValue(null);

      await expect(service.reset('AI_ENABLED', ACTOR)).resolves.toBeDefined();
      expect(store.deleteGlobalSetting).not.toHaveBeenCalled();
    });
  });

  describe('testConnectivity', () => {
    it('throws NotFoundException for unknown keys', async () => {
      const { service } = createService();
      await expect(service.testConnectivity('NOPE', ACTOR)).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException for keys that cannot be tested', async () => {
      const { service } = createService();
      await expect(service.testConnectivity('AI_PROVIDER', ACTOR)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('reports success for a reachable endpoint (Ollama) and audits the test', async () => {
      const { db, service } = createService();
      // Since BugFix-06 part 2 the actual request runs via
      // testEndpoint() (axios, TLS relaxation possible) – so axios instead
      // globalem fetch mocken.
      const axiosGetMock = vi
        .spyOn(axios, 'get')
        .mockResolvedValue({ status: 200, statusText: 'OK' } as never);

      const result = await service.testConnectivity('AI_OLLAMA_BASE_URL', ACTOR);

      expect(result.success).toBe(true);
      expect(result.message).toBe('HTTP 200: OK');
      expect(axiosGetMock).toHaveBeenCalledWith(
        'http://localhost:11434/api/tags',
        expect.objectContaining({ signal: expect.anything() }),
      );
      // The SSRF guard is called BEFORE the request (the guard itself is
      // tested in its own spec; here only the call path).
      expect(assertSafeTestEndpoint).toHaveBeenCalledWith(
        'http://localhost:11434/api/tags',
        expect.objectContaining({ allowPrivate: false }),
      );
      // Connectivity tests are audited revision-safe (M1) – without
      // URLs/tokens, only key + status.
      const auditCall = db.auditEvent.create.mock.calls[0][0].data as any;
      expect(auditCall.action).toBe('SYSTEM_CONFIG_TESTED');
      expect(auditCall.entityId).toBe('AI_OLLAMA_BASE_URL');
      expect(auditCall.actorUserId).toBe('admin-1');
      expect(auditCall.diffJson).toEqual({ key: 'AI_OLLAMA_BASE_URL', redacted: true, outcome: 'ok' });
      axiosGetMock.mockRestore();
    });

    it('reports connection errors safely without secrets', async () => {
      const { service } = createService();
      const axiosGetMock = vi
        .spyOn(axios, 'get')
        .mockRejectedValue(new Error('ECONNREFUSED'));

      const result = await service.testConnectivity('AI_OLLAMA_BASE_URL', ACTOR);

      expect(result.success).toBe(false);
      expect(result.message).toContain('Verbindungsfehler');
      expect(result.message).not.toContain('11434');
      axiosGetMock.mockRestore();
    });

    it('rejects unsafe endpoints (SSRF) without querying them', async () => {
      const { service } = createService();
      assertSafeTestEndpoint.mockRejectedValueOnce(
        new UnsafeEndpointError('Address lies in a blocked range'),
      );
      const axiosGetMock = vi.spyOn(axios, 'get');

      const result = await service.testConnectivity('AI_OLLAMA_BASE_URL', ACTOR);

      expect(result.success).toBe(false);
      expect(result.message).toContain('abgelehnt');
      expect(axiosGetMock).not.toHaveBeenCalled();
      axiosGetMock.mockRestore();
    });
  });
});
