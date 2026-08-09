/* eslint-disable @typescript-eslint/no-explicit-any */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { GlobalRole, UserStatus } from '@prisma/client';
import * as fs from 'fs';
import { PrivacyService } from '../privacy.service';
import type { AuthenticatedUser } from '../../identity/auth.service';

const STORAGE_ROOT = '/tmp/versigo-test-storage';

const adminUser: AuthenticatedUser = {
  id: 'user-1',
  username: 'admin',
  displayName: 'Admin',
  role: GlobalRole.ADMIN,
  status: UserStatus.ACTIVE,
  memberships: [{ householdId: 'household-1' }],
};

function createMockTx(overrides: Record<string, any> = {}) {
  return {
    user: {
      count: vi.fn().mockResolvedValue(1),
      delete: vi.fn().mockResolvedValue({}),
    },
    insurancePolicy: {
      findMany: vi.fn().mockResolvedValue([]),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      count: vi.fn().mockResolvedValue(0),
    },
    auditEvent: {
      create: vi.fn().mockResolvedValue({ id: 'audit-1' }),
    },
    householdMembership: {
      findMany: vi.fn().mockResolvedValue([]),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      count: vi.fn().mockResolvedValue(0),
    },
    household: {
      delete: vi.fn().mockResolvedValue({}),
    },
    ...overrides,
  };
}

function createMockDb(overrides: Record<string, any> = {}) {
  const tx = createMockTx(overrides.tx ?? {});
  return {
    user: { findUnique: vi.fn() },
    insurancePolicy: { findMany: vi.fn() },
    auditEvent: { findMany: vi.fn() },
    $transaction: vi.fn(async (fn: any) => {
      if (typeof fn === 'function') return fn(tx);
      return fn;
    }),
    tx,
    ...(overrides.db ?? {}),
  };
}

function createService(db: ReturnType<typeof createMockDb>): PrivacyService {
  const config = { get: (key: string) => (key === 'DOCUMENTS_STORAGE_PATH' ? STORAGE_ROOT : '') };
  return new PrivacyService(db as never, config as never);
}

