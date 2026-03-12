/**
 * Integration tests for OpenClaw ↔ SocietyEngine interaction.
 *
 * Tests the real interaction between OpenClaw (orchestration) and
 * SocietyEngine (planning/scheduling) with mocked external deps
 * (Ollama, Minecraft, SQLite for agent repo).
 *
 * Validates: Requirements 18.2
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { OpenClawImpl } from '../openclaw.js';
import { SocietyEngine } from '@pyramid-os/society-engine';
import type {
  PyramidConfig,
  TaskDefinition,
  TaskResult,
} from '@pyramid-os/shared-types';
import type { Logger } from '@pyramid-os/logger';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function createMockRepository() {
  return {
    findById: vi.fn(),
    findAll: vi.fn().mockReturnValue([]),
    upsert: vi.fn(),
    delete: vi.fn(),
    updateStatus: vi.fn(),
    updateWorkspaceState: vi.fn(),
  };
}

function createTestConfig(): PyramidConfig {
  return {
    ollama: {
      host: 'localhost',
      port: 11434,
      timeout: 30000,
      maxConcurrentRequests: 4,
    },
    connections: [],
    safety: {
      prohibitedBlocks: ['minecraft:tnt', 'minecraft:lava'],
      prohibitedCommands: ['/op', '/gamemode'],
      maxDecisionTimeMs: 30000,
      maxActionsPerSecond: 10,
      maxReasoningLoops: 50,
    },
    controlCentre: { port: 3000, theme: 'egyptian', refreshRateMs: 1000 },
    logging: { level: 'info', outputPath: './logs', maxFileSizeMb: 10 },
    api: { port: 8080, apiKey: 'test-key', rateLimitPerMin: 100 },
    database: { path: ':memory:', poolSize: 1 },
    workspace: { dataDir: './data', snapshotsDir: './snapshots', logsDir: './logs' },
  };
}

// ---------------------------------------------------------------------------
// Integration Tests
// ---------------------------------------------------------------------------

describe('OpenClaw ↔ SocietyEngine Integration', () => {
  let logger: Logger;
  let repo: ReturnType<typeof createMockRepository>;
  let config: PyramidConfig;
  let openclaw: OpenClawImpl;
  let engine: SocietyEngine;
  let db: InstanceType<typeof Database>;

  beforeEach(async () => {
    logger = createMockLogger();
    repo = createMockRepository();
    config = createTestConfig();

    // Initialize OpenClaw
    openclaw = new OpenClawImpl(logger, repo as any);
    await openclaw.initialize(config);

    // Initialize SocietyEngine with in-memory SQLite
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

  afterEach(async () => {
    await openclaw.shutdown();
    db.close();
  });

  // -----------------------------------------------------------------------
  // Task creation → agent assignment → completion flow
  // -----------------------------------------------------------------------

  describe('task creation through agent assignment and completion', () => {
    it('creates a task in SocietyEngine and assigns it to an OpenClaw-managed agent', async () => {
      // Spawn a worker agent in OpenClaw
      const agentId = await openclaw.spawnAgent('builder');

      // Create a task in SocietyEngine
      const taskDef: TaskDefinition = {
        type: 'build',
        priority: 'high',
        civilizationId: 'civ-1',
        description: 'Place sandstone blocks for pyramid foundation',
      };
      const task = engine.createTask(taskDef);
      expect(task.status).toBe('pending');

      // Assign the task to the OpenClaw-managed agent
      const assigned = engine.assignTask(agentId);
      expect(assigned).toBeDefined();
      expect(assigned!.id).toBe(task.id);
      expect(assigned!.agentId).toBe(agentId);
      expect(assigned!.status).toBe('assigned');

      // Verify the agent exists in OpenClaw
      const state = openclaw.getState();
      expect(state.agentCount).toBe(1);
      expect(state.activeAgents).toBe(1);
    });

    it('completes a task and verifies state updates in both systems', async () => {
      // Spawn agent and create task
      const agentId = await openclaw.spawnAgent('quarry');
      const task = engine.createTask({
        type: 'mine',
        priority: 'normal',
        civilizationId: 'civ-1',
        description: 'Mine sandstone blocks',
      });

      // Assign and complete
      engine.assignTask(agentId);
      const result: TaskResult = {
        taskId: task.id,
        success: true,
        outcome: 'Mined 64 sandstone blocks',
        completedAt: new Date().toISOString(),
      };
      engine.completeTask(task.id, result);

      // Verify task is completed in SocietyEngine
      const completedTask = engine.getTaskQueue().getTask(task.id);
      expect(completedTask?.status).toBe('completed');

      // Verify dependency graph reflects completion
      expect(engine.getDependencyGraph().getStatus(task.id)).toBe('completed');

      // Verify metrics recorded the completion
      const metrics = engine.getMetrics();
      expect(metrics.taskCompletionRates).toBeDefined();

      // Agent is still active in OpenClaw (ready for next task)
      const agentState = openclaw.getState();
      expect(agentState.activeAgents).toBe(1);
    });

    it('handles task dependency chain with multiple OpenClaw agents', async () => {
      // Spawn multiple agents
      const quarryAgentId = await openclaw.spawnAgent('quarry');
      const builderAgentId = await openclaw.spawnAgent('builder');

      // Create dependent tasks: mining must complete before building
      const mineTask = engine.createTask({
        type: 'mine',
        priority: 'high',
        civilizationId: 'civ-1',
        description: 'Mine sandstone',
      });

      const buildTask = engine.createTask({
        type: 'build',
        priority: 'high',
        civilizationId: 'civ-1',
        description: 'Build pyramid layer',
        dependencies: [mineTask.id],
      });

      // Only the mine task should be recommended (build depends on it)
      const recommendations = engine.getRecommendations();
      const recIds = recommendations.map((t) => t.id);
      expect(recIds).toContain(mineTask.id);
      expect(recIds).not.toContain(buildTask.id);

      // Assign mine task to quarry agent
      const assignedMine = engine.assignTask(quarryAgentId);
      expect(assignedMine?.id).toBe(mineTask.id);

      // Complete the mine task
      engine.completeTask(mineTask.id, {
        taskId: mineTask.id,
        success: true,
        outcome: 'Mining complete',
        completedAt: new Date().toISOString(),
      });

      // Now the build task should be recommended
      const postRecs = engine.getRecommendations();
      expect(postRecs.map((t) => t.id)).toContain(buildTask.id);

      // Assign build task to builder agent
      const assignedBuild = engine.assignTask(builderAgentId);
      expect(assignedBuild?.id).toBe(buildTask.id);

      // Complete the build task
      engine.completeTask(buildTask.id, {
        taskId: buildTask.id,
        success: true,
        outcome: 'Layer built',
        completedAt: new Date().toISOString(),
      });

      // Both tasks completed, both agents still active
      expect(engine.getDependencyGraph().getStatus(mineTask.id)).toBe('completed');
      expect(engine.getDependencyGraph().getStatus(buildTask.id)).toBe('completed');
      expect(openclaw.getState().agentCount).toBe(2);
    });

    it('handles task failure and blocks dependent tasks', async () => {
      const agentId = await openclaw.spawnAgent('quarry');

      const mineTask = engine.createTask({
        type: 'mine',
        priority: 'high',
        civilizationId: 'civ-1',
        description: 'Mine gold blocks',
      });

      const buildTask = engine.createTask({
        type: 'build',
        priority: 'normal',
        civilizationId: 'civ-1',
        description: 'Place gold capstone',
        dependencies: [mineTask.id],
      });

      // Assign and fail the mine task
      engine.assignTask(agentId);
      engine.completeTask(mineTask.id, {
        taskId: mineTask.id,
        success: false,
        outcome: 'No gold ore found',
        completedAt: new Date().toISOString(),
      });

      // Mine task failed, build task should be blocked
      expect(engine.getDependencyGraph().getStatus(mineTask.id)).toBe('failed');
      expect(engine.getDependencyGraph().getStatus(buildTask.id)).toBe('blocked');

      // Build task should NOT appear in recommendations
      const recs = engine.getRecommendations();
      expect(recs.map((t) => t.id)).not.toContain(buildTask.id);
    });

    it('agent termination in OpenClaw does not affect SocietyEngine task state', async () => {
      const agentId = await openclaw.spawnAgent('builder');

      const task = engine.createTask({
        type: 'build',
        priority: 'normal',
        civilizationId: 'civ-1',
        description: 'Build wall section',
      });

      engine.assignTask(agentId);

      // Terminate the agent in OpenClaw
      await openclaw.terminateAgent(agentId);
      expect(openclaw.getState().agentCount).toBe(0);

      // Task is still tracked in SocietyEngine (in_progress)
      const trackedTask = engine.getTaskQueue().getTask(task.id);
      expect(trackedTask).toBeDefined();
      expect(trackedTask!.agentId).toBe(agentId);
    });
  });

  // -----------------------------------------------------------------------
  // Resource threshold triggers generating procurement tasks
  // -----------------------------------------------------------------------

  describe('resource threshold triggers procurement tasks', () => {
    it('detects low resources and generates procurement tasks', async () => {
      // Spawn a vizier (planner) and quarry (worker) agent
      await openclaw.spawnAgent('vizier');
      const quarryAgentId = await openclaw.spawnAgent('quarry');

      // Set initial resource level above threshold
      engine.updateResource('sandstone', 100, 'initial stock');
      expect(engine.getResourceTracker().isBelowThreshold('sandstone')).toBe(false);

      // Consume resources to drop below minimum threshold (50)
      engine.updateResource('sandstone', -60, 'used for construction');

      // Verify resource is now below threshold
      expect(engine.getResourceTracker().isBelowThreshold('sandstone')).toBe(true);
      expect(engine.getResourceTracker().getLevel('sandstone')).toBe(40);

      // Check low resource alerts
      const alerts = engine.getResourceTracker().getLowResources();
      expect(alerts.length).toBeGreaterThan(0);
      expect(alerts[0]!.resourceType).toBe('sandstone');
      expect(alerts[0]!.severity).toBe('warning');

      // Simulate the Vizier creating a procurement task in response
      const procurementTask = engine.createTask({
        type: 'mine',
        priority: 'high',
        civilizationId: 'civ-1',
        description: 'Procure sandstone — resource below threshold',
      });

      // Assign to quarry agent managed by OpenClaw
      const assigned = engine.assignTask(quarryAgentId);
      expect(assigned).toBeDefined();
      expect(assigned!.id).toBe(procurementTask.id);

      // Complete procurement and replenish resources
      engine.completeTask(procurementTask.id, {
        taskId: procurementTask.id,
        success: true,
        outcome: 'Mined 80 sandstone',
        completedAt: new Date().toISOString(),
      });
      engine.updateResource('sandstone', 80, 'procurement completed');

      // Resource should now be above threshold
      expect(engine.getResourceTracker().getLevel('sandstone')).toBe(120);
      expect(engine.getResourceTracker().isBelowThreshold('sandstone')).toBe(false);
    });

    it('detects critical resource levels', async () => {
      await openclaw.spawnAgent('vizier');

      // Set resource and drain to critical level
      engine.updateResource('food', 15, 'initial food');
      engine.updateResource('food', -12, 'consumed by workers');

      // Food is at 3, below critical threshold of 5
      expect(engine.getResourceTracker().getLevel('food')).toBe(3);

      const alerts = engine.getResourceTracker().getLowResources();
      const foodAlert = alerts.find((a) => a.resourceType === 'food');
      expect(foodAlert).toBeDefined();
      expect(foodAlert!.severity).toBe('critical');
    });

    it('resource updates are persisted to SQLite during integration flow', async () => {
      await openclaw.spawnAgent('quarry');

      engine.updateResource('sandstone', 200, 'large shipment');
      engine.updateResource('sandstone', -50, 'building phase 1');

      // Verify persistence in SQLite
      const row = db
        .prepare('SELECT level FROM se_resources WHERE resource_type = ?')
        .get('sandstone') as Record<string, unknown>;
      expect(row).toBeDefined();
      expect(row['level']).toBe(150);

      // Verify transactions are recorded
      const txns = db
        .prepare('SELECT * FROM se_resource_transactions WHERE resource_type = ?')
        .all('sandstone');
      expect(txns.length).toBe(2);
    });

    it('multiple resource types can trigger alerts simultaneously', async () => {
      await openclaw.spawnAgent('vizier');
      const farmerId = await openclaw.spawnAgent('farmer');
      const quarryId = await openclaw.spawnAgent('quarry');

      // Both resources start above threshold then drop below
      engine.updateResource('sandstone', 100, 'stock');
      engine.updateResource('food', 30, 'stock');

      engine.updateResource('sandstone', -70, 'heavy construction');
      engine.updateResource('food', -25, 'feeding workers');

      // Both should be below threshold
      const alerts = engine.getResourceTracker().getLowResources();
      expect(alerts.length).toBe(2);

      const types = alerts.map((a) => a.resourceType).sort();
      expect(types).toEqual(['food', 'sandstone']);

      // Create procurement tasks for both
      const mineTask = engine.createTask({
        type: 'mine',
        priority: 'high',
        civilizationId: 'civ-1',
        description: 'Procure sandstone',
      });
      const farmTask = engine.createTask({
        type: 'farm',
        priority: 'high',
        civilizationId: 'civ-1',
        description: 'Grow food crops',
      });

      // Assign to respective agents
      const assignedMine = engine.assignTask(quarryId);
      const assignedFarm = engine.assignTask(farmerId);

      expect(assignedMine).toBeDefined();
      expect(assignedFarm).toBeDefined();

      // Both agents are managed by OpenClaw
      expect(openclaw.getState().agentCount).toBe(3); // vizier + farmer + quarry
    });
  });
});
