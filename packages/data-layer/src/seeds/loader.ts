/**
 * Seed data loader for PYRAMID OS.
 * Loads pre-configured scenarios into a MockDatabase or DatabaseManager.
 *
 * Requirements: 44.2, 44.5
 */

import { MockDatabase } from '../__mocks__/mock-database.js';
import { SEED_SCENARIOS, type SeedScenario } from './scenarios.js';

/**
 * Returns a scenario by name, or undefined if not found.
 */
export function getScenario(name: string): SeedScenario | undefined {
  return SEED_SCENARIOS[name];
}

/**
 * Returns all available scenario names.
 */
export function listScenarios(): string[] {
  return Object.keys(SEED_SCENARIOS);
}

/**
 * Database abstraction — supports both MockDatabase and any object
 * with a getRepository-like interface for seed loading.
 */
interface SeedableDatabase {
  initialize?(dbPath?: string, poolSize?: number): void;
  getRepository<T extends Record<string, unknown>>(name: string, idField?: string): {
    create(record: T): T;
  };
}

/**
 * Load a seed scenario into the given database.
 * Populates civilizations, agents, resources, zones, blueprints, and tasks.
 */
export function loadSeed(scenario: SeedScenario, db: SeedableDatabase): void {
  const civId = scenario.civilization.id;

  // Seed civilization
  const civRepo = db.getRepository<Record<string, unknown>>('civilizations');
  civRepo.create({
    id: civId,
    name: scenario.civilization.name,
    created_at: new Date().toISOString(),
  });

  // Seed agents
  const agentRepo = db.getRepository<Record<string, unknown>>('agents');
  for (const agent of scenario.agents) {
    agentRepo.create({
      id: agent.id,
      role: agent.role,
      tier: agent.tier,
      status: agent.status,
      civilization_id: civId,
      created_at: new Date().toISOString(),
      last_active_at: new Date().toISOString(),
    });
  }

  // Seed resources
  const resourceRepo = db.getRepository<Record<string, unknown>>('resources');
  for (const resource of scenario.resources) {
    resourceRepo.create({
      id: resource.id,
      type: resource.type,
      quantity: resource.quantity,
      civilization_id: civId,
    });
  }

  // Seed zones
  const zoneRepo = db.getRepository<Record<string, unknown>>('zones');
  for (const zone of scenario.zones) {
    zoneRepo.create({
      id: zone.id,
      name: zone.name,
      type: zone.type,
      civilization_id: civId,
      min_x: zone.bounds?.min.x ?? null,
      min_y: zone.bounds?.min.y ?? null,
      min_z: zone.bounds?.min.z ?? null,
      max_x: zone.bounds?.max.x ?? null,
      max_y: zone.bounds?.max.y ?? null,
      max_z: zone.bounds?.max.z ?? null,
    });
  }

  // Seed blueprints
  const bpRepo = db.getRepository<Record<string, unknown>>('blueprints');
  for (const bp of scenario.blueprints) {
    bpRepo.create({
      id: bp.id,
      name: bp.name,
      type: bp.type,
      civilization_id: civId,
      total_blocks: bp.totalBlocks,
      placed_blocks: bp.placedBlocks,
      percent_complete: bp.totalBlocks > 0
        ? Math.round((bp.placedBlocks / bp.totalBlocks) * 100)
        : 0,
    });
  }

  // Seed tasks
  const taskRepo = db.getRepository<Record<string, unknown>>('tasks');
  for (const task of scenario.tasks) {
    taskRepo.create({
      id: task.id,
      type: task.type,
      status: task.status,
      priority: task.priority,
      description: task.description,
      agent_id: task.agentId ?? null,
      civilization_id: civId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      dependencies: JSON.stringify(task.dependencies ?? []),
    });
  }
}
