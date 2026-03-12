import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Logger } from '@pyramid-os/logger';
import {
  MetricsCollector,
  type MetricEntry,
  type MetricsPersistCallback,
} from '../metrics-collector.js';

// ── helpers ─────────────────────────────────────────────────────────

function createMockLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function createCollector(persist?: MetricsPersistCallback) {
  const logger = createMockLogger();
  const options = persist ? { logger, persist } : { logger };
  const collector = new MetricsCollector(options);
  return { collector, logger };
}

// ── tests ───────────────────────────────────────────────────────────

describe('MetricsCollector', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // ── recordTaskCompletion ──────────────────────────────────────────

  describe('recordTaskCompletion', () => {
    it('tracks completions per role', () => {
      const { collector } = createCollector();
      collector.recordTaskCompletion('Builder');
      collector.recordTaskCompletion('Builder');
      collector.recordTaskCompletion('Quarry');

      const metrics = collector.getMetrics();
      expect(metrics.taskCompletionRates['Builder']).toBeGreaterThan(0);
      expect(metrics.taskCompletionRates['Quarry']).toBeGreaterThan(0);
    });

    it('persists each completion via callback', () => {
      const persisted: MetricEntry[] = [];
      const { collector } = createCollector((e) => persisted.push(e));

      collector.recordTaskCompletion('Guard');
      expect(persisted).toHaveLength(1);
      expect(persisted[0]!.metricName).toBe('task_completion');
      expect(persisted[0]!.tags).toBe('role:Guard');
      expect(persisted[0]!.value).toBe(1);
    });
  });

  // ── recordResourceConsumption ─────────────────────────────────────

  describe('recordResourceConsumption', () => {
    it('accumulates consumption per resource type', () => {
      const { collector } = createCollector();
      collector.recordResourceConsumption('sandstone', 10);
      collector.recordResourceConsumption('sandstone', 5);
      collector.recordResourceConsumption('gold', 2);

      const metrics = collector.getMetrics();
      // Rates should reflect accumulated amounts
      expect(metrics.resourceConsumptionRates['sandstone']).toBeGreaterThan(0);
      expect(metrics.resourceConsumptionRates['gold']).toBeGreaterThan(0);
    });

    it('persists each consumption via callback', () => {
      const persisted: MetricEntry[] = [];
      const { collector } = createCollector((e) => persisted.push(e));

      collector.recordResourceConsumption('wood', 7);
      expect(persisted).toHaveLength(1);
      expect(persisted[0]!.metricName).toBe('resource_consumption');
      expect(persisted[0]!.tags).toBe('type:wood');
      expect(persisted[0]!.value).toBe(7);
    });
  });

  // ── recordBlockPlaced ─────────────────────────────────────────────

  describe('recordBlockPlaced', () => {
    it('increments blocks placed counter', () => {
      const { collector } = createCollector();
      collector.setTotalBlocks(100);
      collector.recordBlockPlaced();
      collector.recordBlockPlaced();
      collector.recordBlockPlaced();

      const metrics = collector.getMetrics();
      expect(metrics.buildProgress.totalPlaced).toBe(3);
      expect(metrics.buildProgress.totalBlocks).toBe(100);
      expect(metrics.buildProgress.blocksPlacedPerHour).toBeGreaterThan(0);
    });

    it('reports zero rate when no blocks placed', () => {
      const { collector } = createCollector();
      const metrics = collector.getMetrics();
      expect(metrics.buildProgress.blocksPlacedPerHour).toBe(0);
      expect(metrics.buildProgress.totalPlaced).toBe(0);
    });
  });

  // ── recordDecisionLatency ─────────────────────────────────────────

  describe('recordDecisionLatency', () => {
    it('computes average latency per agent', () => {
      const { collector } = createCollector();
      collector.recordDecisionLatency('agent-1', 100);
      collector.recordDecisionLatency('agent-1', 200);
      collector.recordDecisionLatency('agent-2', 50);

      const metrics = collector.getMetrics();
      expect(metrics.agentDecisionLatency['agent-1']).toBe(150); // (100+200)/2
      expect(metrics.agentDecisionLatency['agent-2']).toBe(50);
    });

    it('persists each latency measurement', () => {
      const persisted: MetricEntry[] = [];
      const { collector } = createCollector((e) => persisted.push(e));

      collector.recordDecisionLatency('agent-3', 42);
      expect(persisted).toHaveLength(1);
      expect(persisted[0]!.metricName).toBe('decision_latency');
      expect(persisted[0]!.tags).toBe('agent:agent-3');
      expect(persisted[0]!.value).toBe(42);
    });
  });

  // ── setTotalBlocks ────────────────────────────────────────────────

  describe('setTotalBlocks', () => {
    it('sets the total blocks target in build progress', () => {
      const { collector } = createCollector();
      collector.setTotalBlocks(500);

      const metrics = collector.getMetrics();
      expect(metrics.buildProgress.totalBlocks).toBe(500);
    });
  });

  // ── getMetrics ────────────────────────────────────────────────────

  describe('getMetrics', () => {
    it('returns a valid SocietyMetrics with ISO timestamp', () => {
      const { collector } = createCollector();
      const metrics = collector.getMetrics();

      expect(metrics.collectedAt).toBeDefined();
      expect(() => new Date(metrics.collectedAt)).not.toThrow();
      expect(metrics.taskCompletionRates).toEqual({});
      expect(metrics.resourceConsumptionRates).toEqual({});
      expect(metrics.agentDecisionLatency).toEqual({});
      expect(metrics.buildProgress).toEqual({
        blocksPlacedPerHour: 0,
        totalPlaced: 0,
        totalBlocks: 0,
      });
    });

    it('includes all recorded data in the snapshot', () => {
      const { collector } = createCollector();
      collector.recordTaskCompletion('Builder');
      collector.recordResourceConsumption('stone', 10);
      collector.recordBlockPlaced();
      collector.setTotalBlocks(50);
      collector.recordDecisionLatency('agent-x', 30);

      const metrics = collector.getMetrics();
      expect(Object.keys(metrics.taskCompletionRates)).toContain('Builder');
      expect(Object.keys(metrics.resourceConsumptionRates)).toContain('stone');
      expect(metrics.buildProgress.totalPlaced).toBe(1);
      expect(metrics.buildProgress.totalBlocks).toBe(50);
      expect(Object.keys(metrics.agentDecisionLatency)).toContain('agent-x');
    });
  });

  // ── reset ─────────────────────────────────────────────────────────

  describe('reset', () => {
    it('clears all counters and accumulated data', () => {
      const { collector } = createCollector();
      collector.recordTaskCompletion('Builder');
      collector.recordResourceConsumption('stone', 10);
      collector.recordBlockPlaced();
      collector.setTotalBlocks(50);
      collector.recordDecisionLatency('agent-x', 30);

      collector.reset();

      const metrics = collector.getMetrics();
      expect(metrics.taskCompletionRates).toEqual({});
      expect(metrics.resourceConsumptionRates).toEqual({});
      expect(metrics.buildProgress).toEqual({
        blocksPlacedPerHour: 0,
        totalPlaced: 0,
        totalBlocks: 0,
      });
      expect(metrics.agentDecisionLatency).toEqual({});
    });
  });

  // ── persistence ───────────────────────────────────────────────────

  describe('persistence', () => {
    it('does not throw when no persist callback is provided', () => {
      const { collector } = createCollector();
      expect(() => {
        collector.recordTaskCompletion('Builder');
        collector.recordResourceConsumption('stone', 5);
        collector.recordBlockPlaced();
        collector.recordDecisionLatency('a', 10);
      }).not.toThrow();
    });

    it('assigns unique IDs to each persisted metric entry', () => {
      const persisted: MetricEntry[] = [];
      const { collector } = createCollector((e) => persisted.push(e));

      collector.recordTaskCompletion('Builder');
      collector.recordBlockPlaced();
      collector.recordDecisionLatency('a', 10);

      const ids = persisted.map((e) => e.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('includes ISO timestamps on persisted entries', () => {
      const persisted: MetricEntry[] = [];
      const { collector } = createCollector((e) => persisted.push(e));

      collector.recordTaskCompletion('Builder');
      expect(persisted[0]!.timestamp).toBeDefined();
      expect(() => new Date(persisted[0]!.timestamp)).not.toThrow();
    });
  });

  // ── logging ───────────────────────────────────────────────────────

  describe('logging', () => {
    it('logs debug messages for each recording', () => {
      const { collector, logger } = createCollector();
      collector.recordTaskCompletion('Builder');
      collector.recordResourceConsumption('stone', 5);
      collector.recordBlockPlaced();
      collector.recordDecisionLatency('a', 10);

      expect(logger.debug).toHaveBeenCalledTimes(4);
    });

    it('logs info on setTotalBlocks and reset', () => {
      const { collector, logger } = createCollector();
      collector.setTotalBlocks(100);
      collector.reset();

      expect(logger.info).toHaveBeenCalledTimes(2);
    });
  });
});
