/**
 * Pathfinder — A* navigation using mineflayer-pathfinder.
 *
 * Provides path computation, dynamic re-routing, path caching, and patrol routes.
 * Requirements: 37.1, 37.2, 37.3, 37.4, 37.5, 37.6, 37.7, 37.8, 37.9, 37.10
 */

import { createLogger, type Logger } from '@pyramid-os/logger';
import type { Vec3, Path, PatrolRoute } from '@pyramid-os/shared-types';

// ---------------------------------------------------------------------------
// PathOptions & PathResult
// ---------------------------------------------------------------------------

export interface PathOptions {
  avoidWater?: boolean;
  avoidLava?: boolean;
  canSwim?: boolean;
  canClimb?: boolean;
  maxDistance?: number;
}

export interface PathResult {
  path: Vec3[];
  cost: number;
  found: boolean;
  reason?: string;
}

// ---------------------------------------------------------------------------
// Cache entry with optional TTL
// ---------------------------------------------------------------------------

interface CacheEntry {
  path: Path;
  expiresAt: number | null; // null = no expiry
}

// ---------------------------------------------------------------------------
// Mineflayer bot shape (minimal interface for typing)
// ---------------------------------------------------------------------------

export interface MineflayerBot {
  pathfinder?: {
    setMovements?: (movements: unknown) => void;
    getPathFromTo?: (
      movements: unknown,
      start: { x: number; y: number; z: number },
      goal: { x: number; y: number; z: number },
      callback: (result: { path: Array<{ x: number; y: number; z: number }>; status: string; cost: number }) => void,
    ) => void;
  };
  loadPlugin?: (plugin: unknown) => void;
}

// ---------------------------------------------------------------------------
// Pathfinder
// ---------------------------------------------------------------------------

export class Pathfinder {
  private readonly bot: MineflayerBot;
  private readonly logger: Logger;
  private readonly cache = new Map<string, CacheEntry>();
  private readonly defaultTtlMs: number;

  constructor(bot: MineflayerBot, options?: { logger?: Logger; defaultTtlMs?: number }) {
    this.bot = bot;
    this.logger = options?.logger ?? createLogger({ level: 'info' });
    this.defaultTtlMs = options?.defaultTtlMs ?? 60_000; // 1 minute default TTL
  }

  // ---- Public API ---------------------------------------------------------

  /**
   * Calculate an A* path from start to goal.
   * Uses mineflayer-pathfinder when available, otherwise falls back to
   * a straight-line path (useful for testing without a real server).
   *
   * Requirements: 37.1, 37.2, 37.3, 37.6, 37.7
   */
  async findPath(start: Vec3, goal: Vec3, options?: PathOptions): Promise<PathResult> {
    const opts: Required<PathOptions> = {
      avoidWater: options?.avoidWater ?? true,
      avoidLava: options?.avoidLava ?? true,
      canSwim: options?.canSwim ?? false,
      canClimb: options?.canClimb ?? true,
      maxDistance: options?.maxDistance ?? 256,
    };

    // Check distance constraint
    const dist = this.euclideanDistance(start, goal);
    if (dist > opts.maxDistance) {
      const reason = `Goal exceeds maxDistance: ${dist.toFixed(1)} > ${opts.maxDistance}`;
      this.logger.warn('Pathfinding failed', {
        start: this.formatVec3(start),
        goal: this.formatVec3(goal),
        reason,
      } as any);
      return { path: [], cost: 0, found: false, reason };
    }

    try {
      const result = await this.computePath(start, goal, opts);
      if (!result.found) {
        this.logger.warn('Pathfinding failed', {
          start: this.formatVec3(start),
          goal: this.formatVec3(goal),
          reason: result.reason,
        } as any);
      }
      return result;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.error('Pathfinding error', undefined, {
        start: this.formatVec3(start),
        goal: this.formatVec3(goal),
        reason,
      } as any);
      return { path: [], cost: 0, found: false, reason };
    }
  }

  /**
   * Recalculate a path when an obstacle is encountered.
   * Removes the obstacle position from the current path and recomputes
   * from the node before the obstacle to the original goal.
   *
   * Requirement: 37.5
   */
  async recalculate(currentPath: PathResult, obstacleAt: Vec3): Promise<PathResult> {
    if (currentPath.path.length < 2) {
      const reason = 'Cannot recalculate: path too short';
      this.logger.warn('Recalculation failed', {
        obstacleAt: this.formatVec3(obstacleAt),
        reason,
      } as any);
      return { path: [], cost: 0, found: false, reason };
    }

    // Find the index of the obstacle (or closest node)
    const obstacleIndex = this.findClosestIndex(currentPath.path, obstacleAt);

    // Start from the node before the obstacle (or the beginning)
    const newStart = currentPath.path[Math.max(0, obstacleIndex - 1)]!;
    const goal = currentPath.path[currentPath.path.length - 1]!;

    this.logger.info('Recalculating path around obstacle', {
      obstacleAt: this.formatVec3(obstacleAt),
      newStart: this.formatVec3(newStart),
      goal: this.formatVec3(goal),
    } as any);

    // Recompute with the obstacle position noted (avoidance is handled by the pathfinder plugin)
    const result = await this.findPath(newStart, goal);

    if (result.found) {
      // Prepend the portion of the original path before the obstacle
      const prefix = currentPath.path.slice(0, Math.max(0, obstacleIndex - 1));
      result.path = [...prefix, ...result.path];
      result.cost += this.calculatePathCost(prefix);
    }

    return result;
  }

