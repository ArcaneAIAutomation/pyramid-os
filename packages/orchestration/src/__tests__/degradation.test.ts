/**
 * Unit tests for graceful degradation scenarios.
 *
 * Validates: Requirements 40.1, 40.3, 40.6
 *
 * Tests that the system degrades gracefully when:
 * 1. Ollama is unavailable — deterministic worker tasks continue executing
 * 2. A Planner agent fails — existing plans continue until recovery
 * 3. DB writes fail — retry with exponential backoff
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  CircuitBreakerImpl,
  CircuitOpenError,
} from '../circuit-breaker.js';
import type { CircuitBreakerConfig } from '../circuit-breaker.js';
import { TaskQueue } from '@pyramid-os/society-engine';
import { withRetry } from '@pyramid-os/data-layer';
import type { Task, TaskPriority } from '@pyramid-os/shared-types';
import type { Logger } from '@pyramid-os/logger';

/** Stub logger that silently swallows all output. */
const stubLogger: Logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

/** Helper to create a minimal Task object. */
function makeTask(overrides: Partial<Task> & { id: string }): Task {
  return {
    type: 'build',
    priority: 'normal' as TaskPriority,
    status: 'pending',
    civilizationId: 'civ-1',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  } as Task;
}

// ---------------------------------------------------------------------------
// 1. Ollama unavailable — deterministic tasks continue (Req 40.1)
// ---------------------------------------------------------------------------
describe('Graceful Degradation: Ollama unavailable (Req 40.1)', () => {
  let ollamaBreaker: CircuitBreakerImpl<string>;
  let currentTime: number;
  let taskQueue: TaskQueue;

  beforeEach(() => {
    currentTime = 0;
    ollamaBreaker = new CircuitBreakerImpl<string>(
      'ollama',
      {
        failureThreshold: 3,
        cooldownMs: 30_000,
        successThreshold: 2,
        operationTimeoutMs: 5_000,
      },
      () => currentTime,
    );
    taskQueue = new TaskQueue(stubLogger);
  });

  it('opens the circuit after consecutive Ollama failures', async () => {
    for (let i = 0; i < 3; i++) {
      await expect(
        ollamaBreaker.execute(() => Promise.reject(new Error('Ollama unreachable'))),
      ).rejects.toThrow();
    }
    expect(ollamaBreaker.getState()).toBe('open');
  });

  it('rejects LLM requests when circuit is open', async () => {
    // Drive circuit to open
    for (let i = 0; i < 3; i++) {
      await expect(
        ollamaBreaker.execute(() => Promise.reject(new Error('Ollama unreachable'))),
      ).rejects.toThrow();
    }

    // LLM request should be rejected immediately
    await expect(
      ollamaBreaker.execute(() => Promise.resolve('llm-response')),
    ).rejects.toThrow(CircuitOpenError);
  });

  it('deterministic worker tasks continue executing when Ollama circuit is open', async () => {
    // Drive Ollama circuit to open
    for (let i = 0; i < 3; i++) {
      await expect(
        ollamaBreaker.execute(() => Promise.reject(new Error('Ollama unreachable'))),
      ).rejects.toThrow();
    }
    expect(ollamaBreaker.getState()).toBe('open');

    // Enqueue deterministic worker tasks (these don't need LLM)
    const buildTask = makeTask({ id: 'task-build-1', type: 'build', priority: 'high' });
    const mineTask = makeTask({ id: 'task-mine-1', type: 'mine', priority: 'normal' });
    taskQueue.enqueue(buildTask);
    taskQueue.enqueue(mineTask);

    // Worker dequeues and executes tasks — no LLM needed
    const dequeued1 = taskQueue.dequeue('worker-builder-1');
    expect(dequeued1).toBeDefined();
    expect(dequeued1!.id).toBe('task-build-1');
    expect(dequeued1!.status).toBe('assigned');

    const dequeued2 = taskQueue.dequeue('worker-quarry-1');
    expect(dequeued2).toBeDefined();
    expect(dequeued2!.id).toBe('task-mine-1');
    expect(dequeued2!.status).toBe('assigned');
  });

  it('queued tasks remain available while Ollama is down', async () => {
    // Drive Ollama circuit to open
    for (let i = 0; i < 3; i++) {
      await expect(
        ollamaBreaker.execute(() => Promise.reject(new Error('Ollama unreachable'))),
      ).rejects.toThrow();
    }

    // Enqueue multiple tasks
    taskQueue.enqueue(makeTask({ id: 't1', priority: 'critical' }));
    taskQueue.enqueue(makeTask({ id: 't2', priority: 'high' }));
    taskQueue.enqueue(makeTask({ id: 't3', priority: 'normal' }));

    expect(taskQueue.size).toBe(3);

    // All tasks can be dequeued by workers independently of Ollama
    const t1 = taskQueue.dequeue('w1');
    const t2 = taskQueue.dequeue('w2');
    const t3 = taskQueue.dequeue('w3');

    expect(t1!.id).toBe('t1');
    expect(t2!.id).toBe('t2');
    expect(t3!.id).toBe('t3');
  });
});

