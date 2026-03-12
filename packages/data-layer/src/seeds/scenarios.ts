/**
 * Seed data scenarios for PYRAMID OS development and testing.
 * Each scenario provides a pre-configured civilization state.
 *
 * Requirements: 44.2, 44.5
 */

import type {
  AgentRole,
  AgentTier,
  AgentStatus,
  TaskType,
  TaskStatus,
  TaskPriority,
  ResourceType,
} from '@pyramid-os/shared-types';

/** Seed data for a civilization */
export interface CivilizationSeed {
  id: string;
  name: string;
}

/** Seed data for an agent */
export interface AgentSeed {
  id: string;
  role: AgentRole;
  tier: AgentTier;
  status: AgentStatus;
}

/** Seed data for a blueprint */
export interface BlueprintSeed {
  id: string;
  name: string;
  type: 'pyramid' | 'housing' | 'farm' | 'temple' | 'custom';
  totalBlocks: number;
  placedBlocks: number;
}

/** Seed data for a resource */
export interface ResourceSeed {
  id: string;
  type: ResourceType;
  quantity: number;
}

/** Seed data for a zone */
export interface ZoneSeed {
  id: string;
  name: string;
  type: string;
  bounds?: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } };
}

/** Seed data for a task */
export interface TaskSeed {
  id: string;
  type: TaskType;
  status: TaskStatus;
  priority: TaskPriority;
  description: string;
  agentId?: string;
  dependencies?: string[];
}

/** A complete seed scenario for development/testing */
export interface SeedScenario {
  name: string;
  description: string;
  civilization: CivilizationSeed;
  agents: AgentSeed[];
  blueprints: BlueprintSeed[];
  resources: ResourceSeed[];
  zones: ZoneSeed[];
  tasks: TaskSeed[];
}


// ── Scenario 1: empty ──

export const emptyScenario: SeedScenario = {
  name: 'empty',
  description: 'Fresh civilization, no agents or tasks',
  civilization: { id: 'civ-empty001', name: 'Empty Kingdom' },
  agents: [],
  blueprints: [],
  resources: [],
  zones: [],
  tasks: [],
};

// ── Scenario 2: basic ──

export const basicScenario: SeedScenario = {
  name: 'basic',
  description: '1 of each agent tier, basic resources, empty task queue',
  civilization: { id: 'civ-basic001', name: 'Basic Kingdom' },
  agents: [
    { id: 'agent-pharaoh', role: 'pharaoh', tier: 'planner', status: 'active' },
    { id: 'agent-foreman', role: 'bot-foreman', tier: 'operational', status: 'active' },
    { id: 'agent-builder', role: 'builder', tier: 'worker', status: 'idle' },
    { id: 'agent-quarry', role: 'quarry', tier: 'worker', status: 'idle' },
  ],
  blueprints: [],
  resources: [
    { id: 'res-sandstone', type: 'sandstone', quantity: 500 },
    { id: 'res-wood', type: 'wood', quantity: 200 },
    { id: 'res-food', type: 'food', quantity: 100 },
  ],
  zones: [
    {
      id: 'zone-spawn',
      name: 'Spawn Area',
      type: 'spawn',
      bounds: { min: { x: -10, y: 60, z: -10 }, max: { x: 10, y: 80, z: 10 } },
    },
  ],
  tasks: [],
};

// ── Scenario 3: mid-build ──

