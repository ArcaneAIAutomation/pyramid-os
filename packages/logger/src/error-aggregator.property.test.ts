/**
 * Property-based tests for error aggregation.
 *
 * **Validates: Requirements 38.9**
 *
 * Property 15: Error aggregation prevents spam
 * For any sequence of N identical errors (same code + context) occurring within
 * the aggregation window, the logger should emit at most 1 log entry (with
 * count = N) rather than N separate entries.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import { ErrorAggregator } from './error-aggregator.js';
import type { AggregatedErrorEntry } from './error-aggregator.js';
import { PyramidError, ErrorCategory } from '@pyramid-os/shared-types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePyramidError(
  code: string,
  context: Record<string, unknown> = {},
): PyramidError {
  return new PyramidError({
    code,
    category: ErrorCategory.SYSTEM,
    severity: 'error',
    message: `Error: ${code}`,
    context,
  });
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** Generate a PYRAMID-style error code */
const errorCodeArb = fc
  .stringMatching(/^[A-Z][A-Z_]{1,8}$/)
  .map((suffix) => `PYRAMID_TEST_${suffix}`);

/** Generate a simple context object */
const contextArb = fc.dictionary(
  fc.string({ minLength: 1, maxLength: 6 }).filter((s) => /^[a-z]/.test(s)),
  fc.oneof(fc.string({ maxLength: 10 }), fc.integer({ min: -100, max: 100 })),
  { minKeys: 0, maxKeys: 3 },
);

/** Generate a count of identical errors to report (at least 1) */
const errorCountArb = fc.integer({ min: 1, max: 50 });

/** Generate a list of distinct error codes (1–10 unique codes) */
const distinctCodesArb = fc
  .uniqueArray(errorCodeArb, { minLength: 1, maxLength: 10 })
  .filter((arr) => arr.length >= 1);

// ---------------------------------------------------------------------------
// Property tests
// ---------------------------------------------------------------------------

describe('Error aggregation prevents spam (Property 15)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('N identical errors within a single window produce exactly 1 log entry with count = N', () => {
    fc.assert(
      fc.property(errorCodeArb, contextArb, errorCountArb, (code, ctx, count) => {
        const emitted: AggregatedErrorEntry[] = [];
        const agg = new ErrorAggregator((e) => emitted.push(e));

        const err = makePyramidError(code, ctx);
        for (let i = 0; i < count; i++) {
          agg.report(err);
        }

        agg.flush();

        // Exactly 1 log entry emitted (not N)
        expect(emitted).toHaveLength(1);
        // The count matches the number of reports
        expect(emitted[0]!.count).toBe(count);
        // The code matches
        expect(emitted[0]!.code).toBe(code);
      }),
      { numRuns: 200 },
    );
  });

  it('K distinct error codes each produce exactly 1 log entry regardless of per-code repetition count', () => {
    fc.assert(
      fc.property(
        distinctCodesArb,
        fc.array(errorCountArb, { minLength: 1, maxLength: 10 }),
        (codes, counts) => {
          const emitted: AggregatedErrorEntry[] = [];
          // Use a high maxTracked to avoid auto-flush interfering
          const agg = new ErrorAggregator((e) => emitted.push(e), { maxTracked: 1000 });

          // For each distinct code, report it `count` times
          for (let i = 0; i < codes.length; i++) {
            const code = codes[i]!;
            const n = counts[i % counts.length]!;
            const err = makePyramidError(code);
            for (let j = 0; j < n; j++) {
              agg.report(err);
            }
          }

          agg.flush();

          // Exactly 1 entry per distinct code
          expect(emitted).toHaveLength(codes.length);

          // Each entry has the correct count
          for (let i = 0; i < codes.length; i++) {
            const code = codes[i]!;
            const n = counts[i % counts.length]!;
            const entry = emitted.find((e) => e.code === code);
            expect(entry).toBeDefined();
            expect(entry!.count).toBe(n);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
