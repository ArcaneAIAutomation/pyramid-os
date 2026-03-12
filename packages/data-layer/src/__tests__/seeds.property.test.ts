/**
 * Property-based test for seed data validity.
 *
 * Property 22: Seed data produces valid state — for every seed scenario,
 * all agent roles/tiers/statuses are valid, all task statuses/priorities are valid,
 * all resource quantities are non-negative, all zone bounds have min <= max,
 * and civilizations have non-empty id and name.
 *
 * **Validates: Requirements 44.5**
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { SEED_SCENARIOS } from '../seeds/scenarios.js';
import type { SeedScenario } from '../seeds/scenarios.js';
import type {
  AgentRole,
  AgentTier,
  AgentStatus,
  TaskStatus,
  TaskPriority,
} from '@pyramid-os/shared-types';

// ─── Valid enum values from shared-types ──────────────────────────────────────

const VALID_AGENT_ROLES: AgentRole[] = [
  'pharaoh', 'vizier', 'architect',
  'scribe', 'bot-foreman', 'defense', 'ops', 'ui-master',
  'builder', 'quarry', 'hauler', 'guard', 'farmer', 'priest',
];

const VALID_AGENT_TIERS: AgentTier[] = ['planner', 'operational', 'worker'];

const VALID_AGENT_STATUSES: AgentStatus[] = ['active', 'idle', 'error', 'stopped'];

const VALID_TASK_STATUSES: TaskStatus[] = [
  'pending', 'assigned', 'in_progress', 'completed', 'failed', 'blocked',
];

const VALID_TASK_PRIORITIES: TaskPriority[] = ['critical', 'high', 'normal', 'low'];

// ─── Scenario names as fast-check arbitrary ───────────────────────────────────

const scenarioNames = Object.keys(SEED_SCENARIOS);
const scenarioNameArb = fc.constantFrom(...scenarioNames);

// ─── Property test ────────────────────────────────────────────────────────────

describe('Seed data validity property', () => {
  it('every seed scenario has a civilization with non-empty id and name', () => {
    fc.assert(
      fc.property(scenarioNameArb, (name) => {
        const scenario: SeedScenario = SEED_SCENARIOS[name]!;
        expect(scenario.civilization.id).toBeTruthy();
        expect(scenario.civilization.name).toBeTruthy();
        expect(scenario.civilization.id.length).toBeGreaterThan(0);
        expect(scenario.civilization.name.length).toBeGreaterThan(0);
      }),
      { numRuns: scenarioNames.length * 5 },
    );
  });

  it('all agent roles are valid AgentRole values', () => {
    fc.assert(
      fc.property(scenarioNameArb, (name) => {
        const scenario: SeedScenario = SEED_SCENARIOS[name]!;
        for (const agent of scenario.agents) {
          expect(VALID_AGENT_ROLES).toContain(agent.role);
        }
      }),
      { numRuns: scenarioNames.length * 5 },
    );
  });

  it('all agent tiers are valid AgentTier values', () => {
    fc.assert(
      fc.property(scenarioNameArb, (name) => {
        const scenario: SeedScenario = SEED_SCENARIOS[name]!;
        for (const agent of scenario.agents) {
          expect(VALID_AGENT_TIERS).toContain(agent.tier);
        }
      }),
      { numRuns: scenarioNames.length * 5 },
    );
  });

  it('all agent statuses are valid AgentStatus values', () => {
    fc.assert(
      fc.property(scenarioNameArb, (name) => {
        const scenario: SeedScenario = SEED_SCENARIOS[name]!;
        for (const agent of scenario.agents) {
          expect(VALID_AGENT_STATUSES).toContain(agent.status);
        }
      }),
      { numRuns: scenarioNames.length * 5 },
    );
  });

  it('all task statuses are valid TaskStatus values', () => {
    fc.assert(
      fc.property(scenarioNameArb, (name) => {
        const scenario: SeedScenario = SEED_SCENARIOS[name]!;
        for (const task of scenario.tasks) {
          expect(VALID_TASK_STATUSES).toContain(task.status);
        }
      }),
      { numRuns: scenarioNames.length * 5 },
    );
  });

  it('all task priorities are valid TaskPriority values', () => {
    fc.assert(
      fc.property(scenarioNameArb, (name) => {
        const scenario: SeedScenario = SEED_SCENARIOS[name]!;
        for (const task of scenario.tasks) {
          expect(VALID_TASK_PRIORITIES).toContain(task.priority);
        }
      }),
      { numRuns: scenarioNames.length * 5 },
    );
  });

  it('all resource quantities are non-negative', () => {
    fc.assert(
      fc.property(scenarioNameArb, (name) => {
        const scenario: SeedScenario = SEED_SCENARIOS[name]!;
        for (const resource of scenario.resources) {
          expect(resource.quantity).toBeGreaterThanOrEqual(0);
        }
      }),
      { numRuns: scenarioNames.length * 5 },
    );
  });

  it('all zone bounds have min <= max when present', () => {
    fc.assert(
      fc.property(scenarioNameArb, (name) => {
        const scenario: SeedScenario = SEED_SCENARIOS[name]!;
        for (const zone of scenario.zones) {
          if (zone.bounds) {
            expect(zone.bounds.min.x).toBeLessThanOrEqual(zone.bounds.max.x);
            expect(zone.bounds.min.y).toBeLessThanOrEqual(zone.bounds.max.y);
            expect(zone.bounds.min.z).toBeLessThanOrEqual(zone.bounds.max.z);
          }
        }
      }),
      { numRuns: scenarioNames.length * 5 },
    );
  });
});
