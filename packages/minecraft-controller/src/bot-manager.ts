/**
 * BotManager — manages bot lifecycle, registry, reconnection, rate limiting, and status.
 *
 * Requirements: 2.1, 2.4, 2.5, 2.7, 2.9, 2.10, 31.5
 */

import { createLogger, type Logger } from '@pyramid-os/logger';
import type {
  BotInstance,
  BotStatus,
  InventoryItem,
  ConnectionProfile,
  Vec3,
} from '@pyramid-os/shared-types';
import type { WorkerRole } from '@pyramid-os/shared-types';
import { ServerConnector } from './server-connector.js';

// ---------------------------------------------------------------------------
// BotRateLimiter — token bucket: 10 actions/sec per bot (req 2.9, 31.5)
// ---------------------------------------------------------------------------

export class BotRateLimiter {
  private readonly maxTokens: number;
  private readonly refillRate: number; // tokens per second
  private readonly buckets = new Map<string, { tokens: number; lastRefill: number }>();

  constructor(maxTokens = 10, refillRate = 10) {
    this.maxTokens = maxTokens;
    this.refillRate = refillRate;
  }

  /** Returns true if the action is allowed (consumes one token). */
  tryConsume(botId: string): boolean {
    this.refill(botId);
    const bucket = this.buckets.get(botId)!;
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return true;
    }
    return false;
  }

  /** Reset the bucket for a bot (e.g. on disconnect). */
  reset(botId: string): void {
    this.buckets.delete(botId);
  }

  private refill(botId: string): void {
    const now = Date.now();
    let bucket = this.buckets.get(botId);
    if (!bucket) {
      bucket = { tokens: this.maxTokens, lastRefill: now };
      this.buckets.set(botId, bucket);
      return;
    }
    const elapsed = (now - bucket.lastRefill) / 1000; // seconds
    bucket.tokens = Math.min(this.maxTokens, bucket.tokens + elapsed * this.refillRate);
    bucket.lastRefill = now;
  }
}

// ---------------------------------------------------------------------------
// Reconnection config
// ---------------------------------------------------------------------------

export interface ReconnectionConfig {
  initialDelayMs: number;  // 1000
  maxDelayMs: number;      // 30000
  multiplier: number;      // 2
  maxAttempts: number;     // 5
}

const DEFAULT_RECONNECTION: ReconnectionConfig = {
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  multiplier: 2,
  maxAttempts: 5,
};

// ---------------------------------------------------------------------------
// Internal tracked bot state
// ---------------------------------------------------------------------------

interface ManagedBot {
  instance: BotInstance;
  profile: ConnectionProfile;
  reconnectAttempts: number;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
}

// ---------------------------------------------------------------------------
// BotManager
// ---------------------------------------------------------------------------

export class BotManager {
  private readonly bots = new Map<string, ManagedBot>();
  private readonly serverConnector: ServerConnector;
  private readonly rateLimiter: BotRateLimiter;
  private readonly reconnectionConfig: ReconnectionConfig;
  private readonly logger: Logger;

  /** Callback to persist bot state — injected by the caller (e.g. BotRepository). */
  onBotChanged?: (bot: BotInstance) => void;

  /** Callback invoked when a bot action is logged. */
  onActionLog?: (entry: BotActionLogEntry) => void;

  constructor(options: {
    serverConnector: ServerConnector;
    rateLimiter?: BotRateLimiter;
    reconnectionConfig?: ReconnectionConfig;
    logger?: Logger;
  }) {
    this.serverConnector = options.serverConnector;
    this.rateLimiter = options.rateLimiter ?? new BotRateLimiter();
    this.reconnectionConfig = options.reconnectionConfig ?? DEFAULT_RECONNECTION;
    this.logger = options.logger ?? createLogger({ level: 'info' });
  }

  // ---- Public API ---------------------------------------------------------

