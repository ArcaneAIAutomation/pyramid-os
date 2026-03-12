/**
 * TaskQueue — priority-ordered task queue for the Society Engine.
 *
 * Maintains an in-memory list of tasks sorted by priority (critical > high > normal > low).
 * Supports enqueue, dequeue (assigns to agent), block, retry, and queue-length queries.
 *
 * Requirements: 3.1, 3.9, 13.5
 */

import type { Task, TaskPriority, TaskStatus } from '@pyramid-os/shared-types';
import type { Logger } from '@pyramid-os/logger';

/** Numeric weight for priority ordering — higher value = higher priority. */
const PRIORITY_WEIGHT: Record<TaskPriority, number> = {
  critical: 4,
  high: 3,
  normal: 2,
  low: 1,
};

/** Optional callback invoked whenever the internal task list changes. */
export type PersistCallback = (tasks: Task[]) => void;

export class TaskQueue {
  private tasks: Task[] = [];
  private readonly logger: Logger;
  private readonly onPersist: PersistCallback | undefined;

  constructor(logger: Logger, onPersist?: PersistCallback) {
    this.logger = logger;
    this.onPersist = onPersist;
  }

  /** Total number of tasks currently in the queue (any status). */
  get size(): number {
    return this.tasks.length;
  }

  /**
   * Insert a task into the queue maintaining priority order.
   * The task's status is set to `'pending'` on enqueue.
   */
  enqueue(task: Task): void {
    const entry: Task = { ...task, status: 'pending' };

    // Find insertion index — keep highest priority first, stable within same priority.
    const weight = PRIORITY_WEIGHT[entry.priority];
    let insertIdx = this.tasks.length;
    for (let i = 0; i < this.tasks.length; i++) {
      const taskPriority = this.tasks[i]!.priority;
      if (PRIORITY_WEIGHT[taskPriority] < weight) {
        insertIdx = i;
        break;
      }
    }

    this.tasks.splice(insertIdx, 0, entry);
    this.logger.info('Task enqueued', { taskId: entry.id, priority: entry.priority });
    this.persist();
  }

  /**
   * Return the highest-priority pending task and mark it as assigned to `agentId`.
   * Returns `undefined` when no pending tasks exist.
   */
  dequeue(agentId: string): Task | undefined {
    const idx = this.tasks.findIndex((t) => t.status === 'pending');
    if (idx === -1) return undefined;

    const task = this.tasks[idx];
    if (!task) return undefined;

    task.status = 'assigned';
    task.agentId = agentId;
    task.updatedAt = new Date().toISOString();

    this.logger.info('Task dequeued', { taskId: task.id, agentId });
    this.persist();
    return task;
  }

  /**
   * Mark a task as blocked with a reason string.
   * Requirement 13.5 — tasks that fail repeatedly are marked blocked.
   */
  blockTask(taskId: string, reason: string): void {
    const task = this.findTask(taskId);
    if (!task) {
      this.logger.warn('blockTask: task not found', { taskId });
      return;
    }

    task.status = 'blocked';
    task.updatedAt = new Date().toISOString();
    this.logger.warn('Task blocked', { taskId, reason });
    this.persist();
  }

  /**
   * Reset a blocked or failed task back to pending so it can be dequeued again.
   */
  retryTask(taskId: string): void {
    const task = this.findTask(taskId);
    if (!task) {
      this.logger.warn('retryTask: task not found', { taskId });
      return;
    }

    if (task.status !== 'blocked' && task.status !== 'failed') {
      this.logger.warn('retryTask: task is not blocked or failed', {
        taskId,
        currentStatus: task.status,
      });
      return;
    }

    task.status = 'pending';
    delete task.agentId;
    task.updatedAt = new Date().toISOString();
    this.logger.info('Task retried', { taskId });
    this.persist();
  }

  /**
   * Return the count of pending tasks grouped by assigned agent.
   * Tasks without an `agentId` are counted under `'unassigned'`.
   */
  getQueueLengths(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const task of this.tasks) {
      if (task.status !== 'pending') continue;
      const key = task.agentId ?? 'unassigned';
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return counts;
  }

  /** Retrieve a task by ID, or `undefined` if not found. */
  getTask(taskId: string): Task | undefined {
    return this.tasks.find((t) => t.id === taskId);
  }

  // ── internal helpers ──────────────────────────────────────────────

  private findTask(taskId: string): Task | undefined {
    return this.tasks.find((t) => t.id === taskId);
  }

  private persist(): void {
    if (this.onPersist) {
      this.onPersist([...this.tasks]);
    }
  }
}
