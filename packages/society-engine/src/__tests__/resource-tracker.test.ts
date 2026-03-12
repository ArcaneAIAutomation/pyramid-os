import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ResourceThreshold, ResourceAlert, ResourceTransaction } from '@pyramid-os/shared-types';
import type { Logger } from '@pyramid-os/logger';
import {
  ResourceTracker,
  type ResourcePersistCallback,
  type TransactionPersistCallback,
  type AlertCallback,
} from '../resource-tracker.js';

// ── helpers ─────────────────────────────────────────────────────────

function createMockLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

const DEFAULT_THRESHOLDS: ResourceThreshold[] = [
  { resourceType: 'sandstone', minimum: 100, critical: 20 },
  { resourceType: 'gold_block', minimum: 50, critical: 10 },
  { resourceType: 'food', minimum: 200, critical: 50 },
];

function createTracker(overrides: {
  thresholds?: ResourceThreshold[];
  onResourcePersist?: ResourcePersistCallback;
  onTransactionPersist?: TransactionPersistCallback;
  onAlert?: AlertCallback;
} = {}) {
  const logger = createMockLogger();
  const tracker = new ResourceTracker({
    logger,
    thresholds: overrides.thresholds ?? DEFAULT_THRESHOLDS,
    ...(overrides.onResourcePersist ? { onResourcePersist: overrides.onResourcePersist } : {}),
    ...(overrides.onTransactionPersist ? { onTransactionPersist: overrides.onTransactionPersist } : {}),
    ...(overrides.onAlert ? { onAlert: overrides.onAlert } : {}),
  });
  return { tracker, logger };
}

// ── tests ───────────────────────────────────────────────────────────

