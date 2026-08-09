/* eslint-disable @typescript-eslint/no-explicit-any */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit.service';

function createMockDb() {
  return {
    auditEvent: {
      findMany: vi.fn(),
      count: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    $transaction: vi.fn(async (ops: any[]) => Promise.all(ops)),
  };
}

describe('AuditService', () => {
  let db: ReturnType<typeof createMockDb>;
  let service: AuditService;

  beforeEach(() => {
    db = createMockDb();
    service = new AuditService(db as never);
  });

  describe('listEvents', () => {
    it('returns events without diffJson content but with the hasDiff flag', async () => {
      db.auditEvent.findMany.mockResolvedValue([
        {
          id: 'e1',
          actorUserId: 'u1',
          actorUser: { username: 'alice' },
          entityType: 'Policy',
          entityId: 'p1',
          action: 'POLICY_UPDATED',
          createdAt: new Date('2026-01-01T00:00:00Z'),
          diffJson: { insurerName: 'Neu' },
        },
        {
          id: 'e2',
          actorUserId: null,
          actorUser: null,
          entityType: 'Policy',
          entityId: 'p2',
          action: 'POLICY_CREATED',
          createdAt: new Date('2026-01-02T00:00:00Z'),
          diffJson: null,
        },
      ]);
      db.auditEvent.count.mockResolvedValue(2);

      const result = await service.listEvents({});

      expect(result.total).toBe(2);
      expect(result.events).toHaveLength(2);
      expect(result.events[0]).toEqual({
        id: 'e1',
        actorUserId: 'u1',
        actorUsername: 'alice',
        entityType: 'Policy',
        entityId: 'p1',
        action: 'POLICY_UPDATED',
        createdAt: '2026-01-01T00:00:00.000Z',
        hasDiff: true,
      });
      expect(result.events[0]).not.toHaveProperty('diffJson');
      expect(result.events[1].hasDiff).toBe(false);
    });

    it('caps take at 200 and defaults it to 50', async () => {
      db.auditEvent.findMany.mockResolvedValue([]);
      db.auditEvent.count.mockResolvedValue(0);

      await service.listEvents({ take: 9999 });
      expect(db.auditEvent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 200 }),
      );

      await service.listEvents({});
      expect(db.auditEvent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 50 }),
      );
    });

    it('builds time and filter criteria into the where clause', async () => {
      db.auditEvent.findMany.mockResolvedValue([]);
      db.auditEvent.count.mockResolvedValue(0);

      await service.listEvents({
        entityType: 'Policy',
        action: 'POLICY_UPDATED',
        actorUserId: 'u1',
        from: '2026-01-01T00:00:00Z',
        to: '2026-01-31T00:00:00Z',
        skip: 10,
      });

      const where = db.auditEvent.findMany.mock.calls[0][0].where;
      expect(where.entityType).toBe('Policy');
      expect(where.action).toBe('POLICY_UPDATED');
      expect(where.actorUserId).toBe('u1');
      expect(where.createdAt.gte).toEqual(new Date('2026-01-01T00:00:00Z'));
      expect(where.createdAt.lte).toEqual(new Date('2026-01-31T00:00:00Z'));
      expect(db.auditEvent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 10 }),
      );
    });
  });

  describe('getEvent', () => {
    it('returns the detail including diffJson', async () => {
      db.auditEvent.findUnique.mockResolvedValue({
        id: 'e1',
        actorUserId: 'u1',
        actorUser: { username: 'alice' },
        entityType: 'Policy',
        entityId: 'p1',
        action: 'POLICY_UPDATED',
        createdAt: new Date('2026-01-01T00:00:00Z'),
        diffJson: { insurerName: 'Neu' },
      });

      const result = await service.getEvent('e1');

      expect(result.diffJson).toEqual({ insurerName: 'Neu' });
      expect(result.hasDiff).toBe(true);
      expect(result.actorUsername).toBe('alice');
    });

    it('throws NotFoundException for an unknown event', async () => {
      db.auditEvent.findUnique.mockResolvedValue(null);

      await expect(service.getEvent('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('record', () => {
    it('writes an audit event', async () => {
      db.auditEvent.create.mockResolvedValue({ id: 'e1' });

      await service.record({
        actorUserId: 'u1',
        entityType: 'User',
        entityId: 'u1',
        action: 'PRIVACY_ACCOUNT_DELETED',
        diff: { selfService: true },
      });

      expect(db.auditEvent.create).toHaveBeenCalledWith({
        data: {
          actorUserId: 'u1',
          entityType: 'User',
          entityId: 'u1',
          action: 'PRIVACY_ACCOUNT_DELETED',
          diffJson: { selfService: true },
        },
      });
    });

    it('is fail-soft: write errors do not throw', async () => {
      db.auditEvent.create.mockRejectedValue(new Error('db down'));

      await expect(
        service.record({
          actorUserId: 'u1',
          entityType: 'User',
          entityId: 'u1',
          action: 'PRIVACY_ACCOUNT_DELETED',
        }),
      ).resolves.toBeUndefined();
    });
  });
});
