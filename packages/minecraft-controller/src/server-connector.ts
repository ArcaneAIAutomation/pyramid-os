/**
 * ServerConnector — handles Minecraft server authentication and connection
 * Supports local (no auth), credentials (mojang), and Microsoft auth.
 * Uses Mineflayer's createBot() under the hood.
 */

import { createBot, type Bot } from 'mineflayer';
import { createLogger, type Logger } from '@pyramid-os/logger';
import {
  createPyramidError,
  type Connection,
  type ConnectionHealth,
  type ServerValidation,
  type ConnectionProfile,
} from '@pyramid-os/shared-types';

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

/** Network-level failure (host unreachable, DNS, timeout) */
export class ConnectionNetworkError extends Error {
  readonly code = 'NETWORK_ERROR' as const;
  readonly originalCause: Error | undefined;
  pyramidError?: import('@pyramid-os/shared-types').PyramidError;
  constructor(message: string, cause?: Error) {
    super(message);
    this.name = 'ConnectionNetworkError';
    this.originalCause = cause ?? undefined;
  }
}

/** Authentication failure (bad credentials, expired token) */
export class ConnectionAuthError extends Error {
  readonly code = 'AUTH_ERROR' as const;
  readonly originalCause: Error | undefined;
  pyramidError?: import('@pyramid-os/shared-types').PyramidError;
  constructor(message: string, cause?: Error) {
    super(message);
    this.name = 'ConnectionAuthError';
    this.originalCause = cause ?? undefined;
  }
}

/** Server rejected the connection (version mismatch, whitelist, etc.) */
export class ConnectionServerError extends Error {
  readonly code = 'SERVER_ERROR' as const;
  readonly originalCause: Error | undefined;
  pyramidError?: import('@pyramid-os/shared-types').PyramidError;
  constructor(message: string, cause?: Error) {
    super(message);
    this.name = 'ConnectionServerError';
    this.originalCause = cause ?? undefined;
  }
}

// ---------------------------------------------------------------------------
// Internal state per connection
// ---------------------------------------------------------------------------

interface ManagedConnection {
  connection: Connection;
  bot: Bot;
  disconnectCallbacks: Array<(reason: string) => void>;
  pingIntervalId: ReturnType<typeof setInterval> | null;
  health: ConnectionHealth;
}

// ---------------------------------------------------------------------------
// Supported Minecraft versions
// ---------------------------------------------------------------------------

const SUPPORTED_VERSIONS = ['1.20', '1.20.1', '1.20.2', '1.20.3', '1.20.4', '1.21', '1.21.1'];

// ---------------------------------------------------------------------------
// ServerConnector
// ---------------------------------------------------------------------------

let connectionCounter = 0;

export class ServerConnector {
  private readonly connections = new Map<string, ManagedConnection>();
  private readonly profiles: ConnectionProfile[];
  private readonly logger: Logger;

  constructor(profiles: ConnectionProfile[] = [], logger?: Logger) {
    this.profiles = profiles;
    this.logger = logger ?? createLogger({ level: 'info' });
  }

  // ---- public API ---------------------------------------------------------

  /** Connect to a local LAN world with no authentication. */
  async connectLocal(host: string, port: number): Promise<Connection> {
    const username = `PyramidBot_${++connectionCounter}`;
    this.logger.info('Connecting to local server', { host, port, username } as any);

    const bot = await this.createMineflayerBot({
      host,
      port,
      username,
      auth: 'offline',
    });

    return this.registerConnection(host, port, bot);
  }

  /** Connect with username / password (mojang auth). */
  async connectWithCredentials(
    host: string,
    port: number,
    username: string,
    password: string,
  ): Promise<Connection> {
    this.logger.info('Connecting with credentials', { host, port, username } as any);

    const bot = await this.createMineflayerBot({
      host,
      port,
      username,
      password,
      auth: 'mojang',
    });

    return this.registerConnection(host, port, bot);
  }

