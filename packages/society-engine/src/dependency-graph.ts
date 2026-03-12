/**
 * DependencyGraph — directed acyclic graph (DAG) for task dependency management.
 *
 * Tracks task nodes and directed edges (dependsOn → taskId), detects cycles,
 * computes topological ordering, identifies parallel execution groups, and
 * propagates completion/failure status through the graph.
 *
 * Requirements: 3.6, 36.1, 36.2, 36.3, 36.4, 36.5, 36.6, 36.7, 36.8, 36.10
 */

import type { Logger } from '@pyramid-os/logger';

/** Status of a node within the dependency graph. */
export type NodeStatus = 'pending' | 'ready' | 'completed' | 'failed' | 'blocked';

/** Optional callback invoked when dependency edges change, for persistence. */
export type DependencyPersistCallback = (edges: Array<{ taskId: string; dependsOn: string }>) => void;

export class DependencyGraph {
  /** taskId → set of task IDs this task depends on */
  private readonly dependencies = new Map<string, Set<string>>();
  /** taskId → set of task IDs that depend on this task */
  private readonly dependents = new Map<string, Set<string>>();
  /** taskId → current status */
  private readonly statuses = new Map<string, NodeStatus>();

  private readonly logger: Logger;
  private readonly onPersist?: DependencyPersistCallback | undefined;

  constructor(logger: Logger, onPersist?: DependencyPersistCallback) {
    this.logger = logger;
    this.onPersist = onPersist;
  }

  /** Register a task node in the graph. */
  addTask(taskId: string): void {
    if (this.statuses.has(taskId)) return;
    this.dependencies.set(taskId, new Set());
    this.dependents.set(taskId, new Set());
    this.statuses.set(taskId, 'pending');
    this.logger.info('DependencyGraph: task added', { taskId });
    this.refreshReadyStatus(taskId);
  }

  /**
   * Add a directed edge: `taskId` depends on `dependsOn`.
   * Throws if either node is not registered or if the edge would create a cycle.
   * Requirement 36.4 — reject circular dependencies.
   */
  addDependency(taskId: string, dependsOn: string): void {
    if (!this.statuses.has(taskId)) {
      throw new Error(`Task "${taskId}" is not registered in the graph`);
    }
    if (!this.statuses.has(dependsOn)) {
      throw new Error(`Task "${dependsOn}" is not registered in the graph`);
    }
    if (taskId === dependsOn) {
      throw new Error(`Task "${taskId}" cannot depend on itself`);
    }

    // Tentatively add the edge and check for cycles
    this.dependencies.get(taskId)!.add(dependsOn);
    this.dependents.get(dependsOn)!.add(taskId);

    const cycles = this.detectCycles();
    if (cycles !== null) {
      // Roll back
      this.dependencies.get(taskId)!.delete(dependsOn);
      this.dependents.get(dependsOn)!.delete(taskId);
      throw new Error(
        `Adding dependency "${taskId}" → "${dependsOn}" would create a cycle: ${cycles.map((c) => c.join(' → ')).join('; ')}`,
      );
    }

    this.logger.info('DependencyGraph: dependency added', { taskId, dependsOn });
    this.refreshReadyStatus(taskId);
    this.persist();
  }

  /**
   * Detect cycles using DFS. Returns an array of cycle paths if any exist, null otherwise.
   */
  detectCycles(): string[][] | null {
    const WHITE = 0; // unvisited
    const GRAY = 1;  // in current DFS path
    const BLACK = 2; // fully processed

    const color = new Map<string, number>();
    for (const id of this.statuses.keys()) {
      color.set(id, WHITE);
    }

    const cycles: string[][] = [];

    const dfs = (node: string, path: string[]): void => {
      color.set(node, GRAY);
      path.push(node);

      const deps = this.dependencies.get(node) ?? new Set<string>();
      for (const dep of deps) {
        if (color.get(dep) === GRAY) {
          // Found a cycle — extract the cycle portion from path
          const cycleStart = path.indexOf(dep);
          const cycle = [...path.slice(cycleStart), dep];
          cycles.push(cycle);
        } else if (color.get(dep) === WHITE) {
          dfs(dep, path);
        }
      }

      path.pop();
      color.set(node, BLACK);
    };

    for (const id of this.statuses.keys()) {
      if (color.get(id) === WHITE) {
        dfs(id, []);
      }
    }

    return cycles.length > 0 ? cycles : null;
  }

  /**
   * Get tasks that are ready for execution — all dependencies completed.
   * Requirement 36.2 — prevent execution until all dependencies satisfied.
   */
  getReadyTasks(): string[] {
    const ready: string[] = [];
    for (const [taskId, status] of this.statuses) {
      if (status === 'ready') {
        ready.push(taskId);
      }
    }
    return ready;
  }

