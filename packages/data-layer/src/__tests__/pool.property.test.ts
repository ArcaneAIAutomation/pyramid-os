/**
 * Property-based test for connection pool bounds.
 *
 * Property 6: For any sequence of acquire/release operations on a connection pool,
 * the number of active connections never exceeds `maxConnections`, and
 * `idle + active === total` always holds.
 *
 * **Validates: Requirements 25.8**
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { ConnectionPool } from '../pool.js';
import type { PoolConfig, ConnectionFactory, PoolStats } from '../pool.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

let nextId = 0;

interface FakeConn {
  id: number;
  destroyed: boolean;
}

function createFactory(): ConnectionFactory<FakeConn> {
  return {
    async create() {
      return { id: nextId++, destroyed: false };
    },
    async destroy(conn) {
      conn.destroyed = true;
    },
    async validate(conn) {
      return !conn.destroyed;
    },
  };
}

// Operation types for the model-based approach
type Op = { type: 'acquire' } | { type: 'release' };

/**
 * Generate a sequence of acquire/release operations that is model-safe:
 * we only acquire when the model says there's room (to avoid timeouts),
 * and only release when we hold at least one connection.
 */
function opsArbitrary(maxConns: number): fc.Arbitrary<Op[]> {
  return fc.array(fc.constantFrom('acquire', 'release'), { minLength: 1, maxLength: 60 }).map(
    (rawOps) => {
      const ops: Op[] = [];
      let modelActive = 0;
      for (const raw of rawOps) {
        if (raw === 'acquire' && modelActive < maxConns) {
          ops.push({ type: 'acquire' });
          modelActive++;
        } else if (raw === 'release' && modelActive > 0) {
          ops.push({ type: 'release' });
          modelActive--;
        }
        // skip ops that would cause timeout or no-op
      }
      // Ensure at least one operation
      if (ops.length === 0) {
        ops.push({ type: 'acquire' });
      }
      return ops;
    }
  );
}

// ─── Config arbitrary ─────────────────────────────────────────────────────────

const poolConfigArb: fc.Arbitrary<PoolConfig> = fc
  .record({
    maxConnections: fc.integer({ min: 1, max: 10 }),
    minIdle: fc.integer({ min: 0, max: 5 }),
    acquireTimeoutMs: fc.constant(500),
    idleTimeoutMs: fc.constant(60_000), // long enough to not interfere
  })
  .map((cfg) => ({
    ...cfg,
    // Ensure minIdle <= maxConnections
    minIdle: Math.min(cfg.minIdle, cfg.maxConnections),
  }));

// ─── Property test ────────────────────────────────────────────────────────────

describe('ConnectionPool bounds property', () => {
  it('active never exceeds maxConnections and idle + active === total for any acquire/release sequence', async () => {
    await fc.assert(
      fc.asyncProperty(
        poolConfigArb.chain((config) =>
          opsArbitrary(config.maxConnections).map((ops) => ({ config, ops }))
        ),
        async ({ config, ops }) => {
          nextId = 0;
          const pool = new ConnectionPool<FakeConn>(config, createFactory());
          const held: FakeConn[] = [];

          for (const op of ops) {
            if (op.type === 'acquire') {
              const conn = await pool.acquire();
              held.push(conn);
            } else {
              // release the most recently acquired connection
              const conn = held.pop()!;
              pool.release(conn);
            }

            // Check invariants after every operation
            const s: PoolStats = pool.stats();

            // active must never exceed maxConnections
            expect(s.active).toBeLessThanOrEqual(config.maxConnections);

            // total must never exceed maxConnections
            expect(s.total).toBeLessThanOrEqual(config.maxConnections);

            // idle + active must equal total
            expect(s.idle + s.active).toBe(s.total);

            // active must match our model
            expect(s.active).toBe(held.length);
          }

          // Cleanup: release all held connections and drain
          for (const conn of held) {
            pool.release(conn);
          }
          await pool.drain();
        }
      ),
      { numRuns: 100 }
    );
  });
});
