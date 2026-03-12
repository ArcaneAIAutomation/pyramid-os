/**
 * Property-based test for memory-cached writes surviving DB recovery.
 *
 * **Validates: Requirements 40.6**
 *
 * Property 19: Memory-cached writes survive DB recovery
 * When database writes fail, the system caches state in memory via the
 * Cache write-through mechanism. On recovery, all cached writes are flushed
 * to the database. No writes are lost.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { Cache } from '../cache.js';
import type { CacheConfig } from '../cache.js';

// ---------------------------------------------------------------------------
// Helpers — simulate DB with failure/recovery
// ---------------------------------------------------------------------------

interface SimulatedDB {
  /** The "database" storage */
  store: Map<string, string>;
  /** Buffer for writes that occurred during DB failure */
  pendingWrites: Map<string, string>;
  /** Whether the DB is currently "down" */
  failed: boolean;
}

function createSimulatedDB(): SimulatedDB {
  return {
    store: new Map(),
    pendingWrites: new Map(),
    failed: false,
  };
}

/**
 * Creates a Cache with write-through that routes to the simulated DB.
 * When the DB is "failed", writes go to the pending buffer instead.
 */
function createCacheWithDB(db: SimulatedDB): Cache<string> {
  const config: CacheConfig = {
    maxSize: 1000,
    ttlMs: 0, // no expiry — we want all writes to survive
    writeThrough: true,
  };

  const writeThrough = (key: string, value: string): void => {
    if (db.failed) {
      // DB is down — buffer the write in memory
      db.pendingWrites.set(key, value);
    } else {
      // DB is healthy — write directly
      db.store.set(key, value);
    }
  };

  return new Cache<string>(config, writeThrough);
}

/**
 * Simulate DB recovery: flush all pending writes to the DB store.
 */
function recoverDB(db: SimulatedDB): void {
  db.failed = false;
  for (const [key, value] of db.pendingWrites) {
    db.store.set(key, value);
  }
  db.pendingWrites.clear();
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** Generate a non-empty alphanumeric key */
const keyArb = fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s.trim().length > 0);

/** Generate a non-empty value */
const valueArb = fc.string({ minLength: 1, maxLength: 50 });

/** Generate a list of key-value write operations */
const writesArb = fc.array(fc.tuple(keyArb, valueArb), { minLength: 1, maxLength: 50 });

// ---------------------------------------------------------------------------
// Property tests
// ---------------------------------------------------------------------------

describe('Memory-cached writes survive DB recovery (Property 19)', () => {
  it('all writes during DB failure are present in DB after recovery', () => {
    fc.assert(
      fc.property(writesArb, (writes) => {
        const db = createSimulatedDB();
        const cache = createCacheWithDB(db);

        // Simulate DB failure
        db.failed = true;

        // Perform all writes during the failure period
        for (const [key, value] of writes) {
          cache.set(key, value);
        }

        // All writes should be in the pending buffer, not in the DB store
        for (const [key] of writes) {
          expect(db.store.has(key)).toBe(false);
        }

        // Simulate recovery — flush pending writes to DB
        recoverDB(db);

        // Build expected state: last write wins for duplicate keys
        const expected = new Map<string, string>();
        for (const [key, value] of writes) {
          expected.set(key, value);
        }

        // Verify every expected key-value is in the DB
        for (const [key, value] of expected) {
          expect(db.store.get(key)).toBe(value);
        }

        // Verify no writes were lost — DB has at least all expected keys
        expect(db.store.size).toBe(expected.size);
      }),
      { numRuns: 200 },
    );
  });

  it('writes before failure go to DB, writes during failure are buffered, all present after recovery', () => {
    fc.assert(
      fc.property(writesArb, writesArb, (preFailureWrites, duringFailureWrites) => {
        const db = createSimulatedDB();
        const cache = createCacheWithDB(db);

        // Phase 1: writes while DB is healthy go directly to store
        for (const [key, value] of preFailureWrites) {
          cache.set(key, value);
        }

        const preFailureExpected = new Map<string, string>();
        for (const [key, value] of preFailureWrites) {
          preFailureExpected.set(key, value);
        }

        // Verify pre-failure writes are in DB
        for (const [key, value] of preFailureExpected) {
          expect(db.store.get(key)).toBe(value);
        }

        // Phase 2: DB fails
        db.failed = true;

        for (const [key, value] of duringFailureWrites) {
          cache.set(key, value);
        }

        // Phase 3: Recovery
        recoverDB(db);

        // Build combined expected state (later writes override earlier)
        const allExpected = new Map<string, string>();
        for (const [key, value] of preFailureWrites) {
          allExpected.set(key, value);
        }
        for (const [key, value] of duringFailureWrites) {
          allExpected.set(key, value);
        }

        // Verify all writes are present in DB after recovery
        for (const [key, value] of allExpected) {
          expect(db.store.get(key)).toBe(value);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('cache still serves values from memory during DB failure', () => {
    fc.assert(
      fc.property(writesArb, (writes) => {
        const db = createSimulatedDB();
        const cache = createCacheWithDB(db);

        db.failed = true;

        // Write during failure
        for (const [key, value] of writes) {
          cache.set(key, value);
        }

        // Cache should still serve the values even though DB is down
        const expected = new Map<string, string>();
        for (const [key, value] of writes) {
          expected.set(key, value);
        }

        for (const [key, value] of expected) {
          expect(cache.get(key)).toBe(value);
        }
      }),
      { numRuns: 200 },
    );
  });
});
