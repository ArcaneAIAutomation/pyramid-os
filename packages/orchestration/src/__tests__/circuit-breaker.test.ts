/**
 * Unit tests for CircuitBreakerImpl
 *
 * Validates: Requirements 13.8
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  CircuitBreakerImpl,
  CircuitOpenError,
  CIRCUIT_BREAKER_DEFAULTS,
} from '../circuit-breaker.js';
import type { CircuitBreakerConfig, CircuitState } from '../circuit-breaker.js';

/** Minimal config for fast tests */
const TEST_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 3,
  cooldownMs: 1000,
  successThreshold: 2,
  operationTimeoutMs: 5000,
};

describe('CircuitBreakerImpl', () => {
  let currentTime: number;
  let clock: () => number;
  let breaker: CircuitBreakerImpl<string>;

  beforeEach(() => {
    currentTime = 0;
    clock = () => currentTime;
    breaker = new CircuitBreakerImpl('test', TEST_CONFIG, clock);
  });

  // -----------------------------------------------------------------------
  // Initial state
  // -----------------------------------------------------------------------
  describe('initial state', () => {
    it('starts in closed state', () => {
      expect(breaker.getState()).toBe('closed');
    });

    it('starts with zero failure count', () => {
      expect(breaker.getFailureCount()).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // Closed state — normal operation
  // -----------------------------------------------------------------------
  describe('closed state', () => {
    it('passes through successful operations', async () => {
      const result = await breaker.execute(() => Promise.resolve('ok'));
      expect(result).toBe('ok');
      expect(breaker.getState()).toBe('closed');
    });

    it('increments failure count on failure', async () => {
      await expect(breaker.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow('fail');
      expect(breaker.getFailureCount()).toBe(1);
      expect(breaker.getState()).toBe('closed');
    });

    it('resets failure count on success', async () => {
      // Two failures
      await expect(breaker.execute(() => Promise.reject(new Error('f1')))).rejects.toThrow();
      await expect(breaker.execute(() => Promise.reject(new Error('f2')))).rejects.toThrow();
      expect(breaker.getFailureCount()).toBe(2);

      // One success resets
      await breaker.execute(() => Promise.resolve('ok'));
      expect(breaker.getFailureCount()).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // Closed → Open transition
  // -----------------------------------------------------------------------
  describe('closed → open transition', () => {
    it('opens after failureThreshold consecutive failures', async () => {
      for (let i = 0; i < TEST_CONFIG.failureThreshold; i++) {
        await expect(breaker.execute(() => Promise.reject(new Error(`fail-${i}`)))).rejects.toThrow();
      }
      expect(breaker.getState()).toBe('open');
    });

    it('does not open before reaching the threshold', async () => {
      for (let i = 0; i < TEST_CONFIG.failureThreshold - 1; i++) {
        await expect(breaker.execute(() => Promise.reject(new Error(`fail-${i}`)))).rejects.toThrow();
      }
      expect(breaker.getState()).toBe('closed');
    });

    it('fires onStateChange callback on transition', async () => {
      const transitions: Array<{ from: CircuitState; to: CircuitState }> = [];
      breaker.onStateChange((from, to) => transitions.push({ from, to }));

      for (let i = 0; i < TEST_CONFIG.failureThreshold; i++) {
        await expect(breaker.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow();
      }

      expect(transitions).toEqual([{ from: 'closed', to: 'open' }]);
    });
  });

  // -----------------------------------------------------------------------
  // Open state — rejecting calls
  // -----------------------------------------------------------------------
  describe('open state', () => {
    beforeEach(async () => {
      // Drive to open
      for (let i = 0; i < TEST_CONFIG.failureThreshold; i++) {
        await expect(breaker.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow();
      }
      expect(breaker.getState()).toBe('open');
    });

    it('rejects calls with CircuitOpenError', async () => {
      await expect(breaker.execute(() => Promise.resolve('ok'))).rejects.toThrow(CircuitOpenError);
    });

    it('includes dependency name in the error', async () => {
      try {
        await breaker.execute(() => Promise.resolve('ok'));
      } catch (e) {
        expect(e).toBeInstanceOf(CircuitOpenError);
        expect((e as CircuitOpenError).dependency).toBe('test');
      }
    });

    it('does not call the operation when open', async () => {
      const op = vi.fn(() => Promise.resolve('ok'));
      await expect(breaker.execute(op)).rejects.toThrow(CircuitOpenError);
      expect(op).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // Open → Half-Open transition (cooldown)
  // -----------------------------------------------------------------------
  describe('open → half-open transition', () => {
    beforeEach(async () => {
      for (let i = 0; i < TEST_CONFIG.failureThreshold; i++) {
        await expect(breaker.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow();
      }
    });

    it('transitions to half-open after cooldown elapses', () => {
      currentTime += TEST_CONFIG.cooldownMs;
      expect(breaker.getState()).toBe('half-open');
    });

    it('stays open before cooldown elapses', () => {
      currentTime += TEST_CONFIG.cooldownMs - 1;
      expect(breaker.getState()).toBe('open');
    });

    it('allows a probe call in half-open state', async () => {
      currentTime += TEST_CONFIG.cooldownMs;
      const result = await breaker.execute(() => Promise.resolve('probe-ok'));
      expect(result).toBe('probe-ok');
    });

    it('fires onStateChange for open → half-open', async () => {
      const transitions: Array<{ from: CircuitState; to: CircuitState }> = [];
      breaker.onStateChange((from, to) => transitions.push({ from, to }));

      currentTime += TEST_CONFIG.cooldownMs;
      breaker.getState(); // triggers transition check

      expect(transitions).toContainEqual({ from: 'open', to: 'half-open' });
    });
  });

  // -----------------------------------------------------------------------
  // Half-Open → Closed (recovery)
  // -----------------------------------------------------------------------
  describe('half-open → closed transition', () => {
    beforeEach(async () => {
      // Drive to open, then to half-open
      for (let i = 0; i < TEST_CONFIG.failureThreshold; i++) {
        await expect(breaker.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow();
      }
      currentTime += TEST_CONFIG.cooldownMs;
    });

    it('closes after successThreshold consecutive successes', async () => {
      for (let i = 0; i < TEST_CONFIG.successThreshold; i++) {
        await breaker.execute(() => Promise.resolve('ok'));
      }
      expect(breaker.getState()).toBe('closed');
    });

    it('does not close before reaching successThreshold', async () => {
      for (let i = 0; i < TEST_CONFIG.successThreshold - 1; i++) {
        await breaker.execute(() => Promise.resolve('ok'));
      }
      expect(breaker.getState()).toBe('half-open');
    });

    it('resets failure count when closing', async () => {
      for (let i = 0; i < TEST_CONFIG.successThreshold; i++) {
        await breaker.execute(() => Promise.resolve('ok'));
      }
      expect(breaker.getFailureCount()).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // Half-Open → Open (failure during probe)
  // -----------------------------------------------------------------------
  describe('half-open → open on failure', () => {
    beforeEach(async () => {
      for (let i = 0; i < TEST_CONFIG.failureThreshold; i++) {
        await expect(breaker.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow();
      }
      currentTime += TEST_CONFIG.cooldownMs;
      // Now in half-open
      expect(breaker.getState()).toBe('half-open');
    });

    it('goes back to open on any failure in half-open', async () => {
      await expect(breaker.execute(() => Promise.reject(new Error('probe-fail')))).rejects.toThrow();
      expect(breaker.getState()).toBe('open');
    });

    it('fires onStateChange for half-open → open', async () => {
      const transitions: Array<{ from: CircuitState; to: CircuitState }> = [];
      breaker.onStateChange((from, to) => transitions.push({ from, to }));

      await expect(breaker.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow();

      expect(transitions).toContainEqual({ from: 'half-open', to: 'open' });
    });
  });

  // -----------------------------------------------------------------------
  // Manual reset
  // -----------------------------------------------------------------------
  describe('reset()', () => {
    it('resets from open to closed', async () => {
      for (let i = 0; i < TEST_CONFIG.failureThreshold; i++) {
        await expect(breaker.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow();
      }
      expect(breaker.getState()).toBe('open');

      breaker.reset();
      expect(breaker.getState()).toBe('closed');
      expect(breaker.getFailureCount()).toBe(0);
    });

    it('resets from half-open to closed', async () => {
      for (let i = 0; i < TEST_CONFIG.failureThreshold; i++) {
        await expect(breaker.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow();
      }
      currentTime += TEST_CONFIG.cooldownMs;
      expect(breaker.getState()).toBe('half-open');

      breaker.reset();
      expect(breaker.getState()).toBe('closed');
    });

    it('fires onStateChange on reset', async () => {
      for (let i = 0; i < TEST_CONFIG.failureThreshold; i++) {
        await expect(breaker.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow();
      }

      const transitions: Array<{ from: CircuitState; to: CircuitState }> = [];
      breaker.onStateChange((from, to) => transitions.push({ from, to }));

      breaker.reset();
      expect(transitions).toContainEqual({ from: 'open', to: 'closed' });
    });

    it('does not fire onStateChange when already closed', () => {
      const cb = vi.fn();
      breaker.onStateChange(cb);
      breaker.reset();
      expect(cb).not.toHaveBeenCalled();
    });

    it('allows operations after reset', async () => {
      for (let i = 0; i < TEST_CONFIG.failureThreshold; i++) {
        await expect(breaker.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow();
      }
      breaker.reset();

      const result = await breaker.execute(() => Promise.resolve('recovered'));
      expect(result).toBe('recovered');
    });
  });


  // -----------------------------------------------------------------------
  // Operation timeout
  // -----------------------------------------------------------------------
  describe('operation timeout', () => {
    it('rejects when operation exceeds timeout', async () => {
      const slowBreaker = new CircuitBreakerImpl<string>(
        'slow',
        { ...TEST_CONFIG, operationTimeoutMs: 50 },
        clock,
      );

      await expect(
        slowBreaker.execute(
          () => new Promise((resolve) => setTimeout(() => resolve('late'), 200)),
        ),
      ).rejects.toThrow(/timed out/);
    });

    it('counts timeout as a failure', async () => {
      const slowBreaker = new CircuitBreakerImpl<string>(
        'slow',
        { ...TEST_CONFIG, operationTimeoutMs: 50 },
        clock,
      );

      await expect(
        slowBreaker.execute(
          () => new Promise((resolve) => setTimeout(() => resolve('late'), 200)),
        ),
      ).rejects.toThrow();

      expect(slowBreaker.getFailureCount()).toBe(1);
    });
  });

  // -----------------------------------------------------------------------
  // onStateChange listener resilience
  // -----------------------------------------------------------------------
  describe('listener error handling', () => {
    it('does not break the breaker if a listener throws', async () => {
      breaker.onStateChange(() => {
        throw new Error('listener boom');
      });

      // Should still transition correctly despite listener error
      for (let i = 0; i < TEST_CONFIG.failureThreshold; i++) {
        await expect(breaker.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow();
      }
      expect(breaker.getState()).toBe('open');
    });

    it('calls all listeners even if one throws', async () => {
      const secondListener = vi.fn();
      breaker.onStateChange(() => {
        throw new Error('first listener boom');
      });
      breaker.onStateChange(secondListener);

      for (let i = 0; i < TEST_CONFIG.failureThreshold; i++) {
        await expect(breaker.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow();
      }

      expect(secondListener).toHaveBeenCalledWith('closed', 'open');
    });
  });

  // -----------------------------------------------------------------------
  // Default configs
  // -----------------------------------------------------------------------
  describe('CIRCUIT_BREAKER_DEFAULTS', () => {
    it('has config for ollama', () => {
      const cfg = CIRCUIT_BREAKER_DEFAULTS['ollama']!;
      expect(cfg).toBeDefined();
      expect(cfg.failureThreshold).toBe(3);
      expect(cfg.cooldownMs).toBe(30_000);
    });

    it('has config for minecraft', () => {
      const cfg = CIRCUIT_BREAKER_DEFAULTS['minecraft']!;
      expect(cfg).toBeDefined();
      expect(cfg.failureThreshold).toBe(5);
      expect(cfg.cooldownMs).toBe(10_000);
    });

    it('has config for sqlite', () => {
      const cfg = CIRCUIT_BREAKER_DEFAULTS['sqlite']!;
      expect(cfg).toBeDefined();
      expect(cfg.failureThreshold).toBe(3);
      expect(cfg.cooldownMs).toBe(5_000);
    });
  });

  // -----------------------------------------------------------------------
  // Full lifecycle: closed → open → half-open → closed
  // -----------------------------------------------------------------------
  describe('full lifecycle', () => {
    it('completes a full recovery cycle', async () => {
      const transitions: Array<{ from: CircuitState; to: CircuitState }> = [];
      breaker.onStateChange((from, to) => transitions.push({ from, to }));

      // 1. Drive to open with consecutive failures
      for (let i = 0; i < TEST_CONFIG.failureThreshold; i++) {
        await expect(breaker.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow();
      }
      expect(breaker.getState()).toBe('open');

      // 2. Wait for cooldown → half-open
      currentTime += TEST_CONFIG.cooldownMs;
      expect(breaker.getState()).toBe('half-open');

      // 3. Succeed enough times → closed
      for (let i = 0; i < TEST_CONFIG.successThreshold; i++) {
        await breaker.execute(() => Promise.resolve('ok'));
      }
      expect(breaker.getState()).toBe('closed');

      // Verify all transitions happened
      expect(transitions).toEqual([
        { from: 'closed', to: 'open' },
        { from: 'open', to: 'half-open' },
        { from: 'half-open', to: 'closed' },
      ]);
    });

    it('handles repeated open/half-open/open cycles', async () => {
      // First cycle: closed → open
      for (let i = 0; i < TEST_CONFIG.failureThreshold; i++) {
        await expect(breaker.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow();
      }
      expect(breaker.getState()).toBe('open');

      // Cooldown → half-open
      currentTime += TEST_CONFIG.cooldownMs;
      expect(breaker.getState()).toBe('half-open');

      // Fail in half-open → back to open
      await expect(breaker.execute(() => Promise.reject(new Error('probe-fail')))).rejects.toThrow();
      expect(breaker.getState()).toBe('open');

      // Another cooldown → half-open again
      currentTime += TEST_CONFIG.cooldownMs;
      expect(breaker.getState()).toBe('half-open');

      // This time succeed → closed
      for (let i = 0; i < TEST_CONFIG.successThreshold; i++) {
        await breaker.execute(() => Promise.resolve('ok'));
      }
      expect(breaker.getState()).toBe('closed');
    });
  });

  // -----------------------------------------------------------------------
  // Edge: execute triggers open → half-open transition
  // -----------------------------------------------------------------------
  describe('execute triggers cooldown check', () => {
    it('transitions to half-open and executes when cooldown elapsed during execute()', async () => {
      // Drive to open
      for (let i = 0; i < TEST_CONFIG.failureThreshold; i++) {
        await expect(breaker.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow();
      }

      // Advance past cooldown
      currentTime += TEST_CONFIG.cooldownMs;

      // execute() should detect cooldown elapsed, transition to half-open, and run the op
      const result = await breaker.execute(() => Promise.resolve('probe'));
      expect(result).toBe('probe');
      expect(breaker.getState()).toBe('half-open');
    });
  });
});
