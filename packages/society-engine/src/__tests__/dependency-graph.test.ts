import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Logger } from '@pyramid-os/logger';
import { DependencyGraph, type DependencyPersistCallback } from '../dependency-graph.js';

// ── helpers ─────────────────────────────────────────────────────────

function createMockLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

// ── tests ───────────────────────────────────────────────────────────

describe('DependencyGraph', () => {
  let logger: Logger;
  let graph: DependencyGraph;

  beforeEach(() => {
    logger = createMockLogger();
    graph = new DependencyGraph(logger);
  });

  // ── addTask ─────────────────────────────────────────────────────

  describe('addTask', () => {
    it('registers a task node', () => {
      graph.addTask('A');
      expect(graph.hasTask('A')).toBe(true);
      expect(graph.size).toBe(1);
    });

    it('is idempotent for the same taskId', () => {
      graph.addTask('A');
      graph.addTask('A');
      expect(graph.size).toBe(1);
    });

    it('task with no dependencies starts as ready', () => {
      graph.addTask('A');
      expect(graph.getStatus('A')).toBe('ready');
    });
  });

  // ── addDependency ───────────────────────────────────────────────

  describe('addDependency', () => {
    it('adds a directed edge', () => {
      graph.addTask('A');
      graph.addTask('B');
      graph.addDependency('B', 'A'); // B depends on A

      expect(graph.getDependencies('B')).toEqual(['A']);
      expect(graph.getDependents('A')).toEqual(['B']);
    });

    it('marks dependent task as pending when dependency is not completed', () => {
      graph.addTask('A');
      graph.addTask('B');
      graph.addDependency('B', 'A');

      expect(graph.getStatus('B')).toBe('pending');
      expect(graph.getStatus('A')).toBe('ready');
    });

    it('throws if taskId is not registered', () => {
      graph.addTask('A');
      expect(() => graph.addDependency('X', 'A')).toThrow('not registered');
    });

    it('throws if dependsOn is not registered', () => {
      graph.addTask('A');
      expect(() => graph.addDependency('A', 'X')).toThrow('not registered');
    });

    it('throws if task depends on itself', () => {
      graph.addTask('A');
      expect(() => graph.addDependency('A', 'A')).toThrow('cannot depend on itself');
    });

    it('throws on circular dependency (req 36.4)', () => {
      graph.addTask('A');
      graph.addTask('B');
      graph.addDependency('B', 'A');

      expect(() => graph.addDependency('A', 'B')).toThrow('cycle');
    });

    it('throws on transitive circular dependency', () => {
      graph.addTask('A');
      graph.addTask('B');
      graph.addTask('C');
      graph.addDependency('B', 'A');
      graph.addDependency('C', 'B');

      expect(() => graph.addDependency('A', 'C')).toThrow('cycle');
    });

    it('does not corrupt graph state after rejected cycle', () => {
      graph.addTask('A');
      graph.addTask('B');
      graph.addDependency('B', 'A');

      try {
        graph.addDependency('A', 'B');
      } catch {
        // expected
      }

      // Graph should still be valid
      expect(graph.getDependencies('A')).toEqual([]);
      expect(graph.getDependencies('B')).toEqual(['A']);
      expect(graph.detectCycles()).toBeNull();
    });
  });

  // ── detectCycles ────────────────────────────────────────────────

  describe('detectCycles', () => {
    it('returns null for an acyclic graph', () => {
      graph.addTask('A');
      graph.addTask('B');
      graph.addTask('C');
      graph.addDependency('B', 'A');
      graph.addDependency('C', 'B');

      expect(graph.detectCycles()).toBeNull();
    });

    it('returns null for a graph with no edges', () => {
      graph.addTask('A');
      graph.addTask('B');
      expect(graph.detectCycles()).toBeNull();
    });

    it('returns null for an empty graph', () => {
      expect(graph.detectCycles()).toBeNull();
    });
  });

  // ── getReadyTasks ───────────────────────────────────────────────

  describe('getReadyTasks', () => {
    it('returns tasks with no dependencies', () => {
      graph.addTask('A');
      graph.addTask('B');

      const ready = graph.getReadyTasks();
      expect(ready).toContain('A');
      expect(ready).toContain('B');
    });

    it('does not return tasks with unsatisfied dependencies', () => {
      graph.addTask('A');
      graph.addTask('B');
      graph.addDependency('B', 'A');

      const ready = graph.getReadyTasks();
      expect(ready).toContain('A');
      expect(ready).not.toContain('B');
    });

    it('returns dependent task after dependency is completed', () => {
      graph.addTask('A');
      graph.addTask('B');
      graph.addDependency('B', 'A');

      graph.markComplete('A');

      const ready = graph.getReadyTasks();
      expect(ready).toContain('B');
    });

    it('does not return completed tasks', () => {
      graph.addTask('A');
      graph.markComplete('A');

      expect(graph.getReadyTasks()).not.toContain('A');
    });
  });

  // ── markComplete ────────────────────────────────────────────────

  describe('markComplete', () => {
    it('sets task status to completed', () => {
      graph.addTask('A');
      graph.markComplete('A');
      expect(graph.getStatus('A')).toBe('completed');
    });

    it('makes dependent tasks ready when all deps are completed', () => {
      graph.addTask('A');
      graph.addTask('B');
      graph.addTask('C');
      graph.addDependency('C', 'A');
      graph.addDependency('C', 'B');

      graph.markComplete('A');
      expect(graph.getStatus('C')).toBe('pending'); // B still pending

      graph.markComplete('B');
      expect(graph.getStatus('C')).toBe('ready');
    });

    it('handles unknown taskId gracefully', () => {
      expect(() => graph.markComplete('unknown')).not.toThrow();
    });
  });

  // ── markFailed ──────────────────────────────────────────────────

  describe('markFailed', () => {
    it('sets task status to failed', () => {
      graph.addTask('A');
      graph.markFailed('A');
      expect(graph.getStatus('A')).toBe('failed');
    });

    it('blocks direct dependents (req 36.7)', () => {
      graph.addTask('A');
      graph.addTask('B');
      graph.addDependency('B', 'A');

      graph.markFailed('A');
      expect(graph.getStatus('B')).toBe('blocked');
    });

    it('propagates blocked status transitively', () => {
      graph.addTask('A');
      graph.addTask('B');
      graph.addTask('C');
      graph.addDependency('B', 'A');
      graph.addDependency('C', 'B');

      graph.markFailed('A');
      expect(graph.getStatus('B')).toBe('blocked');
      expect(graph.getStatus('C')).toBe('blocked');
    });

    it('does not block already completed tasks', () => {
      graph.addTask('A');
      graph.addTask('B');
      graph.addTask('C');
      graph.addDependency('B', 'A');
      graph.addDependency('C', 'A');

      graph.markComplete('B');
      graph.markFailed('A');

      expect(graph.getStatus('B')).toBe('completed');
      expect(graph.getStatus('C')).toBe('blocked');
    });

    it('handles unknown taskId gracefully', () => {
      expect(() => graph.markFailed('unknown')).not.toThrow();
    });
  });

  // ── getParallelGroups ───────────────────────────────────────────

  describe('getParallelGroups', () => {
    it('returns single group for independent tasks (req 36.8)', () => {
      graph.addTask('A');
      graph.addTask('B');
      graph.addTask('C');

      const groups = graph.getParallelGroups();
      expect(groups).toHaveLength(1);
      expect(groups[0]).toHaveLength(3);
      expect(groups[0]).toContain('A');
      expect(groups[0]).toContain('B');
      expect(groups[0]).toContain('C');
    });

    it('returns multiple levels for a chain', () => {
      graph.addTask('A');
      graph.addTask('B');
      graph.addTask('C');
      graph.addDependency('B', 'A');
      graph.addDependency('C', 'B');

      const groups = graph.getParallelGroups();
      expect(groups).toHaveLength(3);
      expect(groups[0]).toEqual(['A']);
      expect(groups[1]).toEqual(['B']);
      expect(groups[2]).toEqual(['C']);
    });

    it('groups independent tasks at the same level', () => {
      // A → B, A → C, B → D, C → D
      graph.addTask('A');
      graph.addTask('B');
      graph.addTask('C');
      graph.addTask('D');
      graph.addDependency('B', 'A');
      graph.addDependency('C', 'A');
      graph.addDependency('D', 'B');
      graph.addDependency('D', 'C');

      const groups = graph.getParallelGroups();
      expect(groups).toHaveLength(3);
      expect(groups[0]).toEqual(['A']);
      expect(groups[1]!.sort()).toEqual(['B', 'C']);
      expect(groups[2]).toEqual(['D']);
    });

    it('returns empty array for empty graph', () => {
      expect(graph.getParallelGroups()).toEqual([]);
    });
  });

  // ── topologicalSort ─────────────────────────────────────────────

  describe('topologicalSort', () => {
    it('returns tasks in dependency order', () => {
      graph.addTask('A');
      graph.addTask('B');
      graph.addTask('C');
      graph.addDependency('B', 'A');
      graph.addDependency('C', 'B');

      const sorted = graph.topologicalSort();
      expect(sorted.indexOf('A')).toBeLessThan(sorted.indexOf('B'));
      expect(sorted.indexOf('B')).toBeLessThan(sorted.indexOf('C'));
    });

    it('returns all tasks', () => {
      graph.addTask('A');
      graph.addTask('B');
      graph.addTask('C');
      graph.addDependency('C', 'A');

      const sorted = graph.topologicalSort();
      expect(sorted).toHaveLength(3);
    });

    it('returns empty array for empty graph', () => {
      expect(graph.topologicalSort()).toEqual([]);
    });

    it('respects diamond dependency ordering', () => {
      graph.addTask('A');
      graph.addTask('B');
      graph.addTask('C');
      graph.addTask('D');
      graph.addDependency('B', 'A');
      graph.addDependency('C', 'A');
      graph.addDependency('D', 'B');
      graph.addDependency('D', 'C');

      const sorted = graph.topologicalSort();
      expect(sorted.indexOf('A')).toBeLessThan(sorted.indexOf('B'));
      expect(sorted.indexOf('A')).toBeLessThan(sorted.indexOf('C'));
      expect(sorted.indexOf('B')).toBeLessThan(sorted.indexOf('D'));
      expect(sorted.indexOf('C')).toBeLessThan(sorted.indexOf('D'));
    });
  });

  // ── getDependencies / getDependents ─────────────────────────────

  describe('getDependencies / getDependents', () => {
    it('returns direct dependencies', () => {
      graph.addTask('A');
      graph.addTask('B');
      graph.addTask('C');
      graph.addDependency('C', 'A');
      graph.addDependency('C', 'B');

      expect(graph.getDependencies('C').sort()).toEqual(['A', 'B']);
    });

    it('returns direct dependents', () => {
      graph.addTask('A');
      graph.addTask('B');
      graph.addTask('C');
      graph.addDependency('B', 'A');
      graph.addDependency('C', 'A');

      expect(graph.getDependents('A').sort()).toEqual(['B', 'C']);
    });

    it('returns empty array for unknown task', () => {
      expect(graph.getDependencies('unknown')).toEqual([]);
      expect(graph.getDependents('unknown')).toEqual([]);
    });
  });

  // ── persistence callback ────────────────────────────────────────

  describe('persistence callback', () => {
    it('calls onPersist when a dependency is added', () => {
      const cb = vi.fn<DependencyPersistCallback>();
      const g = new DependencyGraph(logger, cb);
      g.addTask('A');
      g.addTask('B');
      g.addDependency('B', 'A');

      expect(cb).toHaveBeenCalledTimes(1);
      expect(cb).toHaveBeenCalledWith([{ taskId: 'B', dependsOn: 'A' }]);
    });

    it('does not call onPersist when cycle is rejected', () => {
      const cb = vi.fn<DependencyPersistCallback>();
      const g = new DependencyGraph(logger, cb);
      g.addTask('A');
      g.addTask('B');
      g.addDependency('B', 'A');
      cb.mockClear();

      try {
        g.addDependency('A', 'B');
      } catch {
        // expected
      }

      expect(cb).not.toHaveBeenCalled();
    });
  });

  // ── complex scenarios ───────────────────────────────────────────

  describe('complex scenarios', () => {
    it('handles a multi-level build pipeline', () => {
      // foundation → walls → roof
      // foundation → floor
      // walls + floor → interior
      graph.addTask('foundation');
      graph.addTask('walls');
      graph.addTask('floor');
      graph.addTask('roof');
      graph.addTask('interior');

      graph.addDependency('walls', 'foundation');
      graph.addDependency('floor', 'foundation');
      graph.addDependency('roof', 'walls');
      graph.addDependency('interior', 'walls');
      graph.addDependency('interior', 'floor');

      // Initially only foundation is ready
      expect(graph.getReadyTasks()).toEqual(['foundation']);

      // Complete foundation → walls and floor become ready
      graph.markComplete('foundation');
      const ready1 = graph.getReadyTasks().sort();
      expect(ready1).toEqual(['floor', 'walls']);

      // Complete walls → roof becomes ready, interior still waiting on floor
      graph.markComplete('walls');
      expect(graph.getReadyTasks()).toContain('roof');
      expect(graph.getStatus('interior')).toBe('pending');

      // Complete floor → interior becomes ready
      graph.markComplete('floor');
      expect(graph.getReadyTasks()).toContain('interior');
    });

    it('failure in middle of chain blocks downstream only', () => {
      graph.addTask('A');
      graph.addTask('B');
      graph.addTask('C');
      graph.addTask('D');
      graph.addDependency('B', 'A');
      graph.addDependency('C', 'B');
      graph.addDependency('D', 'A');

      graph.markComplete('A');
      graph.markFailed('B');

      expect(graph.getStatus('C')).toBe('blocked');
      expect(graph.getStatus('D')).toBe('ready'); // D only depends on A
    });
  });
});
