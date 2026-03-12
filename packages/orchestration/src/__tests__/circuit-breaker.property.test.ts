/**
 * Property-based test for circuit breaker state transitions.
 *
 * **Property 1: Circuit breaker state transitions**
 * For any sequence of operation results (success/failure) applied to a circuit breaker,
 * the breaker state should transition correctly: it opens after `failureThreshold`
 * consecutive failures, transitions to half-open after `cooldownMs`, and closes after
 * `successThreshold` consecutive successes in half-open state. At no point should the
 * breaker be in an invalid state.
 *
 * **Validates: Requirements 13.8**
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { CircuitBreakerImpl, CircuitOpenError } from '../circuit-breaker.js';
import type { CircuitBreakerConfig, CircuitState } from '../circuit-breaker.js';

// ─── Types ───────────────────────────────────────────────────────────────────

/** An operation step in the generated sequence */
type Step =
  | { kind: 'success' }
  | { kind: 'failure' }
  | { kind: 'tick'; ms: number };

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/** Generate a reasonable circuit breaker config */
const configArb: fc.Arbitrary<CircuitBreakerConfig> = fc.record({
  failureThreshold: fc.integer({ min: 1, max: 10 }),
  cooldownMs: fc.integer({ min: 1, max: 5000 }),
  successThreshold: fc.integer({ min: 1, max: 10 }),
  operationTimeoutMs: fc.constant(60_000), // large enough to never trigger
});

/** Generate a single step: success, failure, or time advancement */
const stepArb: fc.Arbitrary<Step> = fc.oneof(
  fc.constant<Step>({ kind: 'success' }),
  fc.constant<Step>({ kind: 'failure' }),
  fc.integer({ min: 1, max: 10_000 }).map<Step>((ms) => ({ kind: 'tick', ms })),
);

/** Generate a sequence of steps */
const stepsArb = (minLen: number, maxLen: number): fc.Arbitrary<Step[]> =>
  fc.array(stepArb, { minLength: minLen, maxLength: maxLen });

// ─── Reference model ─────────────────────────────────────────────────────────

/**
 * A simple reference state machine that mirrors the expected circuit breaker
 * behavior. We run both the real implementation and this model in lockstep,
 * then assert they agree.
 */
class ReferenceCircuitBreaker {
  state: CircuitState = 'closed';
  consecutiveFailures = 0;
  consecutiveSuccesses = 0;
  lastFailureTime: number | null = null;

  constructor(private config: CircuitBreakerConfig) {}

  /** Check if cooldown has elapsed and transition if needed */
  checkCooldown(now: number): void {
    if (
      this.state === 'open' &&
      this.lastFailureTime !== null &&
      now - this.lastFailureTime >= this.config.cooldownMs
    ) {
      this.state = 'half-open';
      this.consecutiveSuccesses = 0;
    }
  }

  /**
   * Apply a success/failure operation at the given time.
   * Returns whether the operation would be allowed (not rejected by open circuit).
   */
  applyOperation(kind: 'success' | 'failure', now: number): 'executed' | 'rejected' {
    // First check cooldown transition
    this.checkCooldown(now);

    if (this.state === 'open') {
      return 'rejected';
    }

    if (kind === 'success') {
      if (this.state === 'half-open') {
        this.consecutiveSuccesses++;
        if (this.consecutiveSuccesses >= this.config.successThreshold) {
          this.state = 'closed';
          this.consecutiveFailures = 0;
          this.consecutiveSuccesses = 0;
          this.lastFailureTime = null;
        }
      } else {
        // closed: reset failure count
        this.consecutiveFailures = 0;
      }
    } else {
      // failure
      if (this.state === 'half-open') {
        this.lastFailureTime = now;
        this.state = 'open';
      } else if (this.state === 'closed') {
        this.consecutiveFailures++;
        if (this.consecutiveFailures >= this.config.failureThreshold) {
          this.lastFailureTime = now;
          this.state = 'open';
        }
      }
    }

    return 'executed';
  }

  /** Get the current state, checking cooldown first */
  getState(now: number): CircuitState {
    this.checkCooldown(now);
    return this.state;
  }
}

// ─── Property test ───────────────────────────────────────────────────────────

const VALID_STATES: CircuitState[] = ['closed', 'open', 'half-open'];

describe('Circuit breaker state transitions (property)', () => {
  it('state machine transitions match reference model for any operation sequence', async () => {
    await fc.assert(
      fc.asyncProperty(configArb, stepsArb(1, 50), async (config, steps) => {
        let currentTime = 0;
        const clock = () => currentTime;

        const breaker = new CircuitBreakerImpl<string>('prop-test', config, clock);
        const ref = new ReferenceCircuitBreaker(config);

        for (const step of steps) {
          if (step.kind === 'tick') {
            currentTime += step.ms;
            // After a tick, states should agree
            const realState = breaker.getState();
            const refState = ref.getState(currentTime);
            expect(VALID_STATES).toContain(realState);
            expect(realState).toBe(refState);
            continue;
          }

          // success or failure operation
          const refResult = ref.applyOperation(step.kind, currentTime);

          if (refResult === 'rejected') {
            // The real breaker should throw CircuitOpenError
            try {
              await breaker.execute(() => Promise.resolve('should-not-reach'));
              // If we get here, the circuit didn't reject — that's a failure
              expect.unreachable('Expected CircuitOpenError but operation succeeded');
            } catch (err) {
              expect(err).toBeInstanceOf(CircuitOpenError);
            }
          } else {
            // The operation should be allowed
            if (step.kind === 'success') {
              const result = await breaker.execute(() => Promise.resolve('ok'));
              expect(result).toBe('ok');
            } else {
              try {
                await breaker.execute(() => Promise.reject(new Error('fail')));
                expect.unreachable('Expected failure to propagate');
              } catch (err) {
                expect(err).not.toBeInstanceOf(CircuitOpenError);
              }
            }
          }

          // After each operation, states should still agree
          const realState = breaker.getState();
          const refState = ref.getState(currentTime);
          expect(VALID_STATES).toContain(realState);
          expect(realState).toBe(refState);
        }
      }),
      { numRuns: 200 },
    );
  });
});
