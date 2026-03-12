import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  TaskThrottle,
  DEFAULT_THROTTLE_CONFIG,
  type ThrottleConfig,
} from '../throttle.js';

describe('TaskThrottle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── defaults ──────────────────────────────────────────────────

  describe('DEFAULT_THROTTLE_CONFIG', () => {
    it('has expected default values', () => {
      expect(DEFAULT_THROTTLE_CONFIG).toEqual({
        maxAssignmentsPerSecond: 50,
        queueDepthThreshold: 200,
        maxPendingAssignments: 500,
      });
    });
  });

  describe('constructor', () => {
    it('uses defaults when no config provided', () => {
      const throttle = new TaskThrottle();
      const load = throttle.getLoad();
      expect(load.currentRate).toBe(0);
      expect(load.pendingAssignments).toBe(0);
      expect(load.queueDepth).toBe(0);
      expect(load.backpressure).toBe(false);
    });

    it('merges partial config with defaults', () => {
      const throttle = new TaskThrottle({ maxAssignmentsPerSecond: 10 });
      // Should allow up to 10 per second
      for (let i = 0; i < 10; i++) {
        expect(throttle.canAssign().allowed).toBe(true);
        throttle.recordAssignment();
      }
      expect(throttle.canAssign().allowed).toBe(false);
    });
  });

  // ── canAssign — rate limiting ─────────────────────────────────

  describe('canAssign — rate limiting', () => {
    it('allows assignments under the rate limit', () => {
      const throttle = new TaskThrottle({ maxAssignmentsPerSecond: 5 });
      for (let i = 0; i < 5; i++) {
        expect(throttle.canAssign().allowed).toBe(true);
        throttle.recordAssignment();
      }
    });

    it('rejects when rate limit is reached', () => {
      const throttle = new TaskThrottle({ maxAssignmentsPerSecond: 3 });
      for (let i = 0; i < 3; i++) {
        throttle.recordAssignment();
      }
      const result = throttle.canAssign();
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Rate limit exceeded');
    });

    it('allows again after the sliding window expires', () => {
      const throttle = new TaskThrottle({ maxAssignmentsPerSecond: 2 });
      throttle.recordAssignment();
      throttle.recordAssignment();
      expect(throttle.canAssign().allowed).toBe(false);

      // Advance past the 1-second window
      vi.advanceTimersByTime(1001);
      expect(throttle.canAssign().allowed).toBe(true);
    });

    it('sliding window prunes old entries correctly', () => {
      const throttle = new TaskThrottle({ maxAssignmentsPerSecond: 2 });
      throttle.recordAssignment();

      vi.advanceTimersByTime(600);
      throttle.recordAssignment();

      // At t=600ms, both are within window
      expect(throttle.canAssign().allowed).toBe(false);

      // At t=1001ms, first entry expires
      vi.advanceTimersByTime(401);
      expect(throttle.canAssign().allowed).toBe(true);
    });
  });

  // ── canAssign — queue depth backpressure ──────────────────────

  describe('canAssign — queue depth backpressure', () => {
    it('allows when queue depth is at threshold', () => {
      const throttle = new TaskThrottle({ queueDepthThreshold: 100 });
      throttle.setQueueDepth(100);
      expect(throttle.canAssign().allowed).toBe(true);
    });

    it('rejects when queue depth exceeds threshold', () => {
      const throttle = new TaskThrottle({ queueDepthThreshold: 100 });
      throttle.setQueueDepth(101);
      const result = throttle.canAssign();
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Queue depth');
      expect(result.reason).toContain('exceeds threshold');
    });

    it('allows again when queue depth drops below threshold', () => {
      const throttle = new TaskThrottle({ queueDepthThreshold: 100 });
      throttle.setQueueDepth(150);
      expect(throttle.canAssign().allowed).toBe(false);

      throttle.setQueueDepth(50);
      expect(throttle.canAssign().allowed).toBe(true);
    });
  });

  // ── canAssign — max pending assignments ───────────────────────

  describe('canAssign — max pending assignments', () => {
    it('allows when pending is below max', () => {
      const throttle = new TaskThrottle({
        maxPendingAssignments: 3,
        maxAssignmentsPerSecond: 1000,
      });
      throttle.recordAssignment();
      throttle.recordAssignment();
      expect(throttle.canAssign().allowed).toBe(true);
    });

    it('rejects when max pending is reached', () => {
      const throttle = new TaskThrottle({
        maxPendingAssignments: 2,
        maxAssignmentsPerSecond: 1000,
      });
      throttle.recordAssignment();
      throttle.recordAssignment();
      const result = throttle.canAssign();
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Max pending assignments reached');
    });

    it('allows again after completions reduce pending count', () => {
      const throttle = new TaskThrottle({
        maxPendingAssignments: 2,
        maxAssignmentsPerSecond: 1000,
      });
      throttle.recordAssignment();
      throttle.recordAssignment();
      expect(throttle.canAssign().allowed).toBe(false);

      throttle.recordCompletion();
      expect(throttle.canAssign().allowed).toBe(true);
    });
  });

  // ── canAssign — priority of rejection reasons ─────────────────

  describe('canAssign — rejection priority', () => {
    it('checks max pending before queue depth', () => {
      const throttle = new TaskThrottle({
        maxPendingAssignments: 1,
        queueDepthThreshold: 10,
        maxAssignmentsPerSecond: 1000,
      });
      throttle.recordAssignment();
      throttle.setQueueDepth(20);

      const result = throttle.canAssign();
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Max pending');
    });

    it('checks queue depth before rate limit', () => {
      const throttle = new TaskThrottle({
        maxPendingAssignments: 1000,
        queueDepthThreshold: 5,
        maxAssignmentsPerSecond: 1,
      });
      throttle.setQueueDepth(10);
      throttle.recordAssignment();

      const result = throttle.canAssign();
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Queue depth');
    });
  });

  // ── recordAssignment ──────────────────────────────────────────

  describe('recordAssignment', () => {
    it('increments pending count', () => {
      const throttle = new TaskThrottle();
      throttle.recordAssignment();
      throttle.recordAssignment();
      expect(throttle.getLoad().pendingAssignments).toBe(2);
    });

    it('increments current rate', () => {
      const throttle = new TaskThrottle();
      throttle.recordAssignment();
      expect(throttle.getLoad().currentRate).toBe(1);
    });
  });

  // ── recordCompletion ──────────────────────────────────────────

  describe('recordCompletion', () => {
    it('decrements pending count', () => {
      const throttle = new TaskThrottle();
      throttle.recordAssignment();
      throttle.recordAssignment();
      throttle.recordCompletion();
      expect(throttle.getLoad().pendingAssignments).toBe(1);
    });

    it('does not go below zero', () => {
      const throttle = new TaskThrottle();
      throttle.recordCompletion();
      throttle.recordCompletion();
      expect(throttle.getLoad().pendingAssignments).toBe(0);
    });
  });

  // ── setQueueDepth ─────────────────────────────────────────────

  describe('setQueueDepth', () => {
    it('updates queue depth in metrics', () => {
      const throttle = new TaskThrottle();
      throttle.setQueueDepth(42);
      expect(throttle.getLoad().queueDepth).toBe(42);
    });

    it('clamps negative values to zero', () => {
      const throttle = new TaskThrottle();
      throttle.setQueueDepth(-10);
      expect(throttle.getLoad().queueDepth).toBe(0);
    });
  });

  // ── getLoad ───────────────────────────────────────────────────

  describe('getLoad', () => {
    it('returns all metrics', () => {
      const throttle = new TaskThrottle({ maxAssignmentsPerSecond: 100 });
      throttle.recordAssignment();
      throttle.recordAssignment();
      throttle.setQueueDepth(10);

      const load = throttle.getLoad();
      expect(load.currentRate).toBe(2);
      expect(load.pendingAssignments).toBe(2);
      expect(load.queueDepth).toBe(10);
      expect(load.backpressure).toBe(false);
    });

    it('reports backpressure when rate limit hit', () => {
      const throttle = new TaskThrottle({ maxAssignmentsPerSecond: 1 });
      throttle.recordAssignment();
      expect(throttle.getLoad().backpressure).toBe(true);
    });

    it('reports backpressure when queue depth exceeded', () => {
      const throttle = new TaskThrottle({ queueDepthThreshold: 5 });
      throttle.setQueueDepth(10);
      expect(throttle.getLoad().backpressure).toBe(true);
    });

    it('reports backpressure when max pending reached', () => {
      const throttle = new TaskThrottle({
        maxPendingAssignments: 1,
        maxAssignmentsPerSecond: 1000,
      });
      throttle.recordAssignment();
      expect(throttle.getLoad().backpressure).toBe(true);
    });

    it('rate decreases as window entries expire', () => {
      const throttle = new TaskThrottle();
      throttle.recordAssignment();
      throttle.recordAssignment();
      expect(throttle.getLoad().currentRate).toBe(2);

      vi.advanceTimersByTime(1001);
      expect(throttle.getLoad().currentRate).toBe(0);
    });
  });
});
