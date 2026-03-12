/**
 * Property-based test for JSON snapshot round-trip.
 *
 * Property: `import(export())` restores an equivalent system state —
 * all agents, tasks, resources, and blueprints match the original.
 *
 * **Validates: Requirements 10.11, 18.7**
 */

import { describe, it } from 'vitest';
import * as fc from 'fast-check';
import * as os from 'node:os';
import * as path from 'node:path';
import { DatabaseManager } from '../database.js';
import { SnapshotManager } from '../snapshot.js';
import type {
  AgentInstance,
  AgentRole,
  AgentTier,
  AgentStatus,
  Task,
  TaskType,
  TaskStatus,
  TaskPriority,
  Resource,
  ResourceType,
  Blueprint,
  BlockPlacement,
  JsonSnapshot,
} from '@pyramid-os/shared-types';

// ─── Fixed civilization ID ────────────────────────────────────────────────────

const CIV_ID = 'test-civ';

// ─── Arbitraries ─────────────────────────────────────────────────────────────

const agentRoles: AgentRole[] = [
  'pharaoh', 'vizier', 'architect',
  'scribe', 'bot-foreman', 'defense', 'ops', 'ui-master',
  'builder', 'quarry', 'hauler', 'guard', 'farmer', 'priest',
];

const tierForRole = (role: AgentRole): AgentTier => {
  if (['pharaoh', 'vizier', 'architect'].includes(role)) return 'planner';
  if (['scribe', 'bot-foreman', 'defense', 'ops', 'ui-master'].includes(role)) return 'operational';
  return 'worker';
};

const agentStatuses: AgentStatus[] = ['active', 'idle', 'error', 'stopped'];

const agentArb: fc.Arbitrary<AgentInstance> = fc.record({
  id: fc.uuid(),
  role: fc.constantFrom(...agentRoles),
  status: fc.constantFrom(...agentStatuses),
  civilizationId: fc.constant(CIV_ID),
  createdAt: fc.date({ min: new Date('2020-01-01'), max: new Date('2030-01-01') })
    .map((d) => d.toISOString()),
  lastActiveAt: fc.date({ min: new Date('2020-01-01'), max: new Date('2030-01-01') })
    .map((d) => d.toISOString()),
}).map((a) => ({ ...a, tier: tierForRole(a.role) }));

const taskTypes: TaskType[] = ['build', 'mine', 'haul', 'farm', 'guard', 'ceremony', 'procure', 'repair'];
const taskStatuses: TaskStatus[] = ['pending', 'assigned', 'in_progress', 'completed', 'failed', 'blocked'];
const taskPriorities: TaskPriority[] = ['critical', 'high', 'normal', 'low'];

const taskArb: fc.Arbitrary<Task> = fc.record({
  id: fc.uuid(),
  type: fc.constantFrom(...taskTypes),
  status: fc.constantFrom(...taskStatuses),
  priority: fc.constantFrom(...taskPriorities),
  civilizationId: fc.constant(CIV_ID),
  description: fc.string({ minLength: 1, maxLength: 100 }),
  createdAt: fc.date({ min: new Date('2020-01-01'), max: new Date('2030-01-01') })
    .map((d) => d.toISOString()),
  updatedAt: fc.date({ min: new Date('2020-01-01'), max: new Date('2030-01-01') })
    .map((d) => d.toISOString()),
  dependencies: fc.constant([]),
});

const resourceTypes: ResourceType[] = [
  'sandstone', 'limestone', 'gold_block', 'wood', 'food', 'tools', 'stone', 'iron',
];

const resourceArb: fc.Arbitrary<Resource> = fc.record({
  id: fc.uuid(),
  type: fc.constantFrom(...resourceTypes),
  quantity: fc.integer({ min: 0, max: 100_000 }),
  civilizationId: fc.constant(CIV_ID),
});

const blockPlacementArb: fc.Arbitrary<BlockPlacement> = fc.record({
  index: fc.nat({ max: 999 }),
  position: fc.record({
    x: fc.integer({ min: -1000, max: 1000 }),
    y: fc.integer({ min: 0, max: 256 }),
    z: fc.integer({ min: -1000, max: 1000 }),
  }),
  blockType: fc.constantFrom('minecraft:sandstone', 'minecraft:stone', 'minecraft:gold_block'),
  placed: fc.boolean(),
});

