/**
 * HaulerWorker — transports items using shortest-path routing.
 *
 * Picks up items at a source location, navigates to a destination, and drops
 * them off. Uses pathfinding for navigation.
 *
 * Requirements: 16.3, 16.6, 16.7, 16.8
 */

import type { Vec3 } from '@pyramid-os/shared-types';
import type { ActionExecutor } from '../action-executor.js';
import type { Pathfinder } from '../pathfinder.js';
import { BaseWorker, type WorkerTickResult, type CompletionReporter } from './base-worker.js';

/** A haul job: pick up items at source, deliver to destination. */
export interface HaulJob {
  itemName: string;
  count: number;
  source: Vec3;
  destination: Vec3;
}

type HaulPhase = 'pickup' | 'deliver';

export class HaulerWorker extends BaseWorker {
  private job?: HaulJob | undefined;
  private phase: HaulPhase = 'pickup';
  private taskId?: string | undefined;

  constructor(options: {
    botId: string;
    actionExecutor: ActionExecutor;
    pathfinder: Pathfinder;
    job?: HaulJob;
    taskId?: string;
    completionReporter?: CompletionReporter;
  }) {
    super({
      botId: options.botId,
      role: 'hauler',
      actionExecutor: options.actionExecutor,
      pathfinder: options.pathfinder,
      ...(options.completionReporter !== undefined ? { completionReporter: options.completionReporter } : {}),
    });
    if (options.job !== undefined) {
      this.job = options.job;
    }
    if (options.taskId !== undefined) {
      this.taskId = options.taskId;
    }
  }

  /** Assign a new haul job. */
  setJob(job: HaulJob): void {
    this.job = job;
    this.phase = 'pickup';
  }

  async tick(): Promise<WorkerTickResult> {
    if (!this.job) {
      return { action: 'idle', success: true, details: 'No haul job assigned' };
    }

    if (this.phase === 'pickup') {
      const navigated = await this.navigateTo(this.job.source);
      if (!navigated) {
        return { action: 'navigate', success: false, details: 'Failed to navigate to source' };
      }
      // Simulate picking up items (equip)
      const result = await this.actionExecutor.executeAction(this.botId, {
        type: 'equip',
        params: { itemName: this.job.itemName, destination: 'hand' },
      });
      if (result.success) {
        this.phase = 'deliver';
      }
      return { action: 'pickup', success: result.success, details: result.success ? `Picked up ${this.job.itemName}` : `Pickup failed: ${result.error ?? result.outcome}` };
    }

    // deliver phase
    const navigated = await this.navigateTo(this.job.destination);
    if (!navigated) {
      return { action: 'navigate', success: false, details: 'Failed to navigate to destination' };
    }

    const result = await this.actionExecutor.executeAction(this.botId, {
      type: 'drop',
      params: { itemName: this.job.itemName, count: this.job.count },
    });

    if (result.success) {
      if (this.taskId) {
        this.reportCompletion(this.taskId, `Delivered ${this.job.count}x ${this.job.itemName}`);
      }
      this.job = undefined;
      this.phase = 'pickup';
    }

    return { action: 'deliver', success: result.success, details: result.success ? 'Delivery complete' : `Delivery failed: ${result.error ?? result.outcome}` };
  }
}
