/**
 * Property-based test: Deterministic tasks continue without Ollama.
 *
 * **Property 17: Deterministic tasks continue without Ollama**
 * For any queue of deterministic worker tasks (build, mine, haul, farm, guard),
 * when the Ollama circuit breaker is open (all LLM requests rejected), all
 * deterministic tasks can still be enqueued, dequeued, and processed without
 * loss. The task count is preserved throughout.
 *
 * Key insight: deterministic worker tasks use pathfinding and predefined
 * behaviors — they never need LLM reasoning for execution. So the TaskQueue
 * must function normally even when Ollama is completely unavailable.
 *
 * **Validates: Requirements 40.1**
 */

import { describe, it, expect, vi } from 'vitest';
import * as fc from 'fast-check';
import { CircuitBreakerImpl, CircuitOpenError } from '../circuit-breaker.js';
import type { CircuitBreakerConfig } from '../circuit-breaker.js';
import { TaskQueue } from '@pyramid-os/society-engine';
import type { Task, TaskType, TaskPriority } from '@pyramid-os/shared-types';
import type { Logger } from '@pyramid-os/logger';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Stub logger that silently swallows all output. */
const stubLogger: Logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

/** Deterministic task types — these never require LLM reasoning. */
const DETERMINISTIC_TYPES: TaskType[] = ['build', 'mine', 'haul', 'farm', 'guard'];

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/** Generate a deterministic task type */
const deterministicTypeArb: fc.Arbitrary<TaskType> = fc.constantFrom(...DETERMINISTIC_TYPES);

/** Generate a task priority */
const priorityArb: fc.Arbitrary<TaskPriority> = fc.constantFrom('critical', 'high', 'normal', 'low');

/** Generate a single deterministic Task */
const taskArb: fc.Arbitrary<Task> = fc
  .record({
    id: fc.uuid(),
    type: deterministicTypeArb,
    priority: priorityArb,
    description: fc.string({ minLength: 1, maxLength: 50 }),
  })
  .map(({ id, type, priority, description }) => ({
    id,
    type,
    priority,
    status: 'pending' as const,
    civilizationId: 'civ-prop',
    description,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    dependencies: [],
  }));

/** Generate a non-empty array of deterministic tasks (1–30) */
const taskListArb: fc.Arbitrary<Task[]> = fc.array(taskArb, { minLength: 1, maxLength: 30 });

// ─── Property test ───────────────────────────────────────────────────────────

