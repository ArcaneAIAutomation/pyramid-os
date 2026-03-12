import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import type { Logger } from '@pyramid-os/logger';
import type { TaskDefinition, TaskResult, Blueprint } from '@pyramid-os/shared-types';
import { SocietyEngine, type SocietyEngineConfig } from '../society-engine.js';
import type { Zone } from '../zone-manager.js';
import type { Ceremony } from '../ceremony-manager.js';

// ── helpers ─────────────────────────────────────────────────────────

function createMockLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function makeTaskDef(overrides: Partial<TaskDefinition> = {}): TaskDefinition {
  return {
    type: 'build',
    priority: 'normal',
    civilizationId: 'civ-1',
    description: 'Test task',
    ...overrides,
  };
}

function makeBlueprint(id = 'bp-1'): Blueprint {
  return {
    id,
    name: 'Test Pyramid',
    version: 1,
    type: 'pyramid',
    dimensions: { width: 3, height: 2, depth: 3 },
    metadata: {
      structureName: 'Test Pyramid',
      dimensions: { width: 3, height: 2, depth: 3 },
      requiredResources: [{ type: 'sandstone', count: 5 }],
      estimatedTimeMinutes: 10,
      createdAt: new Date().toISOString(),
      createdBy: 'architect-1',
    },
    placements: [
      { index: 0, position: { x: 0, y: 0, z: 0 }, blockType: 'minecraft:sandstone', placed: false },
      { index: 1, position: { x: 1, y: 0, z: 0 }, blockType: 'minecraft:sandstone', placed: false },
      { index: 2, position: { x: 0, y: 1, z: 0 }, blockType: 'minecraft:gold_block', placed: false },
    ],
    progress: { totalBlocks: 3, placedBlocks: 0, percentComplete: 0, currentPhase: 'foundation' },
  };
}

function makeZone(overrides: Partial<Zone> = {}): Zone {
  return {
    id: 'zone-1',
    name: 'Quarry Alpha',
    type: 'quarry',
    min: { x: 0, y: 0, z: 0 },
    max: { x: 100, y: 64, z: 100 },
    civilizationId: 'civ-1',
    assignedAgents: [],
    ...overrides,
  };
}

function makeCeremony(overrides: Partial<Ceremony> = {}): Ceremony {
  return {
    id: 'cer-1',
    type: 'harvest_festival',
    name: 'Harvest Festival',
    scheduledAt: new Date().toISOString(),
    status: 'scheduled',
    civilizationId: 'civ-1',
    templeZoneId: 'zone-temple-1',
    assignedPriests: [],
    requiresApproval: false,
    effects: [],
    ...overrides,
  };
}

// ── tests ───────────────────────────────────────────────────────────