const blueprintArb: fc.Arbitrary<Blueprint> = fc.record({
  id: fc.uuid(),
  name: fc.string({ minLength: 1, maxLength: 50 }),
  version: fc.integer({ min: 1, max: 10 }),
  type: fc.constantFrom('pyramid', 'housing', 'farm', 'temple', 'custom') as fc.Arbitrary<Blueprint['type']>,
  dimensions: fc.record({
    width: fc.integer({ min: 1, max: 100 }),
    height: fc.integer({ min: 1, max: 100 }),
    depth: fc.integer({ min: 1, max: 100 }),
  }),
  metadata: fc.record({
    structureName: fc.string({ minLength: 1, maxLength: 50 }),
    dimensions: fc.record({
      width: fc.integer({ min: 1, max: 100 }),
      height: fc.integer({ min: 1, max: 100 }),
      depth: fc.integer({ min: 1, max: 100 }),
    }),
    requiredResources: fc.array(
      fc.record({ type: fc.string({ minLength: 1, maxLength: 30 }), count: fc.nat({ max: 10000 }) }),
      { minLength: 0, maxLength: 5 }
    ),
    estimatedTimeMinutes: fc.integer({ min: 1, max: 1440 }),
    createdAt: fc.date({ min: new Date('2020-01-01'), max: new Date('2030-01-01') })
      .map((d) => d.toISOString()),
    createdBy: fc.uuid(),
  }),
  placements: fc.array(blockPlacementArb, { minLength: 1, maxLength: 10 }),
  progress: fc.record({
    totalBlocks: fc.integer({ min: 1, max: 1000 }),
    placedBlocks: fc.integer({ min: 0, max: 1000 }),
    percentComplete: fc.float({ min: 0, max: 100, noNaN: true }),
    currentPhase: fc.string({ minLength: 1, maxLength: 30 }),
  }),
});

// ─── Snapshot arbitrary ───────────────────────────────────────────────────────

const snapshotArb: fc.Arbitrary<JsonSnapshot> = fc.record({
  version: fc.constant('1.0'),
  civilizationId: fc.constant(CIV_ID),
  exportedAt: fc.date({ min: new Date('2020-01-01'), max: new Date('2030-01-01') })
    .map((d) => d.toISOString()),
  agents: fc.array(agentArb, { minLength: 0, maxLength: 5 }),
  tasks: fc.array(taskArb, { minLength: 0, maxLength: 5 }),
  resources: fc.array(resourceArb, { minLength: 0, maxLength: 5 }),
  blueprints: fc.array(blueprintArb, { minLength: 0, maxLength: 3 }),
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalize<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function makeSnapshotManager(db: DatabaseManager): SnapshotManager {
  return new SnapshotManager(db, path.join(os.tmpdir(), 'snapshots'), CIV_ID);
}

// ─── Property test ────────────────────────────────────────────────────────────

describe('SnapshotManager round-trip property', () => {
  it('import(export()) restores equivalent state for all entity types', async () => {
    await fc.assert(
      fc.asyncProperty(snapshotArb, async (snapshot) => {
        // Fresh in-memory DB for each run
        const db = new DatabaseManager();
        db.initialize(':memory:');
        db.migrate();

        const manager = makeSnapshotManager(db);

        // Import the generated snapshot
        await manager.import(snapshot);

        // Export it back
        const exported = await manager.export();

        // Normalize both sides to handle undefined fields and floating-point quirks
        const original = normalize(snapshot);
        const result = normalize(exported);

        // Sort arrays by id for stable comparison
        const sortById = <T extends { id: string }>(arr: T[]): T[] =>
          [...arr].sort((a, b) => a.id.localeCompare(b.id));

        // Agents must match
        const origAgents = sortById(original.agents);
        const resAgents = sortById(result.agents);
        if (origAgents.length !== resAgents.length) return false;
        for (let i = 0; i < origAgents.length; i++) {
          const o = origAgents[i]!;
          const r = resAgents[i]!;
          if (
            o.id !== r.id ||
            o.role !== r.role ||
            o.tier !== r.tier ||
            o.status !== r.status ||
            o.civilizationId !== r.civilizationId ||
            o.createdAt !== r.createdAt ||
            o.lastActiveAt !== r.lastActiveAt
          ) return false;
        }

        // Tasks must match
        const origTasks = sortById(original.tasks);
        const resTasks = sortById(result.tasks);
        if (origTasks.length !== resTasks.length) return false;
        for (let i = 0; i < origTasks.length; i++) {
          const o = origTasks[i]!;
          const r = resTasks[i]!;
          if (
            o.id !== r.id ||
            o.type !== r.type ||
            o.status !== r.status ||
            o.priority !== r.priority ||
            o.civilizationId !== r.civilizationId ||
            o.description !== r.description
          ) return false;
        }

        // Resources must match
        const origResources = sortById(original.resources);
        const resResources = sortById(result.resources);
        if (origResources.length !== resResources.length) return false;
        for (let i = 0; i < origResources.length; i++) {
          const o = origResources[i]!;
          const r = resResources[i]!;
          if (
            o.id !== r.id ||
            o.type !== r.type ||
            o.quantity !== r.quantity ||
            o.civilizationId !== r.civilizationId
          ) return false;
        }

        // Blueprints must match
        const origBlueprints = sortById(original.blueprints);
        const resBlueprints = sortById(result.blueprints);
        if (origBlueprints.length !== resBlueprints.length) return false;
        for (let i = 0; i < origBlueprints.length; i++) {
          const o = origBlueprints[i]!;
          const r = resBlueprints[i]!;
          if (
            o.id !== r.id ||
            o.name !== r.name ||
            o.version !== r.version ||
            o.type !== r.type
          ) return false;
          // Check placements count
          if (o.placements.length !== r.placements.length) return false;
        }

        db.close();
        return true;
      }),
      { numRuns: 50 }
    );
  });
});
