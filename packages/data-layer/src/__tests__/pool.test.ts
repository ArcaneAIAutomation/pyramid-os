import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConnectionPool, POOL_CONFIGS } from '../pool.js';
import type { PoolConfig, ConnectionFactory } from '../pool.js';

// ── Helpers ──────────────────────────────────────────────────────

let nextId = 0;
interface FakeConn {
  id: number;
  destroyed: boolean;
  valid: boolean;
}

function createFactory(opts?: { createDelay?: number; failCreate?: boolean }): ConnectionFactory<FakeConn> {
  return {
    async create() {
      if (opts?.createDelay) await delay(opts.createDelay);
      if (opts?.failCreate) throw new Error('create failed');
      return { id: nextId++, destroyed: false, valid: true };
    },
    async destroy(conn) {
      conn.destroyed = true;
    },
    async validate(conn) {
      return conn.valid && !conn.destroyed;
    },
  };
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

const FAST_CONFIG: PoolConfig = {
  maxConnections: 3,
  minIdle: 1,
  acquireTimeoutMs: 200,
  idleTimeoutMs: 100,
};

// ── Tests ────────────────────────────────────────────────────────

describe('ConnectionPool', () => {
  beforeEach(() => {
    nextId = 0;
    vi.useFakeTimers();
  });
  afterEach(async () => {
    vi.useRealTimers();
  });

  describe('acquire()', () => {
    it('creates a new connection when pool is empty', async () => {
      const pool = new ConnectionPool<FakeConn>(FAST_CONFIG, createFactory());
      const conn = await pool.acquire();
      expect(conn).toBeDefined();
      expect(conn.id).toBe(0);
      expect(pool.stats().active).toBe(1);
    });

    it('reuses an idle connection', async () => {
      const pool = new ConnectionPool<FakeConn>(FAST_CONFIG, createFactory());
      const conn = await pool.acquire();
      pool.release(conn);
      const conn2 = await pool.acquire();
      expect(conn2.id).toBe(conn.id);
    });

    it('creates up to maxConnections', async () => {
      const pool = new ConnectionPool<FakeConn>(FAST_CONFIG, createFactory());
      const conns = await Promise.all([pool.acquire(), pool.acquire(), pool.acquire()]);
      expect(conns).toHaveLength(3);
      expect(pool.stats().active).toBe(3);
      expect(pool.stats().total).toBe(3);
    });

    it('throws on timeout when pool is exhausted', async () => {
      vi.useRealTimers();
      const config: PoolConfig = { ...FAST_CONFIG, acquireTimeoutMs: 50 };
      const pool = new ConnectionPool<FakeConn>(config, createFactory());
      // exhaust pool
      await pool.acquire();
      await pool.acquire();
      await pool.acquire();

      await expect(pool.acquire()).rejects.toThrow(/Acquire timeout/);
    });

    it('waiter gets connection when one is released', async () => {
      vi.useRealTimers();
      const pool = new ConnectionPool<FakeConn>(FAST_CONFIG, createFactory());
      const c1 = await pool.acquire();
      await pool.acquire();
      await pool.acquire();

      const waiterPromise = pool.acquire();
      // release one
      pool.release(c1);
      const c4 = await waiterPromise;
      expect(c4.id).toBe(c1.id);
    });

    it('skips invalid idle connections', async () => {
      const pool = new ConnectionPool<FakeConn>(FAST_CONFIG, createFactory());
      const conn = await pool.acquire();
      conn.valid = false;
      pool.release(conn);

      const conn2 = await pool.acquire();
      expect(conn2.id).not.toBe(conn.id);
      expect(conn.destroyed).toBe(true);
    });

    it('throws when pool is drained', async () => {
      const pool = new ConnectionPool<FakeConn>(FAST_CONFIG, createFactory());
      await pool.drain();
      await expect(pool.acquire()).rejects.toThrow(/drained/);
    });
  });

  describe('release()', () => {
    it('returns connection to idle pool', async () => {
      const pool = new ConnectionPool<FakeConn>(FAST_CONFIG, createFactory());
      const conn = await pool.acquire();
      expect(pool.stats().active).toBe(1);
      pool.release(conn);
      expect(pool.stats().active).toBe(0);
      expect(pool.stats().idle).toBe(1);
    });

    it('ignores connections not owned by pool', async () => {
      const pool = new ConnectionPool<FakeConn>(FAST_CONFIG, createFactory());
      const foreign: FakeConn = { id: 999, destroyed: false, valid: true };
      pool.release(foreign);
      expect(pool.stats().idle).toBe(0);
    });

    it('destroys connection if released after drain', async () => {
      vi.useRealTimers();
      const pool = new ConnectionPool<FakeConn>(FAST_CONFIG, createFactory());
      const conn = await pool.acquire();
      await pool.drain();
      pool.release(conn);
      // give async destroy a tick
      await delay(10);
      expect(conn.destroyed).toBe(true);
    });
  });

  describe('stats()', () => {
    it('returns correct counts', async () => {
      const pool = new ConnectionPool<FakeConn>(FAST_CONFIG, createFactory());
      expect(pool.stats()).toEqual({ total: 0, active: 0, idle: 0, waiting: 0 });

      const c1 = await pool.acquire();
      expect(pool.stats()).toEqual({ total: 1, active: 1, idle: 0, waiting: 0 });

      const c2 = await pool.acquire();
      expect(pool.stats()).toEqual({ total: 2, active: 2, idle: 0, waiting: 0 });

      pool.release(c1);
      expect(pool.stats()).toEqual({ total: 2, active: 1, idle: 1, waiting: 0 });

      pool.release(c2);
      expect(pool.stats()).toEqual({ total: 2, active: 0, idle: 2, waiting: 0 });
    });
  });

  describe('drain()', () => {
    it('destroys all idle and active connections', async () => {
      const pool = new ConnectionPool<FakeConn>(FAST_CONFIG, createFactory());
      const c1 = await pool.acquire();
      const c2 = await pool.acquire();
      pool.release(c1);

      await pool.drain();
      expect(c1.destroyed).toBe(true);
      expect(c2.destroyed).toBe(true);
      expect(pool.stats().total).toBe(0);
    });

    it('rejects pending waiters', async () => {
      vi.useRealTimers();
      const pool = new ConnectionPool<FakeConn>(FAST_CONFIG, createFactory());
      await pool.acquire();
      await pool.acquire();
      await pool.acquire();

      const waiterPromise = pool.acquire();
      await pool.drain();
      await expect(waiterPromise).rejects.toThrow(/draining/);
    });
  });

  describe('idle eviction', () => {
    it('evicts connections idle longer than idleTimeoutMs', async () => {
      vi.useRealTimers();
      const config: PoolConfig = { ...FAST_CONFIG, minIdle: 0, idleTimeoutMs: 1_000 };
      const pool = new ConnectionPool<FakeConn>(config, createFactory());
      await pool.initialize();

      const c1 = await pool.acquire();
      const c2 = await pool.acquire();
      pool.release(c1);
      pool.release(c2);
      expect(pool.stats().idle).toBe(2);

      // Wait for idle timeout + eviction interval to fire
      await delay(2_000);
      expect(c1.destroyed).toBe(true);
      expect(c2.destroyed).toBe(true);
      expect(pool.stats().idle).toBe(0);

      await pool.drain();
    });

    it('keeps minIdle connections even past idleTimeoutMs', async () => {
      vi.useRealTimers();
      const config: PoolConfig = { ...FAST_CONFIG, minIdle: 1, idleTimeoutMs: 1_000 };
      const pool = new ConnectionPool<FakeConn>(config, createFactory());
      await pool.initialize();

      const c1 = await pool.acquire();
      const c2 = await pool.acquire();
      pool.release(c1);
      pool.release(c2);
      expect(pool.stats().idle).toBe(2);

      // Wait for eviction
      await delay(2_000);
      // Should keep at least 1 idle (minIdle)
      expect(pool.stats().idle).toBeGreaterThanOrEqual(1);

      await pool.drain();
    });
  });

  describe('initialize()', () => {
    it('pre-fills minIdle connections', async () => {
      const pool = new ConnectionPool<FakeConn>(FAST_CONFIG, createFactory());
      await pool.initialize();
      expect(pool.stats().idle).toBe(1);
      expect(pool.stats().total).toBe(1);
      await pool.drain();
    });
  });

  describe('POOL_CONFIGS', () => {
    it('has correct SQLite defaults', () => {
      expect(POOL_CONFIGS.sqlite).toEqual({
        maxConnections: 5,
        minIdle: 1,
        acquireTimeoutMs: 3_000,
        idleTimeoutMs: 60_000,
      });
    });

    it('has correct Ollama defaults', () => {
      expect(POOL_CONFIGS.ollama).toEqual({
        maxConnections: 4,
        minIdle: 1,
        acquireTimeoutMs: 5_000,
        idleTimeoutMs: 30_000,
      });
    });
  });
});
