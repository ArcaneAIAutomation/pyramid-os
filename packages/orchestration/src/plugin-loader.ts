/**
 * Plugin Loader for PYRAMID OS
 *
 * Handles plugin manifest validation, loading, unloading, and hot-reload.
 * Validates semver compatibility and required manifest fields before
 * allowing a plugin into the system.
 *
 * @see Requirement 26.3, 26.4, 26.7
 */

import type {
  PluginManifest,
  Plugin,
  PluginContext,
  PluginLogger,
  SystemState,
  AgentFactory,
  TaskHandler,
  EventHandler,
  SystemEvent,
} from '@pyramid-os/shared-types';
import type { PluginRegistryImpl } from './plugin-registry.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SEMVER_REGEX = /^\d+\.\d+\.\d+$/;

const REQUIRED_MANIFEST_FIELDS: (keyof PluginManifest)[] = [
  'id',
  'name',
  'version',
  'minSystemVersion',
  'entryModule',
];

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

/** Error thrown when a plugin is incompatible with the current system version */
export class PluginIncompatibleError extends Error {
  readonly code = 'PYRAMID_PLUGIN_INCOMPATIBLE';

  constructor(
    public readonly pluginId: string,
    public readonly pluginMinVersion: string,
    public readonly systemVersion: string,
  ) {
    super(
      `Plugin "${pluginId}" requires system version >=${pluginMinVersion}, ` +
        `but current system version is ${systemVersion}`,
    );
    this.name = 'PluginIncompatibleError';
  }
}

/** Error thrown when a plugin manifest is invalid */
export class PluginManifestError extends Error {
  readonly code = 'PYRAMID_PLUGIN_MANIFEST_INVALID';

  constructor(message: string) {
    super(message);
    this.name = 'PluginManifestError';
  }
}

/** Error thrown when a plugin load operation fails */
export class PluginLoadError extends Error {
  readonly code = 'PYRAMID_PLUGIN_LOAD_FAILED';

  constructor(
    public readonly pluginId: string,
    cause?: Error,
  ) {
    super(`Failed to load plugin "${pluginId}": ${cause?.message ?? 'unknown error'}`);
    this.name = 'PluginLoadError';
    if (cause) this.cause = cause;
  }
}

// ---------------------------------------------------------------------------
// Semver helpers
// ---------------------------------------------------------------------------

/** Parse a semver string into [major, minor, patch]. Returns null if invalid. */
export function parseSemver(version: string): [number, number, number] | null {
  if (!SEMVER_REGEX.test(version)) return null;
  const parts = version.split('.').map(Number);
  return parts as [number, number, number];
}

/**
 * Compare two semver strings numerically.
 * Returns negative if a < b, 0 if equal, positive if a > b.
 */
export function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) throw new Error(`Invalid semver: ${!pa ? a : b}`);

  if (pa[0] !== pb[0]) return pa[0] - pb[0];
  if (pa[1] !== pb[1]) return pa[1] - pb[1];
  if (pa[2] !== pb[2]) return pa[2] - pb[2];
  return 0;
}

// ---------------------------------------------------------------------------
// PluginLoader
// ---------------------------------------------------------------------------

export interface PluginLoaderConfig {
  /** Current PYRAMID OS system version */
  systemVersion: string;
  /** Optional logger for plugin-loader-level messages */
  logger?: PluginLogger;
}

export class PluginLoaderImpl {
  private readonly systemVersion: string;
  private readonly registry: PluginRegistryImpl;
  private readonly logger: PluginLogger;
  /** Track plugin instances for unload / hot-reload */
  private readonly instances = new Map<string, Plugin>();

  constructor(registry: PluginRegistryImpl, config: PluginLoaderConfig) {
    const sv = parseSemver(config.systemVersion);
    if (!sv) {
      throw new Error(`Invalid system version: ${config.systemVersion}`);
    }
    this.systemVersion = config.systemVersion;
    this.registry = registry;
    this.logger = config.logger ?? createNoopLogger();
  }

  // -----------------------------------------------------------------------
  // Manifest validation
  // -----------------------------------------------------------------------

  /**
   * Validate a plugin manifest.
   * Throws `PluginManifestError` for structural issues or
   * `PluginIncompatibleError` for version mismatches.
   */
  validateManifest(manifest: PluginManifest): void {
    // Check required fields are present and non-empty strings
    for (const field of REQUIRED_MANIFEST_FIELDS) {
      const value = manifest[field];
      if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
        throw new PluginManifestError(
          `Missing or empty required field "${field}" in plugin manifest`,
        );
      }
    }

    // Validate version is valid semver
    if (!parseSemver(manifest.version)) {
      throw new PluginManifestError(
        `Invalid semver version "${manifest.version}" in plugin "${manifest.id}"`,
      );
    }

