/**
 * ProgressTracker — tracks construction progress for a Blueprint.
 *
 * Provides:
 *   - markPlaced(index)       — mark a block as placed
 *   - getProgress()           — current BlueprintProgress snapshot
 *   - getNextPlacement()      — lowest-index unplaced block
 *
 * Requirements: 4.7, 4.8
 */

import type { Blueprint, BlockPlacement, BlueprintProgress } from '@pyramid-os/shared-types';

export class ProgressTracker {
  private readonly blueprint: Blueprint;

  constructor(blueprint: Blueprint) {
    this.blueprint = blueprint;
  }

  /**
   * Mark the block at the given index as placed.
   * Throws if the index does not exist in the blueprint.
   */
  markPlaced(index: number): void {
    const placement = this.blueprint.placements.find(p => p.index === index);
    if (!placement) {
      throw new Error(`No placement found with index ${index}`);
    }
    placement.placed = true;
  }

  /**
   * Return a snapshot of the current construction progress.
   */
  getProgress(): BlueprintProgress {
    const totalBlocks = this.blueprint.placements.length;
    const placedBlocks = this.blueprint.placements.filter(p => p.placed).length;
    const percentComplete = totalBlocks === 0 ? 0 : (placedBlocks / totalBlocks) * 100;

    return {
      totalBlocks,
      placedBlocks,
      percentComplete,
      currentPhase: this.blueprint.progress.currentPhase,
    };
  }

  /**
   * Return the lowest-index unplaced block, or undefined if all blocks are placed.
   */
  getNextPlacement(): BlockPlacement | undefined {
    return this.blueprint.placements
      .filter(p => !p.placed)
      .sort((a, b) => a.index - b.index)[0];
  }
}
