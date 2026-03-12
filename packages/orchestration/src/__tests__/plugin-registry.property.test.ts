/**
 * Property-based test for plugin registry consistency.
 *
 * **Property 9: Plugin registry consistency**
 * For any plugin that is loaded and registered, the registry should list it.
 * For any plugin that is unloaded, the registry should not list it.
 * The registry count should always equal the number of successfully loaded plugins.
 *
 * **Validates: Requirements 26.10**
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { PluginRegistryImpl } from '../plugin-registry.js';
import type { PluginManifest, Plugin, PluginContext } from '@pyramid-os/shared-types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createManifest(id: string): PluginManifest {
  return {
    id,
    name: `Plugin ${id}`,
    version: '1.0.0',
    description: `Test plugin ${id}`,
    author: 'tester',
    minSystemVersion: '0.1.0',
    extensionPoints: [],
    entryModule: `./${id}.js`,
  };
}

function createPluginInstance(manifest: PluginManifest): Plugin {
  return {
    manifest,
    onLoad: async (_ctx: PluginContext) => {},
    onUnload: async () => {},
    healthCheck: async () => true,
  };
}

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/** Small pool of plugin IDs so register/deregister operations overlap */
const pluginIdArb = fc.constantFrom(
  'alpha', 'beta', 'gamma', 'delta', 'epsilon',
  'zeta', 'eta', 'theta', 'iota', 'kappa',
);

/** A single operation: register or deregister a plugin */
type Op =
  | { kind: 'register'; pluginId: string }
  | { kind: 'deregister'; pluginId: string };

const opArb: fc.Arbitrary<Op> = fc.oneof(
  fc.record({ kind: fc.constant('register' as const), pluginId: pluginIdArb }),
  fc.record({ kind: fc.constant('deregister' as const), pluginId: pluginIdArb }),
);

const opsArb = fc.array(opArb, { minLength: 1, maxLength: 80 });

// ─── Property test ───────────────────────────────────────────────────────────

describe('Plugin registry consistency (property)', () => {
  it('registry count always matches loaded plugins after random register/deregister sequences', () => {
    fc.assert(
      fc.property(opsArb, (ops) => {
        const registry = new PluginRegistryImpl();

        // Reference model: set of currently registered plugin IDs
        const model = new Set<string>();
        // Track deregistered IDs for negative checks
        const deregistered = new Set<string>();

        for (const op of ops) {
          if (op.kind === 'register') {
            if (model.has(op.pluginId)) {
              // Already registered — should throw
              const manifest = createManifest(op.pluginId);
              expect(() =>
                registry.register(manifest, createPluginInstance(manifest)),
              ).toThrow();
            } else {
              const manifest = createManifest(op.pluginId);
              registry.register(manifest, createPluginInstance(manifest));
              model.add(op.pluginId);
              deregistered.delete(op.pluginId);
            }
          } else {
            // deregister
            const result = registry.deregister(op.pluginId);
            if (model.has(op.pluginId)) {
              expect(result).toBe(true);
              model.delete(op.pluginId);
              deregistered.add(op.pluginId);
            } else {
              expect(result).toBe(false);
            }
          }

          // ── Invariant 1: list().length matches reference model size ──
          expect(registry.list().length).toBe(model.size);

          // ── Invariant 2: has() returns true for all registered IDs ──
          for (const id of model) {
            expect(registry.has(id)).toBe(true);
          }

          // ── Invariant 3: has() returns false for deregistered IDs ──
          for (const id of deregistered) {
            expect(registry.has(id)).toBe(false);
          }

          // ── Invariant 4: get() returns defined/undefined correctly ──
          for (const id of model) {
            expect(registry.get(id)).toBeDefined();
          }
          for (const id of deregistered) {
            expect(registry.get(id)).toBeUndefined();
          }
        }
      }),
      { numRuns: 200 },
    );
  });
});
