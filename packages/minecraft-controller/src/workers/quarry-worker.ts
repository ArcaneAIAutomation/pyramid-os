/**
 * QuarryWorker — mines blocks using a deterministic row-by-row pattern.
 *
 * Operates within an assigned zone, iterating through positions in a
 * predictable x→z→y (top-down) pattern.
 *
 * Requirements: 16.2, 16.6, 16.7, 16.8
 */

import type { Vec3 } from '@pyramid-os/shared-types';
import type { ActionExecutor } from '../action-executor.js';
import type { Pathfinder } from '../pathfinder.js';
import { BaseWorker, type WorkerTickResult, type CompletionReporter } from './base-worker.js';

/** Axis-aligned bounding box defining the quarry zone. */
export interface QuarryZone {
  min: Vec3;
  max: Vec3;
}

export class QuarryWorker extends BaseWorker {
  private readonly zone: QuarryZone;
  private taskId?: string | undefined;

  // Current mining cursor (row-by-row: x varies fastest, then z, then y descends)
  private cx: number;
  private cz: number;
  private cy: number;

  constructor(options: {
    botId: string;
    actionExecutor: ActionExecutor;
    pathfinder: Pathfinder;
    zone: QuarryZone;
    taskId?: string;
    completionReporter?: CompletionReporter;
  }) {
    super({
      botId: options.botId,
      role: 'quarry',
      actionExecutor: options.actionExecutor,
      pathfinder: options.pathfinder,
      ...(options.completionReporter !== undefined ? { completionReporter: options.completionReporter } : {}),
    });
    this.zone = options.zone;
    if (options.taskId !== undefined) {
      this.taskId = options.taskId;
    }
    // Start at top-left of the highest layer
    this.cx = this.zone.min.x;
    this.cz = this.zone.min.z;
    this.cy = this.zone.max.y;
  }

  async tick(): Promise<WorkerTickResult> {
    if (this.cy < this.zone.min.y) {
      if (this.taskId) {
        this.reportCompletion(this.taskId, 'Quarry zone fully mined');
      }
      return { action: 'idle', success: true, details: 'Quarry zone fully mined' };
    }

    const target: Vec3 = { x: this.cx, y: this.cy, z: this.cz };

    const navigated = await this.navigateTo(target);
    if (!navigated) {
      return { action: 'navigate', success: false, details: `Failed to navigate to (${target.x}, ${target.y}, ${target.z})` };
    }

    const result = await this.actionExecutor.executeAction(this.botId, {
      type: 'dig',
      params: { position: target },
    });

    // Advance cursor: x → z → y (descending)
    this.advanceCursor();

    return {
      action: 'dig',
      success: result.success,
      details: result.success
        ? `Mined block at (${target.x}, ${target.y}, ${target.z})`
        : `Failed to mine: ${result.error ?? result.outcome}`,
    };
  }

  private advanceCursor(): void {
    this.cx++;
    if (this.cx > this.zone.max.x) {
      this.cx = this.zone.min.x;
      this.cz++;
      if (this.cz > this.zone.max.z) {
        this.cz = this.zone.min.z;
        this.cy--;
      }
    }
  }
}
