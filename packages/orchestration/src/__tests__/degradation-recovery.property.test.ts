/**
 * Property-based test: Degradation recovery restores full operation.
 *
 * **Property 18: Degradation recovery restores full operation**
 * For any component that transitions from healthy to failed and back to
 * healthy, the system degradation level should return to its pre-failure
 * state, and all fallback behaviors should be deactivated.
 *
 * **Validates: Requirements 40.10**
 */

import { describe, it, expect, vi } from 'vitest';
import * as fc from 'fast-check';
import { DegradationManager } from '../degradation.js';
import type { FallbackSpec, DegradationLevel } from '../degradation.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Create a FallbackSpec with tracked activate/deactivate calls. */
function makeFallback(): FallbackSpec & {
  activate: ReturnType<typeof vi.fn>;
  deactivate: ReturnType<typeof vi.fn>;
} {
  return {
    priority: 1,
    activate: vi.fn(),
    deactivate: vi.fn(),
  };
}

/**
 * Compute the expected degradation level given total components and
 * how many are currently failed, matching DegradationManager logic.
 */
function expectedLevel(total: number, failedCount: number): DegradationLevel {
  if (total === 0) return 'full';
  if (failedCount === 0) return 'full';
  if (failedCount === total) return 'minimal';
  if (failedCount > total / 2) return 'critical';
  return 'degraded';
}

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/** Generate a unique list of component names (2–8 components). */
const componentNamesArb: fc.Arbitrary<string[]> = fc
  .uniqueArray(fc.stringMatching(/^[a-z][a-z0-9-]{1,15}$/), {
    minLength: 2,
    maxLength: 8,
  });

/** Action type for failure/recovery sequences. */
type Action = { type: 'fail'; component: string } | { type: 'recover'; component: string };

/**
 * Generate a sequence of fail/recover actions for the given components.
 * Ensures every failed component eventually recovers (all recover at the end).
 */
function actionsArb(components: string[]): fc.Arbitrary<Action[]> {
  // Generate a random sequence of fail/recover actions, then append
  // recovery for all components to guarantee full recovery at the end.
  const actionArb: fc.Arbitrary<Action> = fc.record({
    type: fc.constantFrom('fail' as const, 'recover' as const),
    component: fc.constantFrom(...components),
  });

  return fc
    .array(actionArb, { minLength: 1, maxLength: 30 })
    .map((actions) => {
      // Append recovery for every component to ensure all recover
      const recoveries: Action[] = components.map((c) => ({
        type: 'recover' as const,
        component: c,
      }));
      return [...actions, ...recoveries];
    });
}

// ─── Property tests ──────────────────────────────────────────────────────────

describe('Degradation recovery restores full operation (property)', () => {
  it('after all components recover, degradation level returns to full', async () => {
    await fc.assert(
      fc.asyncProperty(
        componentNamesArb.chain((names) =>
          fc.tuple(fc.constant(names), actionsArb(names)),
        ),
        async ([componentNames, actions]) => {
          const manager = new DegradationManager();
          const fallbacks = new Map<string, ReturnType<typeof makeFallback>>();

          // Register all components
          for (const name of componentNames) {
            const fb = makeFallback();
            fallbacks.set(name, fb);
            manager.registerComponent(name, fb);
          }

          // Initial state should be full
          expect(manager.getOverallLevel()).toBe('full');

          // Execute the action sequence
          for (const action of actions) {
            if (action.type === 'fail') {
              await manager.notifyFailure(action.component);
            } else {
              await manager.notifyRecovery(action.component);
            }
          }

          // After all components have recovered, level must be 'full'
          expect(manager.getOverallLevel()).toBe('full');

          // All component states should be healthy
          const states = manager.getComponentStates();
          for (const name of componentNames) {
            expect(states.get(name)).toBe('healthy');
          }

          // All fallbacks should be deactivated (deactivate called at least once)
          // Only check components that were actually failed at some point
          for (const name of componentNames) {
            const wasFailed = actions.some(
              (a) => a.type === 'fail' && a.component === name,
            );
            if (wasFailed) {
              const fb = fallbacks.get(name)!;
              expect(fb.deactivate).toHaveBeenCalled();
            }
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it('intermediate degradation levels match the number of failed components', async () => {
    await fc.assert(
      fc.asyncProperty(
        componentNamesArb.chain((names) =>
          fc.tuple(fc.constant(names), actionsArb(names)),
        ),
        async ([componentNames, actions]) => {
          const manager = new DegradationManager();
          const total = componentNames.length;

          // Register all components
          for (const name of componentNames) {
            manager.registerComponent(name, makeFallback());
          }

          // Track which components are currently failed
          const failedSet = new Set<string>();

          // Execute actions and verify level at each step
          for (const action of actions) {
            if (action.type === 'fail') {
              await manager.notifyFailure(action.component);
              failedSet.add(action.component);
            } else {
              await manager.notifyRecovery(action.component);
              failedSet.delete(action.component);
            }

            const expected = expectedLevel(total, failedSet.size);
            expect(manager.getOverallLevel()).toBe(expected);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