    // Validate minSystemVersion is valid semver
    if (!parseSemver(manifest.minSystemVersion)) {
      throw new PluginManifestError(
        `Invalid semver minSystemVersion "${manifest.minSystemVersion}" in plugin "${manifest.id}"`,
      );
    }

    // Check system version compatibility
    if (compareSemver(this.systemVersion, manifest.minSystemVersion) < 0) {
      throw new PluginIncompatibleError(
        manifest.id,
        manifest.minSystemVersion,
        this.systemVersion,
      );
    }
  }

  // -----------------------------------------------------------------------
  // Load
  // -----------------------------------------------------------------------

  /**
   * Load a plugin: validate its manifest, create a sandbox context,
   * call `onLoad`, and register in the registry.
   */
  async loadPlugin(manifest: PluginManifest, pluginInstance: Plugin): Promise<void> {
    this.validateManifest(manifest);

    const context = this.createPluginContext(manifest);

    try {
      await pluginInstance.onLoad(context);
    } catch (err) {
      throw new PluginLoadError(manifest.id, err instanceof Error ? err : new Error(String(err)));
    }

    this.registry.register(manifest, pluginInstance);
    this.instances.set(manifest.id, pluginInstance);

    this.logger.info(`Plugin "${manifest.id}" v${manifest.version} loaded`, {
      pluginId: manifest.id,
    });
  }

  // -----------------------------------------------------------------------
  // Unload
  // -----------------------------------------------------------------------

  /**
   * Unload a plugin: call `onUnload`, then deregister from the registry.
   */
  async unloadPlugin(pluginId: string): Promise<void> {
    const instance = this.instances.get(pluginId);
    if (!instance) {
      throw new Error(`Plugin "${pluginId}" is not loaded`);
    }

    try {
      await instance.onUnload();
    } catch (err) {
      this.logger.warn(`Error during onUnload for plugin "${pluginId}"`, {
        error: String(err),
      });
    }

    this.registry.deregister(pluginId);
    this.instances.delete(pluginId);

    this.logger.info(`Plugin "${pluginId}" unloaded`, { pluginId });
  }

  // -----------------------------------------------------------------------
  // Hot-reload
  // -----------------------------------------------------------------------

  /**
   * Hot-reload a plugin: unload the old version, validate the new manifest,
   * then load the new version.
   */
  async hotReload(manifest: PluginManifest, pluginInstance: Plugin): Promise<void> {
    const pluginId = manifest.id;

    // Unload old version if present
    if (this.instances.has(pluginId)) {
      await this.unloadPlugin(pluginId);
    }

    // Validate and load new version
    await this.loadPlugin(manifest, pluginInstance);

    this.logger.info(`Plugin "${pluginId}" hot-reloaded to v${manifest.version}`, {
      pluginId,
    });
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  /** Check whether a plugin is currently loaded */
  isLoaded(pluginId: string): boolean {
    return this.instances.has(pluginId);
  }

  /** Create a sandboxed PluginContext for a plugin */
  private createPluginContext(manifest: PluginManifest): PluginContext {
    const pluginId = manifest.id;
    const logger = this.createScopedLogger(pluginId);

    return {
      logger,
      config: {},
      registerAgentFactory: (_role: string, _factory: AgentFactory) => {
        logger.debug(`Registered agent factory for role`, { pluginId });
      },
      registerTaskHandler: (_taskType: string, _handler: TaskHandler) => {
        logger.debug(`Registered task handler`, { pluginId });
      },
      registerEventHandler: (_event: SystemEvent, _handler: EventHandler) => {
        logger.debug(`Registered event handler`, { pluginId });
      },
      getSystemState: (): Readonly<SystemState> => {
        return Object.freeze({
          operatingMode: 'structured',
          agents: [],
          activeTasks: 0,
          connectedBots: 0,
          uptime: 0,
        }) as unknown as Readonly<SystemState>;
      },
    };
  }

  /** Create a logger scoped to a specific plugin */
  private createScopedLogger(pluginId: string): PluginLogger {
    const parent = this.logger;
    const addScope = (ctx?: Record<string, unknown>) => ({
      ...ctx,
      pluginId,
    });
    return {
      debug: (msg, ctx) => parent.debug(msg, addScope(ctx)),
      info: (msg, ctx) => parent.info(msg, addScope(ctx)),
      warn: (msg, ctx) => parent.warn(msg, addScope(ctx)),
      error: (msg, err, ctx) => parent.error(msg, err, addScope(ctx)),
    };
  }
}

// ---------------------------------------------------------------------------
// Noop logger
// ---------------------------------------------------------------------------

function createNoopLogger(): PluginLogger {
  return {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  };
}