export const midBuildScenario: SeedScenario = {
  name: 'mid-build',
  description: 'Pyramid 40% complete, active workers, resource procurement in progress',
  civilization: { id: 'civ-midbld01', name: 'Mid-Build Kingdom' },
  agents: [
    { id: 'agent-pharaoh', role: 'pharaoh', tier: 'planner', status: 'active' },
    { id: 'agent-architect', role: 'architect', tier: 'planner', status: 'active' },
    { id: 'agent-foreman', role: 'bot-foreman', tier: 'operational', status: 'active' },
    { id: 'agent-builder1', role: 'builder', tier: 'worker', status: 'active' },
    { id: 'agent-quarry1', role: 'quarry', tier: 'worker', status: 'active' },
  ],
  blueprints: [
    { id: 'bp-pyramid1', name: 'Great Pyramid', type: 'pyramid', totalBlocks: 1000, placedBlocks: 400 },
  ],
  resources: [
    { id: 'res-sandstone', type: 'sandstone', quantity: 300 },
    { id: 'res-limestone', type: 'limestone', quantity: 150 },
    { id: 'res-gold', type: 'gold_block', quantity: 20 },
    { id: 'res-food', type: 'food', quantity: 80 },
    { id: 'res-tools', type: 'tools', quantity: 10 },
  ],
  zones: [
    {
      id: 'zone-build',
      name: 'Pyramid Site',
      type: 'construction',
      bounds: { min: { x: 0, y: 60, z: 0 }, max: { x: 50, y: 100, z: 50 } },
    },
    {
      id: 'zone-quarry',
      name: 'Stone Quarry',
      type: 'quarry',
      bounds: { min: { x: -100, y: 40, z: -100 }, max: { x: -60, y: 70, z: -60 } },
    },
  ],
  tasks: [
    { id: 'task-build1', type: 'build', status: 'in_progress', priority: 'high', description: 'Place pyramid layer 5', agentId: 'agent-builder1' },
    { id: 'task-mine1', type: 'mine', status: 'in_progress', priority: 'normal', description: 'Mine sandstone blocks', agentId: 'agent-quarry1' },
    { id: 'task-haul1', type: 'haul', status: 'pending', priority: 'normal', description: 'Transport sandstone to build site' },
  ],
};

// ── Scenario 4: low-resources ──

export const lowResourcesScenario: SeedScenario = {
  name: 'low-resources',
  description: 'Critical resource levels, procurement tasks pending',
  civilization: { id: 'civ-lowres01', name: 'Scarce Kingdom' },
  agents: [
    { id: 'agent-vizier', role: 'vizier', tier: 'planner', status: 'active' },
    { id: 'agent-foreman', role: 'bot-foreman', tier: 'operational', status: 'active' },
    { id: 'agent-quarry1', role: 'quarry', tier: 'worker', status: 'active' },
    { id: 'agent-farmer1', role: 'farmer', tier: 'worker', status: 'active' },
  ],
  blueprints: [],
  resources: [
    { id: 'res-sandstone', type: 'sandstone', quantity: 5 },
    { id: 'res-wood', type: 'wood', quantity: 3 },
    { id: 'res-food', type: 'food', quantity: 2 },
    { id: 'res-tools', type: 'tools', quantity: 1 },
  ],
  zones: [
    {
      id: 'zone-farm',
      name: 'Emergency Farm',
      type: 'farm',
      bounds: { min: { x: 20, y: 60, z: 20 }, max: { x: 40, y: 70, z: 40 } },
    },
  ],
  tasks: [
    { id: 'task-procure1', type: 'procure', status: 'pending', priority: 'critical', description: 'Procure sandstone urgently' },
    { id: 'task-farm1', type: 'farm', status: 'in_progress', priority: 'critical', description: 'Grow emergency food supply', agentId: 'agent-farmer1' },
    { id: 'task-mine1', type: 'mine', status: 'assigned', priority: 'high', description: 'Mine stone for tools', agentId: 'agent-quarry1' },
  ],
};

// ── Scenario 5: full-society ──