describe('PrivacyService', () => {
  let unlinkSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    unlinkSpy = vi.spyOn(fs.promises, 'unlink').mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('exportPersonalData', () => {
    it('returns the own data without secrets (no password hash, no storageRefs, no portal credentials)', async () => {
      const db = createMockDb();
      db.user.findUnique.mockResolvedValue({
        id: 'user-1',
        username: 'alice',
        displayName: 'Alice',
        email: 'alice@example.com',
        locale: 'de',
        role: GlobalRole.USER,
        status: UserStatus.ACTIVE,
        oidcIssuer: null,
        oidcSubject: null,
        createdAt: new Date('2026-01-01T00:00:00Z'),
        // Sensitive values must NOT appear in the export:
        passwordHash: 'supersecret-hash',
        userPreferences: [
          { key: 'ui.theme', value: 'dark', updatedAt: new Date('2026-01-02T00:00:00Z') },
        ],
        memberships: [{ householdId: 'h1', household: { name: 'Familie' } }],
      });
      db.insurancePolicy.findMany.mockResolvedValue([
        {
          id: 'p1',
          type: 'Liability',
          insurerName: 'Test AG',
          contractNumber: 'CN-1',
          tariffName: 'T1',
          status: 'ACTIVE',
          startDate: new Date('2026-01-01T00:00:00Z'),
          endDate: null,
          renewalDate: null,
          premiumAmount: '100.00',
          deductibleAmount: null,
          source: 'MANUAL',
          createdAt: new Date('2026-01-01T00:00:00Z'),
          updatedAt: new Date('2026-01-01T00:00:00Z'),
          coveredPersons: [],
          costEntries: [],
          documents: [
            {
              fileName: 'police.pdf',
              mimeType: 'application/pdf',
              fileSize: 1024,
              storageType: 'INTERNAL',
              category: null,
              documentDate: null,
              uploadedAt: new Date('2026-01-03T00:00:00Z'),
              // must not be exported:
              storageRef: '/tmp/versigo-test-storage/p1/doc1/doc1',
            },
          ],
          portalLinks: [
            {
              providerKey: 'example-portal',
              mailboxCapability: true,
              lastSyncAt: null,
              syncStatus: 'NOT_SYNCED',
              // credentials/URLs must not be exported:
              portalUrl: 'https://portal.example.com',
              usernameHint: 'alice',
            },
          ],
          aiExtractionJobs: [],
        },
      ]);
      db.auditEvent.findMany.mockResolvedValue([
        { action: 'POLICY_CREATED', entityType: 'Policy', entityId: 'p1', createdAt: new Date('2026-01-01T00:00:00Z') },
      ]);

      const service = createService(db);
      const result = await service.exportPersonalData('user-1');

      expect(result.user).not.toHaveProperty('passwordHash');
      expect(result.policies[0].documents[0]).not.toHaveProperty('storageRef');
      expect(result.policies[0].portalLinks[0]).not.toHaveProperty('portalUrl');
      expect(result.policies[0].portalLinks[0]).not.toHaveProperty('usernameHint');
      expect(result.policies[0].portalLinks[0].providerKey).toBe('example-portal');
      expect(result.auditEvents).toHaveLength(1);
      expect(result.auditEvents[0].action).toBe('POLICY_CREATED');
    });

    it('throws NotFoundException for an unknown user', async () => {
      const db = createMockDb();
      db.user.findUnique.mockResolvedValue(null);
      const service = createService(db);

      await expect(service.exportPersonalData('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('deleteAccount', () => {
    it('blocks the last active administrator (ConflictException)', async () => {
      const db = createMockDb({
        tx: {
          user: { count: vi.fn().mockResolvedValue(1), delete: vi.fn() },
        },
      });
      const service = createService(db);

      await expect(service.deleteAccount(adminUser)).rejects.toThrow(ConflictException);
      expect(db.tx.user.delete).not.toHaveBeenCalled();
      expect(db.tx.auditEvent.create).not.toHaveBeenCalled();
    });

    it('allows deletion when multiple active administrators exist', async () => {
      const db = createMockDb({
        tx: {
          user: { count: vi.fn().mockResolvedValue(2), delete: vi.fn().mockResolvedValue({}) },
        },
      });
      const service = createService(db);

      await expect(service.deleteAccount(adminUser)).resolves.toBeUndefined();
      expect(db.tx.user.delete).toHaveBeenCalledWith({ where: { id: 'user-1' } });
    });

    it('writes the audit trail BEFORE deletion and deletes policies/memberships', async () => {
      const db = createMockDb({
        tx: {
          user: { count: vi.fn().mockResolvedValue(2), delete: vi.fn().mockResolvedValue({}) },
          insurancePolicy: {
            findMany: vi.fn().mockResolvedValue([]),
            deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
            count: vi.fn().mockResolvedValue(0),
          },
          householdMembership: {
            findMany: vi.fn().mockResolvedValue([{ householdId: 'h1' }]),
            deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
            count: vi.fn().mockResolvedValue(0),
          },
          household: { delete: vi.fn().mockResolvedValue({}) },
          auditEvent: { create: vi.fn().mockResolvedValue({ id: 'audit-1' }) },
        },
      });
      const service = createService(db);

      const user: AuthenticatedUser = { ...adminUser, role: GlobalRole.USER, id: 'user-1' };
      await service.deleteAccount(user);

      const createCalls = db.tx.auditEvent.create.mock.calls;
      expect(createCalls).toHaveLength(1);
      expect(createCalls[0][0].data.action).toBe('PRIVACY_ACCOUNT_DELETED');
      expect(createCalls[0][0].data.actorUserId).toBe('user-1');

      // Order: audit first, then policies, then memberships/user
      const auditOrder = db.tx.auditEvent.create.mock.invocationCallOrder[0];
      const policyOrder = db.tx.insurancePolicy.deleteMany.mock.invocationCallOrder[0];
      const userOrder = db.tx.user.delete.mock.invocationCallOrder[0];
      expect(auditOrder).toBeLessThan(policyOrder);
      expect(policyOrder).toBeLessThan(userOrder);
      expect(db.tx.household.delete).toHaveBeenCalledWith({ where: { id: 'h1' } });
    });

    it('keeps a household with remaining members or policies', async () => {
      const db = createMockDb({
        tx: {
          user: { count: vi.fn().mockResolvedValue(2), delete: vi.fn().mockResolvedValue({}) },
          householdMembership: {
            findMany: vi.fn().mockResolvedValue([{ householdId: 'h1' }]),
            deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
            count: vi.fn().mockResolvedValue(1),
          },
          insurancePolicy: {
            findMany: vi.fn().mockResolvedValue([]),
            deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
            count: vi.fn().mockResolvedValue(1),
          },
          household: { delete: vi.fn() },
          auditEvent: { create: vi.fn().mockResolvedValue({}) },
        },
      });
      const service = createService(db);

      const user: AuthenticatedUser = { ...adminUser, role: GlobalRole.USER, id: 'user-1' };
      await service.deleteAccount(user);

      expect(db.tx.household.delete).not.toHaveBeenCalled();
    });

    it('removes INTERNAL files AFTER the commit, but only within the storage root', async () => {
      const inside = `${STORAGE_ROOT}/p1/doc1/doc1`;
      const outside = '/etc/shadow';
      const db = createMockDb({
        tx: {
          user: { count: vi.fn().mockResolvedValue(2), delete: vi.fn().mockResolvedValue({}) },
          insurancePolicy: {
            findMany: vi.fn().mockResolvedValue([
              {
                id: 'p1',
                documents: [
                  { storageType: 'INTERNAL', storageRef: inside },
                  { storageType: 'INTERNAL', storageRef: outside },
                  { storageType: 'S3', storageRef: 's3://bucket/key' },
                ],
              },
            ]),
            deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
          },
          householdMembership: {
            findMany: vi.fn().mockResolvedValue([]),
            deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
          },
          household: { delete: vi.fn() },
          auditEvent: { create: vi.fn().mockResolvedValue({}) },
        },
      });
      const service = createService(db);

      const user: AuthenticatedUser = { ...adminUser, role: GlobalRole.USER, id: 'user-1' };
      await service.deleteAccount(user);

      // Exactly the file in the storage root is deleted – nothing else.
      expect(unlinkSpy).toHaveBeenCalledTimes(1);
      expect(unlinkSpy).toHaveBeenCalledWith(inside);
    });

    it('tolerates ENOENT when deleting files (no abort)', async () => {
      unlinkSpy.mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }));
      const db = createMockDb({
        tx: {
          user: { count: vi.fn().mockResolvedValue(2), delete: vi.fn().mockResolvedValue({}) },
          insurancePolicy: {
            findMany: vi.fn().mockResolvedValue([
              {
                id: 'p1',
                documents: [
                  { storageType: 'INTERNAL', storageRef: `${STORAGE_ROOT}/gone.pdf` },
                ],
              },
            ]),
            deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
          },
          householdMembership: {
            findMany: vi.fn().mockResolvedValue([]),
            deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
          },
          auditEvent: { create: vi.fn().mockResolvedValue({}) },
        },
      });
      const service = createService(db);

      const user: AuthenticatedUser = { ...adminUser, role: GlobalRole.USER, id: 'user-1' };
      await expect(service.deleteAccount(user)).resolves.toBeUndefined();
    });
  });
});
