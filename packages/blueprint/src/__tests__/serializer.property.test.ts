/**
 * Property-based test for Blueprint round-trip serialization.
 *
 * Property: `deserialize(serialize(blueprint))` produces a structurally
 * equivalent Blueprint for any valid blueprint — all fields, placements,
 * and metadata match.
 *
 * **Validates: Requirements 4.10, 18.6**
 */

import { describe, it } from 'vitest';
import * as fc from 'fast-check';
import { BlueprintSerializer } from '../serializer.js';
import type { Blueprint, BlockPlacement } from '@pyramid-os/shared-types';

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/** Random Vec3 with integer coordinates */
const vec3Arb = fc.record({
  x: fc.integer({ min: -30_000_000, max: 30_000_000 }),
  y: fc.integer({ min: -30_000_000, max: 30_000_000 }),
  z: fc.integer({ min: -30_000_000, max: 30_000_000 }),
});

/** Random BlockPlacement */
const blockPlacementArb: fc.Arbitrary<BlockPlacement> = fc.record({
  index: fc.nat({ max: 999_999 }),
  position: vec3Arb,
  blockType: fc.constantFrom(
    'minecraft:sandstone',
    'minecraft:stone',
    'minecraft:gold_block',
    'minecraft:limestone',
    'minecraft:obsidian',
  ),
  placed: fc.boolean(),
});

/** Full Blueprint with all required fields */
const blueprintArb: fc.Arbitrary<Blueprint> = fc.record({
  id: fc.uuid(),
  name: fc.string({ minLength: 1, maxLength: 50 }),
  version: fc.integer({ min: 1, max: 100 }),
  type: fc.constantFrom('pyramid', 'housing', 'farm', 'temple', 'custom') as fc.Arbitrary<Blueprint['type']>,
  dimensions: fc.record({
    width: fc.integer({ min: 1, max: 1000 }),
    height: fc.integer({ min: 1, max: 1000 }),
    depth: fc.integer({ min: 1, max: 1000 }),
  }),
  metadata: fc.record({
    structureName: fc.string({ minLength: 1, maxLength: 100 }),
    dimensions: fc.record({
      width: fc.integer({ min: 1, max: 1000 }),
      height: fc.integer({ min: 1, max: 1000 }),
      depth: fc.integer({ min: 1, max: 1000 }),
    }),
    requiredResources: fc.array(
      fc.record({
        type: fc.string({ minLength: 1, maxLength: 50 }),
        count: fc.nat({ max: 100_000 }),
      }),
      { minLength: 0, maxLength: 10 },
    ),
    estimatedTimeMinutes: fc.integer({ min: 1, max: 10_000 }),
    createdAt: fc.date({ min: new Date('2020-01-01'), max: new Date('2030-01-01') })
      .map((d) => d.toISOString()),
    createdBy: fc.uuid(),
  }),
  placements: fc.array(blockPlacementArb, { minLength: 0, maxLength: 20 }),
  progress: fc.record({
    totalBlocks: fc.integer({ min: 0, max: 1_000_000 }),
    placedBlocks: fc.integer({ min: 0, max: 1_000_000 }),
    percentComplete: fc.float({ min: 0, max: 100, noNaN: true }),
    currentPhase: fc.string({ minLength: 1, maxLength: 50 }),
  }),
});

// ─── Stable key-sorted replacer (mirrors the serializer's internal approach) ──

function stableReplacer(_key: string, value: unknown): unknown {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[k] = (value as Record<string, unknown>)[k];
    }
    return sorted;
  }
  return value;
}

// ─── Property test ────────────────────────────────────────────────────────────

describe('BlueprintSerializer round-trip property', () => {
  it('deserialize(serialize(blueprint)) produces a structurally equivalent Blueprint', () => {
    const serializer = new BlueprintSerializer();

    fc.assert(
      fc.property(blueprintArb, (blueprint) => {
        const json = serializer.serialize(blueprint);
        const roundTripped = serializer.deserialize(json);

        // Compare using stable key-sorted JSON — same approach as the serializer
        const original = JSON.stringify(blueprint, stableReplacer);
        const result = JSON.stringify(roundTripped, stableReplacer);

        return original === result;
      }),
      { numRuns: 100 },
    );
  });
});
