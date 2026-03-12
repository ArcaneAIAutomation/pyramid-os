/**
 * Plugin Registry for PYRAMID OS
 *
 * Manages registration and discovery of loaded plugins.
 * Provides lookup by ID and by extension point type.
 *
 * @see Requirement 26.3, 26.10
 */

import type {
  PluginManifest,
  Plugin,
  PluginStatus,
  ExtensionPoint,
} from '@pyramid-os/shared-types';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Snapshot of a registered plugin's state */
export interface PluginInfo {
  manifest: PluginManifest;
  instance: Plugin;
  status: PluginStatus;
  loadedAt: Date;
  error?: string;
}

/** Read-only view returned by list / get / find */
export type PluginEntry = Readonly<PluginInfo>;

// ---------------------------------------------------------------------------
// PluginRegistry
// ---------------------------------------------------------------------------

export class PluginRegistryImpl {
  private readonly plugins = new Map<string, PluginInfo>();

  /**
   * Register a loaded plugin.
   * Throws if a plugin with the same ID is already registered.
   */
  register(manifest: PluginManifest, instance: Plugin): void {
    if (this.plugins.has(manifest.id)) {
      throw new Error(
        `Plugin "${manifest.id}" is already registered`,
      );
    }

    this.plugins.set(manifest.id, {
      manifest,
      instance,
      status: 'loaded',
      loadedAt: new Date(),
    });
  }

  /**
   * Remove a plugin from the registry.
   * Returns `true` if the plugin was found and removed, `false` otherwise.
   */
  deregister(pluginId: string): boolean {
    return this.plugins.delete(pluginId);
  }

  /** Return all registered plugin entries. */
  list(): PluginEntry[] {
    return [...this.plugins.values()];
  }

  /** Return a specific plugin entry, or `undefined` if not found. */
  get(pluginId: string): PluginEntry | undefined {
    return this.plugins.get(pluginId);
  }

  /**
   * Return all plugins that declare at least one extension point
   * matching the given type.
   */
  findByExtensionPoint(type: ExtensionPoint['type']): PluginEntry[] {
    const results: PluginEntry[] = [];
    for (const info of this.plugins.values()) {
      if (info.manifest.extensionPoints.some((ep) => ep.type === type)) {
        results.push(info);
      }
    }
    return results;
  }

  /** Check whether a plugin with the given ID is registered. */
  has(pluginId: string): boolean {
    return this.plugins.has(pluginId);
  }
}
