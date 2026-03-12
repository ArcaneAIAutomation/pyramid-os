/**
 * Property-based test for plugin failure isolation.
 *
 * **Property 8: Plugin failure isolation**
 * For any loaded plugin that throws an error during event handling, the main
 * system should continue operating, the error should be logged, and other
 * plugins should not be affected.
 *
 * **Validates: Requirements 26.8**
 */

import { describe, it, expect, vi } from 'vitest';
import * as fc from 'fast-check';
import { PluginSandboxImpl, PLUGIN_FAILURE_THRESHOLD } from '../plugin-sandbox.js';
import type { PluginLoaderImpl } from '../plugin-loader.js';
import type { PluginLogger } from '@pyramid-os/shared-types';

// ─── Types ───────────────────────────────────────────────────────────────────

/** A single step in the generated execution sequence */
type Step =
  | { kind: 'success'; pluginId: string; value: number }
  | { kind: 'failure'; pluginId: string; message: string };

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createMockLoader(): PluginLoaderImpl {
  return {
    unloadPlugin: vi.fn(async () => {}),
    isLoaded: vi.fn(() => true),
  } as unknown as PluginLoaderImpl;
}

function createMockLogger(): PluginLogger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/** Generate a plugin ID from a small pool so interactions overlap */
const pluginIdArb = fc.constantFrom('plugin-a', 'plugin-b', 'plugin-c', 'plugin-d');

/** Generate a single execution step */
const stepArb: fc.Arbitrary<Step> = fc.oneof(
  fc.record({
    kind: fc.constant('success' as const),
    pluginId: pluginIdArb,
    value: fc.integer({ min: -1000, max: 1000 }),
  }),
  fc.record({
    kind: fc.constant('failure' as const),
    pluginId: pluginIdArb,
    message: fc.string({ minLength: 1, maxLength: 50 }),
  }),
);

/** Generate a sequence of steps */
const stepsArb = fc.array(stepArb, { minLength: 1, maxLength: 60 });

// ─── Property test ───────────────────────────────────────────────────────────

describe('Plugin failure isolation (property)', () => {
  it('a failing plugin does not affect other plugins and failure counts are tracked independently', async () => {
    await fc.assert(
      fc.asyncProperty(stepsArb, async (steps) => {
        const loader = createMockLoader();
        const logger = createMockLogger();
        const sandbox = new PluginSandboxImpl(loader, logger);

        // Reference model: track expected consecutive failure counts per plugin
        const expectedFailures = new Map<string, number>();
        // Track which plugins have been auto-unloaded
        const autoUnloaded = new Set<string>();

        for (const step of steps) {
          const { pluginId } = step;

          if (!expectedFailures.has(pluginId)) {
            expectedFailures.set(pluginId, 0);
          }

          if (step.kind === 'success') {
            // Successful execution should return the value and reset failures
            const result = await sandbox.execute(pluginId, () => step.value);
            expect(result).toBe(step.value);

            // Success resets consecutive failure count
            expectedFailures.set(pluginId, 0);
          } else {
            // Failure should throw but not crash the sandbox
            const error = new Error(step.message);
            await expect(
              sandbox.execute(pluginId, () => { throw error; }),
            ).rejects.toThrow(step.message);

            // Increment expected failure count
            const newCount = expectedFailures.get(pluginId)! + 1;
            expectedFailures.set(pluginId, newCount);

            // Check auto-unload at threshold
            if (newCount >= PLUGIN_FAILURE_THRESHOLD) {
              autoUnloaded.add(pluginId);
            }
          }

          // ── Invariant 1: Failure counts match reference model ──
          for (const [pid, expectedCount] of expectedFailures) {
            expect(sandbox.getFailureCount(pid)).toBe(expectedCount);
          }

          // ── Invariant 2: Other plugins are unaffected ──
          // After any step on pluginId, all OTHER plugins' failure counts
          // should remain unchanged (already verified above by checking all
          // plugins against the reference model each iteration).
        }

        // ── Invariant 3: Auto-unload called for plugins that hit threshold ──
        for (const pid of autoUnloaded) {
          expect(loader.unloadPlugin).toHaveBeenCalledWith(pid);
        }

        // ── Invariant 4: System continues operating after failures ──
        // Verify we can still execute on any plugin after the full sequence
        const freshResult = await sandbox.execute('plugin-fresh', () => 42);
        expect(freshResult).toBe(42);
      }),
      { numRuns: 200 },
    );
  });

  it('successful executions reset failure count, preventing auto-unload', async () => {
    await fc.assert(
      fc.asyncProperty(
        pluginIdArb,
        fc.integer({ min: 1, max: PLUGIN_FAILURE_THRESHOLD - 1 }),
        async (pluginId, failuresBefore) => {
          const loader = createMockLoader();
          const sandbox = new PluginSandboxImpl(loader, createMockLogger());

          // Accumulate some failures (less than threshold)
          for (let i = 0; i < failuresBefore; i++) {
            await expect(
              sandbox.execute(pluginId, () => { throw new Error('fail'); }),
            ).rejects.toThrow();
          }
          expect(sandbox.getFailureCount(pluginId)).toBe(failuresBefore);

          // A success resets the count
          await sandbox.execute(pluginId, () => 'ok');
          expect(sandbox.getFailureCount(pluginId)).toBe(0);

          // Now we need PLUGIN_FAILURE_THRESHOLD fresh failures to trigger unload
          for (let i = 0; i < PLUGIN_FAILURE_THRESHOLD - 1; i++) {
            await expect(
              sandbox.execute(pluginId, () => { throw new Error('fail'); }),
            ).rejects.toThrow();
          }
          // Still below threshold — no unload
          expect(loader.unloadPlugin).not.toHaveBeenCalled();
        },
      ),
      { numRuns: 100 },
    );
  });
});
