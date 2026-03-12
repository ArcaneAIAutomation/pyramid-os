/**
 * Unit tests for PluginLoaderImpl
 *
 * Validates: Requirements 26.3, 26.4, 26.7
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  PluginLoaderImpl,
  PluginIncompatibleError,
  PluginManifestError,
  PluginLoadError,
  parseSemver,
  compareSemver,
} from '../plugin-loader.js';
import { PluginRegistryImpl } from '../plugin-registry.js';
import type { PluginManifest, Plugin, PluginContext } from '@pyramid-os/shared-types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createManifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    id: 'test-plugin',
    name: 'Test Plugin',
    version: '1.0.0',
    description: 'A test plugin',
    author: 'tester',
    minSystemVersion: '0.1.0',
    extensionPoints: [],
    entryModule: './test-plugin.js',
    ...overrides,
  };
}

function createPluginInstance(overrides: Partial<Plugin> = {}): Plugin {
  return {
    manifest: createManifest(),
    onLoad: vi.fn(async (_ctx: PluginContext) => {}),
    onUnload: vi.fn(async () => {}),
    healthCheck: vi.fn(async () => true),
    ...overrides,
  };
}

const SYSTEM_VERSION = '1.0.0';

// ---------------------------------------------------------------------------
// Semver helpers
// ---------------------------------------------------------------------------

describe('parseSemver', () => {
  it('parses valid semver strings', () => {
    expect(parseSemver('1.2.3')).toEqual([1, 2, 3]);
    expect(parseSemver('0.0.0')).toEqual([0, 0, 0]);
    expect(parseSemver('10.20.30')).toEqual([10, 20, 30]);
  });

  it('returns null for invalid semver strings', () => {
    expect(parseSemver('1.2')).toBeNull();
    expect(parseSemver('abc')).toBeNull();
    expect(parseSemver('1.2.3.4')).toBeNull();
    expect(parseSemver('')).toBeNull();
    expect(parseSemver('v1.0.0')).toBeNull();
    expect(parseSemver('1.0.0-beta')).toBeNull();
  });
});

describe('compareSemver', () => {
  it('returns 0 for equal versions', () => {
    expect(compareSemver('1.0.0', '1.0.0')).toBe(0);
  });

  it('compares major versions', () => {
    expect(compareSemver('2.0.0', '1.0.0')).toBeGreaterThan(0);
    expect(compareSemver('1.0.0', '2.0.0')).toBeLessThan(0);
  });

  it('compares minor versions', () => {
    expect(compareSemver('1.2.0', '1.1.0')).toBeGreaterThan(0);
    expect(compareSemver('1.1.0', '1.2.0')).toBeLessThan(0);
  });

  it('compares patch versions', () => {
    expect(compareSemver('1.0.2', '1.0.1')).toBeGreaterThan(0);
    expect(compareSemver('1.0.1', '1.0.2')).toBeLessThan(0);
  });

  it('throws for invalid semver', () => {
    expect(() => compareSemver('bad', '1.0.0')).toThrow('Invalid semver');
  });
});

// ---------------------------------------------------------------------------
// PluginLoaderImpl
// ---------------------------------------------------------------------------

describe('PluginLoaderImpl', () => {
  let registry: PluginRegistryImpl;
  let loader: PluginLoaderImpl;

  beforeEach(() => {
    registry = new PluginRegistryImpl();
    loader = new PluginLoaderImpl(registry, { systemVersion: SYSTEM_VERSION });
  });

  // -----------------------------------------------------------------------
  // Constructor
  // -----------------------------------------------------------------------
  describe('constructor', () => {
    it('accepts a valid system version', () => {
      expect(() => new PluginLoaderImpl(registry, { systemVersion: '1.0.0' })).not.toThrow();
    });

    it('rejects an invalid system version', () => {
      expect(() => new PluginLoaderImpl(registry, { systemVersion: 'bad' })).toThrow(
        'Invalid system version',
      );
    });
  });

  // -----------------------------------------------------------------------
  // validateManifest
  // -----------------------------------------------------------------------
  describe('validateManifest', () => {
    it('accepts a valid manifest', () => {
      expect(() => loader.validateManifest(createManifest())).not.toThrow();
    });

    it('rejects manifest missing id', () => {
      const manifest = createManifest({ id: '' });
      expect(() => loader.validateManifest(manifest)).toThrow(PluginManifestError);
      expect(() => loader.validateManifest(manifest)).toThrow('Missing or empty required field "id"');
    });

    it('rejects manifest missing name', () => {
      const manifest = createManifest({ name: '' });
      expect(() => loader.validateManifest(manifest)).toThrow(PluginManifestError);
    });

    it('rejects manifest missing version', () => {
      const manifest = createManifest({ version: '' });
      expect(() => loader.validateManifest(manifest)).toThrow(PluginManifestError);
    });

    it('rejects manifest missing entryModule', () => {
      const manifest = createManifest({ entryModule: '' });
      expect(() => loader.validateManifest(manifest)).toThrow(PluginManifestError);
    });

    it('rejects manifest missing minSystemVersion', () => {
      const manifest = createManifest({ minSystemVersion: '' });
      expect(() => loader.validateManifest(manifest)).toThrow(PluginManifestError);
    });

    it('rejects invalid semver in version field', () => {
      const manifest = createManifest({ version: 'not-semver' });
      expect(() => loader.validateManifest(manifest)).toThrow(PluginManifestError);
      expect(() => loader.validateManifest(manifest)).toThrow('Invalid semver version');
    });

    it('rejects invalid semver in minSystemVersion field', () => {
      const manifest = createManifest({ minSystemVersion: 'bad' });
      expect(() => loader.validateManifest(manifest)).toThrow(PluginManifestError);
      expect(() => loader.validateManifest(manifest)).toThrow('Invalid semver minSystemVersion');
    });

    it('rejects plugin requiring higher system version with PYRAMID_PLUGIN_INCOMPATIBLE', () => {
      const manifest = createManifest({ minSystemVersion: '2.0.0' });
      expect(() => loader.validateManifest(manifest)).toThrow(PluginIncompatibleError);
      try {
        loader.validateManifest(manifest);
      } catch (err) {
        expect((err as PluginIncompatibleError).code).toBe('PYRAMID_PLUGIN_INCOMPATIBLE');
        expect((err as PluginIncompatibleError).pluginMinVersion).toBe('2.0.0');
        expect((err as PluginIncompatibleError).systemVersion).toBe(SYSTEM_VERSION);
      }
    });

    it('accepts plugin requiring exact system version', () => {
      const manifest = createManifest({ minSystemVersion: '1.0.0' });
      expect(() => loader.validateManifest(manifest)).not.toThrow();
    });

    it('accepts plugin requiring lower system version', () => {
      const manifest = createManifest({ minSystemVersion: '0.5.0' });
      expect(() => loader.validateManifest(manifest)).not.toThrow();
    });
  });

  // -----------------------------------------------------------------------
  // loadPlugin
  // -----------------------------------------------------------------------
  describe('loadPlugin', () => {
    it('loads a valid plugin and registers it', async () => {
      const manifest = createManifest();
      const instance = createPluginInstance();

      await loader.loadPlugin(manifest, instance);

      expect(registry.has('test-plugin')).toBe(true);
      expect(loader.isLoaded('test-plugin')).toBe(true);
      expect(instance.onLoad).toHaveBeenCalledOnce();
    });

    it('provides a PluginContext to onLoad', async () => {
      const manifest = createManifest();
      let receivedContext: PluginContext | undefined;
      const instance = createPluginInstance({
        onLoad: vi.fn(async (ctx: PluginContext) => {
          receivedContext = ctx;
        }),
      });

      await loader.loadPlugin(manifest, instance);

      expect(receivedContext).toBeDefined();
      expect(receivedContext!.logger).toBeDefined();
      expect(typeof receivedContext!.registerAgentFactory).toBe('function');
      expect(typeof receivedContext!.registerTaskHandler).toBe('function');
      expect(typeof receivedContext!.registerEventHandler).toBe('function');
      expect(typeof receivedContext!.getSystemState).toBe('function');
    });

    it('rejects invalid manifest before calling onLoad', async () => {
      const manifest = createManifest({ version: 'bad' });
      const instance = createPluginInstance();

      await expect(loader.loadPlugin(manifest, instance)).rejects.toThrow(PluginManifestError);
      expect(instance.onLoad).not.toHaveBeenCalled();
      expect(registry.has('test-plugin')).toBe(false);
    });

    it('rejects incompatible plugin with PYRAMID_PLUGIN_INCOMPATIBLE', async () => {
      const manifest = createManifest({ minSystemVersion: '99.0.0' });
      const instance = createPluginInstance();

      await expect(loader.loadPlugin(manifest, instance)).rejects.toThrow(
        PluginIncompatibleError,
      );
      expect(registry.has('test-plugin')).toBe(false);
    });

    it('wraps onLoad errors in PluginLoadError', async () => {
      const manifest = createManifest();
      const instance = createPluginInstance({
        onLoad: vi.fn(async () => {
          throw new Error('init failed');
        }),
      });

      await expect(loader.loadPlugin(manifest, instance)).rejects.toThrow(PluginLoadError);
      expect(registry.has('test-plugin')).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // unloadPlugin
  // -----------------------------------------------------------------------
  describe('unloadPlugin', () => {
    it('unloads a loaded plugin', async () => {
      const manifest = createManifest();
      const instance = createPluginInstance();
      await loader.loadPlugin(manifest, instance);

      await loader.unloadPlugin('test-plugin');

      expect(registry.has('test-plugin')).toBe(false);
      expect(loader.isLoaded('test-plugin')).toBe(false);
      expect(instance.onUnload).toHaveBeenCalledOnce();
    });

    it('throws when unloading a plugin that is not loaded', async () => {
      await expect(loader.unloadPlugin('nonexistent')).rejects.toThrow(
        'Plugin "nonexistent" is not loaded',
      );
    });

    it('still deregisters even if onUnload throws', async () => {
      const manifest = createManifest();
      const instance = createPluginInstance({
        onUnload: vi.fn(async () => {
          throw new Error('cleanup failed');
        }),
      });
      await loader.loadPlugin(manifest, instance);

      // Should not throw — error is logged but swallowed
      await loader.unloadPlugin('test-plugin');

      expect(registry.has('test-plugin')).toBe(false);
      expect(loader.isLoaded('test-plugin')).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // hotReload
  // -----------------------------------------------------------------------
  describe('hotReload', () => {
    it('unloads old version and loads new version', async () => {
      const manifestV1 = createManifest({ version: '1.0.0' });
      const instanceV1 = createPluginInstance();
      await loader.loadPlugin(manifestV1, instanceV1);

      const manifestV2 = createManifest({ version: '2.0.0' });
      const instanceV2 = createPluginInstance();
      await loader.hotReload(manifestV2, instanceV2);

      expect(instanceV1.onUnload).toHaveBeenCalledOnce();
      expect(instanceV2.onLoad).toHaveBeenCalledOnce();
      expect(registry.has('test-plugin')).toBe(true);
      const entry = registry.get('test-plugin');
      expect(entry!.manifest.version).toBe('2.0.0');
    });

    it('loads fresh if no previous version exists', async () => {
      const manifest = createManifest();
      const instance = createPluginInstance();

      await loader.hotReload(manifest, instance);

      expect(registry.has('test-plugin')).toBe(true);
      expect(instance.onLoad).toHaveBeenCalledOnce();
    });

    it('rejects incompatible new version without affecting old', async () => {
      const manifestV1 = createManifest({ version: '1.0.0' });
      const instanceV1 = createPluginInstance();
      await loader.loadPlugin(manifestV1, instanceV1);

      const manifestV2 = createManifest({ version: '2.0.0', minSystemVersion: '99.0.0' });
      const instanceV2 = createPluginInstance();

      // Hot-reload unloads old first, then tries to load new — which fails
      await expect(loader.hotReload(manifestV2, instanceV2)).rejects.toThrow(
        PluginIncompatibleError,
      );

      // Old plugin was unloaded, new one failed to load
      expect(registry.has('test-plugin')).toBe(false);
      expect(loader.isLoaded('test-plugin')).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // isLoaded
  // -----------------------------------------------------------------------
  describe('isLoaded', () => {
    it('returns false for unknown plugin', () => {
      expect(loader.isLoaded('nope')).toBe(false);
    });

    it('returns true after loading', async () => {
      await loader.loadPlugin(createManifest(), createPluginInstance());
      expect(loader.isLoaded('test-plugin')).toBe(true);
    });

    it('returns false after unloading', async () => {
      await loader.loadPlugin(createManifest(), createPluginInstance());
      await loader.unloadPlugin('test-plugin');
      expect(loader.isLoaded('test-plugin')).toBe(false);
    });
  });
});