describe('SocietyEngine', () => {
  let logger: Logger;
  let db: InstanceType<typeof Database>;
  let engine: SocietyEngine;

  beforeEach(async () => {
    logger = createMockLogger();
    db = new Database(':memory:');
    engine = new SocietyEngine(logger, {
      civilizationId: 'civ-1',
      resourceThresholds: [
        { resourceType: 'sandstone', minimum: 50, critical: 10 },
        { resourceType: 'food', minimum: 20, critical: 5 },
      ],
    });
    await engine.initialize(db);
  });

  afterEach(() => {
    db.close();
  });

  // ── initialization ──────────────────────────────────────────────

  describe('initialize', () => {
    it('creates all required SQLite tables', () => {
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'se_%'")
        .all()
        .map((r) => (r as Record<string, unknown>)['name'] as string)
        .sort();

      expect(tables).toEqual([
        'se_build_phases',
        'se_ceremonies',
        'se_metrics',
        'se_resource_transactions',
        'se_resources',
        'se_task_dependencies',
        'se_tasks',
        'se_zones',
      ]);
    });

    it('throws if methods are called before initialize', async () => {
      const uninit = new SocietyEngine(logger);
      expect(() => uninit.createTask(makeTaskDef())).toThrow('not been initialized');
    });
  });

  // ── createTask ──────────────────────────────────────────────────

  describe('createTask', () => {
    it('returns a task with generated id and pending status', () => {
      const task = engine.createTask(makeTaskDef());
      expect(task.id).toMatch(/^task-/);
      expect(task.status).toBe('pending');
      expect(task.type).toBe('build');
    });

    it('persists the task to SQLite', () => {
      const task = engine.createTask(makeTaskDef());
      const row = db.prepare('SELECT * FROM se_tasks WHERE id = ?').get(task.id) as Record<string, unknown>;
      expect(row).toBeDefined();
      expect(row['status']).toBe('pending');
    });

    it('registers the task in the dependency graph', () => {
      const task = engine.createTask(makeTaskDef());
      expect(engine.getDependencyGraph().hasTask(task.id)).toBe(true);
    });

    it('wires dependencies in the graph', () => {
      const t1 = engine.createTask(makeTaskDef({ description: 'first' }));
      const t2 = engine.createTask(makeTaskDef({ description: 'second', dependencies: [t1.id] }));

      const deps = engine.getDependencyGraph().getDependencies(t2.id);
      expect(deps).toContain(t1.id);
    });
  });

  // ── assignTask ──────────────────────────────────────────────────

  describe('assignTask', () => {
    it('dequeues the highest-priority task for the agent', () => {
      engine.createTask(makeTaskDef({ priority: 'low', description: 'low' }));
      engine.createTask(makeTaskDef({ priority: 'high', description: 'high' }));

      const task = engine.assignTask('agent-1');
      expect(task).toBeDefined();
      expect(task!.priority).toBe('high');
      expect(task!.agentId).toBe('agent-1');
    });

    it('returns undefined when no tasks are available', () => {
      expect(engine.assignTask('agent-1')).toBeUndefined();
    });
  });

  // ── completeTask ────────────────────────────────────────────────

  describe('completeTask', () => {
    it('marks a task as completed in the queue and graph', () => {
      const task = engine.createTask(makeTaskDef());
      engine.assignTask('agent-1');

      const result: TaskResult = {
        taskId: task.id,
        success: true,
        outcome: 'done',
        completedAt: new Date().toISOString(),
      };
      engine.completeTask(task.id, result);

      expect(engine.getTaskQueue().getTask(task.id)?.status).toBe('completed');
      expect(engine.getDependencyGraph().getStatus(task.id)).toBe('completed');
    });

    it('marks a failed task and propagates blocked status', () => {
      const t1 = engine.createTask(makeTaskDef({ description: 'dep' }));
      const t2 = engine.createTask(makeTaskDef({ description: 'child', dependencies: [t1.id] }));

      const result: TaskResult = {
        taskId: t1.id,
        success: false,
        outcome: 'error',
        completedAt: new Date().toISOString(),
      };
      engine.completeTask(t1.id, result);

      expect(engine.getDependencyGraph().getStatus(t1.id)).toBe('failed');
      expect(engine.getDependencyGraph().getStatus(t2.id)).toBe('blocked');
    });

    it('records a metric on completion', () => {
      const task = engine.createTask(makeTaskDef());
      engine.assignTask('agent-1');

      engine.completeTask(task.id, {
        taskId: task.id,
        success: true,
        outcome: 'ok',
        completedAt: new Date().toISOString(),
      });

      const rows = db.prepare('SELECT * FROM se_metrics WHERE metric_name = ?').all('task_completion');
      expect(rows.length).toBeGreaterThanOrEqual(1);
    });

    it('persists completed status to SQLite', () => {
      const task = engine.createTask(makeTaskDef());
      engine.assignTask('agent-1');

      engine.completeTask(task.id, {
        taskId: task.id,
        success: true,
        outcome: 'ok',
        completedAt: new Date().toISOString(),
      });

      const row = db.prepare('SELECT status FROM se_tasks WHERE id = ?').get(task.id) as Record<string, unknown>;
      expect(row['status']).toBe('completed');
    });
  });

  // ── getRecommendations ──────────────────────────────────────────

  describe('getRecommendations', () => {
    it('returns tasks with all dependencies satisfied', () => {
      const t1 = engine.createTask(makeTaskDef({ description: 'first' }));
      engine.createTask(makeTaskDef({ description: 'second', dependencies: [t1.id] }));

      // t1 has no deps so it should be ready
      const recs = engine.getRecommendations();
      expect(recs.map((t) => t.id)).toContain(t1.id);
    });

    it('does not return tasks with unsatisfied dependencies', () => {
      const t1 = engine.createTask(makeTaskDef({ description: 'first' }));
      const t2 = engine.createTask(makeTaskDef({ description: 'second', dependencies: [t1.id] }));

      const recs = engine.getRecommendations();
      expect(recs.map((t) => t.id)).not.toContain(t2.id);
    });
  });

  // ── updateResource ──────────────────────────────────────────────

  describe('updateResource', () => {
    it('updates resource level and persists to SQLite', () => {
      engine.updateResource('sandstone', 100, 'initial stock');

      const row = db.prepare('SELECT level FROM se_resources WHERE resource_type = ?').get('sandstone') as Record<string, unknown>;
      expect(row['level']).toBe(100);
    });

    it('persists resource transactions', () => {
      engine.updateResource('sandstone', 50, 'mined');
      engine.updateResource('sandstone', -10, 'used for building');

      const txns = db.prepare('SELECT * FROM se_resource_transactions').all();
      expect(txns.length).toBe(2);
    });

    it('records consumption metrics for negative deltas', () => {
      engine.updateResource('sandstone', 100, 'stock');
      engine.updateResource('sandstone', -30, 'consumed');

      const rows = db.prepare("SELECT * FROM se_metrics WHERE metric_name = 'resource_consumption'").all();
      expect(rows.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── defineZone ──────────────────────────────────────────────────

  describe('defineZone', () => {
    it('defines a zone and returns it', () => {
      const zone = engine.defineZone(makeZone());
      expect(zone.id).toBe('zone-1');
      expect(zone.name).toBe('Quarry Alpha');
    });

    it('persists the zone to SQLite', () => {
      engine.defineZone(makeZone());
      const row = db.prepare('SELECT * FROM se_zones WHERE id = ?').get('zone-1') as Record<string, unknown>;
      expect(row).toBeDefined();
      expect(row['name']).toBe('Quarry Alpha');
    });
  });

  // ── startBuildSequence ──────────────────────────────────────────

  describe('startBuildSequence', () => {
    it('decomposes a blueprint into build phases', () => {
      const phases = engine.startBuildSequence(makeBlueprint());
      expect(phases.length).toBeGreaterThan(0);
      expect(phases[0]!.type).toBe('foundation');
    });

    it('persists phases to SQLite', () => {
      engine.startBuildSequence(makeBlueprint());
      const rows = db.prepare('SELECT * FROM se_build_phases').all();
      expect(rows.length).toBeGreaterThan(0);
    });

    it('sets total blocks in metrics collector', () => {
      const bp = makeBlueprint();
      engine.startBuildSequence(bp);
      const metrics = engine.getMetrics();
      expect(metrics.buildProgress.totalBlocks).toBe(bp.placements.length);
    });
  });

  // ── scheduleCeremony ────────────────────────────────────────────

  describe('scheduleCeremony', () => {
    it('schedules a ceremony and returns it', () => {
      const ceremony = engine.scheduleCeremony(makeCeremony());
      expect(ceremony.id).toBe('cer-1');
      // harvest_festival doesn't require approval → auto-approved
      expect(ceremony.status).toBe('approved');
    });

    it('persists the ceremony to SQLite', () => {
      engine.scheduleCeremony(makeCeremony());
      const row = db.prepare('SELECT * FROM se_ceremonies WHERE id = ?').get('cer-1') as Record<string, unknown>;
      expect(row).toBeDefined();
      expect(row['type']).toBe('harvest_festival');
    });

    it('requires approval for major ceremonies', () => {
      const ceremony = engine.scheduleCeremony(
        makeCeremony({ id: 'cer-2', type: 'coronation', requiresApproval: true }),
      );
      expect(ceremony.status).toBe('scheduled');
    });
  });

  // ── getMetrics ──────────────────────────────────────────────────

  describe('getMetrics', () => {
    it('returns a metrics snapshot', () => {
      const metrics = engine.getMetrics();
      expect(metrics).toHaveProperty('taskCompletionRates');
      expect(metrics).toHaveProperty('resourceConsumptionRates');
      expect(metrics).toHaveProperty('buildProgress');
      expect(metrics).toHaveProperty('agentDecisionLatency');
      expect(metrics).toHaveProperty('collectedAt');
    });
  });

  // ── sub-component accessors ─────────────────────────────────────

  describe('sub-component accessors', () => {
    it('exposes TaskQueue', () => {
      expect(engine.getTaskQueue()).toBeDefined();
    });

    it('exposes DependencyGraph', () => {
      expect(engine.getDependencyGraph()).toBeDefined();
    });

    it('exposes ResourceTracker', () => {
      expect(engine.getResourceTracker()).toBeDefined();
    });

    it('exposes ZoneManager', () => {
      expect(engine.getZoneManager()).toBeDefined();
    });

    it('exposes BuildPhaseManager', () => {
      expect(engine.getBuildPhaseManager()).toBeDefined();
    });

    it('exposes CeremonyManager', () => {
      expect(engine.getCeremonyManager()).toBeDefined();
    });

    it('exposes MetricsCollector', () => {
      expect(engine.getMetricsCollector()).toBeDefined();
    });
  });
});
