import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createServer } from '../server.js';
import { registerRoutes } from '../routes/index.js';
import type { ServiceContext } from '../routes/context.js';
import type { JsonSnapshot, SnapshotInfo } from '@pyramid-os/shared-types';
import type { SnapshotValidationResult } from '@pyramid-os/data-layer';

const API_KEY = 'test-recover-key';
const headers = { 'x-api-key': API_KEY };

function makeSnapshot(overrides: Partial<JsonSnapshot> = {}): JsonSnapshot {
  return {
    version: '1.0',
    civilizationId: 'test-civ',
    exportedAt: new Date().toISOString(),
    agents: [],
    tasks: [],
    resources: [],
    blueprints: [],
    ...overrides,
  };
}

function makeSnapshotInfo(overrides: Partial<SnapshotInfo> = {}): SnapshotInfo {
  return {
    filename: 'snapshot-test-civ-2024-01-01.json',
    civilizationId: 'test-civ',
    exportedAt: '2024-01-01T00:00:00.000Z',
    sizeBytes: 256,
    ...overrides,
  };
}

describe('POST /system/recover', () => {
  let server: FastifyInstance;

  afterEach(async () => {
    await server.close();
  });

  it('returns 503 when snapshot manager is not wired', async () => {
    server = await createServer({ port: 0, apiKey: API_KEY });
    await registerRoutes(server, {});
    await server.ready();

    const res = await server.inject({ method: 'POST', url: '/system/recover', headers });
    expect(res.statusCode).toBe(503);
    expect(res.json().code).toBe('SNAPSHOT_MANAGER_UNAVAILABLE');
  });

  it('returns 404 when no snapshots exist', async () => {
    const ctx: ServiceContext = {
      snapshotManager: {
        list: vi.fn().mockResolvedValue([]),
        export: vi.fn(),
        import: vi.fn(),
        validate: vi.fn(),
        readSnapshot: vi.fn(),
        saveSnapshot: vi.fn(),
      } as any,
    };

    server = await createServer({ port: 0, apiKey: API_KEY });
    await registerRoutes(server, ctx);
    await server.ready();

    const res = await server.inject({ method: 'POST', url: '/system/recover', headers });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('NO_SNAPSHOTS');
  });

  it('recovers from the most recent valid snapshot', async () => {
    const olderInfo = makeSnapshotInfo({
      filename: 'snapshot-old.json',
      exportedAt: '2024-01-01T00:00:00.000Z',
    });
    const newerInfo = makeSnapshotInfo({
      filename: 'snapshot-new.json',
      exportedAt: '2024-06-15T12:00:00.000Z',
    });
    const newerSnapshot = makeSnapshot({ exportedAt: '2024-06-15T12:00:00.000Z' });

    const ctx: ServiceContext = {
      snapshotManager: {
        list: vi.fn().mockResolvedValue([olderInfo, newerInfo]),
        readSnapshot: vi.fn().mockResolvedValue(newerSnapshot),
        validate: vi.fn().mockReturnValue({ valid: true, errors: [] } as SnapshotValidationResult),
        import: vi.fn().mockResolvedValue(undefined),
        export: vi.fn(),
        saveSnapshot: vi.fn(),
      } as any,
    };

    server = await createServer({ port: 0, apiKey: API_KEY });
    await registerRoutes(server, ctx);
    await server.ready();

    const res = await server.inject({ method: 'POST', url: '/system/recover', headers });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.recovered).toBe(true);
    expect(body.snapshot).toBe('snapshot-new.json');
    expect(ctx.snapshotManager!.import).toHaveBeenCalledWith(newerSnapshot);
  });

  it('skips invalid snapshots and falls back to the next one', async () => {
    const newerInfo = makeSnapshotInfo({
      filename: 'snapshot-newer.json',
      exportedAt: '2024-06-15T12:00:00.000Z',
    });
    const olderInfo = makeSnapshotInfo({
      filename: 'snapshot-older.json',
      exportedAt: '2024-01-01T00:00:00.000Z',
    });
    const olderSnapshot = makeSnapshot({ exportedAt: '2024-01-01T00:00:00.000Z' });

    const ctx: ServiceContext = {
      snapshotManager: {
        list: vi.fn().mockResolvedValue([newerInfo, olderInfo]),
        readSnapshot: vi.fn()
          .mockRejectedValueOnce(new Error('corrupt file'))
          .mockResolvedValueOnce(olderSnapshot),
        validate: vi.fn().mockReturnValue({ valid: true, errors: [] } as SnapshotValidationResult),
        import: vi.fn().mockResolvedValue(undefined),
        export: vi.fn(),
        saveSnapshot: vi.fn(),
      } as any,
    };

    server = await createServer({ port: 0, apiKey: API_KEY });
    await registerRoutes(server, ctx);
    await server.ready();

    const res = await server.inject({ method: 'POST', url: '/system/recover', headers });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.recovered).toBe(true);
    expect(body.snapshot).toBe('snapshot-older.json');
  });

  it('returns 404 when all snapshots are invalid', async () => {
    const info = makeSnapshotInfo();
    const snapshot = makeSnapshot();

    const ctx: ServiceContext = {
      snapshotManager: {
        list: vi.fn().mockResolvedValue([info]),
        readSnapshot: vi.fn().mockResolvedValue(snapshot),
        validate: vi.fn().mockReturnValue({ valid: false, errors: ['bad version'] } as SnapshotValidationResult),
        import: vi.fn(),
        export: vi.fn(),
        saveSnapshot: vi.fn(),
      } as any,
    };

    server = await createServer({ port: 0, apiKey: API_KEY });
    await registerRoutes(server, ctx);
    await server.ready();

    const res = await server.inject({ method: 'POST', url: '/system/recover', headers });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('NO_VALID_SNAPSHOTS');
  });
});
