/**
 * Property-based tests for cache consistency on invalidation.
 *
 * **Validates: Requirements 25.9**
 *
 * Property 5: Cache consistency on invalidation
 * For any cached item, after the item is updated in the underlying store and
 * the cache is invalidated, subsequent cache reads should return the updated
 * value (not stale data).
 *
 * We generate random sequences of cache operations (set, get, invalidate,
 * invalidatePattern) and run them against both the real Cache and a reference
 * model (simple Map). After every invalidation we verify no stale reads occur,
 * and after every set we verify get returns the latest value. We also verify
 * stats.size matches the reference model size.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { Cache } from '../cache.js';
import type { CacheConfig } from '../cache.js';

// ---------------------------------------------------------------------------
// Operation types for the state-machine model
// ---------------------------------------------------------------------------

type SetOp = { type: 'set'; key: string; value: number };
type GetOp = { type: 'get'; key: string };
type InvalidateOp = { type: 'invalidate'; key: string };
type InvalidatePatternOp = { type: 'invalidatePattern'; pattern: string };

type CacheOp = SetOp | GetOp | InvalidateOp | InvalidatePatternOp;

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** Small key space so operations overlap frequently */
const keyArb = fc.constantFrom('a', 'b', 'c', 'd', 'e', 'f');

const setOpArb: fc.Arbitrary<SetOp> = fc.record({
  type: fc.constant('set' as const),
  key: keyArb,
  value: fc.integer({ min: 0, max: 1000 }),
});

const getOpArb: fc.Arbitrary<GetOp> = fc.record({
  type: fc.constant('get' as const),
  key: keyArb,
});

const invalidateOpArb: fc.Arbitrary<InvalidateOp> = fc.record({
  type: fc.constant('invalidate' as const),
  key: keyArb,
});

/** Pattern that matches a prefix like "a", "b", etc. */
const invalidatePatternOpArb: fc.Arbitrary<InvalidatePatternOp> = fc.record({
  type: fc.constant('invalidatePattern' as const),
  pattern: fc.constantFrom('^a', '^b', '^c', '^d', '^e', '^f'),
});

const cacheOpArb: fc.Arbitrary<CacheOp> = fc.oneof(
  { weight: 4, arbitrary: setOpArb },
  { weight: 4, arbitrary: getOpArb },
  { weight: 2, arbitrary: invalidateOpArb },
  { weight: 1, arbitrary: invalidatePatternOpArb },
);

// ---------------------------------------------------------------------------
// Property test
// ---------------------------------------------------------------------------

describe('Cache consistency on invalidation (Property 5)', () => {
  it('no stale reads after invalidation for any random get/set/invalidate sequence', () => {
    /** Use no TTL so expiry doesn't interfere with the consistency model */
    const config: CacheConfig = { maxSize: 4, ttlMs: 0, writeThrough: false };

    fc.assert(
      fc.property(
        fc.array(cacheOpArb, { minLength: 1, maxLength: 80 }),
        (ops) => {
          const cache = new Cache<number>(config);
          /** Reference model — always holds the ground truth */
          const model = new Map<string, number>();

          for (const op of ops) {
            switch (op.type) {
              case 'set': {
                cache.set(op.key, op.value);
                model.set(op.key, op.value);

                // After set, get must return the latest value
                const afterSet = cache.get(op.key);
                expect(afterSet).toBe(op.value);
                break;
              }

              case 'get': {
                const cached = cache.get(op.key);
                if (cached !== undefined) {
                  // If cache returns a value, it must match the model
                  // (the most recently set value for that key)
                  expect(model.has(op.key)).toBe(true);
                  expect(cached).toBe(model.get(op.key));
                }
                // Cache may return undefined due to LRU eviction even if
                // model still has the key — that's fine (miss, not stale).
                break;
              }

              case 'invalidate': {
                cache.invalidate(op.key);
                model.delete(op.key);

                // After invalidation, get MUST return undefined (no stale read)
                const afterInvalidate = cache.get(op.key);
                expect(afterInvalidate).toBeUndefined();
                break;
              }

              case 'invalidatePattern': {
                const regex = new RegExp(op.pattern);
                cache.invalidatePattern(regex);

                // Remove matching keys from model
                for (const key of [...model.keys()]) {
                  if (regex.test(key)) {
                    model.delete(key);
                  }
                }

                // After pattern invalidation, all matching keys must return undefined
                for (const key of ['a', 'b', 'c', 'd', 'e', 'f']) {
                  if (regex.test(key)) {
                    const afterPatternInvalidate = cache.get(key);
                    expect(afterPatternInvalidate).toBeUndefined();
                  }
                }
                break;
              }
            }
          }

          // Final consistency check: stats.size must not exceed model size.
          // It can be smaller due to LRU eviction, but never larger.
          const stats = cache.stats();
          expect(stats.size).toBeLessThanOrEqual(model.size);
          expect(stats.size).toBeLessThanOrEqual(config.maxSize);
        },
      ),
      { numRuns: 200 },
    );
  });
});
