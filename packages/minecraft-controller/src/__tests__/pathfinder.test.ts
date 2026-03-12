import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Pathfinder, type MineflayerBot, type PathResult } from '../pathfinder.js';
import type { Vec3, Path } from '@pyramid-os/shared-types';

// ---------------------------------------------------------------------------
// Mock logger
// ---------------------------------------------------------------------------

vi.mock('@pyramid-os/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockBot(overrides: Partial<MineflayerBot> = {}): MineflayerBot {
  return { ...overrides };
}

/** Create a mock bot with a working pathfinder plugin. */
function mockBotWithPathfinder(
  handler: (
    movements: unknown,
    start: { x: number; y: number; z: number },
    goal: { x: number; y: number; z: number },
    cb: (result: { path: Array<{ x: number; y: number; z: number }>; status: string; cost: number }) => void,
  ) => void,
): MineflayerBot {
  return {
    pathfinder: {
      setMovements: vi.fn(),
      getPathFromTo: handler as any,
    },
  };
}

function vec3(x: number, y: number, z: number): Vec3 {
  return { x, y, z };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Pathfinder', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ---- findPath -----------------------------------------------------------

  describe('findPath', () => {
    it('returns a path using the mineflayer-pathfinder plugin when available', async () => {
      const bot = mockBotWithPathfinder((_movements, _start, _goal, cb) => {
        cb({
          path: [{ x: 0, y: 64, z: 0 }, { x: 5, y: 64, z: 0 }, { x: 10, y: 64, z: 0 }],
          status: 'found',
          cost: 10,
        });
      });

      const pf = new Pathfinder(bot);
      const result = await pf.findPath(vec3(0, 64, 0), vec3(10, 64, 0));

      expect(result.found).toBe(true);
      expect(result.path).toHaveLength(3);
      expect(result.cost).toBe(10);
      expect(result.reason).toBeUndefined();
    });

    it('passes movement options derived from PathOptions to the plugin', async () => {
      let capturedMovements: any = null;
      const bot = mockBotWithPathfinder((movements, _start, _goal, cb) => {
        capturedMovements = movements;
        cb({ path: [{ x: 0, y: 64, z: 0 }], status: 'found', cost: 0 });
      });

      const pf = new Pathfinder(bot);
      await pf.findPath(vec3(0, 64, 0), vec3(5, 64, 0), {
        avoidWater: false,
        avoidLava: true,
        canSwim: true,
        canClimb: false,
        maxDistance: 100,
      });

      expect(capturedMovements).toBeDefined();
      expect(capturedMovements.allowWater).toBe(true);
      expect(capturedMovements.allowLava).toBe(false);
      expect(capturedMovements.canSwim).toBe(true);
      expect(capturedMovements.canClimb).toBe(false);
    });

    it('returns found=false when the plugin reports a non-success status', async () => {
      const bot = mockBotWithPathfinder((_m, _s, _g, cb) => {
        cb({ path: [], status: 'noPath', cost: 0 });
      });

      const pf = new Pathfinder(bot);
      const result = await pf.findPath(vec3(0, 64, 0), vec3(100, 64, 0));

      expect(result.found).toBe(false);
      expect(result.path).toHaveLength(0);
      expect(result.reason).toContain('noPath');
    });

    it('returns found=false when goal exceeds maxDistance', async () => {
      const bot = mockBot();
      const pf = new Pathfinder(bot);

      const result = await pf.findPath(vec3(0, 0, 0), vec3(1000, 0, 0), { maxDistance: 50 });

      expect(result.found).toBe(false);
      expect(result.reason).toContain('maxDistance');
    });

    it('falls back to straight-line path when no pathfinder plugin is loaded', async () => {
      const bot = mockBot();
      const pf = new Pathfinder(bot);

      const result = await pf.findPath(vec3(0, 64, 0), vec3(5, 64, 0));

      expect(result.found).toBe(true);
      expect(result.path.length).toBeGreaterThanOrEqual(2);
      expect(result.path[0]).toEqual(vec3(0, 64, 0));
      expect(result.path[result.path.length - 1]).toEqual(vec3(5, 64, 0));
    });

    it('handles errors from the pathfinder plugin gracefully', async () => {
      const bot: MineflayerBot = {
        pathfinder: {
          getPathFromTo: () => {
            throw new Error('Plugin crashed');
          },
        } as any,
      };

      const pf = new Pathfinder(bot);
      const result = await pf.findPath(vec3(0, 64, 0), vec3(10, 64, 0));

      expect(result.found).toBe(false);
      expect(result.reason).toContain('Plugin crashed');
    });

    it('uses default PathOptions when none are provided', async () => {
      let capturedMovements: any = null;
      const bot = mockBotWithPathfinder((movements, _s, _g, cb) => {
        capturedMovements = movements;
        cb({ path: [{ x: 0, y: 0, z: 0 }], status: 'found', cost: 0 });
      });

      const pf = new Pathfinder(bot);
      await pf.findPath(vec3(0, 0, 0), vec3(1, 0, 0));

      // Defaults: avoidWater=true, avoidLava=true, canSwim=false, canClimb=true
      expect(capturedMovements.allowWater).toBe(false);
      expect(capturedMovements.allowLava).toBe(false);
      expect(capturedMovements.canSwim).toBe(false);
      expect(capturedMovements.canClimb).toBe(true);
    });
  });

  // ---- recalculate --------------------------------------------------------

  describe('recalculate', () => {
    it('recomputes a path around an obstacle', async () => {
      const bot = mockBot(); // uses straight-line fallback
      const pf = new Pathfinder(bot);

      const original: PathResult = {
        path: [vec3(0, 64, 0), vec3(5, 64, 0), vec3(10, 64, 0), vec3(15, 64, 0)],
        cost: 15,
        found: true,
      };

      const result = await pf.recalculate(original, vec3(10, 64, 0));

      expect(result.found).toBe(true);
      // The new path should still reach the goal
      expect(result.path[result.path.length - 1]).toEqual(vec3(15, 64, 0));
    });

    it('returns found=false when the current path is too short', async () => {
      const bot = mockBot();
      const pf = new Pathfinder(bot);

      const result = await pf.recalculate(
        { path: [vec3(0, 0, 0)], cost: 0, found: true },
        vec3(0, 0, 0),
      );

      expect(result.found).toBe(false);
      expect(result.reason).toContain('too short');
    });

    it('handles obstacle at the start of the path', async () => {
      const bot = mockBot();
      const pf = new Pathfinder(bot);

      const original: PathResult = {
        path: [vec3(0, 64, 0), vec3(5, 64, 0), vec3(10, 64, 0)],
        cost: 10,
        found: true,
      };

      const result = await pf.recalculate(original, vec3(0, 64, 0));

      expect(result.found).toBe(true);
      expect(result.path[result.path.length - 1]).toEqual(vec3(10, 64, 0));
    });
  });

  // ---- cachePath / getCachedPath ------------------------------------------

  describe('path caching', () => {
    it('stores and retrieves a cached path', () => {
      const bot = mockBot();
      const pf = new Pathfinder(bot, { defaultTtlMs: 60_000 });

      const path: Path = {
        nodes: [vec3(0, 0, 0), vec3(10, 0, 0)],
        totalDistance: 10,
        computedAt: new Date().toISOString(),
      };

      pf.cachePath('quarry-to-pyramid', path);
      const cached = pf.getCachedPath('quarry-to-pyramid');

      expect(cached).toBeDefined();
      expect(cached!.nodes).toEqual(path.nodes);
      expect(cached!.totalDistance).toBe(10);
    });

    it('returns undefined for a non-existent key', () => {
      const bot = mockBot();
      const pf = new Pathfinder(bot);

      expect(pf.getCachedPath('nonexistent')).toBeUndefined();
    });

    it('expires cached paths after TTL', () => {
      vi.useFakeTimers();
      try {
        const bot = mockBot();
        const pf = new Pathfinder(bot, { defaultTtlMs: 5000 });

        const path: Path = {
          nodes: [vec3(0, 0, 0)],
          totalDistance: 0,
          computedAt: new Date().toISOString(),
        };

        pf.cachePath('temp', path);
        expect(pf.getCachedPath('temp')).toBeDefined();

        vi.advanceTimersByTime(5001);
        expect(pf.getCachedPath('temp')).toBeUndefined();
      } finally {
        vi.useRealTimers();
      }
    });

    it('supports custom TTL per entry', () => {
      vi.useFakeTimers();
      try {
        const bot = mockBot();
        const pf = new Pathfinder(bot, { defaultTtlMs: 60_000 });

        const path: Path = {
          nodes: [vec3(0, 0, 0)],
          totalDistance: 0,
          computedAt: new Date().toISOString(),
        };

        pf.cachePath('short-lived', path, 1000);
        expect(pf.getCachedPath('short-lived')).toBeDefined();

        vi.advanceTimersByTime(1001);
        expect(pf.getCachedPath('short-lived')).toBeUndefined();
      } finally {
        vi.useRealTimers();
      }
    });

    it('overwrites existing cache entries', () => {
      const bot = mockBot();
      const pf = new Pathfinder(bot);

      const path1: Path = { nodes: [vec3(0, 0, 0)], totalDistance: 0, computedAt: '' };
      const path2: Path = { nodes: [vec3(1, 1, 1)], totalDistance: 1, computedAt: '' };

      pf.cachePath('key', path1);
      pf.cachePath('key', path2);

      expect(pf.getCachedPath('key')!.nodes[0]).toEqual(vec3(1, 1, 1));
    });

    it('clearCache removes all entries', () => {
      const bot = mockBot();
      const pf = new Pathfinder(bot);

      pf.cachePath('a', { nodes: [], totalDistance: 0, computedAt: '' });
      pf.cachePath('b', { nodes: [], totalDistance: 0, computedAt: '' });
      expect(pf.cacheSize).toBe(2);

      pf.clearCache();
      expect(pf.cacheSize).toBe(0);
    });
  });

  // ---- createPatrolRoute --------------------------------------------------

  describe('createPatrolRoute', () => {
    it('creates a patrol route that cycles through waypoints', () => {
      const bot = mockBot();
      const pf = new Pathfinder(bot);

      const waypoints = [vec3(0, 64, 0), vec3(10, 64, 0), vec3(10, 64, 10)];
      const route = pf.createPatrolRoute(waypoints);

      expect(route.id).toMatch(/^patrol_/);
      expect(route.waypoints).toHaveLength(3);
      expect(route.looping).toBe(true);

      // Cycle through all waypoints and back to the start
      expect(route.getNext()).toEqual(vec3(0, 64, 0));
      expect(route.getNext()).toEqual(vec3(10, 64, 0));
      expect(route.getNext()).toEqual(vec3(10, 64, 10));
      expect(route.getNext()).toEqual(vec3(0, 64, 0)); // wraps around
    });

    it('reset() returns to the first waypoint', () => {
      const bot = mockBot();
      const pf = new Pathfinder(bot);

      const route = pf.createPatrolRoute([vec3(0, 0, 0), vec3(1, 0, 0)]);

      route.getNext(); // index 0 → 1
      route.getNext(); // index 1 → 0
      route.reset();

      expect(route.getNext()).toEqual(vec3(0, 0, 0));
    });

    it('throws when given an empty waypoints array', () => {
      const bot = mockBot();
      const pf = new Pathfinder(bot);

      expect(() => pf.createPatrolRoute([])).toThrow('at least one waypoint');
    });

    it('works with a single waypoint', () => {
      const bot = mockBot();
      const pf = new Pathfinder(bot);

      const route = pf.createPatrolRoute([vec3(5, 64, 5)]);

      expect(route.getNext()).toEqual(vec3(5, 64, 5));
      expect(route.getNext()).toEqual(vec3(5, 64, 5)); // always returns the same
    });

    it('does not mutate the original waypoints array', () => {
      const bot = mockBot();
      const pf = new Pathfinder(bot);

      const waypoints = [vec3(0, 0, 0), vec3(1, 0, 0)];
      const route = pf.createPatrolRoute(waypoints);

      // Mutate the route's waypoints — original should be unaffected
      route.waypoints.push(vec3(99, 99, 99));
      expect(waypoints).toHaveLength(2);
    });
  });

  // ---- Logging failures (req 37.10) ---------------------------------------

  describe('failure logging', () => {
    it('logs pathfinding failures with coordinates and reason', async () => {
      const warnFn = vi.fn();
      const logger: any = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: warnFn,
        error: vi.fn(),
      };

      const bot = mockBotWithPathfinder((_m, _s, _g, cb) => {
        cb({ path: [], status: 'noPath', cost: 0 });
      });

      const pf = new Pathfinder(bot, { logger });
      await pf.findPath(vec3(0, 64, 0), vec3(100, 64, 0));

      expect(warnFn).toHaveBeenCalledWith(
        'Pathfinding failed',
        expect.objectContaining({
          start: '(0, 64, 0)',
          goal: '(100, 64, 0)',
        }),
      );
    });

    it('logs maxDistance failures with coordinates', async () => {
      const warnFn = vi.fn();
      const logger: any = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: warnFn,
        error: vi.fn(),
      };

      const bot = mockBot();
      const pf = new Pathfinder(bot, { logger });
      await pf.findPath(vec3(0, 0, 0), vec3(500, 0, 0), { maxDistance: 10 });

      expect(warnFn).toHaveBeenCalledWith(
        'Pathfinding failed',
        expect.objectContaining({
          start: '(0, 0, 0)',
          goal: '(500, 0, 0)',
          reason: expect.stringContaining('maxDistance'),
        }),
      );
    });
  });
});
