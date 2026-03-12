/**
 * SocietyEngine — main orchestration class connecting all sub-components
 * of the planning and scheduling layer.
 *
 * Wires TaskQueue, DependencyGraph, ResourceTracker, ZoneManager,
 * BuildPhaseManager, CeremonyManager, and MetricsCollector together,
 * persisting all planning state to SQLite.
 *
 * Requirements: 3.10, 3.11
 */

import type { Logger } from '@pyramid-os/logger';
import type {
  Task,
  TaskDefinition,
  TaskResult,
  Blueprint,
  ResourceThreshold,
} from '@pyramid-os/shared-types';

import { TaskQueue } from './task-queue.js';
import { DependencyGraph } from './dependency-graph.js';
import { ResourceTracker } from './resource-tracker.js';
import { ZoneManager, type Zone } from './zone-manager.js';
import { BuildPhaseManager, type BuildPhase } from './build-phase-manager.js';
import { CeremonyManager, type Ceremony } from './ceremony-manager.js';
import { MetricsCollector, type SocietyMetrics } from './metrics-collector.js';

// ── Database abstraction ────────────────────────────────────────────

/**
 * Minimal database interface expected by SocietyEngine.
 * Matches the subset of better-sqlite3's `Database` used here.
 */
export interface SocietyDatabase {
  prepare(sql: string): {
    run(...params: unknown[]): { changes: number };
    get(...params: unknown[]): Record<string, unknown> | undefined;
    all(...params: unknown[]): Record<string, unknown>[];
  };
  exec(sql: string): void;
}

// ── Config ──────────────────────────────────────────────────────────

export interface SocietyEngineConfig {
  civilizationId?: string;
  resourceThresholds?: ResourceThreshold[];
}

// ── SocietyEngine ───────────────────────────────────────────────────

export class SocietyEngine {
  private readonly logger: Logger;
  private readonly config: SocietyEngineConfig;

  private db: SocietyDatabase | undefined;
  private taskQueue!: TaskQueue;
  private dependencyGraph!: DependencyGraph;
  private resourceTracker!: ResourceTracker;
  private zoneManager!: ZoneManager;
  private buildPhaseManager!: BuildPhaseManager;
  private ceremonyManager!: CeremonyManager;
  private metricsCollector!: MetricsCollector;

  private taskIdCounter = 0;
  private initialized = false;

  constructor(logger: Logger, config: SocietyEngineConfig = {}) {
    this.logger = logger;
    this.config = config;
  }

  // ── Lifecycle ───────────────────────────────────────────────────

  /**
   * Initialize the engine: create SQLite tables (if needed) and
   * instantiate all sub-components with persistence callbacks wired
   * to the database.
   */
  async initialize(db: SocietyDatabase): Promise<void> {
    this.db = db;
    this.ensureSchema();

    const civId = this.config.civilizationId ?? 'default';

    // TaskQueue — persist via tasks table
    this.taskQueue = new TaskQueue(this.logger, (tasks) => {
      for (const t of tasks) {
        this.upsertTask(t);
      }
    });

    // DependencyGraph — persist edges
    this.dependencyGraph = new DependencyGraph(this.logger, (edges) => {
      this.persistDependencyEdges(edges);
    });

    // ResourceTracker
    this.resourceTracker = new ResourceTracker({
      logger: this.logger,
      thresholds: this.config.resourceThresholds ?? [],
      onResourcePersist: (resourceType, level) => {
        this.upsertResource(civId, resourceType, level);
      },
      onTransactionPersist: (txn) => {
        this.insertTransaction(txn);
      },
    });

    // ZoneManager
    this.zoneManager = new ZoneManager({
      logger: this.logger,
      onZonePersist: (zone) => {
        this.upsertZone(zone);
      },
      onZoneDelete: (zoneId) => {
        this.deleteZoneRow(zoneId);
      },
    });

    // BuildPhaseManager
    this.buildPhaseManager = new BuildPhaseManager({
      logger: this.logger,
      onPhasePersist: (phase) => {
        this.upsertPhase(phase);
      },
    });

    // CeremonyManager
    this.ceremonyManager = new CeremonyManager({
      logger: this.logger,
      onCeremonyPersist: (ceremony) => {
        this.upsertCeremony(ceremony);
      },
    });

    // MetricsCollector
    this.metricsCollector = new MetricsCollector({
      logger: this.logger,
      persist: (entry) => {
        this.insertMetric(entry);
      },
    });

    this.initialized = true;
    this.logger.info('SocietyEngine initialized', { civilizationId: civId });
  }