describe('ResourceTracker', () => {
  // ── getLevel ────────────────────────────────────────────────────

  describe('getLevel', () => {
    it('returns 0 for an untracked resource', () => {
      const { tracker } = createTracker();
      expect(tracker.getLevel('sandstone')).toBe(0);
    });

    it('returns the current level after setLevel', () => {
      const { tracker } = createTracker();
      tracker.setLevel('sandstone', 500);
      expect(tracker.getLevel('sandstone')).toBe(500);
    });
  });

  // ── setLevel ────────────────────────────────────────────────────

  describe('setLevel', () => {
    it('sets an absolute level and persists', () => {
      const onResourcePersist = vi.fn();
      const { tracker } = createTracker({ onResourcePersist });

      tracker.setLevel('sandstone', 300);

      expect(tracker.getLevel('sandstone')).toBe(300);
      expect(onResourcePersist).toHaveBeenCalledWith('sandstone', 300);
    });

    it('logs the level change', () => {
      const { tracker, logger } = createTracker();
      tracker.setLevel('gold_block', 42);
      expect(logger.info).toHaveBeenCalledWith(
        'Resource level set',
        expect.objectContaining({ resourceType: 'gold_block', level: 42 }),
      );
    });
  });

  // ── update ──────────────────────────────────────────────────────

  describe('update', () => {
    it('adds to the current level with positive delta', () => {
      const { tracker } = createTracker();
      tracker.setLevel('sandstone', 100);
      tracker.update('sandstone', 50, 'quarry delivery');
      expect(tracker.getLevel('sandstone')).toBe(150);
    });

    it('subtracts from the current level with negative delta', () => {
      const { tracker } = createTracker();
      tracker.setLevel('sandstone', 100);
      tracker.update('sandstone', -30, 'construction');
      expect(tracker.getLevel('sandstone')).toBe(70);
    });

    it('persists the updated resource level', () => {
      const onResourcePersist = vi.fn();
      const { tracker } = createTracker({ onResourcePersist });
      tracker.setLevel('sandstone', 100);
      onResourcePersist.mockClear();

      tracker.update('sandstone', 25, 'delivery');
      expect(onResourcePersist).toHaveBeenCalledWith('sandstone', 125);
    });

    it('persists a transaction record with before/after values', () => {
      const onTransactionPersist = vi.fn();
      const { tracker } = createTracker({ onTransactionPersist });
      tracker.setLevel('sandstone', 200);

      tracker.update('sandstone', -50, 'building wall');

      expect(onTransactionPersist).toHaveBeenCalledTimes(1);
      const txn = onTransactionPersist.mock.calls[0]![0] as ResourceTransaction;
      expect(txn.resourceType).toBe('sandstone');
      expect(txn.delta).toBe(-50);
      expect(txn.beforeQuantity).toBe(200);
      expect(txn.afterQuantity).toBe(150);
      expect(txn.reason).toBe('building wall');
    });

    it('logs the update with before/after values (Req 12.4)', () => {
      const { tracker, logger } = createTracker();
      tracker.setLevel('food', 300);
      tracker.update('food', -100, 'feeding workers');

      expect(logger.info).toHaveBeenCalledWith(
        'Resource updated',
        expect.objectContaining({
          resourceType: 'food',
          delta: -100,
          before: 300,
          after: 200,
          reason: 'feeding workers',
        }),
      );
    });

    it('works on a resource with no prior level (starts at 0)', () => {
      const { tracker } = createTracker();
      tracker.update('wood' as any, 10, 'initial stock');
      expect(tracker.getLevel('wood')).toBe(10);
    });
  });

  // ── isBelowThreshold ───────────────────────────────────────────

  describe('isBelowThreshold', () => {
    it('returns false when level is above minimum', () => {
      const { tracker } = createTracker();
      tracker.setLevel('sandstone', 200);
      expect(tracker.isBelowThreshold('sandstone')).toBe(false);
    });

    it('returns false when level equals minimum', () => {
      const { tracker } = createTracker();
      tracker.setLevel('sandstone', 100);
      expect(tracker.isBelowThreshold('sandstone')).toBe(false);
    });

    it('returns true when level is below minimum', () => {
      const { tracker } = createTracker();
      tracker.setLevel('sandstone', 99);
      expect(tracker.isBelowThreshold('sandstone')).toBe(true);
    });

    it('returns false for a resource with no threshold configured', () => {
      const { tracker } = createTracker();
      tracker.setLevel('iron', 5);
      expect(tracker.isBelowThreshold('iron')).toBe(false);
    });
  });

  // ── getLowResources ─────────────────────────────────────────────

  describe('getLowResources', () => {
    it('returns empty array when all resources are above thresholds', () => {
      const { tracker } = createTracker();
      tracker.setLevel('sandstone', 500);
      tracker.setLevel('gold_block', 100);
      tracker.setLevel('food', 300);
      expect(tracker.getLowResources()).toEqual([]);
    });

    it('returns warning alert when resource is below minimum but above critical', () => {
      const { tracker } = createTracker();
      tracker.setLevel('sandstone', 50); // below 100 minimum, above 20 critical
      tracker.setLevel('gold_block', 200);
      tracker.setLevel('food', 500);

      const alerts = tracker.getLowResources();
      expect(alerts).toHaveLength(1);
      expect(alerts[0]).toEqual({
        resourceType: 'sandstone',
        currentLevel: 50,
        threshold: 100,
        severity: 'warning',
      });
    });

    it('returns critical alert when resource is below critical threshold', () => {
      const { tracker } = createTracker();
      tracker.setLevel('gold_block', 5); // below 10 critical
      tracker.setLevel('sandstone', 500);
      tracker.setLevel('food', 500);

      const alerts = tracker.getLowResources();
      expect(alerts).toHaveLength(1);
      expect(alerts[0]).toEqual({
        resourceType: 'gold_block',
        currentLevel: 5,
        threshold: 10,
        severity: 'critical',
      });
    });

    it('returns multiple alerts for multiple low resources', () => {
      const { tracker } = createTracker();
      tracker.setLevel('sandstone', 50);  // warning
      tracker.setLevel('gold_block', 5);  // critical
      tracker.setLevel('food', 300);      // fine

      const alerts = tracker.getLowResources();
      expect(alerts).toHaveLength(2);

      const types = alerts.map((a) => a.resourceType);
      expect(types).toContain('sandstone');
      expect(types).toContain('gold_block');
    });

    it('includes untracked resources (level 0) that have thresholds', () => {
      const { tracker } = createTracker();
      // Don't set any levels — all default to 0
      const alerts = tracker.getLowResources();
      expect(alerts).toHaveLength(3); // all three thresholds are violated
      for (const alert of alerts) {
        expect(alert.severity).toBe('critical');
      }
    });
  });

  // ── threshold alerts via callback ───────────────────────────────

  describe('alert callback', () => {
    it('fires warning alert when update drops resource below minimum', () => {
      const onAlert = vi.fn();
      const { tracker } = createTracker({ onAlert });
      tracker.setLevel('sandstone', 110);

      tracker.update('sandstone', -20, 'construction'); // 90 < 100 minimum

      expect(onAlert).toHaveBeenCalledTimes(1);
      expect(onAlert).toHaveBeenCalledWith(
        expect.objectContaining({
          resourceType: 'sandstone',
          currentLevel: 90,
          severity: 'warning',
        }),
      );
    });

    it('fires critical alert when update drops resource below critical', () => {
      const onAlert = vi.fn();
      const { tracker } = createTracker({ onAlert });
      tracker.setLevel('gold_block', 15);

      tracker.update('gold_block', -10, 'temple decoration'); // 5 < 10 critical

      expect(onAlert).toHaveBeenCalledTimes(1);
      expect(onAlert).toHaveBeenCalledWith(
        expect.objectContaining({
          resourceType: 'gold_block',
          currentLevel: 5,
          severity: 'critical',
        }),
      );
    });

    it('does not fire alert when resource stays above minimum', () => {
      const onAlert = vi.fn();
      const { tracker } = createTracker({ onAlert });
      tracker.setLevel('sandstone', 200);

      tracker.update('sandstone', -50, 'construction'); // 150 > 100

      expect(onAlert).not.toHaveBeenCalled();
    });

    it('does not fire alert for resources without thresholds', () => {
      const onAlert = vi.fn();
      const { tracker } = createTracker({ onAlert });

      tracker.update('iron', -5, 'crafting');

      expect(onAlert).not.toHaveBeenCalled();
    });
  });

  // ── predictNeeds ────────────────────────────────────────────────

  describe('predictNeeds', () => {
    it('returns empty map for empty phases', () => {
      const { tracker } = createTracker();
      const needs = tracker.predictNeeds([]);
      expect(needs.size).toBe(0);
    });

    it('sums resource needs across a single phase', () => {
      const { tracker } = createTracker();
      const needs = tracker.predictNeeds([
        {
          resources: [
            { type: 'sandstone', count: 100 },
            { type: 'gold_block', count: 10 },
          ],
        },
      ]);

      expect(needs.get('sandstone')).toBe(100);
      expect(needs.get('gold_block')).toBe(10);
    });

    it('sums resource needs across multiple phases', () => {
      const { tracker } = createTracker();
      const needs = tracker.predictNeeds([
        { resources: [{ type: 'sandstone', count: 100 }] },
        { resources: [{ type: 'sandstone', count: 200 }, { type: 'gold_block', count: 5 }] },
        { resources: [{ type: 'sandstone', count: 50 }] },
      ]);

      expect(needs.get('sandstone')).toBe(350);
      expect(needs.get('gold_block')).toBe(5);
    });

    it('handles phases with no resources', () => {
      const { tracker } = createTracker();
      const needs = tracker.predictNeeds([
        { resources: [] },
        { resources: [{ type: 'food', count: 30 }] },
      ]);

      expect(needs.get('food')).toBe(30);
      expect(needs.size).toBe(1);
    });
  });
});
