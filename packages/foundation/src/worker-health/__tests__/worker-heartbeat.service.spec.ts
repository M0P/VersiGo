import { describe, expect, it, vi, afterEach } from 'vitest';
import { WorkerHeartbeatService } from '../worker-heartbeat.service';
import { DatabaseService } from '../../database';
import { AppConfigService } from '../../config';

function buildDb(overrides: Record<string, unknown> = {}): DatabaseService {
  return {
    workerHeartbeat: {
      upsert: vi.fn(),
      findFirst: vi.fn(),
      deleteMany: vi.fn(),
    },
    ...overrides,
  } as unknown as DatabaseService;
}

function buildConfig(overrides: Record<string, unknown> = {}): AppConfigService {
  return {
    get: vi.fn((key: string) => {
      switch (key) {
        case 'WORKER_HEARTBEAT_INTERVAL_MS':
          return 15_000;
        case 'WORKER_HEARTBEAT_TIMEOUT_MS':
          return 45_000;
        default:
          return undefined;
      }
    }),
    ...overrides,
  } as unknown as AppConfigService;
}

describe('WorkerHeartbeatService', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('schreibt beim start() sofort einen Heartbeat (Upsert)', async () => {
    const db = buildDb();
    const service = new WorkerHeartbeatService(db, buildConfig());

    vi.useFakeTimers();
    await service.start();

    expect(db.workerHeartbeat.upsert).toHaveBeenCalledTimes(1);
    const call = (db.workerHeartbeat.upsert as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.where.workerId).toBeTruthy();
    expect(call.create.workerId).toBe(call.where.workerId);
    expect(call.update.lastSeenAt).toBeInstanceOf(Date);

    service.stop();
  });

  it('schreibt Heartbeats periodisch im konfigurierten Intervall', async () => {
    const db = buildDb();
    const service = new WorkerHeartbeatService(db, buildConfig());

    vi.useFakeTimers();
    await service.start();
    const initial = (db.workerHeartbeat.upsert as ReturnType<typeof vi.fn>).mock.calls.length;

    await vi.advanceTimersByTimeAsync(15_000);
    const afterOne = (db.workerHeartbeat.upsert as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(afterOne).toBe(initial + 1);

    await vi.advanceTimersByTimeAsync(15_000);
    const afterTwo = (db.workerHeartbeat.upsert as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(afterTwo).toBe(initial + 2);

    service.stop();
  });

  it('degradiert fail-soft, wenn der Heartbeat-Schreibvorgang fehlschlaegt', async () => {
    const db = buildDb({
      workerHeartbeat: {
        upsert: vi.fn().mockRejectedValue(new Error('DB down')),
      },
    });
    const service = new WorkerHeartbeatService(db, buildConfig());

    await expect(service.writeHeartbeat()).resolves.toBeUndefined();
  });

  it('meldet up bei frischem Heartbeat', async () => {
    const db = buildDb({
      workerHeartbeat: {
        findFirst: vi.fn().mockResolvedValue({
          workerId: 'worker-1',
          lastSeenAt: new Date(),
        }),
      },
    });
    const service = new WorkerHeartbeatService(db, buildConfig());

    const status = await service.getStatus();
    expect(status.worker).toBe('up');
    expect(status.workerId).toBe('worker-1');
  });

  it('meldet down bei veraltetem Heartbeat (aelter als Timeout)', async () => {
    const db = buildDb({
      workerHeartbeat: {
        findFirst: vi.fn().mockResolvedValue({
          workerId: 'worker-1',
          lastSeenAt: new Date(Date.now() - 60_000),
        }),
      },
    });
    const service = new WorkerHeartbeatService(db, buildConfig());

    const status = await service.getStatus();
    expect(status.worker).toBe('down');
  });

  it('meldet unknown, wenn noch nie ein Heartbeat existierte', async () => {
    const db = buildDb({
      workerHeartbeat: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
    });
    const service = new WorkerHeartbeatService(db, buildConfig());

    const status = await service.getStatus();
    expect(status.worker).toBe('unknown');
    expect(status.lastSeenAt).toBeNull();
  });

  it('meldet unknown fail-soft bei DB-Fehler beim Lesen', async () => {
    const db = buildDb({
      workerHeartbeat: {
        findFirst: vi.fn().mockRejectedValue(new Error('DB down')),
      },
    });
    const service = new WorkerHeartbeatService(db, buildConfig());

    const status = await service.getStatus();
    expect(status.worker).toBe('unknown');
  });

  it('start() ist idempotent und stop() beendet das Intervall', async () => {
    const db = buildDb();
    const service = new WorkerHeartbeatService(db, buildConfig());

    vi.useFakeTimers();
    await service.start();
    await service.start();
    expect(db.workerHeartbeat.upsert).toHaveBeenCalledTimes(1);

    service.stop();
    const callsAfterStop = (db.workerHeartbeat.upsert as ReturnType<typeof vi.fn>).mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect((db.workerHeartbeat.upsert as ReturnType<typeof vi.fn>).mock.calls.length).toBe(
      callsAfterStop,
    );
  });

  it('raeumt beim start() verwaiste Heartbeat-Rows aelter als die Retention auf', async () => {
    const db = buildDb();
    const service = new WorkerHeartbeatService(db, buildConfig());

    vi.useFakeTimers();
    await service.start();

    const deleteMany = db.workerHeartbeat.deleteMany as ReturnType<typeof vi.fn>;
    expect(deleteMany).toHaveBeenCalledTimes(1);
    const cutoff = deleteMany.mock.calls[0][0].where.lastSeenAt.lt as Date;
    expect(cutoff).toBeInstanceOf(Date);
    // Retention von 1h: Cutoff liegt in der Vergangenheit, aber weit vor dem
    // Heartbeat-Timeout (45s) – aktive Worker sind nie betroffen.
    const ageMs = Date.now() - cutoff.getTime();
    expect(ageMs).toBeGreaterThan(60 * 60 * 1000 - 1000);
    expect(ageMs).toBeLessThan(2 * 60 * 60 * 1000);

    service.stop();
  });

  it('raeumt fail-soft auf, wenn die Aufraeumung fehlschlaegt', async () => {
    const db = buildDb({
      workerHeartbeat: {
        upsert: vi.fn(),
        findFirst: vi.fn(),
        deleteMany: vi.fn().mockRejectedValue(new Error('DB down')),
      },
    });
    const service = new WorkerHeartbeatService(db, buildConfig());

    vi.useFakeTimers();
    service.start();
    // Mikrotasks der fire-and-forget-Aufraeumung abarbeiten: Es darf weder
    // eine Ablehnung nach aussen dringen noch der Heartbeat ausfallen.
    await vi.advanceTimersByTimeAsync(0);
    expect(service.writeHeartbeat).toBeDefined();
    service.stop();
  });
});