  // ── Task operations ─────────────────────────────────────────────

  /**
   * Create a task: enqueue in TaskQueue and register in DependencyGraph.
   * Requirement 3.10 — persist planning state.
   */
  createTask(definition: TaskDefinition): Task {
    this.assertInitialized();

    this.taskIdCounter += 1;
    const now = new Date().toISOString();

    const task: Task = {
      id: `task-${this.taskIdCounter}`,
      type: definition.type,
      status: 'pending',
      priority: definition.priority,
      civilizationId: definition.civilizationId,
      description: definition.description,
      dependencies: definition.dependencies ?? [],
      ...(definition.agentId !== undefined ? { agentId: definition.agentId } : {}),
      createdAt: now,
      updatedAt: now,
    };

    // Register in dependency graph first
    this.dependencyGraph.addTask(task.id);
    for (const dep of task.dependencies) {
      if (this.dependencyGraph.hasTask(dep)) {
        this.dependencyGraph.addDependency(task.id, dep);
      }
    }

    // Enqueue in task queue
    this.taskQueue.enqueue(task);

    this.logger.info('Task created', { taskId: task.id, type: task.type });
    return task;
  }

  /**
   * Assign the highest-priority pending task to an agent.
   * Returns the assigned task or undefined if none available.
   */
  assignTask(agentId: string): Task | undefined {
    this.assertInitialized();

    const task = this.taskQueue.dequeue(agentId);
    if (task) {
      this.logger.info('Task assigned', { taskId: task.id, agentId });
    }
    return task;
  }

  /**
   * Complete a task: mark in TaskQueue, DependencyGraph, and record metric.
   * Requirement 3.11 — update progress metrics and resource counts.
   */
  completeTask(taskId: string, result: TaskResult): void {
    this.assertInitialized();

    // Update task in queue
    const task = this.taskQueue.getTask(taskId);
    if (task) {
      task.status = result.success ? 'completed' : 'failed';
      task.updatedAt = new Date().toISOString();
      this.upsertTask(task);
    }

    // Update dependency graph
    if (result.success) {
      this.dependencyGraph.markComplete(taskId);
    } else {
      this.dependencyGraph.markFailed(taskId);
    }

    // Record metric
    const role = task?.agentId ?? 'unknown';
    this.metricsCollector.recordTaskCompletion(role);

    this.logger.info('Task completed', {
      taskId,
      success: result.success,
      outcome: result.outcome,
    });
  }

  /**
   * Get recommended tasks — tasks whose dependencies are all satisfied.
   */
  getRecommendations(): Task[] {
    this.assertInitialized();

    const readyIds = this.dependencyGraph.getReadyTasks();
    const tasks: Task[] = [];

    for (const id of readyIds) {
      const task = this.taskQueue.getTask(id);
      if (task && task.status === 'pending') {
        tasks.push(task);
      }
    }

    return tasks;
  }

  // ── Resource operations ─────────────────────────────────────────

  /**
   * Update a resource level. Delegates to ResourceTracker.
   */
  updateResource(type: string, delta: number, reason: string): void {
    this.assertInitialized();
    this.resourceTracker.update(type, delta, reason);

    // Track consumption in metrics when delta is negative
    if (delta < 0) {
      this.metricsCollector.recordResourceConsumption(type, Math.abs(delta));
    }
  }

  // ── Zone operations ─────────────────────────────────────────────

  /**
   * Define a spatial zone. Delegates to ZoneManager.
   */
  defineZone(zone: Zone): Zone {
    this.assertInitialized();
    this.zoneManager.defineZone(zone);
    return this.zoneManager.getZone(zone.id)!;
  }

  // ── Build operations ────────────────────────────────────────────

  /**
   * Start a build sequence from a blueprint. Delegates to BuildPhaseManager.
   */
  startBuildSequence(blueprint: Blueprint): BuildPhase[] {
    this.assertInitialized();

    const phases = this.buildPhaseManager.startBuildSequence(blueprint);

    // Set total blocks target in metrics
    this.metricsCollector.setTotalBlocks(blueprint.placements.length);

    this.logger.info('Build sequence started', {
      blueprintId: blueprint.id,
      phaseCount: phases.length,
    });

    return phases;
  }

