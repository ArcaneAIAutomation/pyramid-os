/**
 * Generic LRU Cache with TTL-based expiry and write-through support.
 * @module cache
 */

/** Configuration for a cache instance */
export interface CacheConfig {
  /** Max items in LRU cache */
  maxSize: number;
  /** Time-to-live in milliseconds (0 = no expiry) */
  ttlMs: number;
  /** Whether to write-through on set (calls writeThrough callback) */
  writeThrough: boolean;
}

/** Cache statistics */
export interface CacheStats {
  hits: number;
  misses: number;
  evictions: number;
  size: number;
}

/** Internal cache entry wrapping value with metadata */
interface CacheEntry<T> {
  value: T;
  expiresAt: number; // 0 = no expiry
}

/**
 * Generic LRU cache with TTL-based expiry and optional write-through.
 *
 * Uses a Map for O(1) get/set with insertion-order iteration for LRU eviction.
 * The most recently accessed entry is always moved to the end of the Map.
 */
export class Cache<T> {
  private readonly store = new Map<string, CacheEntry<T>>();
  private readonly config: CacheConfig;
  private readonly writeThroughFn: ((key: string, value: T) => void) | undefined;

  private _hits = 0;
  private _misses = 0;
  private _evictions = 0;

  constructor(config: CacheConfig, writeThrough?: (key: string, value: T) => void) {
    this.config = config;
    this.writeThroughFn = writeThrough;
  }

  /** Get a value by key. Returns undefined if missing or expired. */
  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) {
      this._misses++;
      return undefined;
    }

    // Check TTL expiry
    if (entry.expiresAt > 0 && Date.now() > entry.expiresAt) {
      this.store.delete(key);
      this._misses++;
      return undefined;
    }

    // Move to end for LRU (most recently used)
    this.store.delete(key);
    this.store.set(key, entry);

    this._hits++;
    return entry.value;
  }

  /** Set a value. Evicts LRU entry if maxSize exceeded. Calls writeThrough if configured. */
  set(key: string, value: T): void {
    // Remove existing entry first so re-insertion goes to end
    if (this.store.has(key)) {
      this.store.delete(key);
    }

    // Evict LRU (first entry in Map) if at capacity
    if (this.store.size >= this.config.maxSize) {
      const lruKey = this.store.keys().next().value;
      if (lruKey !== undefined) {
        this.store.delete(lruKey);
        this._evictions++;
      }
    }

    const expiresAt = this.config.ttlMs > 0 ? Date.now() + this.config.ttlMs : 0;
    this.store.set(key, { value, expiresAt });

    // Write-through callback
    if (this.config.writeThrough && this.writeThroughFn) {
      this.writeThroughFn(key, value);
    }
  }

  /** Invalidate a single key */
  invalidate(key: string): void {
    this.store.delete(key);
  }

  /** Invalidate all keys matching a RegExp pattern */
  invalidatePattern(pattern: RegExp): void {
    for (const key of [...this.store.keys()]) {
      if (pattern.test(key)) {
        this.store.delete(key);
      }
    }
  }

  /** Clear all entries and reset stats */
  clear(): void {
    this.store.clear();
    this._hits = 0;
    this._misses = 0;
    this._evictions = 0;
  }

  /** Return current cache statistics */
  stats(): CacheStats {
    return {
      hits: this._hits,
      misses: this._misses,
      evictions: this._evictions,
      size: this.store.size,
    };
  }
}

/** Pre-configured cache configs per data type */
export const CACHE_CONFIGS: Record<string, CacheConfig> = {
  blueprints: {
    maxSize: 50,
    ttlMs: 300_000,       // 5 minutes
    writeThrough: false,
  },
  agentStates: {
    maxSize: 100,
    ttlMs: 10_000,        // 10 seconds
    writeThrough: true,
  },
  resourceLevels: {
    maxSize: 200,
    ttlMs: 5_000,         // 5 seconds
    writeThrough: true,
  },
  pathCache: {
    maxSize: 500,
    ttlMs: 60_000,        // 1 minute
    writeThrough: false,
  },
  configValues: {
    maxSize: 50,
    ttlMs: 0,             // no expiry
    writeThrough: false,
  },
};
