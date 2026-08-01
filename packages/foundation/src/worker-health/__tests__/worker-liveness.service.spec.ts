import { describe, expect, it, vi, afterEach } from 'vitest';
import * as http from 'http';
import * as net from 'net';
import { WorkerLivenessService } from '../worker-liveness.service';
import { AppConfigService } from '../../config';

/** Ermittelt einen freien TCP-Port fuer den Test (verhindert Kollisionen). */
async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address && typeof address === 'object') {
        const port = address.port;
        server.close(() => resolve(port));
      } else {
        server.close(() => reject(new Error('Kein freier Port ermittelbar')));
      }
    });
    server.on('error', reject);
  });
}

function buildConfig(port: number): AppConfigService {
  return {
    get: vi.fn((key: string) => {
      if (key === 'WORKER_HEALTH_PORT') return port;
      return undefined;
    }),
  } as unknown as AppConfigService;
}

async function fetchJson(url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        let body = '';
        res.on('data', (chunk) => {
          body += chunk.toString();
        });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
      })
      .on('error', reject);
  });
}

describe('WorkerLivenessService', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('antwortet auf GET /health mit status ok und keinen sensiblen Daten', async () => {
    const port = await getFreePort();
    const service = new WorkerLivenessService(buildConfig(port));
    service.start();

    const response = await fetchJson(`http://127.0.0.1:${port}/health`);
    expect(response.status).toBe(200);
    expect(response.body).toBe('{"status":"ok"}');

    await service.stop();
  });

  it('antwortet auch auf GET / mit status ok (Basis-Pfad)', async () => {
    const port = await getFreePort();
    const service = new WorkerLivenessService(buildConfig(port));
    service.start();

    const response = await fetchJson(`http://127.0.0.1:${port}/`);
    expect(response.status).toBe(200);
    expect(response.body).toBe('{"status":"ok"}');

    await service.stop();
  });

  it('beantwortet unbekannte Pfade mit 404', async () => {
    const port = await getFreePort();
    const service = new WorkerLivenessService(buildConfig(port));
    service.start();

    const response = await fetchJson(`http://127.0.0.1:${port}/other`);
    expect(response.status).toBe(404);

    await service.stop();
  });

  it('start() ist idempotent (kein zweiter Server)', async () => {
    const port = await getFreePort();
    const service = new WorkerLivenessService(buildConfig(port));
    service.start();
    service.start();

    const response = await fetchJson(`http://127.0.0.1:${port}/health`);
    expect(response.status).toBe(200);

    await service.stop();
  });

  it('stop() schliesst den Server (weitere Requests schlagen fehl)', async () => {
    const port = await getFreePort();
    const service = new WorkerLivenessService(buildConfig(port));
    service.start();

    await service.stop();
    await expect(
      fetchJson(`http://127.0.0.1:${port}/health`),
    ).rejects.toThrow();
  });
});