  // ── Ceremony operations ─────────────────────────────────────────

  /**
   * Schedule a ceremony. Delegates to CeremonyManager.
   */
  scheduleCeremony(ceremony: Ceremony): Ceremony {
    this.assertInitialized();
    this.ceremonyManager.scheduleCeremony(ceremony);
    return this.ceremonyManager.getCeremony(ceremony.id)!;
  }

  // ── Metrics ─────────────────────────────────────────────────────

  /**
   * Get current metrics snapshot. Delegates to MetricsCollector.
   */
  getMetrics(): SocietyMetrics {
    this.assertInitialized();
    return this.metricsCollector.getMetrics();
  }

  // ── Sub-component accessors for advanced usage ──────────────────

  getTaskQueue(): TaskQueue {
    this.assertInitialized();
    return this.taskQueue;
  }

  getDependencyGraph(): DependencyGraph {
    this.assertInitialized();
    return this.dependencyGraph;
  }

  getResourceTracker(): ResourceTracker {
    this.assertInitialized();
    return this.resourceTracker;
  }

  getZoneManager(): ZoneManager {
    this.assertInitialized();
    return this.zoneManager;
  }

  getBuildPhaseManager(): BuildPhaseManager {
    this.assertInitialized();
    return this.buildPhaseManager;
  }

  getCeremonyManager(): CeremonyManager {
    this.assertInitialized();
    return this.ceremonyManager;
  }

  getMetricsCollector(): MetricsCollector {
    this.assertInitialized();
    return this.metricsCollector;
  }

  // ── Private: schema & persistence ─────────────────────────────

  private assertInitialized(): void {
    if (!this.initialized) {
      throw new Error('SocietyEngine has not been initialized. Call initialize(db) first.');
    }
  }

  /**
   * Create the SQLite tables used by SocietyEngine if they don't exist.
   * Requirement 3.10 — persist all planning state to SQLite.
   */
  private ensureSchema(): void {
    this.db!.exec(`
      CREATE TABLE IF NOT EXISTS se_tasks (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        status TEXT NOT NULL,
        priority TEXT NOT NULL,
        agent_id TEXT,
        civilization_id TEXT NOT NULL,
        description TEXT NOT NULL,
        dependencies TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS se_task_dependencies (
        task_id TEXT NOT NULL,
        depends_on TEXT NOT NULL,
        PRIMARY KEY (task_id, depends_on)
      );

      CREATE TABLE IF NOT EXISTS se_resources (
        civilization_id TEXT NOT NULL,
        resource_type TEXT NOT NULL,
        level REAL NOT NULL DEFAULT 0,
        PRIMARY KEY (civilization_id, resource_type)
      );

      CREATE TABLE IF NOT EXISTS se_resource_transactions (
        id TEXT PRIMARY KEY,
        resource_type TEXT NOT NULL,
        delta REAL NOT NULL,
        before_quantity REAL NOT NULL,
        after_quantity REAL NOT NULL,
        reason TEXT NOT NULL,
        civilization_id TEXT NOT NULL,
        timestamp TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS se_zones (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        min_x REAL NOT NULL,
        min_y REAL NOT NULL,
        min_z REAL NOT NULL,
        max_x REAL NOT NULL,
        max_y REAL NOT NULL,
        max_z REAL NOT NULL,
        civilization_id TEXT NOT NULL,
        assigned_agents TEXT NOT NULL DEFAULT '[]'
      );

      CREATE TABLE IF NOT EXISTS se_build_phases (
        id TEXT PRIMARY KEY,
        blueprint_id TEXT NOT NULL,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        status TEXT NOT NULL,
        placements TEXT NOT NULL,
        resource_requirements TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS se_ceremonies (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        name TEXT NOT NULL,
        scheduled_at TEXT NOT NULL,
        status TEXT NOT NULL,
        civilization_id TEXT NOT NULL,
        temple_zone_id TEXT NOT NULL,
        assigned_priests TEXT NOT NULL DEFAULT '[]',
        requires_approval INTEGER NOT NULL DEFAULT 0,
        effects TEXT NOT NULL DEFAULT '[]'
      );

      CREATE TABLE IF NOT EXISTS se_metrics (
        id TEXT PRIMARY KEY,
        metric_name TEXT NOT NULL,
        value REAL NOT NULL,
        tags TEXT NOT NULL,
        timestamp TEXT NOT NULL
      );
    `);
  }