  /** Connect with a Microsoft account token. */
  async connectMicrosoft(host: string, port: number, msToken: string): Promise<Connection> {
    this.logger.info('Connecting with Microsoft auth', { host, port } as any);

    const bot = await this.createMineflayerBot({
      host,
      port,
      auth: 'microsoft',
      username: msToken, // mineflayer uses username field for the token in microsoft auth flow
    });

    return this.registerConnection(host, port, bot);
  }

  /** Validate server compatibility (version check). */
  async validateServer(connection: Connection): Promise<ServerValidation> {
    const managed = this.connections.get(connection.id);
    if (!managed) {
      return { compatible: false, serverVersion: 'unknown', issues: ['Connection not found'] };
    }

    const serverVersion: string =
      (managed.bot as any).version ?? (managed.bot.game as any)?.version ?? 'unknown';

    const issues: string[] = [];
    const compatible = SUPPORTED_VERSIONS.some((v) => serverVersion.startsWith(v));
    if (!compatible) {
      issues.push(
        `Server version ${serverVersion} is not in the supported list: ${SUPPORTED_VERSIONS.join(', ')}`,
      );
    }

    this.logger.info('Server validation result', {
      connectionId: connection.id,
      serverVersion,
      compatible,
    } as any);

    return { compatible, serverVersion, issues };
  }

  /** Register a callback that fires when the connection drops (within 10 s). */
  onDisconnect(connectionId: string, callback: (reason: string) => void): void {
    const managed = this.connections.get(connectionId);
    if (!managed) {
      throw new ConnectionNetworkError(`Connection ${connectionId} not found`);
    }
    managed.disconnectCallbacks.push(callback);
  }

  /** Return current health metrics for a connection. */
  getHealth(connectionId: string): ConnectionHealth {
    const managed = this.connections.get(connectionId);
    if (!managed) {
      return {
        connectionId,
        latencyMs: -1,
        packetLoss: 1,
        stable: false,
        lastCheckedAt: new Date().toISOString(),
      };
    }
    return { ...managed.health };
  }

  /** Get stored connection profiles. */
  getProfiles(): ConnectionProfile[] {
    return [...this.profiles];
  }

  /** Disconnect and clean up a connection. */
  async disconnect(connectionId: string): Promise<void> {
    const managed = this.connections.get(connectionId);
    if (!managed) return;

    if (managed.pingIntervalId) {
      clearInterval(managed.pingIntervalId);
    }
    try {
      managed.bot.quit();
    } catch {
      // already disconnected
    }
    managed.connection.status = 'disconnected';
    this.connections.delete(connectionId);
    this.logger.info('Disconnected', { connectionId } as any);
  }

  /** Disconnect all connections. */
  async disconnectAll(): Promise<void> {
    for (const id of [...this.connections.keys()]) {
      await this.disconnect(id);
    }
  }

  // ---- private helpers ----------------------------------------------------

  private createMineflayerBot(options: {
    host: string;
    port: number;
    username: string;
    password?: string;
    auth: 'offline' | 'mojang' | 'microsoft';
  }): Promise<Bot> {
    return new Promise<Bot>((resolve, reject) => {
      let settled = false;

      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(
            new ConnectionNetworkError(
              `Connection to ${options.host}:${options.port} timed out after 30 seconds`,
            ),
          );
        }
      }, 30_000);

