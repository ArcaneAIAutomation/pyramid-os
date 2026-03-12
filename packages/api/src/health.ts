/**
 * Health check system for PYRAMID OS.
 * Checks Ollama, SQLite, Minecraft Controller, agents, and disk space.
 * Runs periodically and enters safe mode on critical failures.
 *
 * Requirements: 13.6, 13.7, 29.1–29.9
 */

import type { Logger } from '@pyramid-os/logger';

export interface HealthCheckResult {
  component: string;
  status: 'healthy' | 'degraded' | 'critical';
  message: string;
  latencyMs: number;
  checkedAt: string;
}

export interface SystemHealth {
  overall: 'healthy' | 'degraded' | 'critical';
  checks: HealthCheckResult[];
  checkedAt: string;
}

/** Function signature for individual health check implementations. */
export type CheckFn = () => Promise<HealthCheckResult>;

/** Callback invoked when the system enters safe mode due to critical failures. */
export type OnCriticalCallback = (health: SystemHealth) => void;

/** Optional callback to persist health check results. */
export type PersistFn = (results: HealthCheckResult[]) => Promise<void>;

export interface HealthCheckerOptions {
  logger: Logger;
  checks: {
    ollama?: CheckFn;
    database?: CheckFn;
    minecraft?: CheckFn;
    agents?: CheckFn;
    diskSpace?: CheckFn;
  };
  onCritical?: OnCriticalCallback;
  persist?: PersistFn;
}

const DEFAULT_INTERVAL_MS = 60_000;

export class HealthChecker {
  private readonly logger: Logger;
  private readonly checks: Map<string, CheckFn>;
  private readonly onCritical: OnCriticalCallback | undefined;
  private readonly persist: PersistFn | undefined;
  private intervalHandle: ReturnType<typeof setInterval> | undefined;
  private lastResult: SystemHealth | undefined;

  constructor(options: HealthCheckerOptions) {
    this.logger = options.logger;
    this.onCritical = options.onCritical;
    this.persist = options.persist;

    this.checks = new Map();
    if (options.checks.ollama) this.checks.set('ollama', options.checks.ollama);
    if (options.checks.database) this.checks.set('database', options.checks.database);
    if (options.checks.minecraft) this.checks.set('minecraft', options.checks.minecraft);
    if (options.checks.agents) this.checks.set('agents', options.checks.agents);
    if (options.checks.diskSpace) this.checks.set('diskSpace', options.checks.diskSpace);
  }

  /**
   * Run all registered health checks and return aggregate result.
   * Overall status: 'critical' if any critical, 'degraded' if any degraded, else 'healthy'.
   */
  async runAll(): Promise<SystemHealth> {
    const results: HealthCheckResult[] = [];

    for (const [name, checkFn] of this.checks) {
      try {
        const result = await checkFn();
        results.push(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        results.push({
          component: name,
          status: 'critical',
          message: `Check threw: ${message}`,
          latencyMs: 0,
          checkedAt: new Date().toISOString(),
        });
      }
    }

    const overall = deriveOverallStatus(results);
    const health: SystemHealth = {
      overall,
      checks: results,
      checkedAt: new Date().toISOString(),
    };

    this.lastResult = health;

    // Log results
    for (const r of results) {
      if (r.status === 'critical') {
        this.logger.error(`Health check CRITICAL: ${r.component} — ${r.message}`);
      } else if (r.status === 'degraded') {
        this.logger.warn(`Health check degraded: ${r.component} — ${r.message}`, { component: r.component });
      } else {
        this.logger.info(`Health check OK: ${r.component}`, { component: r.component });
      }
    }

    // Persist results if a persist function is provided
    if (this.persist) {
      try {
        await this.persist(results);
      } catch (err) {
        this.logger.error('Failed to persist health check results', err instanceof Error ? err : undefined);
      }
    }

    // Enter safe mode on critical failures
    if (overall === 'critical' && this.onCritical) {
      this.logger.error('System entering safe mode due to critical health check failures');
      this.onCritical(health);
    }

    return health;
  }

  /**
   * Start periodic health checks.
   * @param intervalMs Interval between checks in milliseconds (default: 60000).
   */
  start(intervalMs: number = DEFAULT_INTERVAL_MS): void {
    if (this.intervalHandle) {
      return; // Already running
    }

    // Run immediately on startup (fire-and-forget, errors are logged inside runAll)
    void this.runAll();

    this.intervalHandle = setInterval(() => {
      void this.runAll();
    }, intervalMs);
  }

  /** Stop periodic health checks. */
  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = undefined;
    }
  }

  /** Return the most recent health check result, or undefined if none has run yet. */
  getLastResult(): SystemHealth | undefined {
    return this.lastResult;
  }
}

/**
 * Derive overall status from individual check results.
 * 'critical' if any critical, 'degraded' if any degraded, else 'healthy'.
 */
function deriveOverallStatus(results: HealthCheckResult[]): 'healthy' | 'degraded' | 'critical' {
  let hasDegraded = false;
  for (const r of results) {
    if (r.status === 'critical') return 'critical';
    if (r.status === 'degraded') hasDegraded = true;
  }
  return hasDegraded ? 'degraded' : 'healthy';
}

// ── Helper factory for creating standard check functions ──

/**
 * Create a health check function that measures latency and catches errors.
 * The `probe` function should throw on failure or return a status/message.
 */
export function createCheck(
  component: string,
  probe: () => Promise<{ status: 'healthy' | 'degraded' | 'critical'; message: string }>,
): CheckFn {
  return async (): Promise<HealthCheckResult> => {
    const start = Date.now();
    try {
      const { status, message } = await probe();
      return {
        component,
        status,
        message,
        latencyMs: Date.now() - start,
        checkedAt: new Date().toISOString(),
      };
    } catch (err) {
      return {
        component,
        status: 'critical',
        message: err instanceof Error ? err.message : String(err),
        latencyMs: Date.now() - start,
        checkedAt: new Date().toISOString(),
      };
    }
  };
}