describe('Deterministic tasks without Ollama (property)', () => {
  /**
   * Drive the Ollama circuit breaker to the open state so all LLM requests
   * are rejected, then verify the TaskQueue still works for deterministic tasks.
   */
  const openOllamaBreaker = async (): Promise<CircuitBreakerImpl<string>> => {
    const config: CircuitBreakerConfig = {
      failureThreshold: 3,
      cooldownMs: 60_000, // long cooldown so it stays open
      successThreshold: 2,
      operationTimeoutMs: 5_000,
    };
    const breaker = new CircuitBreakerImpl<string>('ollama', config);

    // Trip the breaker with consecutive failures
    for (let i = 0; i < config.failureThreshold; i++) {
      try {
        await breaker.execute(() => Promise.reject(new Error('Ollama unreachable')));
      } catch {
        // expected
      }
    }

    // Confirm it's open
    expect(breaker.getState()).toBe('open');
    return breaker;
  };

  it('all deterministic tasks can be enqueued and dequeued while Ollama circuit is open', async () => {
    await fc.assert(
      fc.asyncProperty(taskListArb, async (tasks) => {
        const breaker = await openOllamaBreaker();
        const queue = new TaskQueue(stubLogger);

        // Confirm LLM requests are rejected
        await expect(
          breaker.execute(() => Promise.resolve('llm-response')),
        ).rejects.toThrow(CircuitOpenError);

        // Enqueue all deterministic tasks
        for (const task of tasks) {
          queue.enqueue(task);
        }

        // Queue size must match the number of tasks enqueued
        expect(queue.size).toBe(tasks.length);

        // Dequeue all tasks — every single one should come back
        const dequeued: Task[] = [];
        let next = queue.dequeue('worker-agent');
        while (next !== undefined) {
          dequeued.push(next);
          next = queue.dequeue('worker-agent');
        }

        // No tasks lost
        expect(dequeued.length).toBe(tasks.length);

        // Every original task ID is present in the dequeued set
        const dequeuedIds = new Set(dequeued.map((t) => t.id));
        for (const task of tasks) {
          expect(dequeuedIds.has(task.id)).toBe(true);
        }

        // All dequeued tasks are assigned (not blocked, not lost)
        for (const t of dequeued) {
          expect(t.status).toBe('assigned');
          expect(t.agentId).toBe('worker-agent');
        }

        // All dequeued tasks are deterministic types
        for (const t of dequeued) {
          expect(DETERMINISTIC_TYPES).toContain(t.type);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('task priority ordering is preserved while Ollama circuit is open', async () => {
    await fc.assert(
      fc.asyncProperty(taskListArb, async (tasks) => {
        const breaker = await openOllamaBreaker();
        const queue = new TaskQueue(stubLogger);

        // Confirm Ollama is down
        await expect(
          breaker.execute(() => Promise.resolve('llm-response')),
        ).rejects.toThrow(CircuitOpenError);

        // Enqueue all tasks
        for (const task of tasks) {
          queue.enqueue(task);
        }

        // Dequeue all and verify priority ordering (higher priority first)
        const PRIORITY_WEIGHT: Record<TaskPriority, number> = {
          critical: 4,
          high: 3,
          normal: 2,
          low: 1,
        };

        const dequeued: Task[] = [];
        let next = queue.dequeue('worker-agent');
        while (next !== undefined) {
          dequeued.push(next);
          next = queue.dequeue('worker-agent');
        }

        // Each successive task should have equal or lower priority weight
        for (let i = 1; i < dequeued.length; i++) {
          const prevWeight = PRIORITY_WEIGHT[dequeued[i - 1]!.priority];
          const currWeight = PRIORITY_WEIGHT[dequeued[i]!.priority];
          expect(prevWeight).toBeGreaterThanOrEqual(currWeight);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('blockTask and retryTask work correctly while Ollama circuit is open', async () => {
    await fc.assert(
      fc.asyncProperty(taskListArb, async (tasks) => {
        const breaker = await openOllamaBreaker();
        const queue = new TaskQueue(stubLogger);

        // Confirm Ollama is down
        await expect(
          breaker.execute(() => Promise.resolve('llm-response')),
        ).rejects.toThrow(CircuitOpenError);

        // Enqueue all tasks
        for (const task of tasks) {
          queue.enqueue(task);
        }

        // Dequeue first task and block it
        const first = queue.dequeue('worker-agent');
        expect(first).toBeDefined();
        queue.blockTask(first!.id, 'obstacle encountered');

        const blocked = queue.getTask(first!.id);
        expect(blocked?.status).toBe('blocked');

        // Retry the blocked task — it should become pending again
        queue.retryTask(first!.id);
        const retried = queue.getTask(first!.id);
        expect(retried?.status).toBe('pending');

        // Drain remaining tasks — total should still equal original count
        const dequeued: Task[] = [];
        let next = queue.dequeue('worker-agent');
        while (next !== undefined) {
          dequeued.push(next);
          next = queue.dequeue('worker-agent');
        }

        // All tasks accounted for (dequeued now + the first one already assigned earlier)
        // The retried task should be among the dequeued set
        expect(dequeued.some((t) => t.id === first!.id)).toBe(true);
        expect(dequeued.length).toBe(tasks.length);
      }),
      { numRuns: 200 },
    );
  });
});
