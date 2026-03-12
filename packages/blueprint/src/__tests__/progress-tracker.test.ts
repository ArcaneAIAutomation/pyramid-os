/**
 * Unit tests for ProgressTracker
 *
 * Validates: Requirements 4.7, 4.8
 */

import { describe, it, expect } from 'vitest';
import { ProgressTracker } from '../progress-tracker.js';
import type { Blueprint, BlockPlacement } from '@pyramid-os/shared-types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function placement(
  index: number,
  x: number,
  y: number,
  z: number,
  placed = false,
): BlockPlacement {
  return { index, position: { x, y, z }, blockType: 'minecraft:stone', placed };
}

function makeBlueprint(placements: BlockPlacement[]): Blueprint {
  return {
    id: 'test-bp',
    name: 'Test Blueprint',
    version: 1,
    type: 'pyramid',
    dimensions: { width: 3, height: 1, depth: 1 },
    metadata: {
      structureName: 'Test',
      dimensions: { width: 3, height: 1, depth: 1 },
      requiredResources: [],
      estimatedTimeMinutes: 1,
      createdAt: new Date().toISOString(),
      createdBy: 'test',
    },
    placements,
    progress: {
      totalBlocks: placements.length,
      placedBlocks: 0,
      percentComplete: 0,
      currentPhase: 'foundation',
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ProgressTracker', () => {
  describe('getProgress', () => {
    it('returns zero progress for a fresh blueprint', () => {
      const bp = makeBlueprint([
        placement(0, 0, 0, 0),
        placement(1, 1, 0, 0),
        placement(2, 2, 0, 0),
      ]);
      const tracker = new ProgressTracker(bp);
      const progress = tracker.getProgress();

      expect(progress.totalBlocks).toBe(3);
      expect(progress.placedBlocks).toBe(0);
      expect(progress.percentComplete).toBe(0);
      expect(progress.currentPhase).toBe('foundation');
    });

    it('computes correct percentage after marking blocks', () => {
      const bp = makeBlueprint([
        placement(0, 0, 0, 0),
        placement(1, 1, 0, 0),
        placement(2, 2, 0, 0),
        placement(3, 3, 0, 0),
      ]);
      const tracker = new ProgressTracker(bp);

      tracker.markPlaced(0);
      tracker.markPlaced(1);

      const progress = tracker.getProgress();
      expect(progress.placedBlocks).toBe(2);
      expect(progress.percentComplete).toBe(50);
    });

    it('returns 100% when all blocks are placed', () => {
      const bp = makeBlueprint([
        placement(0, 0, 0, 0),
        placement(1, 1, 0, 0),
      ]);
      const tracker = new ProgressTracker(bp);

      tracker.markPlaced(0);
      tracker.markPlaced(1);

      expect(tracker.getProgress().percentComplete).toBe(100);
    });

    it('handles empty blueprint', () => {
      const bp = makeBlueprint([]);
      const tracker = new ProgressTracker(bp);
      const progress = tracker.getProgress();

      expect(progress.totalBlocks).toBe(0);
      expect(progress.placedBlocks).toBe(0);
      expect(progress.percentComplete).toBe(0);
    });
  });

  describe('markPlaced', () => {
    it('marks a block as placed', () => {
      const bp = makeBlueprint([placement(0, 0, 0, 0), placement(1, 1, 0, 0)]);
      const tracker = new ProgressTracker(bp);

      tracker.markPlaced(0);

      expect(bp.placements[0]!.placed).toBe(true);
      expect(bp.placements[1]!.placed).toBe(false);
    });

    it('throws for a non-existent index', () => {
      const bp = makeBlueprint([placement(0, 0, 0, 0)]);
      const tracker = new ProgressTracker(bp);

      expect(() => tracker.markPlaced(99)).toThrow('No placement found with index 99');
    });

    it('is idempotent — marking the same index twice does not error', () => {
      const bp = makeBlueprint([placement(0, 0, 0, 0)]);
      const tracker = new ProgressTracker(bp);

      tracker.markPlaced(0);
      tracker.markPlaced(0);

      expect(tracker.getProgress().placedBlocks).toBe(1);
    });
  });

  describe('getNextPlacement', () => {
    it('returns the lowest-index unplaced block', () => {
      const bp = makeBlueprint([
        placement(0, 0, 0, 0),
        placement(1, 1, 0, 0),
        placement(2, 2, 0, 0),
      ]);
      const tracker = new ProgressTracker(bp);

      expect(tracker.getNextPlacement()?.index).toBe(0);
    });

    it('skips already-placed blocks', () => {
      const bp = makeBlueprint([
        placement(0, 0, 0, 0),
        placement(1, 1, 0, 0),
        placement(2, 2, 0, 0),
      ]);
      const tracker = new ProgressTracker(bp);

      tracker.markPlaced(0);
      tracker.markPlaced(1);

      expect(tracker.getNextPlacement()?.index).toBe(2);
    });

    it('returns undefined when all blocks are placed', () => {
      const bp = makeBlueprint([placement(0, 0, 0, 0)]);
      const tracker = new ProgressTracker(bp);

      tracker.markPlaced(0);

      expect(tracker.getNextPlacement()).toBeUndefined();
    });

    it('returns undefined for an empty blueprint', () => {
      const bp = makeBlueprint([]);
      const tracker = new ProgressTracker(bp);

      expect(tracker.getNextPlacement()).toBeUndefined();
    });

    it('returns lowest index even when placements are not sorted', () => {
      const bp = makeBlueprint([
        placement(2, 2, 0, 0),
        placement(0, 0, 0, 0),
        placement(1, 1, 0, 0),
      ]);
      const tracker = new ProgressTracker(bp);

      expect(tracker.getNextPlacement()?.index).toBe(0);
    });
  });
});