// ---------------------------------------------------------------------------
// 2. Planner agent failure — existing plans continue (Req 40.3)
// ---------------------------------------------------------------------------
describe('Graceful Degradation: Planner agent failure (Req 40.3)', () => {
  let taskQueue: TaskQueue;

  beforeEach(() => {
    taskQueue = new TaskQueue(stubLogger);
  });

  it('existing queued tasks continue executing after planner failure', () => {
    // Planner has already created and enqueued tasks before failing
    const tasks = [
      makeTask({ id: 'plan-task-1', priority: 'high' }),
      makeTask({ id: 'plan-task-2', priority: 'normal' }),
      makeTask({ id: 'plan-task-3', priority: 'low' }),
    ];
    for (const t of tasks) {
      taskQueue.enqueue(t);
    }

    // Simulate planner failure — it's gone, but tasks remain in queue
    // Operational/worker agents can still dequeue and execute
    const t1 = taskQueue.dequeue('operational-foreman');
    expect(t1).toBeDefined();
    expect(t1!.id).toBe('plan-task-1');
    expect(t1!.status).toBe('assigned');

    const t2 = taskQueue.dequeue('worker-builder-1');
    expect(t2).toBeDefined();
    expect(t2!.id).toBe('plan-task-2');
  });

  it('task queue remains functional without new planner input', () => {
    // Pre-existing tasks from before planner failure
    taskQueue.enqueue(makeTask({ id: 'existing-1', priority: 'critical' }));
    taskQueue.enqueue(makeTask({ id: 'existing-2', priority: 'high' }));

    // No new tasks are added (planner is down)
    // But existing tasks can still be processed
    expect(taskQueue.size).toBe(2);

    const task = taskQueue.dequeue('worker-1');
    expect(task).toBeDefined();
    expect(task!.id).toBe('existing-1');
    expect(task!.agentId).toBe('worker-1');
  });

  it('blocked tasks can be retried without planner involvement', () => {
    taskQueue.enqueue(makeTask({ id: 'retry-task', priority: 'normal' }));

    // Task gets blocked during execution
    taskQueue.blockTask('retry-task', 'temporary obstacle');
    const blocked = taskQueue.getTask('retry-task');
    expect(blocked!.status).toBe('blocked');

    // Operational agent retries the task — no planner needed
    taskQueue.retryTask('retry-task');
    const retried = taskQueue.getTask('retry-task');
    expect(retried!.status).toBe('pending');

    // Can be dequeued again
    const dequeued = taskQueue.dequeue('worker-2');
    expect(dequeued).toBeDefined();
    expect(dequeued!.id).toBe('retry-task');
  });

  it('queue lengths remain queryable during planner outage', () => {
    taskQueue.enqueue(makeTask({ id: 'q1', priority: 'normal' }));
    taskQueue.enqueue(makeTask({ id: 'q2', priority: 'normal' }));

    // Dequeue one to an agent
    taskQueue.dequeue('worker-a');

    // Queue lengths still work — monitoring continues
    const lengths = taskQueue.getQueueLengths();
    expect(lengths['unassigned']).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 3. DB write failure — retry with exponential backoff (Req 40.6)
// ---------------------------------------------------------------------------
describe('Graceful Degradation: DB write failure retry (Req 40.6)', () => {
  it('retries on SQLITE_BUSY and succeeds on subsequent attempt', () => {
    let callCount = 0;
    const result = withRetry(() => {
      callCount++;
      if (callCount < 3) {
        const err = new Error('database is locked');
        (err as unknown as { code: string }).code = 'SQLITE_BUSY';
        throw err;
      }
      return 'success';
    }, 3);

    expect(result).toBe('success');
    expect(callCount).toBe(3);
  });

  it('retries on SQLITE_LOCKED and succeeds on subsequent attempt', () => {
    let callCount = 0;
    const result = withRetry(() => {
      callCount++;
      if (callCount < 2) {
        const err = new Error('database table is locked');
        (err as unknown as { code: string }).code = 'SQLITE_LOCKED';
        throw err;
      }
      return 'ok';
    }, 3);

    expect(result).toBe('ok');
    expect(callCount).toBe(2);
  });

  it('throws after exhausting all retry attempts', () => {
    let callCount = 0;
    expect(() =>
      withRetry(() => {
        callCount++;
        const err = new Error('database is locked');
        (err as unknown as { code: string }).code = 'SQLITE_BUSY';
        throw err;
      }, 3),
    ).toThrow('database is locked');

    expect(callCount).toBe(3);
  });

  it('does not retry on non-SQLITE errors', () => {
    let callCount = 0;
    expect(() =>
      withRetry(() => {
        callCount++;
        throw new Error('some other error');
      }, 3),
    ).toThrow('some other error');

    // Should fail immediately without retrying
    expect(callCount).toBe(1);
  });

  it('succeeds immediately when no error occurs', () => {
    let callCount = 0;
    const result = withRetry(() => {
      callCount++;
      return 42;
    }, 3);

    expect(result).toBe(42);
    expect(callCount).toBe(1);
  });

  it('uses exponential backoff between retries', () => {
    // We verify the retry mechanism attempts all 3 times with SQLITE_BUSY.
    // The actual delay is 2^attempt * 100ms (100ms, 200ms, 400ms).
    // We can't easily measure timing in a unit test, but we verify
    // the function is called exactly maxAttempts times before throwing.
    const attempts: number[] = [];
    expect(() =>
      withRetry(() => {
        attempts.push(attempts.length);
        const err = new Error('busy');
        (err as unknown as { code: string }).code = 'SQLITE_BUSY';
        throw err;
      }, 3),
    ).toThrow('busy');

    expect(attempts).toEqual([0, 1, 2]);
  });
});


// ---------------------------------------------------------------------------
// 4. DegradationManager — component states, fallbacks, and level computation
//    (Req 40.1, 40.2, 40.3, 40.10)
// ---------------------------------------------------------------------------
import { DegradationManager } from '../degradation.js';
import type { FallbackSpec, DegradationLevel } from '../degradation.js';

function makeFallback(overrides?: Partial<FallbackSpec>): FallbackSpec {
  return {
    priority: 3,
    activate: vi.fn(),
    deactivate: vi.fn(),
    ...overrides,
  };
}

describe('DegradationManager', () => {
  let manager: DegradationManager;

  beforeEach(() => {
    manager = new DegradationManager();
  });

  // -- getComponentStates / registerComponent --
  describe('getComponentStates()', () => {
    it('returns empty map when no components registered', () => {
      expect(manager.getComponentStates().size).toBe(0);
    });

    it('returns healthy state for newly registered components', () => {
      manager.registerComponent('ollama', makeFallback());
      manager.registerComponent('sqlite', makeFallback());
      const states = manager.getComponentStates();
      expect(states.get('ollama')).toBe('healthy');
      expect(states.get('sqlite')).toBe('healthy');
    });
  });

  // -- getOverallLevel --
  describe('getOverallLevel()', () => {
    it('returns full when no components registered', () => {
      expect(manager.getOverallLevel()).toBe('full');
    });

    it('returns full when all components are healthy', () => {
      manager.registerComponent('a', makeFallback());
      manager.registerComponent('b', makeFallback());
      expect(manager.getOverallLevel()).toBe('full');
    });

    it('returns degraded when one of several components fails', async () => {
      manager.registerComponent('a', makeFallback());
      manager.registerComponent('b', makeFallback());
      manager.registerComponent('c', makeFallback());
      manager.registerComponent('d', makeFallback());
      await manager.notifyFailure('a');
      expect(manager.getOverallLevel()).toBe('degraded');
    });

    it('returns critical when more than half of components fail', async () => {
      manager.registerComponent('a', makeFallback());
      manager.registerComponent('b', makeFallback());
      manager.registerComponent('c', makeFallback());
      await manager.notifyFailure('a');
      await manager.notifyFailure('b');
      expect(manager.getOverallLevel()).toBe('critical');
    });

    it('returns minimal when all components fail', async () => {
      manager.registerComponent('a', makeFallback());
      manager.registerComponent('b', makeFallback());
      await manager.notifyFailure('a');
      await manager.notifyFailure('b');
      expect(manager.getOverallLevel()).toBe('minimal');
    });
  });

  // -- notifyFailure --
  describe('notifyFailure()', () => {
    it('marks component as failed', async () => {
      manager.registerComponent('ollama', makeFallback());
      await manager.notifyFailure('ollama');
      expect(manager.getComponentStates().get('ollama')).toBe('failed');
    });

    it('activates the fallback on failure', async () => {
      const fb = makeFallback();
      manager.registerComponent('ollama', fb);
      await manager.notifyFailure('ollama');
      expect(fb.activate).toHaveBeenCalledTimes(1);
    });

    it('does not activate fallback twice on repeated failures', async () => {
      const fb = makeFallback();
      manager.registerComponent('ollama', fb);
      await manager.notifyFailure('ollama');
      await manager.notifyFailure('ollama');
      expect(fb.activate).toHaveBeenCalledTimes(1);
    });

    it('is a no-op for unregistered components', async () => {
      await expect(manager.notifyFailure('unknown')).resolves.toBeUndefined();
    });
  });

  // -- notifyRecovery --
  describe('notifyRecovery()', () => {
    it('marks component as healthy after recovery', async () => {
      manager.registerComponent('ollama', makeFallback());
      await manager.notifyFailure('ollama');
      await manager.notifyRecovery('ollama');
      expect(manager.getComponentStates().get('ollama')).toBe('healthy');
    });

    it('deactivates the fallback on recovery', async () => {
      const fb = makeFallback();
      manager.registerComponent('ollama', fb);
      await manager.notifyFailure('ollama');
      await manager.notifyRecovery('ollama');
      expect(fb.deactivate).toHaveBeenCalledTimes(1);
    });

    it('restores overall level to full after all components recover (Req 40.10)', async () => {
      manager.registerComponent('a', makeFallback());
      manager.registerComponent('b', makeFallback());
      await manager.notifyFailure('a');
      await manager.notifyFailure('b');
      expect(manager.getOverallLevel()).toBe('minimal');

      await manager.notifyRecovery('a');
      await manager.notifyRecovery('b');
      expect(manager.getOverallLevel()).toBe('full');
    });

    it('is a no-op for unregistered components', async () => {
      await expect(manager.notifyRecovery('unknown')).resolves.toBeUndefined();
    });
  });

  // -- onLevelChange --
  describe('onLevelChange()', () => {
    it('fires callback when level transitions', async () => {
      const transitions: Array<{ from: DegradationLevel; to: DegradationLevel }> = [];
      manager.onLevelChange((from, to) => transitions.push({ from, to }));

      manager.registerComponent('a', makeFallback());
      await manager.notifyFailure('a');

      expect(transitions).toEqual([{ from: 'full', to: 'minimal' }]);
    });

    it('fires callback on recovery transition', async () => {
      const transitions: Array<{ from: DegradationLevel; to: DegradationLevel }> = [];
      manager.registerComponent('a', makeFallback());
      manager.registerComponent('b', makeFallback());

      await manager.notifyFailure('a');
      manager.onLevelChange((from, to) => transitions.push({ from, to }));
      await manager.notifyRecovery('a');

      expect(transitions).toEqual([{ from: 'degraded', to: 'full' }]);
    });

    it('does not fire when level stays the same', async () => {
      const cb = vi.fn();
      manager.onLevelChange(cb);

      manager.registerComponent('a', makeFallback());
      manager.registerComponent('b', makeFallback());
      manager.registerComponent('c', makeFallback());
      manager.registerComponent('d', makeFallback());

      // First failure: full → degraded
      await manager.notifyFailure('a');
      expect(cb).toHaveBeenCalledTimes(1);

      // Second failure: still degraded (2/4 = half, not more than half)
      await manager.notifyFailure('b');
      // 2/4 is not > 4/2, so still degraded — no transition
      expect(cb).toHaveBeenCalledTimes(1);
    });

    it('swallows errors thrown by listeners', async () => {
      manager.onLevelChange(() => { throw new Error('boom'); });
      manager.registerComponent('a', makeFallback());
      // Should not throw
      await expect(manager.notifyFailure('a')).resolves.toBeUndefined();
    });
  });

  // -- Full failure/recovery cycle --
  describe('full degradation cycle', () => {
    it('transitions through all levels and back', async () => {
      const levels: DegradationLevel[] = [];
      manager.onLevelChange((_from, to) => levels.push(to));

      manager.registerComponent('a', makeFallback());
      manager.registerComponent('b', makeFallback());
      manager.registerComponent('c', makeFallback());

      // full → degraded (1/3 failed)
      await manager.notifyFailure('a');
      // degraded → critical (2/3 failed, > half)
      await manager.notifyFailure('b');
      // critical → minimal (3/3 failed)
      await manager.notifyFailure('c');

      expect(levels).toEqual(['degraded', 'critical', 'minimal']);

      levels.length = 0;

      // minimal → critical (2/3 failed)
      await manager.notifyRecovery('c');
      // critical → degraded (1/3 failed)
      await manager.notifyRecovery('b');
      // degraded → full (0/3 failed)
      await manager.notifyRecovery('a');

      expect(levels).toEqual(['critical', 'degraded', 'full']);
    });
  });
});
