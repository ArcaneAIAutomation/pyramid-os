/**
 * Property-based test for task failure escalation to blocked.
 *
 * **Property 3: Task failure escalation to blocked**
 *
 * For any task that fails in a DAG, all tasks that depend on it (directly or
 * transitively) should be marked as blocked, while tasks with no dependency
 * on the failed task remain unaffected.
 *
 * **Validates: Requirements 13.5**
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import type { Logger } from '@pyramid-os/logger';
import { DependencyGraph, type NodeStatus } from '../dependency-graph.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function createSilentLogger(): Logger {
  const noop = () => {};
  return { debug: noop, info: noop, warn: noop, error: noop };
}

/**
 * Compute the set of all transitive dependents of a given task in a DAG.
 * This is the "ground truth" oracle — a simple BFS over the dependents map.
 */
function getTransitiveDependents(
  taskId: string,
  dependentsMap: Map<string, Set<string>>,
): Set<string> {
  const visited = new Set<string>();
  const queue = [taskId];
  while (queue.length > 0) {
    const current = queue.pop()!;
    const deps = dependentsMap.get(current) ?? new Set();
    for (const d of deps) {
      if (!visited.has(d)) {
        visited.add(d);
        queue.push(d);
      }
    }
  }
  return visited;
}

/**
 * Arbitrary that generates a random DAG (directed acyclic graph) as a list of
 * task IDs and edges. Edges only go from lower-index to higher-index tasks,
 * guaranteeing acyclicity. Each potential edge is independently included or not
 * via a boolean array.
 */
const dagArb = fc
  .integer({ min: 2, max: 20 })
  .chain((taskCount) => {
    const taskIds = Array.from({ length: taskCount }, (_, i) => `t${i}`);
    const pairCount = (taskCount * (taskCount - 1)) / 2;

    // For each pair (i, j) where i < j, a boolean decides if j depends on i
    return fc
      .array(fc.boolean(), { minLength: pairCount, maxLength: pairCount })
      .map((booleans) => {
        const edges: Array<{ taskId: string; dependsOn: string }> = [];
        let idx = 0;
        for (let i = 0; i < taskCount; i++) {
          for (let j = i + 1; j < taskCount; j++) {
            if (booleans[idx]) {
              edges.push({ taskId: taskIds[j]!, dependsOn: taskIds[i]! });
            }
            idx++;
          }
        }
        return { taskIds, edges };
      });
  });

/**
 * Arbitrary that generates a DAG plus a non-empty subset of tasks to fail.
 */
const dagWithFailuresArb = dagArb.chain(({ taskIds, edges }) =>
  fc
    .subarray(taskIds, { minLength: 1, maxLength: Math.max(1, Math.floor(taskIds.length / 2)) })
    .map((failedTasks) => ({ taskIds, edges, failedTasks })),
);

// ── Property test ────────────────────────────────────────────────────────────

describe('DependencyGraph — Property 3: Task failure escalation to blocked', () => {
  it('when a task fails, all transitive dependents become blocked and unrelated tasks are unaffected', () => {
    fc.assert(
      fc.property(dagWithFailuresArb, ({ taskIds, edges, failedTasks }) => {
        const logger = createSilentLogger();
        const graph = new DependencyGraph(logger);

        // Build the graph
        for (const id of taskIds) {
          graph.addTask(id);
        }
        for (const { taskId, dependsOn } of edges) {
          graph.addDependency(taskId, dependsOn);
        }

        // Build an oracle dependents map for transitive reachability
        const dependentsMap = new Map<string, Set<string>>();
        for (const id of taskIds) {
          dependentsMap.set(id, new Set());
        }
        for (const { taskId, dependsOn } of edges) {
          dependentsMap.get(dependsOn)!.add(taskId);
        }

        // Fail each selected task
        for (const failedId of failedTasks) {
          graph.markFailed(failedId);
        }

        // Compute the set of all tasks that should be blocked:
        // the union of transitive dependents of all failed tasks
        const expectedBlocked = new Set<string>();
        for (const failedId of failedTasks) {
          for (const dep of getTransitiveDependents(failedId, dependentsMap)) {
            expectedBlocked.add(dep);
          }
        }
        // Remove failed tasks themselves from expectedBlocked — they are 'failed', not 'blocked'
        for (const failedId of failedTasks) {
          expectedBlocked.delete(failedId);
        }

        // Verify: every task that should be blocked IS blocked
        for (const taskId of expectedBlocked) {
          const status = graph.getStatus(taskId);
          if (status !== 'blocked' && status !== 'failed') {
            return false; // A transitive dependent was not blocked
          }
        }

        // Verify: failed tasks have 'failed' status
        for (const failedId of failedTasks) {
          if (graph.getStatus(failedId) !== 'failed') {
            return false;
          }
        }

        // Verify: tasks NOT in expectedBlocked and NOT failed remain unaffected
        // (their status should be 'pending' or 'ready', not 'blocked' or 'failed')
        const failedSet = new Set(failedTasks);
        for (const taskId of taskIds) {
          if (failedSet.has(taskId) || expectedBlocked.has(taskId)) continue;
          const status = graph.getStatus(taskId);
          if (status === 'blocked' || status === 'failed') {
            return false; // An unrelated task was incorrectly blocked/failed
          }
        }

        return true;
      }),
      { numRuns: 200 },
    );
  });

  it('blocked propagation reaches all transitive dependents even in deep chains', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 3, max: 30 }),
        (chainLength) => {
          const logger = createSilentLogger();
          const graph = new DependencyGraph(logger);

          // Build a linear chain: t0 → t1 → t2 → ... → t(n-1)
          const ids = Array.from({ length: chainLength }, (_, i) => `t${i}`);
          for (const id of ids) {
            graph.addTask(id);
          }
          for (let i = 1; i < chainLength; i++) {
            graph.addDependency(ids[i]!, ids[i - 1]!);
          }

          // Fail the root
          graph.markFailed(ids[0]!);

          // Every downstream task must be blocked
          expect(graph.getStatus(ids[0]!)).toBe('failed');
          for (let i = 1; i < chainLength; i++) {
            expect(graph.getStatus(ids[i]!)).toBe('blocked');
          }

          return true;
        },
      ),
      { numRuns: 100 },
    );
  });

  it('tasks with only completed dependencies remain ready after an unrelated failure', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 3, max: 15 }),
        (branchCount) => {
          const logger = createSilentLogger();
          const graph = new DependencyGraph(logger);

          // Create a fan-out: root → branch_0, branch_1, ..., branch_n
          // Plus an independent task with no deps
          graph.addTask('root');
          graph.addTask('independent');

          const branches: string[] = [];
          for (let i = 0; i < branchCount; i++) {
            const id = `branch_${i}`;
            branches.push(id);
            graph.addTask(id);
            graph.addDependency(id, 'root');
          }

          // Fail root — all branches should be blocked, independent should stay ready
          graph.markFailed('root');

          for (const b of branches) {
            expect(graph.getStatus(b)).toBe('blocked');
          }
          expect(graph.getStatus('independent')).toBe('ready');

          return true;
        },
      ),
      { numRuns: 100 },
    );
  });
});