export const fullSocietyScenario: SeedScenario = {
  name: 'full-society',
  description: 'All agents active, multiple districts, ceremonies scheduled',
  civilization: { id: 'civ-fullsc01', name: 'Grand Kingdom' },
  agents: [
    { id: 'agent-pharaoh', role: 'pharaoh', tier: 'planner', status: 'active' },
    { id: 'agent-vizier', role: 'vizier', tier: 'planner', status: 'active' },
    { id: 'agent-architect', role: 'architect', tier: 'planner', status: 'active' },
    { id: 'agent-scribe', role: 'scribe', tier: 'operational', status: 'active' },
    { id: 'agent-foreman', role: 'bot-foreman', tier: 'operational', status: 'active' },
  ],
  blueprints: [
    { id: 'bp-pyramid1', name: 'Royal Pyramid', type: 'pyramid', totalBlocks: 2000, placedBlocks: 2000 },
    { id: 'bp-temple1', name: 'Sun Temple', type: 'temple', totalBlocks: 500, placedBlocks: 250 },
    { id: 'bp-housing1', name: 'Worker Housing', type: 'housing', totalBlocks: 300, placedBlocks: 300 },
  ],
  resources: [
    { id: 'res-sandstone', type: 'sandstone', quantity: 1000 },
    { id: 'res-limestone', type: 'limestone', quantity: 500 },
    { id: 'res-gold', type: 'gold_block', quantity: 100 },
    { id: 'res-wood', type: 'wood', quantity: 400 },
    { id: 'res-food', type: 'food', quantity: 300 },
  ],
  zones: [
    {
      id: 'zone-palace',
      name: 'Royal Palace',
      type: 'palace',
      bounds: { min: { x: 0, y: 60, z: 0 }, max: { x: 60, y: 100, z: 60 } },
    },
    {
      id: 'zone-temple',
      name: 'Temple District',
      type: 'temple',
      bounds: { min: { x: 70, y: 60, z: 0 }, max: { x: 110, y: 90, z: 40 } },
    },
  ],
  tasks: [
    { id: 'task-build-temple', type: 'build', status: 'in_progress', priority: 'high', description: 'Build Sun Temple walls' },
    { id: 'task-ceremony1', type: 'ceremony', status: 'pending', priority: 'normal', description: 'Pyramid dedication ceremony' },
    { id: 'task-guard1', type: 'guard', status: 'in_progress', priority: 'normal', description: 'Patrol palace perimeter' },
  ],
};

// ── Scenario 6: failure-mode ──

export const failureModeScenario: SeedScenario = {
  name: 'failure-mode',
  description: 'Simulates component failures for testing recovery',
  civilization: { id: 'civ-fail0001', name: 'Failing Kingdom' },
  agents: [
    { id: 'agent-pharaoh', role: 'pharaoh', tier: 'planner', status: 'error' },
    { id: 'agent-foreman', role: 'bot-foreman', tier: 'operational', status: 'error' },
    { id: 'agent-builder1', role: 'builder', tier: 'worker', status: 'stopped' },
  ],
  blueprints: [
    { id: 'bp-broken', name: 'Broken Pyramid', type: 'pyramid', totalBlocks: 800, placedBlocks: 100 },
  ],
  resources: [
    { id: 'res-sandstone', type: 'sandstone', quantity: 0 },
    { id: 'res-food', type: 'food', quantity: 0 },
    { id: 'res-tools', type: 'tools', quantity: 0 },
  ],
  zones: [
    {
      id: 'zone-ruins',
      name: 'Abandoned Site',
      type: 'construction',
      bounds: { min: { x: 0, y: 60, z: 0 }, max: { x: 30, y: 80, z: 30 } },
    },
  ],
  tasks: [
    { id: 'task-failed1', type: 'build', status: 'failed', priority: 'high', description: 'Place foundation blocks' },
    { id: 'task-blocked1', type: 'haul', status: 'blocked', priority: 'normal', description: 'Transport materials', dependencies: ['task-failed1'] },
  ],
};

/** All available seed scenarios indexed by name */
export const SEED_SCENARIOS: Record<string, SeedScenario> = {
  empty: emptyScenario,
  basic: basicScenario,
  'mid-build': midBuildScenario,
  'low-resources': lowResourcesScenario,
  'full-society': fullSocietyScenario,
  'failure-mode': failureModeScenario,
};
