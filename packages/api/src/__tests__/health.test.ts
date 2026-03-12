import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HealthChecker, createCheck } from '../health.js';
import type {
  HealthCheckResult,
  SystemHealth,
  CheckFn,
  HealthCheckerOptions,
} from '../health.js';
import type { Logger } from '@pyramid-os/logger';

function createMockLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function makeHealthy(component: string): CheckFn {
  return async () => ({
    component,
    status: 'healthy',
    message: 'OK',
    latencyMs: 1,
    checkedAt: new Date().toISOString(),
  });
}

function makeDegraded(component: string): CheckFn {
  return async () => ({
    component,
    status: 'degraded',
    message: 'Slow response',
    latencyMs: 500,
    checkedAt: new Date().toISOString(),
  });
}

function makeCritical(component: string): CheckFn {
  return async () => ({
    component,
    status: 'critical',
    message: 'Unreachable',
    latencyMs: 0,
    checkedAt: new Date().toISOString(),
  });
}

describe('HealthChecker', () => {
  let logger: Logger;

  beforeEach(() => {
    vi.useFakeTimers();
    logger = createMockLogger();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('runAll', () => {
    it('should return healthy when all checks pass', async () => {
      const checker = new HealthChecker({
        logger,
        checks: {
          ollama: makeHealthy('ollama'),
          database: makeHealthy('database'),
        },
      });

      const result = await checker.runAll();

      expect(result.overall).toBe('healthy');
      expect(result.checks).toHaveLength(2);
      expect(result.checks.every((c) => c.status === 'healthy')).toBe(true);
      expect(result.checkedAt).toBeDefined();
    });

    it('should return degraded when any check is degraded', async () => {
      const checker = new HealthChecker({
        logger,
        checks: {
          ollama: makeHealthy('ollama'),
          database: makeDegraded('database'),
          minecraft: makeHealthy('minecraft'),
        },
      });

      const result = await checker.runAll();

      expect(result.overall).toBe('degraded');
    });

    it('should return critical when any check is critical', async () => {
      const checker = new HealthChecker({
        logger,
        checks: {
          ollama: makeCritical('ollama'),
          database: makeHealthy('database'),
        },
      });

      const result = await checker.runAll();

      expect(result.overall).toBe('critical');
    });

    it('should prioritize critical over degraded', async () => {
      const checker = new HealthChecker({
        logger,
        checks: {
          ollama: makeCritical('ollama'),
          database: makeDegraded('database'),
          minecraft: makeHealthy('minecraft'),
        },
      });

      const result = await checker.runAll();

      expect(result.overall).toBe('critical');
    });

    it('should handle check functions that throw', async () => {
      const throwingCheck: CheckFn = async () => {
        throw new Error('Connection refused');
      };

      const checker = new HealthChecker({
        logger,
        checks: {
          ollama: throwingCheck,
          database: makeHealthy('database'),
        },
      });

      const result = await checker.runAll();

      expect(result.overall).toBe('critical');
      const ollamaResult = result.checks.find((c) => c.component === 'ollama');
      expect(ollamaResult?.status).toBe('critical');
      expect(ollamaResult?.message).toContain('Connection refused');
    });

    it('should return healthy with no checks registered', async () => {
      const checker = new HealthChecker({
        logger,
        checks: {},
      });

      const result = await checker.runAll();

      expect(result.overall).toBe('healthy');
      expect(result.checks).toHaveLength(0);
    });

    it('should log critical results as errors', async () => {
      const checker = new HealthChecker({
        logger,
        checks: {
          ollama: makeCritical('ollama'),
        },
      });

      await checker.runAll();

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('CRITICAL'),
      );
    });

    it('should log degraded results as warnings', async () => {
      const checker = new HealthChecker({
        logger,
        checks: {
          database: makeDegraded('database'),
        },
      });

      await checker.runAll();

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('degraded'),
        expect.any(Object),
      );
    });

    it('should log healthy results as info', async () => {
      const checker = new HealthChecker({
        logger,
        checks: {
          ollama: makeHealthy('ollama'),
        },
      });

      await checker.runAll();

      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('OK'),
        expect.any(Object),
      );
    });
  });

  describe('onCritical callback', () => {
    it('should invoke onCritical when overall status is critical', async () => {
      const onCritical = vi.fn();
      const checker = new HealthChecker({
        logger,
        checks: {
          ollama: makeCritical('ollama'),
        },
        onCritical,
      });

      const result = await checker.runAll();

      expect(onCritical).toHaveBeenCalledTimes(1);
      expect(onCritical).toHaveBeenCalledWith(result);
    });

    it('should not invoke onCritical when status is degraded', async () => {
      const onCritical = vi.fn();
      const checker = new HealthChecker({
        logger,
        checks: {
          database: makeDegraded('database'),
        },
        onCritical,
      });

      await checker.runAll();

      expect(onCritical).not.toHaveBeenCalled();
    });

    it('should not invoke onCritical when status is healthy', async () => {
      const onCritical = vi.fn();
      const checker = new HealthChecker({
        logger,
        checks: {
          ollama: makeHealthy('ollama'),
        },
        onCritical,
      });

      await checker.runAll();

      expect(onCritical).not.toHaveBeenCalled();
    });
  });

  describe('persist', () => {
    it('should call persist with check results', async () => {
      const persist = vi.fn().mockResolvedValue(undefined);
      const checker = new HealthChecker({
        logger,
        checks: {
          ollama: makeHealthy('ollama'),
          database: makeDegraded('database'),
        },
        persist,
      });

      await checker.runAll();

      expect(persist).toHaveBeenCalledTimes(1);
      const call = persist.mock.calls[0];
      expect(call).toBeDefined();
      const persistedResults = call![0] as HealthCheckResult[];
      expect(persistedResults).toHaveLength(2);
    });

    it('should log error when persist fails without crashing', async () => {
      const persist = vi.fn().mockRejectedValue(new Error('DB write failed'));
      const checker = new HealthChecker({
        logger,
        checks: {
          ollama: makeHealthy('ollama'),
        },
        persist,
      });

      const result = await checker.runAll();

      // Should still return a valid result
      expect(result.overall).toBe('healthy');
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('persist'),
        expect.any(Error),
      );
    });
  });

  describe('getLastResult', () => {
    it('should return undefined before any check has run', () => {
      const checker = new HealthChecker({
        logger,
        checks: { ollama: makeHealthy('ollama') },
      });

      expect(checker.getLastResult()).toBeUndefined();
    });

    it('should return the most recent result after runAll', async () => {
      const checker = new HealthChecker({
        logger,
        checks: { ollama: makeHealthy('ollama') },
      });

      const result = await checker.runAll();

      expect(checker.getLastResult()).toBe(result);
    });

    it('should update on subsequent runs', async () => {
      let callCount = 0;
      const toggleCheck: CheckFn = async () => {
        callCount++;
        return {
          component: 'ollama',
          status: callCount === 1 ? 'healthy' : 'degraded',
          message: callCount === 1 ? 'OK' : 'Slow',
          latencyMs: 1,
          checkedAt: new Date().toISOString(),
        };
      };

      const checker = new HealthChecker({
        logger,
        checks: { ollama: toggleCheck },
      });

      await checker.runAll();
      const first = checker.getLastResult();
      expect(first).toBeDefined();
      expect(first!.overall).toBe('healthy');

      await checker.runAll();
      const second = checker.getLastResult();
      expect(second).toBeDefined();
      expect(second!.overall).toBe('degraded');
    });
  });

  describe('start / stop', () => {
    it('should run checks immediately on start', async () => {
      const checkFn = vi.fn().mockResolvedValue({
        component: 'ollama',
        status: 'healthy',
        message: 'OK',
        latencyMs: 1,
        checkedAt: new Date().toISOString(),
      } satisfies HealthCheckResult);

      const checker = new HealthChecker({
        logger,
        checks: { ollama: checkFn },
      });

      checker.start(60_000);

      // The immediate runAll is fire-and-forget; flush microtasks
      await vi.advanceTimersByTimeAsync(0);

      expect(checkFn).toHaveBeenCalled();

      checker.stop();
    });

    it('should run checks periodically at the given interval', async () => {
      const checkFn = vi.fn().mockResolvedValue({
        component: 'ollama',
        status: 'healthy',
        message: 'OK',
        latencyMs: 1,
        checkedAt: new Date().toISOString(),
      } satisfies HealthCheckResult);

      const checker = new HealthChecker({
        logger,
        checks: { ollama: checkFn },
      });

      checker.start(1000);

      // Flush the immediate call
      await vi.advanceTimersByTimeAsync(0);
      const initialCalls = checkFn.mock.calls.length;

      // Advance by 3 intervals
      await vi.advanceTimersByTimeAsync(3000);

      // Should have the initial call + 3 interval calls
      expect(checkFn.mock.calls.length).toBe(initialCalls + 3);

      checker.stop();
    });

    it('should stop periodic checks when stop is called', async () => {
      const checkFn = vi.fn().mockResolvedValue({
        component: 'ollama',
        status: 'healthy',
        message: 'OK',
        latencyMs: 1,
        checkedAt: new Date().toISOString(),
      } satisfies HealthCheckResult);

      const checker = new HealthChecker({
        logger,
        checks: { ollama: checkFn },
      });

      checker.start(1000);
      await vi.advanceTimersByTimeAsync(0);
      const callsAfterStart = checkFn.mock.calls.length;

      checker.stop();

      await vi.advanceTimersByTimeAsync(5000);

      // No additional calls after stop
      expect(checkFn.mock.calls.length).toBe(callsAfterStart);
    });

    it('should not start a second interval if already running', async () => {
      const checkFn = vi.fn().mockResolvedValue({
        component: 'ollama',
        status: 'healthy',
        message: 'OK',
        latencyMs: 1,
        checkedAt: new Date().toISOString(),
      } satisfies HealthCheckResult);

      const checker = new HealthChecker({
        logger,
        checks: { ollama: checkFn },
      });

      checker.start(1000);
      checker.start(1000); // second call should be a no-op

      await vi.advanceTimersByTimeAsync(0);
      const callsAfterStart = checkFn.mock.calls.length;

      await vi.advanceTimersByTimeAsync(1000);

      // Only 1 interval tick, not 2
      expect(checkFn.mock.calls.length).toBe(callsAfterStart + 1);

      checker.stop();
    });

    it('should default to 60 second interval', async () => {
      const checkFn = vi.fn().mockResolvedValue({
        component: 'ollama',
        status: 'healthy',
        message: 'OK',
        latencyMs: 1,
        checkedAt: new Date().toISOString(),
      } satisfies HealthCheckResult);

      const checker = new HealthChecker({
        logger,
        checks: { ollama: checkFn },
      });

      checker.start(); // no argument — should use 60s default

      await vi.advanceTimersByTimeAsync(0);
      const callsAfterStart = checkFn.mock.calls.length;

      // Advance 59 seconds — no new interval tick yet
      await vi.advanceTimersByTimeAsync(59_000);
      expect(checkFn.mock.calls.length).toBe(callsAfterStart);

      // Advance 1 more second — now the interval fires
      await vi.advanceTimersByTimeAsync(1_000);
      expect(checkFn.mock.calls.length).toBe(callsAfterStart + 1);

      checker.stop();
    });
  });

  describe('all five check types', () => {
    it('should run all five checks and aggregate correctly', async () => {
      const checker = new HealthChecker({
        logger,
        checks: {
          ollama: makeHealthy('ollama'),
          database: makeHealthy('database'),
          minecraft: makeHealthy('minecraft'),
          agents: makeHealthy('agents'),
          diskSpace: makeHealthy('diskSpace'),
        },
      });

      const result = await checker.runAll();

      expect(result.overall).toBe('healthy');
      expect(result.checks).toHaveLength(5);
      const components = result.checks.map((c) => c.component).sort();
      expect(components).toEqual(['agents', 'database', 'diskSpace', 'minecraft', 'ollama']);
    });
  });
});