  /**
   * Cache a computed path under a string key.
   *
   * Requirement: 37.4
   */
  cachePath(key: string, path: Path, ttlMs?: number): void {
    const expiresAt = ttlMs !== undefined
      ? Date.now() + ttlMs
      : (this.defaultTtlMs > 0 ? Date.now() + this.defaultTtlMs : null);

    this.cache.set(key, { path, expiresAt });
  }

  /**
   * Retrieve a cached path. Returns undefined if not found or expired.
   *
   * Requirement: 37.4
   */
  getCachedPath(key: string): Path | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    if (entry.expiresAt !== null && Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }

    return entry.path;
  }

  /**
   * Create a patrol route that cycles through waypoints.
   * The returned object tracks the current index and provides getNext() / reset().
   *
   * Requirement: 37.8
   */
  createPatrolRoute(waypoints: Vec3[]): PatrolRoute & { getNext(): Vec3; reset(): void } {
    if (waypoints.length === 0) {
      throw new Error('Patrol route requires at least one waypoint');
    }

    const route: PatrolRoute & { currentIndex: number; getNext(): Vec3; reset(): void } = {
      id: `patrol_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      waypoints: [...waypoints],
      looping: true,
      currentIndex: 0,

      getNext(): Vec3 {
        const wp = this.waypoints[this.currentIndex]!;
        this.currentIndex = (this.currentIndex + 1) % this.waypoints.length;
        return wp;
      },

      reset(): void {
        this.currentIndex = 0;
      },
    };

    this.logger.info('Created patrol route', {
      routeId: route.id,
      waypointCount: waypoints.length,
    } as any);

    return route;
  }

  /**
   * Clear all cached paths.
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Get the number of cached paths.
   */
  get cacheSize(): number {
    return this.cache.size;
  }

  // ---- Private helpers ----------------------------------------------------

  private async computePath(
    start: Vec3,
    goal: Vec3,
    opts: Required<PathOptions>,
  ): Promise<PathResult> {
    const pf = this.bot.pathfinder;

    // If mineflayer-pathfinder is loaded and has getPathFromTo, use it
    if (pf?.getPathFromTo) {
      return new Promise<PathResult>((resolve) => {
        const movements = this.buildMovements(opts);
        pf.getPathFromTo!(
          movements,
          { x: start.x, y: start.y, z: start.z },
          { x: goal.x, y: goal.y, z: goal.z },
          (result) => {
            const path: Vec3[] = result.path.map((n) => ({ x: n.x, y: n.y, z: n.z }));
            const found = result.status === 'found' || result.status === 'success';
            const pathResult: PathResult = {
              path: found ? path : [],
              cost: result.cost,
              found,
            };
            if (!found) {
              pathResult.reason = `Pathfinder status: ${result.status}`;
            }
            resolve(pathResult);
          },
        );
      });
    }

    // Fallback: straight-line path (for environments without the plugin)
    return this.straightLinePath(start, goal);
  }

  private buildMovements(opts: Required<PathOptions>): Record<string, unknown> {
    return {
      allowWater: !opts.avoidWater && opts.canSwim,
      allowLava: !opts.avoidLava,
      canSwim: opts.canSwim,
      canClimb: opts.canClimb,
      maxDistance: opts.maxDistance,
    };
  }

  private straightLinePath(start: Vec3, goal: Vec3): PathResult {
    // Simple interpolation for fallback
    const dist = this.euclideanDistance(start, goal);
    const steps = Math.max(1, Math.ceil(dist));
    const path: Vec3[] = [{ ...start }];

    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      path.push({
        x: Math.round(start.x + (goal.x - start.x) * t),
        y: Math.round(start.y + (goal.y - start.y) * t),
        z: Math.round(start.z + (goal.z - start.z) * t),
      });
    }

    return { path, cost: dist, found: true };
  }

  private euclideanDistance(a: Vec3, b: Vec3): number {
    return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
  }

  private findClosestIndex(path: Vec3[], target: Vec3): number {
    let minDist = Infinity;
    let minIndex = 0;
    for (let i = 0; i < path.length; i++) {
      const d = this.euclideanDistance(path[i]!, target);
      if (d < minDist) {
        minDist = d;
        minIndex = i;
      }
    }
    return minIndex;
  }

  private calculatePathCost(path: Vec3[]): number {
    let cost = 0;
    for (let i = 1; i < path.length; i++) {
      cost += this.euclideanDistance(path[i - 1]!, path[i]!);
    }
    return cost;
  }

  private formatVec3(v: Vec3): string {
    return `(${v.x}, ${v.y}, ${v.z})`;
  }
}
