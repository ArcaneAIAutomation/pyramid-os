/**
 * Unit tests for RecoveryManagerImpl
 * Validates: Requirements 13.1, 13.2, 13.9, 13.10
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RecoveryManagerImpl } from '../recovery.js';
import type { SystemHealthState, RecoveryStrategy, ShutdownDeps, RecoveryManagerConfig } from '../recovery.js';

function makeShutdownDeps(): ShutdownDeps & { callOrder: string[] } {
  const callOrder: string[] = [];
  return {
    callOrder,
    pauseAgents: vi.fn(async () => { callOrder.push('pauseAgents'); }),
    disconnectBots: vi.fn(async () => { callOrder.push('disconnectBots'); }),
    persistState: vi.fn(async () => { callOrder.push('persistState'); }),
    createSnapshot: vi.fn(async () => { callOrder.push('createSnapshot'); }),
    closeDatabase: vi.fn(async () => { callOrder.push('closeDatabase'); }),
  };
}

function makeStrategy(opts: { maxRetries?: number; backoffBaseMs?: number; succeedOnAttempt?: number }):
  RecoveryStrategy & { attempts: number[] } {
  const attempts: number[] = [];
  const succeedOn = opts.succeedOnAttempt ?? 1;
  return {
    maxRetries: opts.maxRetries ?? 3,
    backoffBaseMs: opts.backoffBaseMs ?? 100,
    attempts,
    async recover(failure) { attempts.push(failure.retryCount); return failure.retryCount >= succeedOn; },
  };
}

function makeFailingStrategy(maxRetries = 3): RecoveryStrategy & { attempts: number[] } {
  const attempts: number[] = [];
  return {
    maxRetries, backoffBaseMs: 10, attempts,
    async recover(failure) { attempts.push(failure.retryCount); return false; },
  };
}

class TestableRecoveryManager extends RecoveryManagerImpl {
  public sleepCalls: number[] = [];
  protected override sleep(ms: number): Promise<void> {
    this.sleepCalls.push(ms);
    return Promise.resolve();
  }
}

function createManager(deps?: Partial<ShutdownDeps>, config?: Partial<RecoveryManagerConfig>): TestableRecoveryManager {
  const shutdownDeps = { ...makeShutdownDeps(), ...deps };
  return new TestableRecoveryManager(shutdownDeps, config);
}

describe('RecoveryManagerImpl', () => {
  describe('initial state', () => {
    it('starts in healthy state', () => {
      expect(createManager().getState()).toBe('healthy');
    });
    it('has no active failures initially', () => {
      expect(createManager().getActiveFailures()).toEqual([]);
    });
  });

  describe('reportFailure', () => {
    it('tracks consecutive failures per component', () => {
      const mgr = createManager();
      mgr.reportFailure('ollama', new Error('unreachable'));
      expect(mgr.getComponentFailureCount('ollama')).toBe(1);
      mgr.reportFailure('ollama', new Error('unreachable'));
      expect(mgr.getComponentFailureCount('ollama')).toBe(2);
    });
    it('tracks failures independently per component', () => {
      const mgr = createManager();
      mgr.reportFailure('ollama', new Error('fail'));
      mgr.reportFailure('minecraft', new Error('fail'));
      mgr.reportFailure('ollama', new Error('fail'));
      expect(mgr.getComponentFailureCount('ollama')).toBe(2);
      expect(mgr.getComponentFailureCount('minecraft')).toBe(1);
    });
    it('transitions to degraded after reaching threshold', () => {
      const mgr = createManager(undefined, { degradedThreshold: 2 });
      mgr.reportFailure('ollama', new Error('fail'));
      expect(mgr.getState()).toBe('healthy');
      mgr.reportFailure('ollama', new Error('fail'));
      expect(mgr.getState()).toBe('degraded');
    });
    it('transitions to critical after reaching critical threshold', () => {
      const mgr = createManager(undefined, { degradedThreshold: 2, criticalThreshold: 4 });
      for (let i = 0; i < 4; i++) mgr.reportFailure('ollama', new Error('fail'));
      expect(mgr.getState()).toBe('critical');
    });
    it('adds failure to active failures list', () => {
      const mgr = createManager();
      const err = new Error('test error');
      mgr.reportFailure('ollama', err);
      const failures = mgr.getActiveFailures();
      expect(failures).toHaveLength(1);
      expect(failures[0]!.component).toBe('ollama');
      expect(failures[0]!.error).toBe(err);
    });
    it('ignores failures after shutdown', async () => {
      const deps = makeShutdownDeps();
      const mgr = new TestableRecoveryManager(deps);
      await mgr.initiateShutdown();
      mgr.reportFailure('ollama', new Error('fail'));
      expect(mgr.getComponentFailureCount('ollama')).toBe(0);
    });
  });

  describe('reportRecovery', () => {
    it('resets consecutive failures for a component', () => {
      const mgr = createManager();
      mgr.reportFailure('ollama', new Error('fail'));
      mgr.reportFailure('ollama', new Error('fail'));
      expect(mgr.getComponentFailureCount('ollama')).toBe(2);
      mgr.reportRecovery('ollama');
      expect(mgr.getComponentFailureCount('ollama')).toBe(0);
    });
    it('transitions back to healthy when all components recover', () => {
      const mgr = createManager(undefined, { degradedThreshold: 2 });
      mgr.reportFailure('ollama', new Error('fail'));
      mgr.reportFailure('ollama', new Error('fail'));
      expect(mgr.getState()).toBe('degraded');
      mgr.reportRecovery('ollama');
      expect(mgr.getState()).toBe('healthy');
    });
    it('stays degraded if other components still failing', () => {
      const mgr = createManager(undefined, { degradedThreshold: 2 });
      mgr.reportFailure('ollama', new Error('fail'));
      mgr.reportFailure('ollama', new Error('fail'));
      mgr.reportFailure('minecraft', new Error('fail'));
      mgr.reportFailure('minecraft', new Error('fail'));
      mgr.reportRecovery('ollama');
      expect(mgr.getState()).toBe('degraded');
    });
    it('removes component from active failures', () => {
      const mgr = createManager();
      mgr.reportFailure('ollama', new Error('fail'));
      expect(mgr.getActiveFailures()).toHaveLength(1);
      mgr.reportRecovery('ollama');
      expect(mgr.getActiveFailures()).toHaveLength(0);
    });
    it('ignores recovery after shutdown', async () => {
      const deps = makeShutdownDeps();
      const mgr = new TestableRecoveryManager(deps);
      mgr.reportFailure('ollama', new Error('fail'));
      await mgr.initiateShutdown();
      mgr.reportRecovery('ollama');
      expect(mgr.getState()).toBe('shutdown');
    });
  });

  describe('attemptRecovery', () => {
    it('returns false when no strategy is registered', async () => {
      const mgr = createManager();
      mgr.reportFailure('ollama', new Error('fail'));
      expect(await mgr.attemptRecovery('ollama')).toBe(false);
    });
    it('returns false when component has no failure', async () => {
      const mgr = createManager();
      mgr.registerStrategy('ollama', makeStrategy({}));
      expect(await mgr.attemptRecovery('ollama')).toBe(false);
    });
    it('calls strategy.recover and returns true on success', async () => {
      const mgr = createManager();
      const strategy = makeStrategy({ succeedOnAttempt: 1 });
      mgr.registerStrategy('ollama', strategy);
      mgr.reportFailure('ollama', new Error('fail'));
      expect(await mgr.attemptRecovery('ollama')).toBe(true);
      expect(strategy.attempts.length).toBeGreaterThanOrEqual(1);
    });
    it('resets failure count on successful recovery', async () => {
      const mgr = createManager(undefined, { degradedThreshold: 2 });
      const strategy = makeStrategy({ succeedOnAttempt: 1 });
      mgr.registerStrategy('ollama', strategy);
      mgr.reportFailure('ollama', new Error('fail'));
      mgr.reportFailure('ollama', new Error('fail'));
      expect(mgr.getState()).toBe('degraded');
      await mgr.attemptRecovery('ollama');
      expect(mgr.getComponentFailureCount('ollama')).toBe(0);
      expect(mgr.getState()).toBe('healthy');
    });
    it('transitions to recovering state during recovery attempt', async () => {
      const mgr = createManager(undefined, { degradedThreshold: 1 });
      const states: SystemHealthState[] = [];
      mgr.onStateChange((_from, to) => states.push(to));
      let resolveRecover!: (v: boolean) => void;
      const strategy: RecoveryStrategy = {
        maxRetries: 1, backoffBaseMs: 10,
        async recover() { return new Promise<boolean>((r) => { resolveRecover = r; }); },
      };
      mgr.registerStrategy('ollama', strategy);
      mgr.reportFailure('ollama', new Error('fail'));
      const recoveryPromise = mgr.attemptRecovery('ollama');
      expect(mgr.getState()).toBe('recovering');
      resolveRecover(true);
      await recoveryPromise;
      expect(mgr.getState()).toBe('healthy');
    });
    it('uses exponential backoff between retries', async () => {
      const mgr = createManager();
      const strategy = makeStrategy({ maxRetries: 4, backoffBaseMs: 100, succeedOnAttempt: 4 });
      mgr.registerStrategy('ollama', strategy);
      mgr.reportFailure('ollama', new Error('fail'));
      await mgr.attemptRecovery('ollama');
      expect(mgr.sleepCalls).toEqual([100, 200, 400]);
    });
    it('returns false when all retries are exhausted', async () => {
      const mgr = createManager();
      const strategy = makeFailingStrategy(3);
      mgr.registerStrategy('ollama', strategy);
      mgr.reportFailure('ollama', new Error('fail'));
      expect(await mgr.attemptRecovery('ollama')).toBe(false);
      expect(strategy.attempts).toHaveLength(3);
    });
    it('handles strategy.recover throwing errors', async () => {
      const mgr = createManager();
      let callCount = 0;
      const strategy: RecoveryStrategy = {
        maxRetries: 3, backoffBaseMs: 10,
        async recover() { callCount++; if (callCount < 3) throw new Error('crash'); return true; },
      };
      mgr.registerStrategy('ollama', strategy);
      mgr.reportFailure('ollama', new Error('fail'));
      expect(await mgr.attemptRecovery('ollama')).toBe(true);
      expect(callCount).toBe(3);
    });
    it('returns false after shutdown', async () => {
      const deps = makeShutdownDeps();
      const mgr = new TestableRecoveryManager(deps);
      mgr.registerStrategy('ollama', makeStrategy({}));
      mgr.reportFailure('ollama', new Error('fail'));
      await mgr.initiateShutdown();
      expect(await mgr.attemptRecovery('ollama')).toBe(false);
    });
  });

  describe('registerStrategy', () => {
    it('initializes component tracking on registration', () => {
      const mgr = createManager();
      mgr.registerStrategy('ollama', makeStrategy({}));
      expect(mgr.getComponentFailureCount('ollama')).toBe(0);
    });
    it('allows overriding a strategy', async () => {
      const mgr = createManager();
      mgr.registerStrategy('ollama', makeFailingStrategy(1));
      mgr.reportFailure('ollama', new Error('fail'));
      expect(await mgr.attemptRecovery('ollama')).toBe(false);
      mgr.registerStrategy('ollama', makeStrategy({ succeedOnAttempt: 1 }));
      mgr.reportFailure('ollama', new Error('fail'));
      expect(await mgr.attemptRecovery('ollama')).toBe(true);
    });
  });

  describe('state transitions', () => {
    it('fires onStateChange callback on transitions', () => {
      const mgr = createManager(undefined, { degradedThreshold: 2 });
      const transitions: Array<{ from: SystemHealthState; to: SystemHealthState }> = [];
      mgr.onStateChange((from, to) => transitions.push({ from, to }));
      mgr.reportFailure('ollama', new Error('fail'));
      mgr.reportFailure('ollama', new Error('fail'));
      expect(transitions).toEqual([{ from: 'healthy', to: 'degraded' }]);
    });
    it('fires callback for recovery transition', () => {
      const mgr = createManager(undefined, { degradedThreshold: 2 });
      mgr.reportFailure('ollama', new Error('fail'));
      mgr.reportFailure('ollama', new Error('fail'));
      const transitions: Array<{ from: SystemHealthState; to: SystemHealthState }> = [];
      mgr.onStateChange((from, to) => transitions.push({ from, to }));
      mgr.reportRecovery('ollama');
      expect(transitions).toEqual([{ from: 'degraded', to: 'healthy' }]);
    });
    it('transitions healthy -> degraded -> critical', () => {
      const mgr = createManager(undefined, { degradedThreshold: 2, criticalThreshold: 4 });
      const transitions: Array<{ from: SystemHealthState; to: SystemHealthState }> = [];
      mgr.onStateChange((from, to) => transitions.push({ from, to }));
      for (let i = 0; i < 4; i++) mgr.reportFailure('ollama', new Error('fail'));
      expect(transitions).toEqual([
        { from: 'healthy', to: 'degraded' },
        { from: 'degraded', to: 'critical' },
      ]);
    });
    it('swallows listener errors without breaking state machine', () => {
      const mgr = createManager(undefined, { degradedThreshold: 1 });
      mgr.onStateChange(() => { throw new Error('listener boom'); });
      mgr.reportFailure('ollama', new Error('fail'));
      expect(mgr.getState()).toBe('degraded');
    });
    it('calls all listeners even if one throws', () => {
      const mgr = createManager(undefined, { degradedThreshold: 1 });
      const secondListener = vi.fn();
      mgr.onStateChange(() => { throw new Error('boom'); });
      mgr.onStateChange(secondListener);
      mgr.reportFailure('ollama', new Error('fail'));
      expect(secondListener).toHaveBeenCalledWith('healthy', 'degraded');
    });
  });

  describe('initiateShutdown', () => {
    it('transitions to shutdown state', async () => {
      const deps = makeShutdownDeps();
      const mgr = new TestableRecoveryManager(deps);
      await mgr.initiateShutdown();
      expect(mgr.getState()).toBe('shutdown');
    });
    it('executes shutdown steps in correct order', async () => {
      const deps = makeShutdownDeps();
      const mgr = new TestableRecoveryManager(deps);
      await mgr.initiateShutdown();
      expect(deps.callOrder).toEqual([
        'pauseAgents', 'disconnectBots', 'persistState', 'createSnapshot', 'closeDatabase',
      ]);
    });
    it('calls all shutdown deps', async () => {
      const deps = makeShutdownDeps();
      const mgr = new TestableRecoveryManager(deps);
      await mgr.initiateShutdown();
      expect(deps.pauseAgents).toHaveBeenCalledOnce();
      expect(deps.disconnectBots).toHaveBeenCalledOnce();
      expect(deps.persistState).toHaveBeenCalledOnce();
      expect(deps.createSnapshot).toHaveBeenCalledOnce();
      expect(deps.closeDatabase).toHaveBeenCalledOnce();
    });
    it('is idempotent -- second call is a no-op', async () => {
      const deps = makeShutdownDeps();
      const mgr = new TestableRecoveryManager(deps);
      await mgr.initiateShutdown();
      await mgr.initiateShutdown();
      expect(deps.pauseAgents).toHaveBeenCalledOnce();
    });
    it('fires state change listener for shutdown', async () => {
      const deps = makeShutdownDeps();
      const mgr = new TestableRecoveryManager(deps);
      const transitions: Array<{ from: SystemHealthState; to: SystemHealthState }> = [];
      mgr.onStateChange((from, to) => transitions.push({ from, to }));
      await mgr.initiateShutdown();
      expect(transitions).toEqual([{ from: 'healthy', to: 'shutdown' }]);
    });
    it('can shutdown from degraded state', async () => {
      const deps = makeShutdownDeps();
      const mgr = new TestableRecoveryManager(deps, { degradedThreshold: 1 });
      mgr.reportFailure('ollama', new Error('fail'));
      expect(mgr.getState()).toBe('degraded');
      await mgr.initiateShutdown();
      expect(mgr.getState()).toBe('shutdown');
      expect(deps.callOrder).toEqual([
        'pauseAgents', 'disconnectBots', 'persistState', 'createSnapshot', 'closeDatabase',
      ]);
    });
    it('can shutdown from critical state', async () => {
      const deps = makeShutdownDeps();
      const mgr = new TestableRecoveryManager(deps, { degradedThreshold: 1, criticalThreshold: 2 });
      mgr.reportFailure('ollama', new Error('fail'));
      mgr.reportFailure('ollama', new Error('fail'));
      expect(mgr.getState()).toBe('critical');
      await mgr.initiateShutdown();
      expect(mgr.getState()).toBe('shutdown');
    });
  });

  describe('full lifecycle', () => {
    it('healthy -> degraded -> recovering -> healthy', async () => {
      const mgr = createManager(undefined, { degradedThreshold: 2 });
      const transitions: Array<{ from: SystemHealthState; to: SystemHealthState }> = [];
      mgr.onStateChange((from, to) => transitions.push({ from, to }));
      const strategy = makeStrategy({ succeedOnAttempt: 1 });
      mgr.registerStrategy('ollama', strategy);
      mgr.reportFailure('ollama', new Error('fail'));
      mgr.reportFailure('ollama', new Error('fail'));
      expect(mgr.getState()).toBe('degraded');
      const result = await mgr.attemptRecovery('ollama');
      expect(result).toBe(true);
      expect(mgr.getState()).toBe('healthy');
      expect(transitions).toEqual([
        { from: 'healthy', to: 'degraded' },
        { from: 'degraded', to: 'recovering' },
        { from: 'recovering', to: 'healthy' },
      ]);
    });
    it('healthy -> degraded -> recovering -> degraded (failed recovery)', async () => {
      const mgr = createManager(undefined, { degradedThreshold: 2, criticalThreshold: 10 });
      const transitions: Array<{ from: SystemHealthState; to: SystemHealthState }> = [];
      mgr.onStateChange((from, to) => transitions.push({ from, to }));
      const strategy = makeFailingStrategy(2);
      mgr.registerStrategy('ollama', strategy);
      mgr.reportFailure('ollama', new Error('fail'));
      mgr.reportFailure('ollama', new Error('fail'));
      expect(mgr.getState()).toBe('degraded');
      const result = await mgr.attemptRecovery('ollama');
      expect(result).toBe(false);
      expect(mgr.getState()).toBe('degraded');
      expect(transitions).toEqual([
        { from: 'healthy', to: 'degraded' },
        { from: 'degraded', to: 'recovering' },
        { from: 'recovering', to: 'degraded' },
      ]);
    });
    it('multiple components failing and recovering independently', () => {
      const mgr = createManager(undefined, { degradedThreshold: 2 });
      mgr.reportFailure('ollama', new Error('fail'));
      mgr.reportFailure('ollama', new Error('fail'));
      expect(mgr.getState()).toBe('degraded');
      mgr.reportFailure('minecraft', new Error('fail'));
      mgr.reportFailure('minecraft', new Error('fail'));
      expect(mgr.getState()).toBe('degraded');
      mgr.reportRecovery('ollama');
      expect(mgr.getState()).toBe('degraded');
      mgr.reportRecovery('minecraft');
      expect(mgr.getState()).toBe('healthy');
    });
  });
});
