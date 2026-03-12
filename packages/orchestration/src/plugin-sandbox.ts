/**
 * Plugin Sandbox for PYRAMID OS
 *
 * Wraps plugin execution in try/catch boundaries to isolate failures.
 * Tracks consecutive failure counts per plugin and auto-unloads plugins
 * that exceed the failure threshold.
 *
 * @see Requirement 26.8, 26.9
 */

import type { PluginLogger } from '@pyramid-os/shared-types';
import type { PluginLoaderImpl } from './plugin-loader.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Number of consecutive failures before a plugin is automatically unloaded */
export const PLUGIN_FAILURE_THRESHOLD = 3;

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class PluginSandboxImpl {
  private readonly loader: PluginLoaderImpl;
  private readonly logger: PluginLogger;
  /** Consecutive failure count per plugin */
  private readonly failureCounts = new Map<string, number>();

  constructor(loader: PluginLoaderImpl, logger?: PluginLogger) {
    this.loader = loader;
    this.logger = logger ?? createNoopLogger();
  }

  /**
   * Execute a plugin handler with error isolation.
   * On success the failure counter is reset.
   * On failure the counter is incremented and, if the threshold is reached,
   * the plugin is automatically unloaded via the loader.
   */
  async execute<T>(pluginId: string, fn: () => T | Promise<T>): Promise<T> {
    try {
      const result = await fn();
      this.resetFailureCount(pluginId);
      return result;
    } catch (err) {
      const count = this.incrementFailureCount(pluginId);

      this.logger.error(
        `Plugin "${pluginId}" execution failed (consecutive failures: ${count})`,
        err instanceof Error ? err : new Error(String(err)),
        {
          pluginId,
          consecutiveFailures: count,
        },
      );

      if (count >= PLUGIN_FAILURE_THRESHOLD) {
        this.logger.warn(
          `Plugin "${pluginId}" reached failure threshold (${PLUGIN_FAILURE_THRESHOLD}), auto-unloading`,
          { pluginId },
        );
        try {
          await this.loader.unloadPlugin(pluginId);
        } catch (unloadErr) {
          this.logger.error(
            `Failed to auto-unload plugin "${pluginId}"`,
            unloadErr instanceof Error ? unloadErr : new Error(String(unloadErr)),
            { pluginId },
          );
        }
      }

      throw err;
    }
  }

  /** Get the current consecutive failure count for a plugin */
  getFailureCount(pluginId: string): number {
    return this.failureCounts.get(pluginId) ?? 0;
  }

  /** Manually reset the consecutive failure count for a plugin */
  resetFailureCount(pluginId: string): void {
    this.failureCounts.delete(pluginId);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private incrementFailureCount(pluginId: string): number {
    const current = this.failureCounts.get(pluginId) ?? 0;
    const next = current + 1;
    this.failureCounts.set(pluginId, next);
    return next;
  }
}

// ---------------------------------------------------------------------------
// Noop logger fallback
// ---------------------------------------------------------------------------

function createNoopLogger(): PluginLogger {
  const noop = () => {};
  return { debug: noop, info: noop, warn: noop, error: noop };
}
