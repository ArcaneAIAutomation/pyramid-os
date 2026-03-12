/**
 * Property-based test for worker action idempotency.
 *
 * Property 3: Executing any WorkerAction twice with the same inputs produces
 * the same observable outcome as executing it once — no duplicate block
 * placements, no duplicate inventory changes.
 *
 * The key idempotency invariant for BuilderWorker: if a block at index N is
 * already marked as placed, calling tick() again should NOT re-place it.
 * Instead it should advance to the next unplaced block.
 *
 * **Validates: Requirements 16.10, 18.3**
 */

import { describe, it, expect, vi } from 'vitest';
import * as fc from 'fast-check';
import type { ActionResult, BotAction } from '@pyramid-os/shared-types';
import type { Pathfinder } from '../pathfinder.js';
import { BuilderWorker } from '../workers/builder-worker.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function successResult(action: string): ActionResult {
  return {
    success: true,
    action,
    botId: 'bot-1',
    outcome: 'ok',
    timestamp: new Date().toISOString(),
  };
}

function createMockActionExecutor() {
  return {
    executeAction: vi.fn().mockImplementation(
      (_botId: string, action: BotAction) => Promise.resolve(successResult(action.type)),
    ),
    setErrorReporter: vi.fn(),
  };
}

function createMockPathfinder(): Pathfinder {
  return {} as unknown as Pathfinder;
}

interface MockPlacement {
  index: number;
  position: { x: number; y: number; z: number };
  blockType: string;
  placed: boolean;
}

/**
 * Creates a mock ProgressTracker that faithfully mirrors the real one:
 * - getNextPlacement() returns the lowest-index unplaced block
 * - markPlaced(index) marks a block as placed
 */
function createMockProgressTracker(placements: MockPlacement[]) {
  return {
    getNextPlacement: vi.fn().mockImplementation(() => {
      return [...placements]
        .filter((p) => !p.placed)
        .sort((a, b) => a.index - b.index)[0] ?? undefined;
    }),
    markPlaced: vi.fn().mockImplementation((index: number) => {
      const p = placements.find((pl) => pl.index === index);
      if (p) p.placed = true;
    }),
    getProgress: vi.fn().mockReturnValue({
      totalBlocks: placements.length,
      placedBlocks: 0,
      percentComplete: 0,
      currentPhase: 'foundation',
    }),
  };
}

// ─── Arbitraries ──────────────────────────────────────────────────────────────

const blockTypeArb = fc.constantFrom(
  'minecraft:sandstone',
  'minecraft:stone',
  'minecraft:gold_block',
  'minecraft:limestone',
  'minecraft:quartz_block',
);

const positionArb = fc.record({
  x: fc.integer({ min: -1000, max: 1000 }),
  y: fc.integer({ min: 0, max: 256 }),
  z: fc.integer({ min: -1000, max: 1000 }),
});

/** Generate a list of 1–20 unique-index placements, all initially unplaced. */
const placementsArb: fc.Arbitrary<MockPlacement[]> = fc
  .integer({ min: 1, max: 20 })
  .chain((count) =>
    fc.tuple(
      fc.array(positionArb, { minLength: count, maxLength: count }),
      fc.array(blockTypeArb, { minLength: count, maxLength: count }),
    ).map(([positions, blockTypes]) =>
      positions.map((pos, i) => ({
        index: i,
        position: pos,
        blockType: blockTypes[i]!,
        placed: false,
      })),
    ),
  );

// ─── Property tests ──────────────────────────────────────────────────────────

