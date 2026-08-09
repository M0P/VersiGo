import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { UserAdminService } from '../user-admin.service';
import { GlobalRole, UserStatus } from '@prisma/client';
import type { AuthenticatedUser } from '../auth.service';

const adminUser: AuthenticatedUser = {
  id: 'admin-1',
  username: 'admin',
  displayName: 'Admin',
  role: GlobalRole.ADMIN,
  status: UserStatus.ACTIVE,
  memberships: [],
};

function createMockDb() {
  return {
    user: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
    },
    household: {
      findUnique: vi.fn(),
    },
    householdMembership: {
      upsert: vi.fn().mockResolvedValue({ id: 'membership-1' }),
    },
    auditEvent: {
      create: vi.fn().mockResolvedValue({ id: 'audit-1' }),
    },
    $transaction: vi.fn(),
  };
}

type MockDb = ReturnType<typeof createMockDb>;

describe('UserAdminService', () => {
  let mockDb: MockDb;
  let service: UserAdminService;

  beforeEach(() => {
    mockDb = createMockDb();
    service = new UserAdminService(mockDb as never);
    // $transaction supports both forms:
    // - Array form: $transaction([p1, p2]) => Promise.all (used by list())
    // - Callback form: $transaction(cb[, options]) => cb(tx); tx === mockDb
    mockDb.$transaction.mockImplementation(
      (input: unknown, _options?: unknown) => {
        if (Array.isArray(input)) {
          return Promise.all(input);
        }
        return (input as (tx: unknown) => unknown)(mockDb);
      },
    );
  });

  describe('list', () => {
    it('returns users, the credential flag and the total count', async () => {
      mockDb.user.findMany.mockResolvedValue([
        {
          id: 'user-1',
          username: 'max',
          displayName: 'Max',
          role: GlobalRole.USER,
          status: UserStatus.PENDING_APPROVAL,
          email: null,
          oidcIssuer: null,
          oidcSubject: null,
          createdAt: new Date('2026-01-01'),
          credential: { id: 'cred-1' },
        },
      ]);
      mockDb.user.count.mockResolvedValue(1);

      const result = await service.list({ status: UserStatus.PENDING_APPROVAL, take: 50, skip: 0 });

      expect(result.total).toBe(1);
      expect(result.users[0]).toMatchObject({
        username: 'max',
        hasCredential: true,
        oidcIssuer: null,
      });
      expect(mockDb.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: UserStatus.PENDING_APPROVAL },
          take: 50,
          skip: 0,
        }),
      );
    });

    it('does not use a status filter when none is given', async () => {
      mockDb.user.findMany.mockResolvedValue([]);
      mockDb.user.count.mockResolvedValue(0);

      await service.list({ take: 10, skip: 0 });

      expect(mockDb.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: {} }),
      );
    });
  });

  describe('approve', () => {
    it('approves PENDING_APPROVAL accounts, adds them to the default household and audits', async () => {
      mockDb.user.findUnique.mockResolvedValue({ status: UserStatus.PENDING_APPROVAL });
      mockDb.household.findUnique.mockResolvedValue({ id: 'default' });

      await service.approve(adminUser, 'user-1');

      expect(mockDb.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { status: UserStatus.ACTIVE },
      });
      // AP-20: add the membership in the beta reference household
      expect(mockDb.householdMembership.upsert).toHaveBeenCalledWith({
        where: {
          householdId_userId: { householdId: 'default', userId: 'user-1' },
        },
        create: { householdId: 'default', userId: 'user-1' },
        update: {},
      });
      expect(mockDb.auditEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          actorUserId: 'admin-1',
          action: 'USER_APPROVED',
          entityId: 'user-1',
        }),
      });
    });

    it('skips the household membership when the default household is missing', async () => {
      mockDb.user.findUnique.mockResolvedValue({ status: UserStatus.PENDING_APPROVAL });
      mockDb.household.findUnique.mockResolvedValue(null);

      await service.approve(adminUser, 'user-1');

      expect(mockDb.householdMembership.upsert).not.toHaveBeenCalled();
      expect(mockDb.auditEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ action: 'USER_APPROVED' }),
      });
    });

    it('throws NotFoundException for an unknown user', async () => {
      mockDb.user.findUnique.mockResolvedValue(null);

      await expect(service.approve(adminUser, 'user-1')).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException when the account is not PENDING_APPROVAL', async () => {
      mockDb.user.findUnique.mockResolvedValue({ status: UserStatus.ACTIVE });

      await expect(service.approve(adminUser, 'user-1')).rejects.toThrow(ConflictException);
    });
  });

  describe('reject', () => {
    it('rejects PENDING_APPROVAL accounts (DISABLED) and audits', async () => {
      mockDb.user.findUnique.mockResolvedValue({ status: UserStatus.PENDING_APPROVAL });

      await service.reject(adminUser, 'user-1');

      expect(mockDb.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { status: UserStatus.DISABLED },
      });
      expect(mockDb.auditEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ action: 'USER_REJECTED' }),
      });
    });

    it('throws ConflictException when the account is not PENDING_APPROVAL', async () => {
      mockDb.user.findUnique.mockResolvedValue({ status: UserStatus.ACTIVE });

      await expect(service.reject(adminUser, 'user-1')).rejects.toThrow(ConflictException);
    });
  });

  describe('disable', () => {
    it('disables active accounts and audits', async () => {
      mockDb.user.findUnique.mockResolvedValue({
        status: UserStatus.ACTIVE,
        role: GlobalRole.USER,
      });
      mockDb.user.count.mockResolvedValue(2);

      await service.disable(adminUser, 'user-2');

      expect(mockDb.user.update).toHaveBeenCalledWith({
        where: { id: 'user-2' },
        data: { status: UserStatus.DISABLED },
      });
      expect(mockDb.auditEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ action: 'USER_DISABLED' }),
      });
      // Letzter-Admin-Schutz: serialisierbare Transaktion
      expect(mockDb.$transaction).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({ isolationLevel: expect.anything() }),
      );
    });

    it('verhindert Selbstsperrung', async () => {
      await expect(service.disable(adminUser, 'admin-1')).rejects.toThrow(
        'You cannot disable yourself',
      );
      expect(mockDb.user.findUnique).not.toHaveBeenCalled();
    });

    it('throws ConflictException when the account is not active', async () => {
      mockDb.user.findUnique.mockResolvedValue({
        status: UserStatus.DISABLED,
        role: GlobalRole.USER,
      });

      await expect(service.disable(adminUser, 'user-2')).rejects.toThrow(ConflictException);
    });

    it('prevents disabling the last active ADMIN (last-admin protection)', async () => {
      mockDb.user.findUnique.mockResolvedValue({
        status: UserStatus.ACTIVE,
        role: GlobalRole.ADMIN,
      });
      mockDb.user.count.mockResolvedValue(1);

      await expect(service.disable(adminUser, 'user-2')).rejects.toThrow(
        'The last active administrator',
      );
      expect(mockDb.user.update).not.toHaveBeenCalled();
    });

    it('retries P2034 serialization conflicts a limited number of times and then executes', async () => {
      mockDb.user.findUnique.mockResolvedValue({
        status: UserStatus.ACTIVE,
        role: GlobalRole.USER,
      });
      mockDb.user.count.mockResolvedValue(2);
      // The first transaction call fails with P2034, the second succeeds.
      const original = mockDb.$transaction.getMockImplementation();
      let calls = 0;
      mockDb.$transaction.mockImplementation(
        (input: unknown, _options?: unknown) => {
          if (Array.isArray(input)) {
            return Promise.all(input);
          }
          calls += 1;
          if (calls === 1) {
            return Promise.reject({ code: 'P2034' });
          }
          return original!(input, _options);
        },
      );

      await service.disable(adminUser, 'user-2');

      expect(calls).toBe(2);
      expect(mockDb.user.update).toHaveBeenCalledWith({
        where: { id: 'user-2' },
        data: { status: UserStatus.DISABLED },
      });
    });

    it('reports persistent P2034 conflicts as ConflictException instead of 500', async () => {
      mockDb.$transaction.mockImplementation(() => Promise.reject({ code: 'P2034' }));

      await expect(service.disable(adminUser, 'user-2')).rejects.toThrow(ConflictException);
    });
  });

  describe('enable', () => {
    it('re-enables disabled accounts and audits', async () => {
      mockDb.user.findUnique.mockResolvedValue({ status: UserStatus.DISABLED });

      await service.enable(adminUser, 'user-2');

      expect(mockDb.user.update).toHaveBeenCalledWith({
        where: { id: 'user-2' },
        data: { status: UserStatus.ACTIVE },
      });
      expect(mockDb.auditEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ action: 'USER_ENABLED' }),
      });
    });

    it('throws ConflictException when the account is not disabled', async () => {
      mockDb.user.findUnique.mockResolvedValue({ status: UserStatus.ACTIVE });

      await expect(service.enable(adminUser, 'user-2')).rejects.toThrow(ConflictException);
    });
  });

  describe('setRole', () => {
    it('sets the global role and audits from/to', async () => {
      mockDb.user.findUnique.mockResolvedValue({
        status: UserStatus.ACTIVE,
        role: GlobalRole.USER,
      });

      await service.setRole(adminUser, 'user-2', GlobalRole.ADMIN);

      expect(mockDb.user.update).toHaveBeenCalledWith({
        where: { id: 'user-2' },
        data: { role: GlobalRole.ADMIN },
      });
      expect(mockDb.auditEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'USER_ROLE_CHANGED',
          diffJson: { from: GlobalRole.USER, to: GlobalRole.ADMIN },
        }),
      });
    });

    it('throws ConflictException when the role is already set', async () => {
      mockDb.user.findUnique.mockResolvedValue({
        status: UserStatus.ACTIVE,
        role: GlobalRole.ADMIN,
      });

      await expect(service.setRole(adminUser, 'user-2', GlobalRole.ADMIN)).rejects.toThrow(
        'Role is already set',
      );
      expect(mockDb.user.update).not.toHaveBeenCalled();
    });

    it('prevents demoting the last active ADMIN', async () => {
      mockDb.user.findUnique.mockResolvedValue({
        status: UserStatus.ACTIVE,
        role: GlobalRole.ADMIN,
      });
      mockDb.user.count.mockResolvedValue(1);

      await expect(service.setRole(adminUser, 'user-2', GlobalRole.USER)).rejects.toThrow(
        'The last active administrator',
      );
      expect(mockDb.user.update).not.toHaveBeenCalled();
    });

    it('allows the demotion as long as another active ADMIN exists', async () => {
      mockDb.user.findUnique.mockResolvedValue({
        status: UserStatus.ACTIVE,
        role: GlobalRole.ADMIN,
      });
      mockDb.user.count.mockResolvedValue(2);

      await service.setRole(adminUser, 'user-2', GlobalRole.USER);

      expect(mockDb.user.update).toHaveBeenCalledWith({
        where: { id: 'user-2' },
        data: { role: GlobalRole.USER },
      });
    });

    it('retries P2034 serialization conflicts in setRole a limited number of times', async () => {
      mockDb.user.findUnique.mockResolvedValue({
        status: UserStatus.ACTIVE,
        role: GlobalRole.ADMIN,
      });
      mockDb.user.count.mockResolvedValue(2);
      const original = mockDb.$transaction.getMockImplementation();
      let calls = 0;
      mockDb.$transaction.mockImplementation(
        (input: unknown, _options?: unknown) => {
          if (Array.isArray(input)) {
            return Promise.all(input);
          }
          calls += 1;
          if (calls === 1) {
            return Promise.reject({ code: 'P2034' });
          }
          return original!(input, _options);
        },
      );

      await service.setRole(adminUser, 'user-2', GlobalRole.USER);

      expect(calls).toBe(2);
      expect(mockDb.user.update).toHaveBeenCalledWith({
        where: { id: 'user-2' },
        data: { role: GlobalRole.USER },
      });
    });
  });

  describe('bindOidcIdentity', () => {
    it('binds (issuer, subject) to a local account and audits', async () => {
      mockDb.user.findUnique.mockResolvedValue({ id: 'user-2' });

      await service.bindOidcIdentity(adminUser, 'user-2', 'https://issuer.example.com', 'sub-1');

      expect(mockDb.user.update).toHaveBeenCalledWith({
        where: { id: 'user-2' },
        data: { oidcIssuer: 'https://issuer.example.com', oidcSubject: 'sub-1' },
      });
      expect(mockDb.auditEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ action: 'OIDC_BOUND' }),
      });
    });

    it('throws NotFoundException for an unknown user', async () => {
      mockDb.user.findUnique.mockResolvedValue(null);

      await expect(
        service.bindOidcIdentity(adminUser, 'user-2', 'https://issuer.example.com', 'sub-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('translates P2002 (already bound identity) into ConflictException', async () => {
      mockDb.user.findUnique.mockResolvedValue({ id: 'user-2' });
      const conflict = new Error('Unique constraint failed on the fields: (`oidcIssuer`,`oidcSubject`)');
      (conflict as { code?: string }).code = 'P2002';
      mockDb.user.update.mockRejectedValue(conflict);

      await expect(
        service.bindOidcIdentity(adminUser, 'user-2', 'https://issuer.example.com', 'sub-1'),
      ).rejects.toThrow('already bound to another account');
    });
  });

  describe('unbindOidcIdentity', () => {
    it('removes the OIDC binding and audits', async () => {
      mockDb.user.findUnique.mockResolvedValue({ oidcIssuer: 'https://issuer.example.com' });

      await service.unbindOidcIdentity(adminUser, 'user-2');

      expect(mockDb.user.update).toHaveBeenCalledWith({
        where: { id: 'user-2' },
        data: { oidcIssuer: null, oidcSubject: null },
      });
      expect(mockDb.auditEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ action: 'OIDC_UNBOUND' }),
      });
    });

    it('throws ConflictException for an account without a binding', async () => {
      mockDb.user.findUnique.mockResolvedValue({ oidcIssuer: null });

      await expect(service.unbindOidcIdentity(adminUser, 'user-2')).rejects.toThrow(
        'Account has no OIDC binding',
      );
      expect(mockDb.user.update).not.toHaveBeenCalled();
    });
  });
});
