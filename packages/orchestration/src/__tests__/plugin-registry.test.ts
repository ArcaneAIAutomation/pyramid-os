/**
 * Unit tests for PluginRegistryImpl
 *
 * Validates: Requirements 26.3, 26.10
 */

import { describe, it, expect, beforeEach } from 'vitest';
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

function createPluginInstance(manifest?: PluginManifest): Plugin {
  const m = manifest ?? createManifest();
  return {
    manifest: m,
    onLoad: async (_ctx: PluginContext) => {},
    onUnload: async () => {},
    healthCheck: async () => true,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PluginRegistryImpl', () => {
  let registry: PluginRegistryImpl;

  beforeEach(() => {
    registry = new PluginRegistryImpl();
  });

  // -----------------------------------------------------------------------
  // register
  // -----------------------------------------------------------------------
  describe('register', () => {
    it('stores a plugin with loaded status', () => {
      const manifest = createManifest();
      const instance = createPluginInstance(manifest);

      registry.register(manifest, instance);

      const entry = registry.get('test-plugin');
      expect(entry).toBeDefined();
      expect(entry!.manifest).toBe(manifest);
      expect(entry!.instance).toBe(instance);
      expect(entry!.status).toBe('loaded');
      expect(entry!.loadedAt).toBeInstanceOf(Date);
    });

    it('throws when registering a duplicate plugin ID', () => {
      const manifest = createManifest();
      registry.register(manifest, createPluginInstance(manifest));

      expect(() => registry.register(manifest, createPluginInstance(manifest))).toThrow(
        'Plugin "test-plugin" is already registered',
      );
    });

    it('allows registering plugins with different IDs', () => {
      const m1 = createManifest({ id: 'plugin-a' });
      const m2 = createManifest({ id: 'plugin-b' });

      registry.register(m1, createPluginInstance(m1));
      registry.register(m2, createPluginInstance(m2));

      expect(registry.has('plugin-a')).toBe(true);
      expect(registry.has('plugin-b')).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // deregister
  // -----------------------------------------------------------------------
  describe('deregister', () => {
    it('removes a registered plugin and returns true', () => {
      const manifest = createManifest();
      registry.register(manifest, createPluginInstance(manifest));

      expect(registry.deregister('test-plugin')).toBe(true);
      expect(registry.has('test-plugin')).toBe(false);
    });

    it('returns false for an unknown plugin ID', () => {
      expect(registry.deregister('nonexistent')).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // list
  // -----------------------------------------------------------------------
  describe('list', () => {
    it('returns empty array when no plugins registered', () => {
      expect(registry.list()).toEqual([]);
    });

    it('returns all registered plugins', () => {
      const m1 = createManifest({ id: 'a' });
      const m2 = createManifest({ id: 'b' });
      registry.register(m1, createPluginInstance(m1));
      registry.register(m2, createPluginInstance(m2));

      const entries = registry.list();
      expect(entries).toHaveLength(2);
      const ids = entries.map((e) => e.manifest.id).sort();
      expect(ids).toEqual(['a', 'b']);
    });
  });

  // -----------------------------------------------------------------------
  // get
  // -----------------------------------------------------------------------
  describe('get', () => {
    it('returns undefined for unknown plugin', () => {
      expect(registry.get('nope')).toBeUndefined();
    });

    it('returns the correct entry for a known plugin', () => {
      const manifest = createManifest({ id: 'my-plugin' });
      registry.register(manifest, createPluginInstance(manifest));

      const entry = registry.get('my-plugin');
      expect(entry).toBeDefined();
      expect(entry!.manifest.id).toBe('my-plugin');
    });
  });

  // -----------------------------------------------------------------------
  // findByExtensionPoint
  // -----------------------------------------------------------------------
  describe('findByExtensionPoint', () => {
    it('returns empty array when no plugins match', () => {
      const manifest = createManifest({
        extensionPoints: [{ type: 'task-handler', taskType: 'custom-task' }],
      });
      registry.register(manifest, createPluginInstance(manifest));

      expect(registry.findByExtensionPoint('agent-factory')).toEqual([]);
    });

    it('returns plugins matching the extension point type', () => {
      const m1 = createManifest({
        id: 'agent-plugin',
        extensionPoints: [{ type: 'agent-factory', role: 'scout', tier: 'worker' }],
      });
      const m2 = createManifest({
        id: 'task-plugin',
        extensionPoints: [{ type: 'task-handler', taskType: 'patrol' }],
      });
      const m3 = createManifest({
        id: 'multi-plugin',
        extensionPoints: [
          { type: 'agent-factory', role: 'spy', tier: 'operational' },
          { type: 'event-handler', events: ['task:completed'] },
        ],
      });

      registry.register(m1, createPluginInstance(m1));
      registry.register(m2, createPluginInstance(m2));
      registry.register(m3, createPluginInstance(m3));

      const agentFactories = registry.findByExtensionPoint('agent-factory');
      expect(agentFactories).toHaveLength(2);
      const ids = agentFactories.map((e) => e.manifest.id).sort();
      expect(ids).toEqual(['agent-plugin', 'multi-plugin']);
    });

    it('returns empty array when registry is empty', () => {
      expect(registry.findByExtensionPoint('custom')).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // has
  // -----------------------------------------------------------------------
  describe('has', () => {
    it('returns false for unregistered plugin', () => {
      expect(registry.has('ghost')).toBe(false);
    });

    it('returns true for registered plugin', () => {
      const manifest = createManifest();
      registry.register(manifest, createPluginInstance(manifest));
      expect(registry.has('test-plugin')).toBe(true);
    });

    it('returns false after deregistration', () => {
      const manifest = createManifest();
      registry.register(manifest, createPluginInstance(manifest));
      registry.deregister('test-plugin');
      expect(registry.has('test-plugin')).toBe(false);
    });
  });
});
