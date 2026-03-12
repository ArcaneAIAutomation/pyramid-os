/**
 * Generic connection pool with idle eviction, min-idle maintenance,
 * acquire timeout, and configurable defaults for SQLite and Ollama.
 *
 * Requirements: 25.3, 25.8
 */

export interface PoolConfig {
  /** Max connections in pool */
  maxConnections: number;
  /** Min idle connections to maintain */
  minIdle: number;
  /** Max time to wait for a connection (ms) */
  acquireTimeoutMs: number;
  /** Max time a connection can be idle before eviction (ms) */
  idleTimeoutMs: number;
}

export interface ConnectionFactory<T> {
  create(): Promise<T>;
  destroy(conn: T): Promise<void>;
  validate(conn: T): Promise<boolean>;
}

export interface PoolStats {
  total: number;
  active: number;
  idle: number;
  waiting: number;
}

interface IdleEntry<T> {
  connection: T;
  idleSince: number;
}

interface Waiter<T> {
  resolve: (conn: T) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export const POOL_CONFIGS = {
  sqlite: {
    maxConnections: 5,
    minIdle: 1,
    acquireTimeoutMs: 3_000,
    idleTimeoutMs: 60_000,
  } satisfies PoolConfig,
  ollama: {
    maxConnections: 4,
    minIdle: 1,
    acquireTimeoutMs: 5_000,
    idleTimeoutMs: 30_000,
  } satisfies PoolConfig,
} as const;

export class ConnectionPool<T> {
  private readonly config: PoolConfig;
  private readonly factory: ConnectionFactory<T>;

  private readonly idle: IdleEntry<T>[] = [];
  private readonly active = new Set<T>();
  private readonly waiters: Waiter<T>[] = [];

  private evictionTimer: ReturnType<typeof setInterval> | null = null;
  private drained = false;

  constructor(config: PoolConfig, factory: ConnectionFactory<T>) {
    this.config = config;
    this.factory = factory;
  }

  /** Start the idle-eviction interval and pre-fill minIdle connections. */
  async initialize(): Promise<void> {
    await this.ensureMinIdle();
    this.startEviction();
  }

  /** Acquire a connection from the pool, blocking up to acquireTimeoutMs. */
  async acquire(): Promise<T> {
    if (this.drained) {
      throw new Error('Pool has been drained');
    }

    // 1. Try to grab an idle connection
    while (this.idle.length > 0) {
      const entry = this.idle.shift()!;
      try {
        const valid = await this.factory.validate(entry.connection);
        if (valid) {
          this.active.add(entry.connection);
          return entry.connection;
        }
      } catch {
        // invalid — destroy silently
      }
      await this.safeDestroy(entry.connection);
    }

    // 2. If room to create, create a new connection
    if (this.totalCount() < this.config.maxConnections) {
      const conn = await this.factory.create();
      this.active.add(conn);
      return conn;
    }

    // 3. Wait for a released connection
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.waiters.findIndex((w) => w.resolve === resolve);
        if (idx !== -1) this.waiters.splice(idx, 1);
        reject(new Error(`Acquire timeout after ${this.config.acquireTimeoutMs}ms`));
      }, this.config.acquireTimeoutMs);

      this.waiters.push({ resolve, reject, timer });
    });
  }

  /** Release a connection back to the idle pool. */
  release(connection: T): void {
    if (!this.active.has(connection)) {
      return; // not ours — ignore
    }
    this.active.delete(connection);

    if (this.drained) {
      void this.safeDestroy(connection);
      return;
    }

    // Hand off to a waiter if one exists
    if (this.waiters.length > 0) {
      const waiter = this.waiters.shift()!;
      clearTimeout(waiter.timer);
      this.active.add(connection);
      waiter.resolve(connection);
      return;
    }

    // If we already have maxConnections idle, destroy instead
    if (this.idle.length >= this.config.maxConnections) {
      void this.safeDestroy(connection);
      return;
    }

    this.idle.push({ connection, idleSince: Date.now() });
  }

  /** Return pool statistics. */
  stats(): PoolStats {
    return {
      total: this.totalCount(),
      active: this.active.size,
      idle: this.idle.length,
      waiting: this.waiters.length,
    };
  }

  /** Drain and close all connections. */
  async drain(): Promise<void> {
    this.drained = true;
    this.stopEviction();

    // Reject all waiters
    for (const waiter of this.waiters) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error('Pool is draining'));
    }
    this.waiters.length = 0;

    // Destroy idle connections
    const idleConns = this.idle.splice(0);
    await Promise.all(idleConns.map((e) => this.safeDestroy(e.connection)));

    // Destroy active connections
    const activeConns = [...this.active];
    this.active.clear();
    await Promise.all(activeConns.map((c) => this.safeDestroy(c)));
  }

  // ── Internal helpers ──────────────────────────────────────────

  private totalCount(): number {
    return this.active.size + this.idle.length;
  }

  private async safeDestroy(conn: T): Promise<void> {
    try {
      await this.factory.destroy(conn);
    } catch {
      // swallow destroy errors
    }
  }

  private async ensureMinIdle(): Promise<void> {
    while (this.idle.length < this.config.minIdle && this.totalCount() < this.config.maxConnections) {
      try {
        const conn = await this.factory.create();
        this.idle.push({ connection: conn, idleSince: Date.now() });
      } catch {
        break; // can't create more right now
      }
    }
  }

  private startEviction(): void {
    // Check every half the idle timeout (minimum 500ms)
    const interval = Math.max(Math.floor(this.config.idleTimeoutMs / 2), 500);
    this.evictionTimer = setInterval(() => {
      void this.evictIdle();
    }, interval);
    // Don't keep the process alive just for eviction
    if (this.evictionTimer && typeof this.evictionTimer === 'object' && 'unref' in this.evictionTimer) {
      this.evictionTimer.unref();
    }
  }

  private stopEviction(): void {
    if (this.evictionTimer !== null) {
      clearInterval(this.evictionTimer);
      this.evictionTimer = null;
    }
  }

  private async evictIdle(): Promise<void> {
    if (this.drained) return;

    const now = Date.now();
    const toEvict: IdleEntry<T>[] = [];

    // Walk from oldest (front) to newest, evict those past idleTimeoutMs
    // but keep at least minIdle idle connections
    while (this.idle.length > this.config.minIdle) {
      const oldest = this.idle[0];
      if (!oldest) break;
      if (now - oldest.idleSince >= this.config.idleTimeoutMs) {
        toEvict.push(this.idle.shift()!);
      } else {
        break; // rest are newer
      }
    }

    await Promise.all(toEvict.map((e) => this.safeDestroy(e.connection)));

    // Replenish if we dropped below minIdle
    await this.ensureMinIdle();
  }
}