  private upsertTask(task: Task): void {
    this.db!.prepare(`
      INSERT OR REPLACE INTO se_tasks
        (id, type, status, priority, agent_id, civilization_id, description, dependencies, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      task.id,
      task.type,
      task.status,
      task.priority,
      task.agentId ?? null,
      task.civilizationId,
      task.description,
      JSON.stringify(task.dependencies),
      task.createdAt,
      task.updatedAt,
    );
  }

  private persistDependencyEdges(edges: Array<{ taskId: string; dependsOn: string }>): void {
    this.db!.exec('DELETE FROM se_task_dependencies');
    const stmt = this.db!.prepare(
      'INSERT INTO se_task_dependencies (task_id, depends_on) VALUES (?, ?)',
    );
    for (const edge of edges) {
      stmt.run(edge.taskId, edge.dependsOn);
    }
  }

  private upsertResource(civId: string, resourceType: string, level: number): void {
    this.db!.prepare(`
      INSERT OR REPLACE INTO se_resources (civilization_id, resource_type, level)
      VALUES (?, ?, ?)
    `).run(civId, resourceType, level);
  }

  private insertTransaction(txn: {
    id: string;
    resourceType: string;
    delta: number;
    beforeQuantity: number;
    afterQuantity: number;
    reason: string;
    civilizationId: string;
    timestamp: string;
  }): void {
    this.db!.prepare(`
      INSERT INTO se_resource_transactions
        (id, resource_type, delta, before_quantity, after_quantity, reason, civilization_id, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      txn.id,
      txn.resourceType,
      txn.delta,
      txn.beforeQuantity,
      txn.afterQuantity,
      txn.reason,
      txn.civilizationId,
      txn.timestamp,
    );
  }

  private upsertZone(zone: Zone): void {
    this.db!.prepare(`
      INSERT OR REPLACE INTO se_zones
        (id, name, type, min_x, min_y, min_z, max_x, max_y, max_z, civilization_id, assigned_agents)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      zone.id,
      zone.name,
      zone.type,
      zone.min.x,
      zone.min.y,
      zone.min.z,
      zone.max.x,
      zone.max.y,
      zone.max.z,
      zone.civilizationId,
      JSON.stringify(zone.assignedAgents),
    );
  }

  private deleteZoneRow(zoneId: string): void {
    this.db!.prepare('DELETE FROM se_zones WHERE id = ?').run(zoneId);
  }

  private upsertPhase(phase: BuildPhase): void {
    this.db!.prepare(`
      INSERT OR REPLACE INTO se_build_phases
        (id, blueprint_id, name, type, status, placements, resource_requirements)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      phase.id,
      phase.blueprintId,
      phase.name,
      phase.type,
      phase.status,
      JSON.stringify(phase.placements),
      JSON.stringify(phase.resourceRequirements),
    );
  }

  private upsertCeremony(ceremony: Ceremony): void {
    this.db!.prepare(`
      INSERT OR REPLACE INTO se_ceremonies
        (id, type, name, scheduled_at, status, civilization_id, temple_zone_id, assigned_priests, requires_approval, effects)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      ceremony.id,
      ceremony.type,
      ceremony.name,
      ceremony.scheduledAt,
      ceremony.status,
      ceremony.civilizationId,
      ceremony.templeZoneId,
      JSON.stringify(ceremony.assignedPriests),
      ceremony.requiresApproval ? 1 : 0,
      JSON.stringify(ceremony.effects),
    );
  }

  private insertMetric(entry: {
    id: string;
    metricName: string;
    value: number;
    tags: string;
    timestamp: string;
  }): void {
    this.db!.prepare(`
      INSERT INTO se_metrics (id, metric_name, value, tags, timestamp)
      VALUES (?, ?, ?, ?, ?)
    `).run(entry.id, entry.metricName, entry.value, entry.tags, entry.timestamp);
  }
}
