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
    // $transaction unterstuetzt beide Formen:
    // - Array-Form: $transaction([p1, p2]) => Promise.all (wird von list() genutzt)
    // - Callback-Form: $transaction(cb[, options]) => cb(tx); tx === mockDb
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
    it('liefert Users, Credential-Flag und Gesamtzahl', async () => {
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

    it('nutzt keinen Status-Filter, wenn keiner angegeben ist', async () => {
      mockDb.user.findMany.mockResolvedValue([]);
      mockDb.user.count.mockResolvedValue(0);

      await service.list({ take: 10, skip: 0 });

      expect(mockDb.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: {} }),
      );
    });
  });

  describe('approve', () => {
    it('schaltet PENDING_APPROVAL-Konten frei und auditiert', async () => {
      mockDb.user.findUnique.mockResolvedValue({ status: UserStatus.PENDING_APPROVAL });

      await service.approve(adminUser, 'user-1');

      expect(mockDb.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { status: UserStatus.ACTIVE },
      });
      expect(mockDb.auditEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          actorUserId: 'admin-1',
          action: 'USER_APPROVED',
          entityId: 'user-1',
        }),
      });
    });

    it('wirft NotFoundException bei unbekanntem User', async () => {
      mockDb.user.findUnique.mockResolvedValue(null);

      await expect(service.approve(adminUser, 'user-1')).rejects.toThrow(NotFoundException);
    });

    it('wirft ConflictException, wenn das Konto nicht PENDING_APPROVAL ist', async () => {
      mockDb.user.findUnique.mockResolvedValue({ status: UserStatus.ACTIVE });

      await expect(service.approve(adminUser, 'user-1')).rejects.toThrow(ConflictException);
    });
  });

  describe('reject', () => {
    it('lehnt PENDING_APPROVAL-Konten ab (DISABLED) und auditiert', async () => {
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

    it('wirft ConflictException, wenn das Konto nicht PENDING_APPROVAL ist', async () => {
      mockDb.user.findUnique.mockResolvedValue({ status: UserStatus.ACTIVE });

      await expect(service.reject(adminUser, 'user-1')).rejects.toThrow(ConflictException);
    });
  });

  describe('disable', () => {
    it('sperrt aktive Konten und auditiert', async () => {
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
        'Sie koennen sich nicht selbst sperren',
      );
      expect(mockDb.user.findUnique).not.toHaveBeenCalled();
    });

    it('wirft ConflictException, wenn das Konto nicht aktiv ist', async () => {
      mockDb.user.findUnique.mockResolvedValue({
        status: UserStatus.DISABLED,
        role: GlobalRole.USER,
      });

      await expect(service.disable(adminUser, 'user-2')).rejects.toThrow(ConflictException);
    });

    it('verhindert das Sperren des letzten aktiven ADMIN (Letzter-Admin-Schutz)', async () => {
      mockDb.user.findUnique.mockResolvedValue({
        status: UserStatus.ACTIVE,
        role: GlobalRole.ADMIN,
      });
      mockDb.user.count.mockResolvedValue(1);

      await expect(service.disable(adminUser, 'user-2')).rejects.toThrow(
        'Der letzte aktive Administrator',
      );
      expect(mockDb.user.update).not.toHaveBeenCalled();
    });

    it('wiederholt P2034-Serialisierungskonflikte begrenzt und fuehrt dann aus', async () => {
      mockDb.user.findUnique.mockResolvedValue({
        status: UserStatus.ACTIVE,
        role: GlobalRole.USER,
      });
      mockDb.user.count.mockResolvedValue(2);
      // Erster Transaktionsaufruf scheitert mit P2034, zweiter laeuft durch.
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

    it('meldet dauerhafte P2034-Konflikte als ConflictException statt 500', async () => {
      mockDb.$transaction.mockImplementation(() => Promise.reject({ code: 'P2034' }));

      await expect(service.disable(adminUser, 'user-2')).rejects.toThrow(ConflictException);
    });
  });

  describe('enable', () => {
    it('entsperrt gesperrte Konten und auditiert', async () => {
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

    it('wirft ConflictException, wenn das Konto nicht gesperrt ist', async () => {
      mockDb.user.findUnique.mockResolvedValue({ status: UserStatus.ACTIVE });

      await expect(service.enable(adminUser, 'user-2')).rejects.toThrow(ConflictException);
    });
  });

  describe('setRole', () => {
    it('setzt die globale Rolle und auditiert from/to', async () => {
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

    it('wirft ConflictException, wenn die Rolle bereits gesetzt ist', async () => {
      mockDb.user.findUnique.mockResolvedValue({
        status: UserStatus.ACTIVE,
        role: GlobalRole.ADMIN,
      });

      await expect(service.setRole(adminUser, 'user-2', GlobalRole.ADMIN)).rejects.toThrow(
        'Rolle ist bereits gesetzt',
      );
      expect(mockDb.user.update).not.toHaveBeenCalled();
    });

    it('verhindert die Herabstufung des letzten aktiven ADMIN', async () => {
      mockDb.user.findUnique.mockResolvedValue({
        status: UserStatus.ACTIVE,
        role: GlobalRole.ADMIN,
      });
      mockDb.user.count.mockResolvedValue(1);

      await expect(service.setRole(adminUser, 'user-2', GlobalRole.USER)).rejects.toThrow(
        'Der letzte aktive Administrator',
      );
      expect(mockDb.user.update).not.toHaveBeenCalled();
    });

    it('erlaubt die Herabstufung, solange ein weiterer aktiver ADMIN existiert', async () => {
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

    it('wiederholt P2034-Serialisierungskonflikte bei setRole begrenzt', async () => {
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
    it('bindet (issuer, subject) an ein lokales Konto und auditiert', async () => {
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

    it('wirft NotFoundException bei unbekanntem User', async () => {
      mockDb.user.findUnique.mockResolvedValue(null);

      await expect(
        service.bindOidcIdentity(adminUser, 'user-2', 'https://issuer.example.com', 'sub-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('uebersetzt P2002 (bereits gebundene Identitaet) in ConflictException', async () => {
      mockDb.user.findUnique.mockResolvedValue({ id: 'user-2' });
      const conflict = new Error('Unique constraint failed on the fields: (`oidcIssuer`,`oidcSubject`)');
      (conflict as { code?: string }).code = 'P2002';
      mockDb.user.update.mockRejectedValue(conflict);

      await expect(
        service.bindOidcIdentity(adminUser, 'user-2', 'https://issuer.example.com', 'sub-1'),
      ).rejects.toThrow('bereits an ein anderes Konto gebunden');
    });
  });

  describe('unbindOidcIdentity', () => {
    it('loest die OIDC-Bindung und auditiert', async () => {
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

    it('wirft ConflictException bei Konto ohne Bindung', async () => {
      mockDb.user.findUnique.mockResolvedValue({ oidcIssuer: null });

      await expect(service.unbindOidcIdentity(adminUser, 'user-2')).rejects.toThrow(
        'Konto hat keine OIDC-Bindung',
      );
      expect(mockDb.user.update).not.toHaveBeenCalled();
    });
  });
});