  /**
   * Mark a task as completed and update dependents.
   * Requirement 36.3 — check dependent tasks and mark them as ready.
   */
  markComplete(taskId: string): void {
    if (!this.statuses.has(taskId)) {
      this.logger.warn('DependencyGraph: markComplete called for unknown task', { taskId });
      return;
    }

    this.statuses.set(taskId, 'completed');
    this.logger.info('DependencyGraph: task completed', { taskId });

    // Check if any dependents are now ready
    const deps = this.dependents.get(taskId) ?? new Set<string>();
    for (const dependent of deps) {
      this.refreshReadyStatus(dependent);
    }
  }

  /**
   * Mark a task as failed and propagate blocked status to all dependents.
   * Requirement 36.7 — mark dependent tasks as blocked.
   */
  markFailed(taskId: string): void {
    if (!this.statuses.has(taskId)) {
      this.logger.warn('DependencyGraph: markFailed called for unknown task', { taskId });
      return;
    }

    this.statuses.set(taskId, 'failed');
    this.logger.warn('DependencyGraph: task failed', { taskId });

    this.propagateBlocked(taskId);
  }

  /**
   * Return groups of tasks that can execute in parallel (same topological level).
   * Requirement 36.8 — support parallel execution of independent tasks.
   */
  getParallelGroups(): string[][] {
    // Kahn's algorithm variant that groups by level
    const inDegree = new Map<string, number>();
    for (const taskId of this.statuses.keys()) {
      inDegree.set(taskId, 0);
    }
    for (const [taskId, deps] of this.dependencies) {
      // Only count non-completed dependencies for grouping
      let count = 0;
      for (const dep of deps) {
        count++;
      }
      inDegree.set(taskId, count);
    }

    const groups: string[][] = [];
    const remaining = new Set(this.statuses.keys());

    while (remaining.size > 0) {
      const group: string[] = [];
      for (const taskId of remaining) {
        if ((inDegree.get(taskId) ?? 0) === 0) {
          group.push(taskId);
        }
      }

      if (group.length === 0) {
        // Remaining nodes form a cycle — shouldn't happen if we reject cycles on add
        break;
      }

      groups.push(group);

      for (const taskId of group) {
        remaining.delete(taskId);
        const deps = this.dependents.get(taskId) ?? new Set<string>();
        for (const dependent of deps) {
          inDegree.set(dependent, (inDegree.get(dependent) ?? 1) - 1);
        }
      }
    }

    return groups;
  }

  /**
   * Return tasks in topological (dependency) order.
   * Requirement 36.6 — prioritize tasks based on dependency depth.
   * Requirement 36.10 — log task execution order for audit.
   */
  topologicalSort(): string[] {
    const sorted: string[] = [];
    const groups = this.getParallelGroups();
    for (const group of groups) {
      sorted.push(...group);
    }
    this.logger.info('DependencyGraph: topological sort computed', {
      order: sorted,
    });
    return sorted;
  }

  /** Get direct dependencies of a task. */
  getDependencies(taskId: string): string[] {
    return [...(this.dependencies.get(taskId) ?? [])];
  }

  /** Get tasks that depend on this task. */
  getDependents(taskId: string): string[] {
    return [...(this.dependents.get(taskId) ?? [])];
  }

  /** Get the current status of a task node. */
  getStatus(taskId: string): NodeStatus | undefined {
    return this.statuses.get(taskId);
  }

  /** Check whether a task is registered. */
  hasTask(taskId: string): boolean {
    return this.statuses.has(taskId);
  }

  /** Get the total number of registered tasks. */
  get size(): number {
    return this.statuses.size;
  }

  // ── internal helpers ──────────────────────────────────────────────

  /**
   * Recalculate whether a task should be 'ready' based on its dependencies.
   * A task is ready when all its dependencies are completed and it is still pending.
   */
  private refreshReadyStatus(taskId: string): void {
    const status = this.statuses.get(taskId);
    if (status !== 'pending' && status !== 'ready') return;

    const deps = this.dependencies.get(taskId) ?? new Set<string>();
    const allCompleted = [...deps].every((d) => this.statuses.get(d) === 'completed');

    if (allCompleted) {
      this.statuses.set(taskId, 'ready');
    } else {
      this.statuses.set(taskId, 'pending');
    }
  }

  /** Recursively mark all dependents of a failed task as blocked. */
  private propagateBlocked(taskId: string): void {
    const deps = this.dependents.get(taskId) ?? new Set<string>();
    for (const dependent of deps) {
      const status = this.statuses.get(dependent);
      if (status === 'pending' || status === 'ready') {
        this.statuses.set(dependent, 'blocked');
        this.logger.warn('DependencyGraph: task blocked due to failed dependency', {
          taskId: dependent,
          failedDependency: taskId,
        });
        // Recursively block downstream
        this.propagateBlocked(dependent);
      }
    }
  }

  private persist(): void {
    if (this.onPersist) {
      const edges: Array<{ taskId: string; dependsOn: string }> = [];
      for (const [taskId, deps] of this.dependencies) {
        for (const dep of deps) {
          edges.push({ taskId, dependsOn: dep });
        }
      }
      this.onPersist(edges);
    }
  }
}
