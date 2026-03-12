/**
 * Property-based test for plugin validation.
 *
 * **Property 10: Plugin validation rejects incompatible plugins**
 * For any plugin manifest where `minSystemVersion` is greater than the current
 * system version, loading should fail with a `PYRAMID_PLUGIN_INCOMPATIBLE` error
 * and the plugin should not appear in the registry. Conversely, when
 * `minSystemVersion <= systemVersion`, validation should NOT throw
 * `PluginIncompatibleError`.
 *
 * **Validates: Requirements 26.7**
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  PluginLoaderImpl,
  PluginIncompatibleError,
  compareSemver,
} from '../plugin-loader.js';
import { PluginRegistryImpl } from '../plugin-registry.js';
import type { PluginManifest, Plugin, PluginContext } from '@pyramid-os/shared-types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createValidManifest(minSystemVersion: string): PluginManifest {
  return {
    id: 'test-plugin',
    name: 'Test Plugin',
    version: '1.0.0',
    description: 'A test plugin',
    author: 'tester',
    minSystemVersion,
    extensionPoints: [],
    entryModule: './test-plugin.js',
  };
}

function createPluginInstance(): Plugin {
  return {
    manifest: createValidManifest('0.1.0'),
    onLoad: async (_ctx: PluginContext) => {},
    onUnload: async () => {},
    healthCheck: async () => true,
  };
}

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/** Generate a semver component (0–99 to keep versions realistic) */
const semverPartArb = fc.integer({ min: 0, max: 99 });

/** Generate a valid semver string like "1.2.3" */
const semverArb = fc
  .tuple(semverPartArb, semverPartArb, semverPartArb)
  .map(([major, minor, patch]) => `${major}.${minor}.${patch}`);

// ─── Property test ───────────────────────────────────────────────────────────

describe('Plugin validation rejects incompatible plugins (property)', () => {
  it('rejects manifests where minSystemVersion > systemVersion with PluginIncompatibleError', () => {
    fc.assert(
      fc.property(semverArb, semverArb, (systemVersion, minSystemVersion) => {
        const registry = new PluginRegistryImpl();
        const loader = new PluginLoaderImpl(registry, { systemVersion });
        const manifest = createValidManifest(minSystemVersion);

        const cmp = compareSemver(minSystemVersion, systemVersion);

        if (cmp > 0) {
          // minSystemVersion > systemVersion → must throw PluginIncompatibleError
          try {
            loader.validateManifest(manifest);
            // Should not reach here
            return false;
          } catch (err) {
            expect(err).toBeInstanceOf(PluginIncompatibleError);
            const incompatErr = err as PluginIncompatibleError;
            expect(incompatErr.code).toBe('PYRAMID_PLUGIN_INCOMPATIBLE');
            expect(incompatErr.pluginMinVersion).toBe(minSystemVersion);
            expect(incompatErr.systemVersion).toBe(systemVersion);
          }
        } else {
          // minSystemVersion <= systemVersion → must NOT throw PluginIncompatibleError
          try {
            loader.validateManifest(manifest);
          } catch (err) {
            // If it throws, it must NOT be PluginIncompatibleError
            expect(err).not.toBeInstanceOf(PluginIncompatibleError);
          }
        }
      }),
      { numRuns: 500 },
    );
  });

  it('incompatible plugins are not registered after failed loadPlugin', async () => {
    await fc.assert(
      fc.asyncProperty(semverArb, semverArb, async (systemVersion, minSystemVersion) => {
        const registry = new PluginRegistryImpl();
        const loader = new PluginLoaderImpl(registry, { systemVersion });
        const manifest = createValidManifest(minSystemVersion);
        manifest.id = `plugin-${systemVersion}-${minSystemVersion}`;
        const instance = createPluginInstance();

        const cmp = compareSemver(minSystemVersion, systemVersion);

        if (cmp > 0) {
          // Incompatible — loadPlugin must reject and plugin must NOT be in registry
          await expect(loader.loadPlugin(manifest, instance)).rejects.toThrow(
            PluginIncompatibleError,
          );
          expect(registry.has(manifest.id)).toBe(false);
          expect(loader.isLoaded(manifest.id)).toBe(false);
        } else {
          // Compatible — loadPlugin should succeed and plugin should be in registry
          await loader.loadPlugin(manifest, instance);
          expect(registry.has(manifest.id)).toBe(true);
          expect(loader.isLoaded(manifest.id)).toBe(true);
        }
      }),
      { numRuns: 200 },
    );
  });
});
