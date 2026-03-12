/**
 * FarmerWorker — plants and harvests crops in a grid pattern.
 *
 * Operates within an assigned farm zone, iterating through grid cells
 * in row-by-row order. Alternates between planting and harvesting phases.
 *
 * Requirements: 16.5, 16.6, 16.7, 16.8
 */

import type { Vec3 } from '@pyramid-os/shared-types';
import type { ActionExecutor } from '../action-executor.js';
import type { Pathfinder } from '../pathfinder.js';
import { BaseWorker, type WorkerTickResult, type CompletionReporter } from './base-worker.js';

/** Axis-aligned farm zone with crop type. */
export interface FarmZone {
  min: Vec3;
  max: Vec3;
  cropType: string;
}

type FarmPhase = 'plant' | 'harvest';

export class FarmerWorker extends BaseWorker {
  private readonly zone: FarmZone;
  private phase: FarmPhase = 'plant';
  private cx: number;
  private cz: number;
  private taskId?: string | undefined;

  constructor(options: {
    botId: string;
    actionExecutor: ActionExecutor;
    pathfinder: Pathfinder;
    zone: FarmZone;
    taskId?: string;
    completionReporter?: CompletionReporter;
  }) {
    super({
      botId: options.botId,
      role: 'farmer',
      actionExecutor: options.actionExecutor,
      pathfinder: options.pathfinder,
      ...(options.completionReporter !== undefined ? { completionReporter: options.completionReporter } : {}),
    });
    this.zone = options.zone;
    if (options.taskId !== undefined) {
      this.taskId = options.taskId;
    }
    this.cx = this.zone.min.x;
    this.cz = this.zone.min.z;
  }

  async tick(): Promise<WorkerTickResult> {
    if (this.cx > this.zone.max.x && this.cz > this.zone.max.z) {
      // Completed a full pass — switch phase and reset cursor
      const completedPhase = this.phase;
      this.phase = this.phase === 'plant' ? 'harvest' : 'plant';
      this.cx = this.zone.min.x;
      this.cz = this.zone.min.z;

      if (this.taskId) {
        this.reportCompletion(this.taskId, `${completedPhase} pass complete`);
      }
      return { action: completedPhase, success: true, details: `${completedPhase} pass complete` };
    }

    const target: Vec3 = { x: this.cx, y: this.zone.min.y, z: this.cz };

    const navigated = await this.navigateTo(target);
    if (!navigated) {
      return { action: 'navigate', success: false, details: `Failed to navigate to (${target.x}, ${target.y}, ${target.z})` };
    }

    let result;
    if (this.phase === 'plant') {
      result = await this.actionExecutor.executeAction(this.botId, {
        type: 'place_block',
        params: { position: target, blockType: this.zone.cropType },
      });
    } else {
      result = await this.actionExecutor.executeAction(this.botId, {
        type: 'dig',
        params: { position: target },
      });
    }

    this.advanceCursor();

    return {
      action: this.phase,
      success: result.success,
      details: result.success
        ? `${this.phase === 'plant' ? 'Planted' : 'Harvested'} at (${target.x}, ${target.y}, ${target.z})`
        : `${this.phase} failed: ${result.error ?? result.outcome}`,
    };
  }

  private advanceCursor(): void {
    this.cx++;
    if (this.cx > this.zone.max.x) {
      this.cx = this.zone.min.x;
      this.cz++;
    }
  }
}