describe('createCheck', () => {
  it('should create a check that returns healthy on success', async () => {
    const check = createCheck('ollama', async () => ({
      status: 'healthy',
      message: 'Connected',
    }));

    const result = await check();

    expect(result.component).toBe('ollama');
    expect(result.status).toBe('healthy');
    expect(result.message).toBe('Connected');
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.checkedAt).toBeDefined();
  });

  it('should create a check that returns critical when probe throws', async () => {
    const check = createCheck('database', async () => {
      throw new Error('SQLITE_CANTOPEN');
    });

    const result = await check();

    expect(result.component).toBe('database');
    expect(result.status).toBe('critical');
    expect(result.message).toContain('SQLITE_CANTOPEN');
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('should measure latency', async () => {
    const check = createCheck('slow', async () => {
      await new Promise((r) => setTimeout(r, 50));
      return { status: 'healthy', message: 'OK' };
    });

    // Use real timers for latency measurement
    vi.useRealTimers();
    const result = await check();
    vi.useFakeTimers();

    expect(result.latencyMs).toBeGreaterThanOrEqual(40); // allow some tolerance
  });

  it('should return degraded status from probe', async () => {
    const check = createCheck('diskSpace', async () => ({
      status: 'degraded',
      message: 'Only 500MB free',
    }));

    const result = await check();

    expect(result.status).toBe('degraded');
    expect(result.message).toBe('Only 500MB free');
  });
});