describe('Worker action idempotency property', () => {
  it('markPlaced is called exactly once per block index across repeated ticks', async () => {
    await fc.assert(
      fc.asyncProperty(placementsArb, async (placements) => {
        // Deep-clone so each run starts fresh
        const clonedPlacements: MockPlacement[] = placements.map((p) => ({ ...p, placed: false }));

        const tracker = createMockProgressTracker(clonedPlacements);
        const executor = createMockActionExecutor();

        const worker = new BuilderWorker({
          botId: 'bot-1',
          actionExecutor: executor as any,
          pathfinder: createMockPathfinder(),
          progressTracker: tracker as any,
        });

        // Tick through ALL blocks (N ticks to place N blocks)
        for (let i = 0; i < clonedPlacements.length; i++) {
          await worker.tick();
        }

        // Now all blocks should be placed
        // Tick again — this should be idle, NOT re-place any block
        const idleResult = await worker.tick();
        expect(idleResult.action).toBe('idle');

        // Verify markPlaced was called exactly once per block index
        const markPlacedCalls = (tracker.markPlaced.mock.calls as [number][]).map(
          (call) => call[0],
        );

        // Each index should appear exactly once
        const callCounts = new Map<number, number>();
        for (const idx of markPlacedCalls) {
          callCounts.set(idx, (callCounts.get(idx) ?? 0) + 1);
        }

        for (const [idx, count] of callCounts) {
          expect(count).toBe(1);
        }

        // Every block index should have been placed
        expect(markPlacedCalls.length).toBe(clonedPlacements.length);
        const placedIndices = new Set(markPlacedCalls);
        for (let i = 0; i < clonedPlacements.length; i++) {
          expect(placedIndices.has(i)).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('place_block executeAction is called with correct sequential indices', async () => {
    await fc.assert(
      fc.asyncProperty(placementsArb, async (placements) => {
        const clonedPlacements: MockPlacement[] = placements.map((p) => ({ ...p, placed: false }));

        const tracker = createMockProgressTracker(clonedPlacements);
        const executor = createMockActionExecutor();

        const worker = new BuilderWorker({
          botId: 'bot-1',
          actionExecutor: executor as any,
          pathfinder: createMockPathfinder(),
          progressTracker: tracker as any,
        });

        // Tick through all blocks
        for (let i = 0; i < clonedPlacements.length; i++) {
          await worker.tick();
        }

        // Filter only place_block calls (not move_to calls)
        const placeBlockCalls = (executor.executeAction.mock.calls as [string, BotAction][]).filter(
          (call) => call[1].type === 'place_block',
        );

        // Should have exactly N place_block calls
        expect(placeBlockCalls.length).toBe(clonedPlacements.length);

        // Each call should correspond to the correct sequential index
        for (let i = 0; i < placeBlockCalls.length; i++) {
          const action = placeBlockCalls[i]![1] as BotAction;
          const expectedPlacement = clonedPlacements[i]!;
          expect(action.params).toEqual({
            position: expectedPlacement.position,
            blockType: expectedPlacement.blockType,
          });
        }
      }),
      { numRuns: 100 },
    );
  });

  it('double-ticking after a block is placed does not re-place the same block', async () => {
    await fc.assert(
      fc.asyncProperty(placementsArb, async (placements) => {
        const clonedPlacements: MockPlacement[] = placements.map((p) => ({ ...p, placed: false }));

        const tracker = createMockProgressTracker(clonedPlacements);
        const executor = createMockActionExecutor();

        const worker = new BuilderWorker({
          botId: 'bot-1',
          actionExecutor: executor as any,
          pathfinder: createMockPathfinder(),
          progressTracker: tracker as any,
        });

        // Place the first block
        const firstResult = await worker.tick();
        expect(firstResult.action).toBe('place_block');
        expect(firstResult.success).toBe(true);

        // The first block (index 0) should now be marked as placed
        expect(clonedPlacements[0]!.placed).toBe(true);

        // Tick again — should place the NEXT block (index 1), not re-place index 0
        const secondResult = await worker.tick();

        if (clonedPlacements.length > 1) {
          // Should advance to next block
          expect(secondResult.action).toBe('place_block');
          expect(secondResult.details).toContain('index 1');
        } else {
          // Only one block, so should be idle now
          expect(secondResult.action).toBe('idle');
        }

        // Verify index 0 was only placed once
        const index0Calls = (tracker.markPlaced.mock.calls as [number][]).filter(
          (call) => call[0] === 0,
        );
        expect(index0Calls.length).toBe(1);
      }),
      { numRuns: 100 },
    );
  });
});
