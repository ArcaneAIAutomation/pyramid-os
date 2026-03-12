/**
 * PriestWorker — executes ceremony actions at temple zones.
 *
 * Navigates to the temple zone and performs a sequence of ceremony actions
 * (chat announcements, block placements for offerings, etc.).
 *
 * Requirements: 16.7, 16.8
 */

import type { Vec3 } from '@pyramid-os/shared-types';
import type { ActionExecutor } from '../action-executor.js';
import type { Pathfinder } from '../pathfinder.js';
import { BaseWorker, type WorkerTickResult, type CompletionReporter } from './base-worker.js';

/** A single step in a ceremony sequence. */
export interface CeremonyAction {
  type: 'chat' | 'place_block';
  params: Record<string, unknown>;
}

/** Ceremony definition assigned to the priest. */
export interface CeremonyTask {
  id: string;
  templePosition: Vec3;
  actions: CeremonyAction[];
}

export class PriestWorker extends BaseWorker {
  private ceremony?: CeremonyTask;
  private actionIndex = 0;
  private taskId?: string;

  constructor(options: {
    botId: string;
    actionExecutor: ActionExecutor;
    pathfinder: Pathfinder;
    ceremony?: CeremonyTask;
    taskId?: string;
    completionReporter?: CompletionReporter;
  }) {
    super({
      botId: options.botId,
      role: 'priest',
      actionExecutor: options.actionExecutor,
      pathfinder: options.pathfinder,
      ...(options.completionReporter !== undefined ? { completionReporter: options.completionReporter } : {}),
    });
    if (options.ceremony !== undefined) {
      this.ceremony = options.ceremony;
    }
    if (options.taskId !== undefined) {
      this.taskId = options.taskId;
    }
  }

  /** Assign a new ceremony. */
  setCeremony(ceremony: CeremonyTask): void {
    this.ceremony = ceremony;
    this.actionIndex = 0;
  }

  async tick(): Promise<WorkerTickResult> {
    if (!this.ceremony) {
      return { action: 'idle', success: true, details: 'No ceremony assigned' };
    }

    // Navigate to temple if this is the first action
    if (this.actionIndex === 0) {
      const navigated = await this.navigateTo(this.ceremony.templePosition);
      if (!navigated) {
        return { action: 'navigate', success: false, details: 'Failed to navigate to temple' };
      }
    }

    if (this.actionIndex >= this.ceremony.actions.length) {
      if (this.taskId) {
        this.reportCompletion(this.taskId, `Ceremony ${this.ceremony.id} completed`);
      }
      const id = this.ceremony.id;
      delete this.ceremony;
      this.actionIndex = 0;
      return { action: 'ceremony_complete', success: true, details: `Ceremony ${id} completed` };
    }

    const step = this.ceremony.actions[this.actionIndex]!;
    const result = await this.actionExecutor.executeAction(this.botId, {
      type: step.type,
      params: step.params,
    });

    if (result.success) {
      this.actionIndex++;
    }

    return {
      action: `ceremony_step_${step.type}`,
      success: result.success,
      details: result.success
        ? `Ceremony step ${this.actionIndex} complete`
        : `Ceremony step failed: ${result.error ?? result.outcome}`,
    };
  }
}