  /**
   * Connect a new bot to a Minecraft server and register it in the registry.
   * Requirements: 2.1, 2.7
   */
  async connectBot(profile: ConnectionProfile, role: WorkerRole): Promise<BotInstance> {
    const botId = `bot_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    this.logger.info('Connecting bot', { botId, role, host: profile.host, port: profile.port } as any);

    const connection = await this.connectViaProfile(profile);

    const instance: BotInstance = {
      id: botId,
      role,
      status: 'connected',
      connectionId: connection.id,
    };

    const managed: ManagedBot = {
      instance,
      profile,
      reconnectAttempts: 0,
      reconnectTimer: null,
    };

    this.bots.set(botId, managed);
    this.notifyChanged(instance);

    this.logAction(botId, 'connect', true, `Connected to ${profile.host}:${profile.port}`);

    // Set up automatic reconnection on disconnect (req 2.5)
    this.serverConnector.onDisconnect(connection.id, (reason) => {
      this.handleDisconnect(botId, reason);
    });

    return instance;
  }

  /**
   * Gracefully disconnect a bot.
   */
  async disconnectBot(botId: string): Promise<void> {
    const managed = this.bots.get(botId);
    if (!managed) {
      this.logger.warn('Attempted to disconnect unknown bot', { botId } as any);
      return;
    }

    // Cancel any pending reconnection
    if (managed.reconnectTimer) {
      clearTimeout(managed.reconnectTimer);
      managed.reconnectTimer = null;
    }

    await this.serverConnector.disconnect(managed.instance.connectionId);
    managed.instance.status = 'disconnected';
    this.rateLimiter.reset(botId);
    this.notifyChanged(managed.instance);

    this.logAction(botId, 'disconnect', true, 'Graceful disconnect');
    this.logger.info('Bot disconnected', { botId } as any);
  }

  /**
   * Get detailed status for a bot (req 2.4).
   */
  getBotStatus(botId: string): BotStatus | undefined {
    const managed = this.bots.get(botId);
    if (!managed) return undefined;

    const health = this.serverConnector.getHealth(managed.instance.connectionId);

    return {
      botId,
      position: managed.instance.position ?? { x: 0, y: 0, z: 0 },
      health: managed.instance.health ?? 20,
      food: 20,
      inventory: [],
      connectionStatus: managed.instance.status,
      latencyMs: health.latencyMs,
    };
  }

  /**
   * Get a bot instance by ID.
   */
  getBot(botId: string): BotInstance | undefined {
    return this.bots.get(botId)?.instance;
  }

  /**
   * List all registered bots.
   */
  listBots(): BotInstance[] {
    return [...this.bots.values()].map((m) => ({ ...m.instance }));
  }

  /**
   * Check rate limit before executing an action (req 2.9, 31.5).
   * Returns true if the action is allowed.
   */
  checkRateLimit(botId: string): boolean {
    return this.rateLimiter.tryConsume(botId);
  }

  /**
   * Update a bot's position (called by action executor or event listeners).
   */
  updatePosition(botId: string, position: Vec3): void {
    const managed = this.bots.get(botId);
    if (managed) {
      managed.instance.position = position;
    }
  }

  /**
   * Update a bot's health (called by action executor or event listeners).
   */
  updateHealth(botId: string, health: number): void {
    const managed = this.bots.get(botId);
    if (managed) {
      managed.instance.health = health;
    }
  }

  /**
   * Clean up all bots and timers.
   */
  async shutdown(): Promise<void> {
    for (const [botId, managed] of this.bots) {
      if (managed.reconnectTimer) {
        clearTimeout(managed.reconnectTimer);
      }
    }
    for (const botId of [...this.bots.keys()]) {
      await this.disconnectBot(botId);
    }
  }

  // ---- Private helpers ----------------------------------------------------

  private async connectViaProfile(profile: ConnectionProfile) {
    switch (profile.authMethod) {
      case 'none':
        return this.serverConnector.connectLocal(profile.host, profile.port);
      case 'credentials':
        if (!profile.credentials) {
          throw new Error('Credentials required for credentials auth method');
        }
        return this.serverConnector.connectWithCredentials(
          profile.host,
          profile.port,
          profile.credentials.username,
          profile.credentials.password,
        );
      case 'microsoft':
        if (!profile.msToken) {
          throw new Error('Microsoft token required for microsoft auth method');
        }
        return this.serverConnector.connectMicrosoft(profile.host, profile.port, profile.msToken);
      default:
        throw new Error(`Unsupported auth method: ${profile.authMethod}`);
    }
  }

  /**
   * Handle bot disconnection — trigger reconnection with exponential backoff (req 2.5).
   */
  private handleDisconnect(botId: string, reason: string): void {
    const managed = this.bots.get(botId);
    if (!managed) return;

    managed.instance.status = 'reconnecting';
    this.notifyChanged(managed.instance);
    this.logAction(botId, 'disconnect', false, `Disconnected: ${reason}`);
    this.logger.warn('Bot disconnected, attempting reconnection', { botId, reason } as any);

    this.scheduleReconnect(botId);
  }

  private scheduleReconnect(botId: string): void {
    const managed = this.bots.get(botId);
    if (!managed) return;

    if (managed.reconnectAttempts >= this.reconnectionConfig.maxAttempts) {
      managed.instance.status = 'disconnected';
      this.notifyChanged(managed.instance);
      this.logAction(botId, 'reconnect', false, `Max reconnection attempts (${this.reconnectionConfig.maxAttempts}) reached`);
      this.logger.error(`Bot ${botId} reconnection failed after ${this.reconnectionConfig.maxAttempts} attempts`);
      return;
    }

    const delay = Math.min(
      this.reconnectionConfig.initialDelayMs * Math.pow(this.reconnectionConfig.multiplier, managed.reconnectAttempts),
      this.reconnectionConfig.maxDelayMs,
    );

    managed.reconnectAttempts += 1;

    this.logger.info('Scheduling reconnection', {
      botId,
      attempt: managed.reconnectAttempts,
      delayMs: delay,
    } as any);

    managed.reconnectTimer = setTimeout(async () => {
      await this.attemptReconnect(botId);
    }, delay);
  }

  private async attemptReconnect(botId: string): Promise<void> {
    const managed = this.bots.get(botId);
    if (!managed) return;

    try {
      this.logger.info('Attempting reconnection', { botId, attempt: managed.reconnectAttempts } as any);

      const connection = await this.connectViaProfile(managed.profile);
      managed.instance.connectionId = connection.id;
      managed.instance.status = 'connected';
      managed.reconnectAttempts = 0;
      managed.reconnectTimer = null;
      this.notifyChanged(managed.instance);

      this.logAction(botId, 'reconnect', true, `Reconnected after ${managed.reconnectAttempts} attempts`);
      this.logger.info('Bot reconnected successfully', { botId } as any);

      // Re-register disconnect handler for the new connection
      this.serverConnector.onDisconnect(connection.id, (reason) => {
        this.handleDisconnect(botId, reason);
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logAction(botId, 'reconnect', false, `Reconnection attempt ${managed.reconnectAttempts} failed: ${message}`);
      this.logger.warn('Reconnection attempt failed', {
        botId,
        attempt: managed.reconnectAttempts,
        error: message,
      } as any);

      this.scheduleReconnect(botId);
    }
  }

  private notifyChanged(instance: BotInstance): void {
    if (this.onBotChanged) {
      try {
        this.onBotChanged({ ...instance });
      } catch {
        // swallow callback errors
      }
    }
  }

  private logAction(botId: string, action: string, success: boolean, outcome: string): void {
    const entry: BotActionLogEntry = {
      botId,
      action,
      success,
      outcome,
      timestamp: new Date().toISOString(),
    };

    this.logger.info('Bot action', entry as any);

    if (this.onActionLog) {
      try {
        this.onActionLog(entry);
      } catch {
        // swallow callback errors
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BotActionLogEntry {
  botId: string;
  action: string;
  success: boolean;
  outcome: string;
  timestamp: string;
}
