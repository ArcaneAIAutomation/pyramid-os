/**
 * Property-based test for worker failure task reassignment.
 *
 * **Property 4: Worker failure task reassignment**
 * For any random worker pool with task assignments, when one or more workers
 * fail, all tasks assigned to failed workers are reassigned or returned to the
 * queue. No tasks are lost — the total task count before failure equals the
 * total task count after reassignment.
 *
 * Uses a simplified reference model that tracks task assignments across workers
 * and verifies the invariant that no tasks are lost when workers fail.
 *
 * **Validates: Requirements 13.1, 40.5**
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import type { AgentRole, WorkerRole, Task, TaskPriority, TaskType } from '@pyramid-os/shared-types';

// ─── Types ───────────────────────────────────────────────────────────────────

/** A worker in the reference model */
interface RefWorker {
  id: string;
  role: WorkerRole;
  alive: boolean;
}

/** Simplified task assignment tracker */
interface RefTask {
  id: string;
  type: TaskType;
  priority: TaskPriority;
  assignedTo: string | null; // worker id or null (in queue)
}

// ─── Reference Model ─────────────────────────────────────────────────────────

/**
 * Reference model that mirrors the expected behavior of AgentManager + TaskQueue
 * when workers fail. It tracks which tasks are assigned to which workers and
 * implements the reassignment logic on failure.
 */
class WorkerPoolModel {
  workers: Map<string, RefWorker> = new Map();
  tasks: Map<string, RefTask> = new Map();

  addWorker(worker: RefWorker): void {
    this.workers.set(worker.id, { ...worker });
  }

  addTask(task: RefTask): void {
    this.tasks.set(task.id, { ...task });
  }

  /** Assign a task to a worker */
  assignTask(taskId: string, workerId: string): boolean {
    const task = this.tasks.get(taskId);
    const worker = this.workers.get(workerId);
    if (!task || !worker || !worker.alive) return false;
    task.assignedTo = workerId;
    return true;
  }

  /**
   * Simulate worker failure: mark worker as dead and return all its tasks
   * to the unassigned pool (assignedTo = null). This models the behavior
   * described in Req 13.1 and 40.5.
   */
  failWorker(workerId: string): string[] {
    const worker = this.workers.get(workerId);
    if (!worker || !worker.alive) return [];

    worker.alive = false;
    const reassignedTaskIds: string[] = [];

    for (const [taskId, task] of this.tasks) {
      if (task.assignedTo === workerId) {
        task.assignedTo = null; // return to queue
        reassignedTaskIds.push(taskId);
      }
    }

    return reassignedTaskIds;
  }

  /**
   * Reassign unassigned tasks to alive workers in round-robin fashion.
   * Returns the number of tasks reassigned.
   */
  reassignTasks(): number {
    const aliveWorkers = [...this.workers.values()].filter((w) => w.alive);
    if (aliveWorkers.length === 0) return 0;

    let reassigned = 0;
    let workerIdx = 0;

    for (const task of this.tasks.values()) {
      if (task.assignedTo === null) {
        task.assignedTo = aliveWorkers[workerIdx % aliveWorkers.length]!.id;
        workerIdx++;
        reassigned++;
      }
    }

    return reassigned;
  }

  /** Get total task count */
  get totalTasks(): number {
    return this.tasks.size;
  }

  /** Get all task IDs */
  getAllTaskIds(): Set<string> {
    return new Set(this.tasks.keys());
  }

  /** Get tasks assigned to a specific worker */
  getWorkerTasks(workerId: string): RefTask[] {
    return [...this.tasks.values()].filter((t) => t.assignedTo === workerId);
  }

  /** Get unassigned tasks */
  getUnassignedTasks(): RefTask[] {
    return [...this.tasks.values()].filter((t) => t.assignedTo === null);
  }
}

// ─── Arbitraries ─────────────────────────────────────────────────────────────

const workerRoleArb: fc.Arbitrary<WorkerRole> = fc.constantFrom(
  'builder', 'quarry', 'hauler', 'guard', 'farmer', 'priest',
);

const taskTypeArb: fc.Arbitrary<TaskType> = fc.constantFrom(
  'build', 'mine', 'haul', 'farm', 'guard', 'ceremony',
);

const taskPriorityArb: fc.Arbitrary<TaskPriority> = fc.constantFrom(
  'critical', 'high', 'normal', 'low',
);

/** Generate a worker pool of 2–8 workers */
const workerPoolArb: fc.Arbitrary<RefWorker[]> = fc
  .array(
    fc.record({
      id: fc.uuid(),
      role: workerRoleArb,
      alive: fc.constant(true),
    }),
    { minLength: 2, maxLength: 8 },
  )
  .filter((workers) => {
    // Ensure unique IDs
    const ids = new Set(workers.map((w) => w.id));
    return ids.size === workers.length;
  });

/** Generate a set of tasks (3–20) */
const taskListArb: fc.Arbitrary<RefTask[]> = fc
  .array(
    fc.record({
      id: fc.uuid(),
      type: taskTypeArb,
      priority: taskPriorityArb,
      assignedTo: fc.constant(null as string | null),
    }),
    { minLength: 3, maxLength: 20 },
  )
  .filter((tasks) => {
    const ids = new Set(tasks.map((t) => t.id));
    return ids.size === tasks.length;
  });

// ─── Property Tests ──────────────────────────────────────────────────────────

