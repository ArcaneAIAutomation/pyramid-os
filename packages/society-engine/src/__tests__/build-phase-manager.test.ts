import { describe, it, expect, vi } from 'vitest';
import type { Blueprint, BlockPlacement } from '@pyramid-os/shared-types';
import type { Logger } from '@pyramid-os/logger';
import {
  BuildPhaseManager,
  type BuildPhase,
  type PhasePersistCallback,
} from '../build-phase-manager.js';

// ── helpers ─────────────────────────────────────────────────────────

function createMockLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function placement(index: number, x: number, y: number, z: number, blockType = 'minecraft:sandstone', placed = false): BlockPlacement {
  return { index, position: { x, y, z }, blockType, placed };
}

function createBlueprint(overrides: Partial<Blueprint> = {}): Blueprint {
  return {
    id: 'bp-1',
    name: 'Test Pyramid',
    version: 1,
    type: 'pyramid',
    dimensions: { width: 3, height: 3, depth: 3 },
    metadata: {
      structureName: 'Test Pyramid',
      dimensions: { width: 3, height: 3, depth: 3 },
      requiredResources: [],
      estimatedTimeMinutes: 10,
      createdAt: new Date().toISOString(),
      createdBy: 'architect-1',
    },
    placements: [
      // Foundation y=0 (9 blocks)
      placement(0, 0, 0, 0), placement(1, 1, 0, 0), placement(2, 2, 0, 0),
      placement(3, 0, 0, 1), placement(4, 1, 0, 1), placement(5, 2, 0, 1),
      placement(6, 0, 0, 2), placement(7, 1, 0, 2), placement(8, 2, 0, 2),
      // Layer y=1 (4 blocks)
      placement(9, 0, 1, 0), placement(10, 1, 1, 0),
      placement(11, 0, 1, 1), placement(12, 1, 1, 1),
      // Capstone y=2 (1 block)
      placement(13, 0, 2, 0, 'minecraft:gold_block'),
    ],
    progress: { totalBlocks: 14, placedBlocks: 0, percentComplete: 0, currentPhase: '' },
    ...overrides,
  };
}

function createManager(overrides: { onPhasePersist?: PhasePersistCallback } = {}) {
  const logger = createMockLogger();
  const manager = new BuildPhaseManager({
    logger,
    ...overrides,
  });
  return { manager, logger };
}

// ── tests ───────────────────────────────────────────────────────────

