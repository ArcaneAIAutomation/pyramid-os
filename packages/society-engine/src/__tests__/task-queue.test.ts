import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Task, TaskPriority } from '@pyramid-os/shared-types';
import type { Logger } from '@pyramid-os/logger';
import { TaskQueue, type PersistCallback } from '../task-queue.js';

// ── helpers ─────────────────────────────────────────────────────────

function createMockLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

let idCounter = 0;
function makeTask(overrides: Partial<Task> = {}): Task {
  idCounter += 1;
  return {
    id: `task-${idCounter}`,
    type: 'build',
    status: 'pending',
    priority: 'normal',
    civilizationId: 'civ-1',
    description: `Test task ${idCounter}`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    dependencies: [],
    ...overrides,
  };
}

// ── tests ───────────────────────────────────────────────────────────

describe('TaskQueue', () => {
  let logger: Logger;
  let queue: TaskQueue;

  beforeEach(() => {
    idCounter = 0;
    logger = createMockLogger();
    queue = new TaskQueue(logger);
  });

  // ── enqueue ─────────────────────────────────────────────────────

  describe('enqueue', () => {
    it('adds a task and increases size', () => {
      queue.enqueue(makeTask());
      expect(queue.size).toBe(1);
    });

    it('sets task status to pending on enqueue', () => {
      const task = makeTask({ status: 'in_progress' });
      queue.enqueue(task);
      expect(queue.getTask(task.id)?.status).toBe('pending');
    });

    it('maintains priority order (critical > high > normal > low)', () => {
      const low = makeTask({ priority: 'low' });
      const normal = makeTask({ priority: 'normal' });
      const critical = makeTask({ priority: 'critical' });
      const high = makeTask({ priority: 'high' });

      queue.enqueue(low);
      queue.enqueue(normal);
      queue.enqueue(critical);
      queue.enqueue(high);

      // Dequeue should return in priority order
      const first = queue.dequeue('agent-1');
      const second = queue.dequeue('agent-2');
      const third = queue.dequeue('agent-3');
      const fourth = queue.dequeue('agent-4');

      expect(first?.priority).toBe('critical');
      expect(second?.priority).toBe('high');
      expect(third?.priority).toBe('normal');
      expect(fourth?.priority).toBe('low');
    });

    it('preserves insertion order within the same priority', () => {
      const a = makeTask({ id: 'a', priority: 'high' });
      const b = makeTask({ id: 'b', priority: 'high' });
      const c = makeTask({ id: 'c', priority: 'high' });

      queue.enqueue(a);
      queue.enqueue(b);
      queue.enqueue(c);

      expect(queue.dequeue('x')?.id).toBe('a');
      expect(queue.dequeue('x')?.id).toBe('b');
      expect(queue.dequeue('x')?.id).toBe('c');
    });
  });

  // ── dequeue ─────────────────────────────────────────────────────

  describe('dequeue', () => {
    it('returns undefined when queue is empty', () => {
      expect(queue.dequeue('agent-1')).toBeUndefined();
    });

    it('returns the highest-priority pending task', () => {
      queue.enqueue(makeTask({ id: 'lo', priority: 'low' }));
      queue.enqueue(makeTask({ id: 'hi', priority: 'high' }));

      const task = queue.dequeue('agent-1');
      expect(task?.id).toBe('hi');
    });

    it('marks the dequeued task as assigned with the given agentId', () => {
      queue.enqueue(makeTask({ id: 't1' }));
      const task = queue.dequeue('agent-42');

      expect(task?.status).toBe('assigned');
      expect(task?.agentId).toBe('agent-42');
    });

    it('skips non-pending tasks', () => {
      queue.enqueue(makeTask({ id: 't1' }));
      queue.enqueue(makeTask({ id: 't2' }));

      // Dequeue first — marks it assigned
      queue.dequeue('a1');
      // Second dequeue should return t2
      const second = queue.dequeue('a2');
      expect(second?.id).toBe('t2');
    });

    it('returns undefined when all tasks are assigned', () => {
      queue.enqueue(makeTask());
      queue.dequeue('a1');
      expect(queue.dequeue('a2')).toBeUndefined();
    });
  });

  // ── blockTask ───────────────────────────────────────────────────

  describe('blockTask', () => {
    it('marks a task as blocked', () => {
      const task = makeTask({ id: 'b1' });
      queue.enqueue(task);
      queue.blockTask('b1', 'resource unavailable');

      expect(queue.getTask('b1')?.status).toBe('blocked');
    });

    it('does not throw for unknown taskId', () => {
      expect(() => queue.blockTask('nonexistent', 'reason')).not.toThrow();
    });

    it('blocked tasks are not returned by dequeue', () => {
      queue.enqueue(makeTask({ id: 'b1' }));
      queue.enqueue(makeTask({ id: 'b2' }));
      queue.blockTask('b1', 'stuck');

      const task = queue.dequeue('a1');
      expect(task?.id).toBe('b2');
    });
  });

  // ── retryTask ───────────────────────────────────────────────────

  describe('retryTask', () => {
    it('resets a blocked task back to pending', () => {
      queue.enqueue(makeTask({ id: 'r1' }));
      queue.blockTask('r1', 'temp failure');
      queue.retryTask('r1');

      expect(queue.getTask('r1')?.status).toBe('pending');
    });

    it('resets a failed task back to pending', () => {
      const task = makeTask({ id: 'r2', status: 'failed' });
      queue.enqueue(task);
      // enqueue sets status to pending, so manually set to failed
      queue.getTask('r2')!.status = 'failed';

      queue.retryTask('r2');
      expect(queue.getTask('r2')?.status).toBe('pending');
    });

    it('clears agentId on retry', () => {
      queue.enqueue(makeTask({ id: 'r3' }));
      queue.dequeue('agent-1'); // assigns
      queue.blockTask('r3', 'err');
      queue.retryTask('r3');

      expect(queue.getTask('r3')?.agentId).toBeUndefined();
    });

    it('does nothing for a task that is not blocked or failed', () => {
      queue.enqueue(makeTask({ id: 'r4' }));
      queue.retryTask('r4'); // status is pending — should be a no-op
      expect(queue.getTask('r4')?.status).toBe('pending');
    });

    it('does not throw for unknown taskId', () => {
      expect(() => queue.retryTask('nonexistent')).not.toThrow();
    });
  });

  // ── getQueueLengths ─────────────────────────────────────────────

  describe('getQueueLengths', () => {
    it('returns empty object for empty queue', () => {
      expect(queue.getQueueLengths()).toEqual({});
    });

    it('counts pending tasks as unassigned when no agentId', () => {
      queue.enqueue(makeTask());
      queue.enqueue(makeTask());

      expect(queue.getQueueLengths()).toEqual({ unassigned: 2 });
    });

    it('does not count non-pending tasks', () => {
      queue.enqueue(makeTask({ id: 'x1' }));
      queue.enqueue(makeTask({ id: 'x2' }));
      queue.dequeue('a1'); // x1 becomes assigned

      expect(queue.getQueueLengths()).toEqual({ unassigned: 1 });
    });
  });

  // ── getTask ─────────────────────────────────────────────────────

  describe('getTask', () => {
    it('returns the task by id', () => {
      queue.enqueue(makeTask({ id: 'g1', description: 'hello' }));
      expect(queue.getTask('g1')?.description).toBe('hello');
    });

    it('returns undefined for unknown id', () => {
      expect(queue.getTask('nope')).toBeUndefined();
    });
  });

  // ── persistence callback ────────────────────────────────────────

  describe('persistence callback', () => {
    it('calls onPersist after enqueue', () => {
      const cb = vi.fn<PersistCallback>();
      const q = new TaskQueue(logger, cb);
      q.enqueue(makeTask());

      expect(cb).toHaveBeenCalledTimes(1);
      expect(cb).toHaveBeenCalledWith(expect.any(Array));
    });

    it('calls onPersist after dequeue', () => {
      const cb = vi.fn<PersistCallback>();
      const q = new TaskQueue(logger, cb);
      q.enqueue(makeTask());
      cb.mockClear();

      q.dequeue('a1');
      expect(cb).toHaveBeenCalledTimes(1);
    });

    it('calls onPersist after blockTask', () => {
      const cb = vi.fn<PersistCallback>();
      const q = new TaskQueue(logger, cb);
      q.enqueue(makeTask({ id: 'p1' }));
      cb.mockClear();

      q.blockTask('p1', 'reason');
      expect(cb).toHaveBeenCalledTimes(1);
    });

    it('calls onPersist after retryTask', () => {
      const cb = vi.fn<PersistCallback>();
      const q = new TaskQueue(logger, cb);
      q.enqueue(makeTask({ id: 'p2' }));
      q.blockTask('p2', 'reason');
      cb.mockClear();

      q.retryTask('p2');
      expect(cb).toHaveBeenCalledTimes(1);
    });
  });

  // ── size ────────────────────────────────────────────────────────

  describe('size', () => {
    it('reflects total tasks regardless of status', () => {
      queue.enqueue(makeTask({ id: 's1' }));
      queue.enqueue(makeTask({ id: 's2' }));
      queue.dequeue('a1'); // s1 assigned
      queue.blockTask('s2', 'err');

      expect(queue.size).toBe(2);
    });
  });
});