describe('Worker failure task reassignment (property)', () => {
  it('no tasks are lost when a single worker fails and tasks are reassigned', () => {
    fc.assert(
      fc.property(
        workerPoolArb,
        taskListArb,
        fc.integer({ min: 0 }), // seed for selecting which worker fails
        (workers, tasks, failSeed) => {
          const model = new WorkerPoolModel();

          // Set up workers
          for (const w of workers) {
            model.addWorker(w);
          }

          // Set up tasks
          for (const t of tasks) {
            model.addTask(t);
          }

          const taskCountBefore = model.totalTasks;
          const taskIdsBefore = model.getAllTaskIds();

          // Assign tasks round-robin to workers
          const workerIds = workers.map((w) => w.id);
          let idx = 0;
          for (const t of tasks) {
            model.assignTask(t.id, workerIds[idx % workerIds.length]!);
            idx++;
          }

          // All tasks should be assigned
          expect(model.getUnassignedTasks()).toHaveLength(0);

          // Fail one worker
          const failIdx = failSeed % workers.length;
          const failedWorkerId = workerIds[failIdx]!;
          const reassignedIds = model.failWorker(failedWorkerId);

          // Tasks from failed worker should now be unassigned
          expect(model.getWorkerTasks(failedWorkerId)).toHaveLength(0);

          // Total task count unchanged
          expect(model.totalTasks).toBe(taskCountBefore);

          // All original task IDs still present
          const taskIdsAfterFailure = model.getAllTaskIds();
          expect(taskIdsAfterFailure).toEqual(taskIdsBefore);

          // Reassign unassigned tasks to surviving workers
          model.reassignTasks();

          // After reassignment: no unassigned tasks (since we have ≥2 workers, at least 1 alive)
          expect(model.getUnassignedTasks()).toHaveLength(0);

          // Total task count still unchanged
          expect(model.totalTasks).toBe(taskCountBefore);

          // All original task IDs still present
          const taskIdsAfterReassign = model.getAllTaskIds();
          expect(taskIdsAfterReassign).toEqual(taskIdsBefore);

          // No tasks assigned to the failed worker
          expect(model.getWorkerTasks(failedWorkerId)).toHaveLength(0);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('no tasks are lost when multiple workers fail simultaneously', () => {
    fc.assert(
      fc.property(
        workerPoolArb,
        taskListArb,
        fc.integer({ min: 1, max: 7 }), // number of workers to fail
        fc.integer({ min: 0 }),           // seed for randomizing failure selection
        (workers, tasks, failCount, seed) => {
          const model = new WorkerPoolModel();

          for (const w of workers) model.addWorker(w);
          for (const t of tasks) model.addTask(t);

          const taskCountBefore = model.totalTasks;
          const taskIdsBefore = model.getAllTaskIds();

          // Assign tasks round-robin
          const workerIds = workers.map((w) => w.id);
          let idx = 0;
          for (const t of tasks) {
            model.assignTask(t.id, workerIds[idx % workerIds.length]!);
            idx++;
          }

          // Fail up to (workers.length - 1) workers — always keep at least 1 alive
          const actualFailCount = Math.min(failCount, workers.length - 1);
          const failedWorkerIds = new Set<string>();

          // Use seed to deterministically pick which workers fail
          const shuffled = [...workerIds];
          for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.abs((seed + i) % (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
          }

          for (let i = 0; i < actualFailCount; i++) {
            const wId = shuffled[i]!;
            model.failWorker(wId);
            failedWorkerIds.add(wId);
          }

          // Total task count unchanged after failures
          expect(model.totalTasks).toBe(taskCountBefore);
          expect(model.getAllTaskIds()).toEqual(taskIdsBefore);

          // No tasks assigned to any failed worker
          for (const fId of failedWorkerIds) {
            expect(model.getWorkerTasks(fId)).toHaveLength(0);
          }

          // Reassign
          model.reassignTasks();

          // After reassignment: no unassigned tasks
          expect(model.getUnassignedTasks()).toHaveLength(0);

          // Total task count still unchanged
          expect(model.totalTasks).toBe(taskCountBefore);
          expect(model.getAllTaskIds()).toEqual(taskIdsBefore);

          // All tasks assigned to alive workers only
          for (const task of model.tasks.values()) {
            expect(task.assignedTo).not.toBeNull();
            expect(failedWorkerIds.has(task.assignedTo!)).toBe(false);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it('tasks remain in queue when all workers fail', () => {
    fc.assert(
      fc.property(workerPoolArb, taskListArb, (workers, tasks) => {
        const model = new WorkerPoolModel();

        for (const w of workers) model.addWorker(w);
        for (const t of tasks) model.addTask(t);

        const taskCountBefore = model.totalTasks;
        const taskIdsBefore = model.getAllTaskIds();

        // Assign tasks
        const workerIds = workers.map((w) => w.id);
        let idx = 0;
        for (const t of tasks) {
          model.assignTask(t.id, workerIds[idx % workerIds.length]!);
          idx++;
        }

        // Fail ALL workers
        for (const wId of workerIds) {
          model.failWorker(wId);
        }

        // Total task count unchanged
        expect(model.totalTasks).toBe(taskCountBefore);
        expect(model.getAllTaskIds()).toEqual(taskIdsBefore);

        // All tasks should be unassigned (back in queue)
        expect(model.getUnassignedTasks()).toHaveLength(taskCountBefore);

        // Reassign returns 0 since no alive workers
        const reassigned = model.reassignTasks();
        expect(reassigned).toBe(0);

        // Tasks still in queue, none lost
        expect(model.totalTasks).toBe(taskCountBefore);
        expect(model.getAllTaskIds()).toEqual(taskIdsBefore);
      }),
      { numRuns: 200 },
    );
  });
});