describe('BuildPhaseManager', () => {
  // ── startBuildSequence ─────────────────────────────────────────

  describe('startBuildSequence', () => {
    it('decomposes a 3-layer blueprint into foundation, layer, and capstone', () => {
      const { manager } = createManager();
      const bp = createBlueprint();

      const phases = manager.startBuildSequence(bp);

      expect(phases).toHaveLength(3);
      expect(phases[0]!.type).toBe('foundation');
      expect(phases[0]!.name).toContain('y=0');
      expect(phases[0]!.placements).toHaveLength(9);

      expect(phases[1]!.type).toBe('layer');
      expect(phases[1]!.name).toContain('y=1');
      expect(phases[1]!.placements).toHaveLength(4);

      expect(phases[2]!.type).toBe('capstone');
      expect(phases[2]!.name).toContain('y=2');
      expect(phases[2]!.placements).toHaveLength(1);
    });

    it('sets the first phase to in_progress and the rest to pending', () => {
      const { manager } = createManager();
      const phases = manager.startBuildSequence(createBlueprint());

      expect(phases[0]!.status).toBe('in_progress');
      expect(phases[1]!.status).toBe('pending');
      expect(phases[2]!.status).toBe('pending');
    });

    it('returns empty array for a blueprint with no placements', () => {
      const { manager } = createManager();
      const bp = createBlueprint({ placements: [] });

      const phases = manager.startBuildSequence(bp);
      expect(phases).toHaveLength(0);
    });

    it('handles a single y-level as foundation only', () => {
      const { manager } = createManager();
      const bp = createBlueprint({
        placements: [placement(0, 0, 5, 0), placement(1, 1, 5, 0)],
      });

      const phases = manager.startBuildSequence(bp);
      expect(phases).toHaveLength(1);
      expect(phases[0]!.type).toBe('foundation');
    });

    it('handles two y-levels as foundation and capstone', () => {
      const { manager } = createManager();
      const bp = createBlueprint({
        placements: [
          placement(0, 0, 0, 0),
          placement(1, 0, 3, 0),
        ],
      });

      const phases = manager.startBuildSequence(bp);
      expect(phases).toHaveLength(2);
      expect(phases[0]!.type).toBe('foundation');
      expect(phases[1]!.type).toBe('capstone');
    });

    it('calculates resource requirements per phase', () => {
      const { manager } = createManager();
      const phases = manager.startBuildSequence(createBlueprint());

      // Foundation: 9 sandstone blocks
      expect(phases[0]!.resourceRequirements).toEqual([
        { type: 'minecraft:sandstone', count: 9 },
      ]);

      // Capstone: 1 gold block
      expect(phases[2]!.resourceRequirements).toEqual([
        { type: 'minecraft:gold_block', count: 1 },
      ]);
    });

    it('persists each phase via callback', () => {
      const onPhasePersist = vi.fn();
      const { manager } = createManager({ onPhasePersist });

      manager.startBuildSequence(createBlueprint());

      expect(onPhasePersist).toHaveBeenCalledTimes(3);
    });

    it('assigns correct blueprintId to all phases', () => {
      const { manager } = createManager();
      const bp = createBlueprint({ id: 'my-bp' });
      const phases = manager.startBuildSequence(bp);

      for (const phase of phases) {
        expect(phase.blueprintId).toBe('my-bp');
      }
    });
  });

  // ── getPhase ──────────────────────────────────────────────────────

  describe('getPhase', () => {
    it('returns a phase by ID after startBuildSequence', () => {
      const { manager } = createManager();
      const phases = manager.startBuildSequence(createBlueprint());

      const found = manager.getPhase(phases[0]!.id);
      expect(found).toBeDefined();
      expect(found!.type).toBe('foundation');
    });

    it('returns undefined for unknown phase ID', () => {
      const { manager } = createManager();
      expect(manager.getPhase('nonexistent')).toBeUndefined();
    });
  });

  // ── getPhasesByBlueprint ──────────────────────────────────────────

  describe('getPhasesByBlueprint', () => {
    it('returns all phases for a blueprint', () => {
      const { manager } = createManager();
      manager.startBuildSequence(createBlueprint());

      const phases = manager.getPhasesByBlueprint('bp-1');
      expect(phases).toHaveLength(3);
    });

    it('returns empty array for unknown blueprint', () => {
      const { manager } = createManager();
      expect(manager.getPhasesByBlueprint('unknown')).toEqual([]);
    });
  });

  // ── advancePhase ──────────────────────────────────────────────────

  describe('advancePhase', () => {
    it('marks current phase completed and returns next phase as in_progress', () => {
      const { manager } = createManager();
      const phases = manager.startBuildSequence(createBlueprint());

      const next = manager.advancePhase(phases[0]!.id);

      expect(phases[0]!.status).toBe('completed');
      expect(next).toBeDefined();
      expect(next!.id).toBe(phases[1]!.id);
      expect(next!.status).toBe('in_progress');
    });

    it('returns undefined when advancing the last phase', () => {
      const { manager } = createManager();
      const phases = manager.startBuildSequence(createBlueprint());

      manager.advancePhase(phases[0]!.id);
      manager.advancePhase(phases[1]!.id);
      const result = manager.advancePhase(phases[2]!.id);

      expect(result).toBeUndefined();
      expect(phases[2]!.status).toBe('completed');
    });

    it('returns undefined for unknown phase ID', () => {
      const { manager } = createManager();
      expect(manager.advancePhase('nonexistent')).toBeUndefined();
    });

    it('persists both completed and advanced phases', () => {
      const onPhasePersist = vi.fn();
      const { manager } = createManager({ onPhasePersist });
      const phases = manager.startBuildSequence(createBlueprint());
      onPhasePersist.mockClear();

      manager.advancePhase(phases[0]!.id);

      // Should persist the completed phase and the newly in_progress phase
      expect(onPhasePersist).toHaveBeenCalledTimes(2);
    });
  });

  // ── verifyPhase ───────────────────────────────────────────────────

  describe('verifyPhase', () => {
    it('returns correct=true when all placements are placed', () => {
      const { manager } = createManager();
      const bp = createBlueprint({
        placements: [
          placement(0, 0, 0, 0, 'minecraft:sandstone', true),
          placement(1, 1, 0, 0, 'minecraft:sandstone', true),
        ],
      });
      const phases = manager.startBuildSequence(bp);

      const result = manager.verifyPhase(phases[0]!.id);
      expect(result.correct).toBe(true);
      expect(result.missing).toHaveLength(0);
      expect(result.incorrect).toHaveLength(0);
    });

    it('returns missing placements when blocks are not placed', () => {
      const { manager } = createManager();
      const phases = manager.startBuildSequence(createBlueprint());

      const result = manager.verifyPhase(phases[0]!.id);
      expect(result.correct).toBe(false);
      expect(result.missing).toHaveLength(9); // all 9 foundation blocks unplaced
    });

    it('marks phase as failed when verification finds issues', () => {
      const { manager } = createManager();
      const phases = manager.startBuildSequence(createBlueprint());

      manager.verifyPhase(phases[0]!.id);
      expect(phases[0]!.status).toBe('failed');
    });

    it('returns correct=true for unknown phase ID', () => {
      const { manager } = createManager();
      const result = manager.verifyPhase('nonexistent');
      expect(result.correct).toBe(true);
    });

    it('detects partially placed phases', () => {
      const { manager } = createManager();
      const bp = createBlueprint({
        placements: [
          placement(0, 0, 0, 0, 'minecraft:sandstone', true),
          placement(1, 1, 0, 0, 'minecraft:sandstone', false),
          placement(2, 2, 0, 0, 'minecraft:sandstone', true),
        ],
      });
      const phases = manager.startBuildSequence(bp);

      const result = manager.verifyPhase(phases[0]!.id);
      expect(result.correct).toBe(false);
      expect(result.missing).toHaveLength(1);
      expect(result.missing[0]!.index).toBe(1);
    });
  });

  // ── getResourceRequirements ───────────────────────────────────────

  describe('getResourceRequirements', () => {
    it('returns resource requirements for a phase', () => {
      const { manager } = createManager();
      const phases = manager.startBuildSequence(createBlueprint());

      const reqs = manager.getResourceRequirements(phases[0]!.id);
      expect(reqs).toEqual([{ type: 'minecraft:sandstone', count: 9 }]);
    });

    it('aggregates multiple block types in a single phase', () => {
      const { manager } = createManager();
      const bp = createBlueprint({
        placements: [
          placement(0, 0, 0, 0, 'minecraft:sandstone'),
          placement(1, 1, 0, 0, 'minecraft:gold_block'),
          placement(2, 2, 0, 0, 'minecraft:sandstone'),
        ],
      });
      const phases = manager.startBuildSequence(bp);

      const reqs = manager.getResourceRequirements(phases[0]!.id);
      expect(reqs).toHaveLength(2);

      const sandstone = reqs.find((r) => r.type === 'minecraft:sandstone');
      const gold = reqs.find((r) => r.type === 'minecraft:gold_block');
      expect(sandstone!.count).toBe(2);
      expect(gold!.count).toBe(1);
    });

    it('returns empty array for unknown phase ID', () => {
      const { manager } = createManager();
      expect(manager.getResourceRequirements('nonexistent')).toEqual([]);
    });
  });
});