      try {
        const botOptions: Record<string, unknown> = {
          host: options.host,
          port: options.port,
          username: options.username,
          auth: options.auth,
          hideErrors: true,
        };
        if (options.password !== undefined) {
          botOptions['password'] = options.password;
        }
        const bot = createBot(botOptions as any);

        bot.once('spawn', () => {
          if (!settled) {
            settled = true;
            clearTimeout(timeout);
            resolve(bot);
          }
        });

        bot.once('error', (err: Error) => {
          if (!settled) {
            settled = true;
            clearTimeout(timeout);
            reject(this.classifyError(err, options.host, options.port));
          }
        });

        bot.once('kicked', (reason: string) => {
          if (!settled) {
            settled = true;
            clearTimeout(timeout);
            reject(
              new ConnectionServerError(
                `Kicked from ${options.host}:${options.port}: ${reason}`,
              ),
            );
          }
        });
      } catch (err) {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          reject(
            this.classifyError(
              err instanceof Error ? err : new Error(String(err)),
              options.host,
              options.port,
            ),
          );
        }
      }
    });
  }

  private registerConnection(host: string, port: number, bot: Bot): Connection {
    const id = `conn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const connection: Connection = {
      id,
      host,
      port,
      connectedAt: new Date().toISOString(),
      status: 'connected',
    };

    const health: ConnectionHealth = {
      connectionId: id,
      latencyMs: 0,
      packetLoss: 0,
      stable: true,
      lastCheckedAt: new Date().toISOString(),
    };

    const managed: ManagedConnection = {
      connection,
      bot,
      disconnectCallbacks: [],
      pingIntervalId: null,
      health,
    };

    this.connections.set(id, managed);

    // Set up disconnect detection — fires within 10 seconds via the 'end' event
    bot.once('end', (reason: string) => {
      managed.connection.status = 'disconnected';
      managed.health.stable = false;
      managed.health.lastCheckedAt = new Date().toISOString();

      this.logger.warn('Bot disconnected', { connectionId: id, reason } as any);

      for (const cb of managed.disconnectCallbacks) {
        try {
          cb(reason ?? 'unknown');
        } catch {
          // swallow callback errors
        }
      }
    });

    // Periodic health ping every 5 seconds (well within the 10-second detection window)
    managed.pingIntervalId = setInterval(() => {
      this.updateHealth(managed);
    }, 5_000);

    this.logger.info('Connection established', { connectionId: id, host, port } as any);
    return connection;
  }

  private updateHealth(managed: ManagedConnection): void {
    const now = Date.now();
    const latency = (managed.bot as any).player?.ping ?? 0;
    managed.health.latencyMs = latency;
    managed.health.lastCheckedAt = new Date(now).toISOString();
    managed.health.stable = managed.connection.status === 'connected' && latency < 5000;
  }

  private classifyError(err: Error, host: string, port: number): Error {
    const msg = err.message.toLowerCase();

    if (
      msg.includes('econnrefused') ||
      msg.includes('enotfound') ||
      msg.includes('etimedout') ||
      msg.includes('enetunreach') ||
      msg.includes('ehostunreach') ||
      msg.includes('econnreset') ||
      msg.includes('socket')
    ) {
      const classified = new ConnectionNetworkError(
        `Network error connecting to ${host}:${port}: ${err.message}`,
        err,
      );
      classified.pyramidError = createPyramidError(
        'PYRAMID_CONNECTION_NETWORK',
        { host, port, originalMessage: err.message },
        err,
      );
      return classified;
    }

    if (
      msg.includes('auth') ||
      msg.includes('login') ||
      msg.includes('credentials') ||
      msg.includes('token') ||
      msg.includes('invalid session') ||
      msg.includes('password')
    ) {
      const classified = new ConnectionAuthError(
        `Authentication failed for ${host}:${port}: ${err.message}`,
        err,
      );
      classified.pyramidError = createPyramidError(
        'PYRAMID_CONNECTION_AUTH',
        { host, port, originalMessage: err.message },
        err,
      );
      return classified;
    }

    if (
      msg.includes('version') ||
      msg.includes('outdated') ||
      msg.includes('incompatible') ||
      msg.includes('kicked') ||
      msg.includes('banned') ||
      msg.includes('whitelist')
    ) {
      const classified = new ConnectionServerError(
        `Server rejected connection to ${host}:${port}: ${err.message}`,
        err,
      );
      classified.pyramidError = createPyramidError(
        'PYRAMID_CONNECTION_SERVER',
        { host, port, originalMessage: err.message },
        err,
      );
      return classified;
    }

    // Default to network error for unclassified issues
    const classified = new ConnectionNetworkError(
      `Failed to connect to ${host}:${port}: ${err.message}`,
      err,
    );
    classified.pyramidError = createPyramidError(
      'PYRAMID_CONNECTION_NETWORK',
      { host, port, originalMessage: err.message },
      err,
    );
    return classified;
  }
}
