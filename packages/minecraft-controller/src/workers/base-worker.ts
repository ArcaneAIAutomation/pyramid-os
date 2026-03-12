/**
 * BaseWorker — abstract base class for all Worker role behaviors.
 *
 * Provides shared infrastructure: bot identity, role, access to ActionExecutor
 * and Pathfinder, and a standard completion-reporting method.
 *
 * All concrete workers implement `tick()` which is called periodically by the
 * bot-foreman loop. Workers use pathfinding (not LLM) for navigation and
 * report task completion with task ID and outcome.
 *
 * Requirements: 7.3, 16.6, 16.7, 16.8
 */

import type { WorkerRole, Vec3 } from '@pyramid-os/shared-types';
import type { ActionExecutor } from '../action-executor.js';
import type { Pathfinder } from '../pathfinder.js';

/** Result returned by every worker tick. */
export interface WorkerTickResult {
  action: string;
  success: boolean;
  details: string;
}

/** Callback invoked when a worker reports task completion. */
export type CompletionReporter = (taskId: string, outcome: string) => void;

export abstract class BaseWorker {
  readonly botId: string;
  readonly role: WorkerRole;

  protected readonly actionExecutor: ActionExecutor;
  protected readonly pathfinder: Pathfinder;
  private completionReporter?: CompletionReporter | undefined;

  constructor(options: {
    botId: string;
    role: WorkerRole;
    actionExecutor: ActionExecutor;
    pathfinder: Pathfinder;
    completionReporter?: CompletionReporter | undefined;
  }) {
    this.botId = options.botId;
    this.role = options.role;
    this.actionExecutor = options.actionExecutor;
    this.pathfinder = options.pathfinder;
    this.completionReporter = options.completionReporter;
  }

  /** Periodic behavior loop — implemented by each concrete worker. */
  abstract tick(): Promise<WorkerTickResult>;

  /**
   * Report task completion with task ID and outcome.
   * Requirement: 16.7
   */
  reportCompletion(taskId: string, outcome: string): void {
    if (this.completionReporter) {
      this.completionReporter(taskId, outcome);
    }
  }

  /** Navigate the bot to a target position using pathfinding (not LLM). Requirement: 16.6 */
  protected async navigateTo(target: Vec3): Promise<boolean> {
    const result = await this.actionExecutor.executeAction(this.botId, {
      type: 'move_to',
      params: { position: target },
    });
    return result.success;
  }
}
