/**
 * Unit tests for BlueprintValidator
 *
 * Validates: Requirements 4.3, 35.1, 35.2, 35.3, 35.4, 35.8
 */

import { describe, it, expect } from 'vitest';
import { BlueprintValidator } from '../validator.js';
import type { Blueprint, BlockPlacement } from '@pyramid-os/shared-types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function placement(
  index: number,
  x: number,
  y: number,
  z: number,
  blockType = 'minecraft:stone',
): BlockPlacement {
  return { index, position: { x, y, z }, blockType, placed: false };
}

function makeBlueprint(overrides: Partial<Blueprint> = {}): Blueprint {
  const placements = overrides.placements ?? [
    placement(0, 0, 0, 0),
    placement(1, 1, 0, 0),
    placement(2, 0, 1, 0),
    placement(3, 0, 0, 1),
  ];

  return {
    id: 'test-id',
    name: 'Test Blueprint',
    version: 1,
    type: 'custom',
    dimensions: overrides.dimensions ?? { width: 2, height: 2, depth: 2 },
    metadata: {
      structureName: 'Test',
      dimensions: overrides.dimensions ?? { width: 2, height: 2, depth: 2 },
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
      currentPhase: 'not_started',
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const validator = new BlueprintValidator();

describe('BlueprintValidator', () => {
  describe('validate (full)', () => {
    it('returns valid for a correct blueprint', () => {
      const bp = makeBlueprint();
      const result = validator.validate(bp);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('returns warnings for empty placements', () => {
      const bp = makeBlueprint({ placements: [], dimensions: { width: 0, height: 0, depth: 0 } });
      const result = validator.validate(bp);
      expect(result.valid).toBe(true);
      expect(result.warnings).toContainEqual(
        expect.objectContaining({ code: 'EMPTY_PLACEMENTS' }),
      );
    });

    it('calculates resource requirements', () => {
      const bp = makeBlueprint({
        placements: [
          placement(0, 0, 0, 0, 'minecraft:stone'),
          placement(1, 1, 0, 0, 'minecraft:stone'),
          placement(2, 0, 1, 0, 'minecraft:gold_block'),
        ],
        dimensions: { width: 2, height: 2, depth: 1 },
      });
      const result = validator.validate(bp);
      expect(result.resourceRequirements).toEqual(
        expect.arrayContaining([
          { type: 'minecraft:stone', count: 2 },
          { type: 'minecraft:gold_block', count: 1 },
        ]),
      );
    });
  });

  describe('validateBlockTypes', () => {
    it('accepts valid Minecraft block IDs', () => {
      const errors = validator.validateBlockTypes([
        placement(0, 0, 0, 0, 'minecraft:stone'),
        placement(1, 1, 0, 0, 'minecraft:oak_planks'),
        placement(2, 2, 0, 0, 'mymod:custom_block'),
      ]);
      expect(errors).toHaveLength(0);
    });

    it('rejects empty block type', () => {
      const errors = validator.validateBlockTypes([
        placement(0, 0, 0, 0, ''),
      ]);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.code).toBe('INVALID_BLOCK_TYPE');
    });

    it('rejects block type without namespace', () => {
      const errors = validator.validateBlockTypes([
        placement(0, 0, 0, 0, 'stone'),
      ]);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.code).toBe('INVALID_BLOCK_TYPE');
    });

    it('rejects block type with uppercase letters', () => {
      const errors = validator.validateBlockTypes([
        placement(0, 0, 0, 0, 'Minecraft:Stone'),
      ]);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.code).toBe('INVALID_BLOCK_TYPE');
    });

    it('rejects block type with spaces', () => {
      const errors = validator.validateBlockTypes([
        placement(0, 0, 0, 0, 'minecraft: stone'),
      ]);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.code).toBe('INVALID_BLOCK_TYPE');
    });
  });

  describe('validateCoordinates', () => {
    it('accepts coordinates within world border', () => {
      const errors = validator.validateCoordinates([
        placement(0, 0, 0, 0),
        placement(1, 30_000_000, 0, -30_000_000),
      ]);
      expect(errors).toHaveLength(0);
    });

    it('rejects coordinates beyond world border', () => {
      const errors = validator.validateCoordinates([
        placement(0, 30_000_001, 0, 0),
      ]);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.code).toBe('COORDINATES_OUT_OF_BOUNDS');
    });

    it('rejects NaN coordinates', () => {
      const errors = validator.validateCoordinates([
        placement(0, NaN, 0, 0),
      ]);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.code).toBe('INVALID_COORDINATES');
    });

    it('rejects Infinity coordinates', () => {
      const errors = validator.validateCoordinates([
        placement(0, 0, Infinity, 0),
      ]);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.code).toBe('INVALID_COORDINATES');
    });

    it('rejects -Infinity coordinates', () => {
      const errors = validator.validateCoordinates([
        placement(0, 0, 0, -Infinity),
      ]);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.code).toBe('INVALID_COORDINATES');
    });
  });

  describe('validateDuplicatePositions', () => {
    it('accepts unique positions', () => {
      const errors = validator.validateDuplicatePositions([
        placement(0, 0, 0, 0),
        placement(1, 1, 0, 0),
        placement(2, 0, 1, 0),
      ]);
      expect(errors).toHaveLength(0);
    });

    it('detects duplicate positions', () => {
      const errors = validator.validateDuplicatePositions([
        placement(0, 5, 10, 15),
        placement(1, 5, 10, 15),
      ]);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.code).toBe('DUPLICATE_POSITION');
      expect(errors[0]!.placementIndex).toBe(1);
    });

    it('detects multiple duplicates', () => {
      const errors = validator.validateDuplicatePositions([
        placement(0, 0, 0, 0),
        placement(1, 0, 0, 0),
        placement(2, 0, 0, 0),
      ]);
      expect(errors).toHaveLength(2);
    });
  });

  describe('validateDimensions', () => {
    it('passes when dimensions match bounding box', () => {
      const bp = makeBlueprint({
        placements: [
          placement(0, 0, 0, 0),
          placement(1, 4, 0, 0),
          placement(2, 0, 2, 0),
          placement(3, 0, 0, 3),
        ],
        dimensions: { width: 5, height: 3, depth: 4 },
      });
      const errors = validator.validateDimensions(bp);
      expect(errors).toHaveLength(0);
    });

    it('reports width mismatch', () => {
      const bp = makeBlueprint({
        placements: [
          placement(0, 0, 0, 0),
          placement(1, 4, 0, 0),
        ],
        dimensions: { width: 10, height: 1, depth: 1 },
      });
      const errors = validator.validateDimensions(bp);
      expect(errors.some(e => e.code === 'DIMENSIONS_MISMATCH' && e.message.includes('width'))).toBe(true);
    });

    it('skips validation for empty placements', () => {
      const bp = makeBlueprint({
        placements: [],
        dimensions: { width: 99, height: 99, depth: 99 },
      });
      const errors = validator.validateDimensions(bp);
      expect(errors).toHaveLength(0);
    });
  });

  describe('calculateResources', () => {
    it('counts block types correctly', () => {
      const resources = validator.calculateResources([
        placement(0, 0, 0, 0, 'minecraft:stone'),
        placement(1, 1, 0, 0, 'minecraft:stone'),
        placement(2, 2, 0, 0, 'minecraft:gold_block'),
      ]);
      expect(resources).toEqual(
        expect.arrayContaining([
          { type: 'minecraft:stone', count: 2 },
          { type: 'minecraft:gold_block', count: 1 },
        ]),
      );
    });

    it('returns empty array for no placements', () => {
      const resources = validator.calculateResources([]);
      expect(resources).toEqual([]);
    });
  });
});
