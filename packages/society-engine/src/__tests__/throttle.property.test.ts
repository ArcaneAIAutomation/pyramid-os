/**
 * Property-based test for throttle rate limiting.
 *
 * **Property 7: Throttle respects rate limit**
 *
 * For any sequence of task assignment attempts, when the assignment rate
 * exceeds `maxAssignmentsPerSecond`, the throttle should reject excess
 * assignments, and the actual throughput should not exceed the configured limit.
 *
 * **Validates: Requirements 25.10**
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fc from 'fast-check';
import { TaskThrottle, type ThrottleConfig } from '../throttle.js';

// ── Arbitraries ──────────────────────────────────────────────────────────────

/** Generate a valid ThrottleConfig with reasonable bounds */
const throttleConfigArb: fc.Arbitrary<ThrottleConfig> = fc.record({
  maxAssignmentsPerSecond: fc.integer({ min: 1, max: 100 }),
  queueDepthThreshold: fc.integer({ min: 50, max: 1000 }),
  maxPendingAssignments: fc.integer({ min: 100, max: 2000 }),
});

/**
 * A burst is a group of assignment attempts at a specific time offset (ms).
 * We generate a sequence of bursts within a time span.
 */
interface Burst {
  timeOffsetMs: number;
  attemptCount: number;
}

const burstArb: fc.Arbitrary<Burst> = fc.record({
  timeOffsetMs: fc.integer({ min: 0, max: 5000 }),
  attemptCount: fc.integer({ min: 1, max: 30 }),
});

const burstSequenceArb: fc.Arbitrary<Burst[]> = fc
  .array(burstArb, { minLength: 1, maxLength: 20 })
  .map((bursts) => bursts.sort((a, b) => a.timeOffsetMs - b.timeOffsetMs));

// ── Property tests ───────────────────────────────────────────────────────────

describe('TaskThrottle — Property 7: Throttle respects rate limit', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('allowed assignments within any 1-second window never exceed maxAssignmentsPerSecond', () => {
    fc.assert(
      fc.property(
        throttleConfigArb,
        burstSequenceArb,
        (config, bursts) => {
          const throttle = new TaskThrottle(config);
          // Keep queue depth and pending low so only rate limit is tested
          throttle.setQueueDepth(0);

          // Track every allowed assignment with its timestamp
          const allowedTimestamps: number[] = [];
          let currentTime = 0;

          for (const burst of bursts) {
            // Advance time to this burst's offset
            const delta = burst.timeOffsetMs - currentTime;
            if (delta > 0) {
              vi.advanceTimersByTime(delta);
              currentTime = burst.timeOffsetMs;
            }

            for (let i = 0; i < burst.attemptCount; i++) {
              const result = throttle.canAssign();
              if (result.allowed) {
                throttle.recordAssignment();
                // Immediately complete to avoid hitting maxPendingAssignments
                throttle.recordCompletion();
                allowedTimestamps.push(currentTime);
              }
            }
          }

          // Verify: in any 1-second sliding window, allowed count <= maxAssignmentsPerSecond
          for (let i = 0; i < allowedTimestamps.length; i++) {
            const windowStart = allowedTimestamps[i]!;
            let count = 0;
            for (let j = i; j < allowedTimestamps.length; j++) {
              if (allowedTimestamps[j]! - windowStart < 1000) {
                count++;
              } else {
                break;
              }
            }
            expect(count).toBeLessThanOrEqual(config.maxAssignmentsPerSecond);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it('canAssign returns false when rate limit is reached within a window', () => {
    fc.assert(
      fc.property(
        throttleConfigArb,
        (config) => {
          const throttle = new TaskThrottle(config);
          throttle.setQueueDepth(0);

          // Fill up the rate limit exactly
          for (let i = 0; i < config.maxAssignmentsPerSecond; i++) {
            const result = throttle.canAssign();
            expect(result.allowed).toBe(true);
            throttle.recordAssignment();
            // Complete immediately to avoid pending limit
            throttle.recordCompletion();
          }

          // The next attempt must be rejected
          const rejected = throttle.canAssign();
          expect(rejected.allowed).toBe(false);
          expect(rejected.reason).toBeDefined();
        },
      ),
      { numRuns: 200 },
    );
  });

  it('assignments are allowed again after the 1-second window expires', () => {
    fc.assert(
      fc.property(
        throttleConfigArb,
        (config) => {
          const throttle = new TaskThrottle(config);
          throttle.setQueueDepth(0);

          // Saturate the rate limit
          for (let i = 0; i < config.maxAssignmentsPerSecond; i++) {
            throttle.recordAssignment();
            throttle.recordCompletion();
          }
          expect(throttle.canAssign().allowed).toBe(false);

          // Advance past the 1-second sliding window
          vi.advanceTimersByTime(1001);

          // Should be allowed again
          expect(throttle.canAssign().allowed).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });
});
