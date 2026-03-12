import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Cache, CACHE_CONFIGS } from '../cache.js';
import type { CacheConfig } from '../cache.js';

describe('Cache<T>', () => {
  const defaultConfig: CacheConfig = { maxSize: 3, ttlMs: 0, writeThrough: false };

  describe('get / set basics', () => {
    it('returns undefined for missing key', () => {
      const cache = new Cache<string>(defaultConfig);
      expect(cache.get('missing')).toBeUndefined();
    });

    it('stores and retrieves a value', () => {
      const cache = new Cache<number>(defaultConfig);
      cache.set('a', 42);
      expect(cache.get('a')).toBe(42);
    });

    it('overwrites existing key', () => {
      const cache = new Cache<string>(defaultConfig);
      cache.set('k', 'old');
      cache.set('k', 'new');
      expect(cache.get('k')).toBe('new');
      expect(cache.stats().size).toBe(1);
    });
  });

  describe('LRU eviction', () => {
    it('evicts least recently used entry when maxSize exceeded', () => {
      const cache = new Cache<number>(defaultConfig); // maxSize 3
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);
      // 'a' is LRU
      cache.set('d', 4);
      expect(cache.get('a')).toBeUndefined(); // evicted
      expect(cache.get('b')).toBe(2);
      expect(cache.get('d')).toBe(4);
      expect(cache.stats().evictions).toBe(1);
    });

    it('accessing a key promotes it in LRU order', () => {
      const cache = new Cache<number>(defaultConfig);
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);
      // Access 'a' to promote it
      cache.get('a');
      // Now 'b' is LRU
      cache.set('d', 4);
      expect(cache.get('b')).toBeUndefined(); // evicted
      expect(cache.get('a')).toBe(1); // still present
    });

    it('overwriting a key does not cause extra eviction', () => {
      const cache = new Cache<number>(defaultConfig);
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);
      cache.set('a', 10); // overwrite, no eviction needed
      expect(cache.stats().evictions).toBe(0);
      expect(cache.stats().size).toBe(3);
    });
  });

  describe('TTL-based expiry', () => {
    it('returns value before TTL expires', () => {
      const cache = new Cache<string>({ maxSize: 10, ttlMs: 5000, writeThrough: false });
      cache.set('k', 'val');
      expect(cache.get('k')).toBe('val');
    });

    it('returns undefined after TTL expires', () => {
      vi.useFakeTimers();
      try {
        const cache = new Cache<string>({ maxSize: 10, ttlMs: 100, writeThrough: false });
        cache.set('k', 'val');
        expect(cache.get('k')).toBe('val');
        vi.advanceTimersByTime(101);
        expect(cache.get('k')).toBeUndefined();
      } finally {
        vi.useRealTimers();
      }
    });

    it('expired entry is removed from store', () => {
      vi.useFakeTimers();
      try {
        const cache = new Cache<string>({ maxSize: 10, ttlMs: 50, writeThrough: false });
        cache.set('k', 'val');
        vi.advanceTimersByTime(51);
        cache.get('k'); // triggers removal
        expect(cache.stats().size).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    });

    it('ttlMs=0 means no expiry', () => {
      vi.useFakeTimers();
      try {
        const cache = new Cache<string>({ maxSize: 10, ttlMs: 0, writeThrough: false });
        cache.set('k', 'val');
        vi.advanceTimersByTime(999_999);
        expect(cache.get('k')).toBe('val');
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('invalidate', () => {
    it('removes a specific key', () => {
      const cache = new Cache<number>(defaultConfig);
      cache.set('a', 1);
      cache.set('b', 2);
      cache.invalidate('a');
      expect(cache.get('a')).toBeUndefined();
      expect(cache.get('b')).toBe(2);
    });

    it('is a no-op for missing key', () => {
      const cache = new Cache<number>(defaultConfig);
      cache.invalidate('nope'); // should not throw
      expect(cache.stats().size).toBe(0);
    });
  });

  describe('invalidatePattern', () => {
    it('removes all keys matching a regex', () => {
      const cache = new Cache<number>({ maxSize: 10, ttlMs: 0, writeThrough: false });
      cache.set('agent:1', 1);
      cache.set('agent:2', 2);
      cache.set('resource:wood', 3);
      cache.invalidatePattern(/^agent:/);
      expect(cache.get('agent:1')).toBeUndefined();
      expect(cache.get('agent:2')).toBeUndefined();
      expect(cache.get('resource:wood')).toBe(3);
    });

    it('handles pattern matching no keys', () => {
      const cache = new Cache<number>(defaultConfig);
      cache.set('a', 1);
      cache.invalidatePattern(/^zzz/);
      expect(cache.get('a')).toBe(1);
    });
  });

  describe('clear', () => {
    it('removes all entries and resets stats', () => {
      const cache = new Cache<number>(defaultConfig);
      cache.set('a', 1);
      cache.set('b', 2);
      cache.get('a');
      cache.get('missing');
      cache.clear();
      expect(cache.stats()).toEqual({ hits: 0, misses: 0, evictions: 0, size: 0 });
      expect(cache.get('a')).toBeUndefined();
    });
  });

  describe('stats', () => {
    it('tracks hits and misses', () => {
      const cache = new Cache<number>(defaultConfig);
      cache.set('a', 1);
      cache.get('a');    // hit
      cache.get('a');    // hit
      cache.get('b');    // miss
      const s = cache.stats();
      expect(s.hits).toBe(2);
      expect(s.misses).toBe(1);
      expect(s.size).toBe(1);
    });

    it('tracks evictions', () => {
      const cache = new Cache<number>({ maxSize: 2, ttlMs: 0, writeThrough: false });
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3); // evicts 'a'
      cache.set('d', 4); // evicts 'b'
      expect(cache.stats().evictions).toBe(2);
    });

    it('counts expired reads as misses', () => {
      vi.useFakeTimers();
      try {
        const cache = new Cache<string>({ maxSize: 10, ttlMs: 50, writeThrough: false });
        cache.set('k', 'v');
        vi.advanceTimersByTime(51);
        cache.get('k');
        expect(cache.stats().misses).toBe(1);
        expect(cache.stats().hits).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('write-through mode', () => {
    it('calls writeThrough callback on set when configured', () => {
      const writeFn = vi.fn();
      const cache = new Cache<number>(
        { maxSize: 10, ttlMs: 0, writeThrough: true },
        writeFn,
      );
      cache.set('key', 99);
      expect(writeFn).toHaveBeenCalledWith('key', 99);
    });

    it('does not call writeThrough when writeThrough is false', () => {
      const writeFn = vi.fn();
      const cache = new Cache<number>(
        { maxSize: 10, ttlMs: 0, writeThrough: false },
        writeFn,
      );
      cache.set('key', 99);
      expect(writeFn).not.toHaveBeenCalled();
    });

    it('does not call writeThrough when no callback provided', () => {
      // Should not throw even with writeThrough: true and no callback
      const cache = new Cache<number>({ maxSize: 10, ttlMs: 0, writeThrough: true });
      cache.set('key', 99);
      expect(cache.get('key')).toBe(99);
    });
  });

  describe('CACHE_CONFIGS', () => {
    it('defines blueprints config (50/5min/no-writethrough)', () => {
      const c = CACHE_CONFIGS['blueprints'];
      expect(c).toBeDefined();
      expect(c.maxSize).toBe(50);
      expect(c.ttlMs).toBe(300_000);
      expect(c.writeThrough).toBe(false);
    });

    it('defines agentStates config (100/10s/writethrough)', () => {
      const c = CACHE_CONFIGS['agentStates'];
      expect(c).toBeDefined();
      expect(c.maxSize).toBe(100);
      expect(c.ttlMs).toBe(10_000);
      expect(c.writeThrough).toBe(true);
    });

    it('defines resourceLevels config (200/5s/writethrough)', () => {
      const c = CACHE_CONFIGS['resourceLevels'];
      expect(c).toBeDefined();
      expect(c.maxSize).toBe(200);
      expect(c.ttlMs).toBe(5_000);
      expect(c.writeThrough).toBe(true);
    });

    it('defines pathCache config (500/1min/no-writethrough)', () => {
      const c = CACHE_CONFIGS['pathCache'];
      expect(c).toBeDefined();
      expect(c.maxSize).toBe(500);
      expect(c.ttlMs).toBe(60_000);
      expect(c.writeThrough).toBe(false);
    });

    it('defines configValues config (50/no-expiry/no-writethrough)', () => {
      const c = CACHE_CONFIGS['configValues'];
      expect(c).toBeDefined();
      expect(c.maxSize).toBe(50);
      expect(c.ttlMs).toBe(0);
      expect(c.writeThrough).toBe(false);
    });
  });
});
