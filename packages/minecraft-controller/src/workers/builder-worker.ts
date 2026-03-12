/**
 * BuilderWorker — places blocks in exact Blueprint order.
 *
 * Each tick() gets the next placement from ProgressTracker, navigates to the
 * position, and places the block via ActionExecutor.
 *
 * Requirements: 16.1, 16.6, 16.7, 16.8
 */

import type { ProgressTracker } from '@pyramid-os/blueprint';
import type { ActionExecutor } from '../action-executor.js';
import type { Pathfinder } from '../pathfinder.js';
import { BaseWorker, type WorkerTickResult, type CompletionReporter } from './base-worker.js';

export class BuilderWorker extends BaseWorker {
  private readonly progressTracker: ProgressTracker;
  private taskId?: string | undefined;

  constructor(options: {
    botId: string;
    actionExecutor: ActionExecutor;
    pathfinder: Pathfinder;
    progressTracker: ProgressTracker;
    taskId?: string;
    completionReporter?: CompletionReporter;
  }) {
    super({
      botId: options.botId,
      role: 'builder',
      actionExecutor: options.actionExecutor,
      pathfinder: options.pathfinder,
      ...(options.completionReporter !== undefined ? { completionReporter: options.completionReporter } : {}),
    });
    this.progressTracker = options.progressTracker;
    if (options.taskId !== undefined) {
      this.taskId = options.taskId;
    }
  }

  /** Assign a task ID for completion reporting. */
  setTaskId(taskId: string): void {
    this.taskId = taskId;
  }

  /**
   * tick(): get next placement → navigate → place block.
   * Returns idle result when all blocks are placed.
   */
  async tick(): Promise<WorkerTickResult> {
    const placement = this.progressTracker.getNextPlacement();

    if (!placement) {
      if (this.taskId) {
        this.reportCompletion(this.taskId, 'All blocks placed');
      }
      return { action: 'idle', success: true, details: 'No more blocks to place' };
    }

    // Navigate to the block position
    const navigated = await this.navigateTo(placement.position);
    if (!navigated) {
      return { action: 'navigate', success: false, details: `Failed to navigate to (${placement.position.x}, ${placement.position.y}, ${placement.position.z})` };
    }

    // Place the block
    const result = await this.actionExecutor.executeAction(this.botId, {
      type: 'place_block',
      params: { position: placement.position, blockType: placement.blockType },
    });

    if (result.success) {
      this.progressTracker.markPlaced(placement.index);
    }

    return {
      action: 'place_block',
      success: result.success,
      details: result.success
        ? `Placed ${placement.blockType} at index ${placement.index}`
        : `Failed to place block: ${result.error ?? result.outcome}`,
    };
  }
}
