/* eslint-disable @typescript-eslint/no-explicit-any */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { getSettingDefinition } from '@insura/foundation';
import { SystemConfigService } from '../system-config.service';

// SSRF-Guard wird im Service-Spec gemockt (eigene Guard-Spec testet die
// Blockliste); hier wird nur der Aufrufpfad verifiziert. `UnsafeEndpointError`
// muss als echte Error-Klasse exportiert werden, damit die `instanceof`-
// Pruefung im Service funktioniert.
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
      reason: 'Kein Wert konfiguriert – sicherer Code-Default aktiv',
      uiValuePresent: false,
      uiValueInvalid: false,
      uiUpdatedAt: null,
    };
    if (definition.category === 'restart') {
      // Vereinfachtes Mock: fuer Restart-Keys liegt ein pendenter Wert vor
      // (die vollstaendige Semantik inkl. "bereits aktiv"-Unterdrueckung
      // testet die Resolver-Spec).
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
    it('liefert Eintraege fuer alle UI-konfigurierbaren Schluessel (keine Bootstrap-Keys)', async () => {
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

    it('markiert Secrets und maskiert deren effektiven Wert', async () => {
      const { service } = createService();
      const entries = await service.list();
      const secretEntry = entries.find((e) => e.key === 'AI_OPENAI_COMPAT_API_KEY');

      expect(secretEntry).toBeDefined();
      expect(secretEntry!.secret).toBe(true);
      expect(secretEntry!.effectiveValue).toBeNull();
      expect(secretEntry!.secretSet).toBe(false);
    });

    it('markiert Neustart-Settings nur bei pendentem Wert als restartRequired', async () => {
      const { service } = createService();
      const entries = await service.list();
      const restartEntry = entries.find((e) => e.key === 'STORAGE_ENABLED');
      const runtimeEntry = entries.find((e) => e.key === 'AI_ENABLED');

      expect(restartEntry).toBeDefined();
      // m8: "Neustart erforderlich" + pendingRestartValue nur fuer
      // Restart-Keys mit pendentem (noch nicht aktivem) Wert.
      expect(restartEntry!.restartRequired).toBe(true);
      expect(restartEntry!.pendingRestartValue).toBe(false);
      expect(runtimeEntry!.restartRequired).toBe(false);
      expect(runtimeEntry!.pendingRestartValue).toBeNull();
    });
  });

  describe('get', () => {
    it('wirft NotFoundException fuer unbekannten Schluessel', async () => {
      const { service } = createService();
      await expect(service.get('UNKNOWN_KEY')).rejects.toThrow(NotFoundException);
    });

    it('wirft ForbiddenException fuer Bootstrap-Schluessel', async () => {
      const { service } = createService();
      await expect(service.get('DATABASE_URL')).rejects.toThrow(ForbiddenException);
    });

    it('liefert die Katalogansicht eines bekannten Schluessels', async () => {
      const { service } = createService();
      const entry = await service.get('AI_ENABLED');

      expect(entry.key).toBe('AI_ENABLED');
      expect(entry.type).toBe('boolean');
      expect(entry.source).toBe('DEFAULT');
      // Benutzername statt roher User-UUID (m6).
      expect(entry.uiUpdatedBy).toBe('admin');
    });
  });

  describe('update', () => {
    it('persistiert einen validen Wert kanonisch und auditiert ohne Werte', async () => {
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
      // Kein Wert in der Audit-Diff – nur Key + Redaction-Flag
      const auditCall = db.auditEvent.create.mock.calls[0][0].data as any;
      expect(auditCall.diffJson).toEqual({ key: 'AI_ENABLED', redacted: true });
      expect(entry.key).toBe('AI_ENABLED');
    });

    it('aktualisiert einen bestehenden Wert ueber updateGlobalSetting', async () => {
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

    it('lehnt ungueltige Werte ab und persistiert nichts', async () => {
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

    it('persistiert Secrets verschluesselt (isSecret true) und auditiert ohne Klartext', async () => {
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

    it('lehnt Bootstrap-Schluessel ab', async () => {
      const { store, service } = createService();
      await expect(service.update('DATABASE_URL', 'postgres://x', ACTOR)).rejects.toThrow(
        ForbiddenException,
      );
      expect(store.createGlobalSetting).not.toHaveBeenCalled();
    });
  });

  describe('reset', () => {
    it('loescht die UI-Zeile und auditiert den Reset', async () => {
      const { db, store, service } = createService();

      await service.reset('AI_ENABLED', ACTOR);

      expect(store.deleteGlobalSetting).toHaveBeenCalledWith('AI_ENABLED');
      expect(db.auditEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'SYSTEM_CONFIG_RESET' }),
        }),
      );
    });

    it('ist idempotent, wenn keine UI-Zeile existiert', async () => {
      const { db, store, service } = createService();
      db.globalIntegrationSetting.findUnique.mockResolvedValue(null);

      await expect(service.reset('AI_ENABLED', ACTOR)).resolves.toBeDefined();
      expect(store.deleteGlobalSetting).not.toHaveBeenCalled();
    });
  });

  describe('testConnectivity', () => {
    it('wirft NotFoundException fuer unbekannte Schluessel', async () => {
      const { service } = createService();
      await expect(service.testConnectivity('NOPE', ACTOR)).rejects.toThrow(NotFoundException);
    });

    it('wirft BadRequestException fuer nicht pruefbare Schluessel', async () => {
      const { service } = createService();
      await expect(service.testConnectivity('AI_PROVIDER', ACTOR)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('meldet Erfolg bei erreichbarem Endpunkt (Ollama) und auditiert den Test', async () => {
      const { db, service } = createService();
      const fetchMock = vi
        .fn()
        .mockResolvedValue({ ok: true, status: 200, statusText: 'OK' });
      vi.stubGlobal('fetch', fetchMock);

      const result = await service.testConnectivity('AI_OLLAMA_BASE_URL', ACTOR);

      expect(result.success).toBe(true);
      expect(result.message).toBe('HTTP 200: OK');
      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:11434/api/tags',
        expect.objectContaining({ signal: expect.anything() }),
      );
      // SSRF-Guard wird VOR dem fetch aufgerufen (Guard selbst ist in der
      // eigenen Spec getestet, hier nur der Aufrufpfad).
      expect(assertSafeTestEndpoint).toHaveBeenCalledWith('http://localhost:11434/api/tags');
      // Connectivity-Tests werden revisionssicher auditiert (M1) – ohne
      // URLs/Tokens, nur Key + Status.
      const auditCall = db.auditEvent.create.mock.calls[0][0].data as any;
      expect(auditCall.action).toBe('SYSTEM_CONFIG_TESTED');
      expect(auditCall.entityId).toBe('AI_OLLAMA_BASE_URL');
      expect(auditCall.actorUserId).toBe('admin-1');
      expect(auditCall.diffJson).toEqual({ key: 'AI_OLLAMA_BASE_URL', redacted: true, outcome: 'ok' });
      vi.unstubAllGlobals();
    });

    it('meldet Verbindungsfehler sicher ohne Secrets', async () => {
      const { service } = createService();
      vi.stubGlobal(
        'fetch',
        vi.fn().mockRejectedValue(new Error('ECONNREFUSED') as never),
      );

      const result = await service.testConnectivity('AI_OLLAMA_BASE_URL', ACTOR);

      expect(result.success).toBe(false);
      expect(result.message).toContain('Verbindungsfehler');
      expect(result.message).not.toContain('11434');
      vi.unstubAllGlobals();
    });

    it('lehnt unsichere Endpunkte (SSRF) ab, ohne sie anzufragen', async () => {
      const { service } = createService();
      assertSafeTestEndpoint.mockRejectedValueOnce(
        new UnsafeEndpointError('Adresse liegt in einem gesperrten Bereich'),
      );
      vi.stubGlobal('fetch', vi.fn());

      const result = await service.testConnectivity('AI_OLLAMA_BASE_URL', ACTOR);

      expect(result.success).toBe(false);
      expect(result.message).toContain('abgelehnt');
      expect(fetch).not.toHaveBeenCalled();
      vi.unstubAllGlobals();
    });
  });
});
