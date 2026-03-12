/**
 * Unit tests for the seed data system.
 * Requirements: 44.2, 44.5
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MockDatabase } from '../__mocks__/mock-database.js';
import {
  SEED_SCENARIOS,
  emptyScenario,
  basicScenario,
  midBuildScenario,
  lowResourcesScenario,
  fullSocietyScenario,
  failureModeScenario,
} from '../seeds/scenarios.js';
import { loadSeed, getScenario, listScenarios } from '../seeds/loader.js';
import type { SeedScenario } from '../seeds/scenarios.js';

describe('Seed scenarios', () => {
  it('defines exactly 6 scenarios', () => {
    expect(Object.keys(SEED_SCENARIOS)).toHaveLength(6);
  });

  it('listScenarios returns all 6 names', () => {
    const names = listScenarios();
    expect(names).toEqual(
      expect.arrayContaining([
        'empty', 'basic', 'mid-build', 'low-resources', 'full-society', 'failure-mode',
      ]),
    );
    expect(names).toHaveLength(6);
  });

  it('getScenario returns correct scenario by name', () => {
    expect(getScenario('basic')).toBe(basicScenario);
    expect(getScenario('empty')).toBe(emptyScenario);
    expect(getScenario('mid-build')).toBe(midBuildScenario);
    expect(getScenario('low-resources')).toBe(lowResourcesScenario);
    expect(getScenario('full-society')).toBe(fullSocietyScenario);
    expect(getScenario('failure-mode')).toBe(failureModeScenario);
  });

  it('getScenario returns undefined for unknown name', () => {
    expect(getScenario('nonexistent')).toBeUndefined();
  });

  it('each scenario has required fields', () => {
    for (const scenario of Object.values(SEED_SCENARIOS)) {
      expect(scenario.name).toBeTruthy();
      expect(scenario.description).toBeTruthy();
      expect(scenario.civilization).toBeDefined();
      expect(scenario.civilization.id).toBeTruthy();
      expect(scenario.civilization.name).toBeTruthy();
      expect(Array.isArray(scenario.agents)).toBe(true);
      expect(Array.isArray(scenario.blueprints)).toBe(true);
      expect(Array.isArray(scenario.resources)).toBe(true);
      expect(Array.isArray(scenario.zones)).toBe(true);
      expect(Array.isArray(scenario.tasks)).toBe(true);
    }
  });

  it('all agent seeds have valid roles and tiers', () => {
    const validRoles = [
      'pharaoh', 'vizier', 'architect',
      'scribe', 'bot-foreman', 'defense', 'ops', 'ui-master',
      'builder', 'quarry', 'hauler', 'guard', 'farmer', 'priest',
    ];
    const validTiers = ['planner', 'operational', 'worker'];
    const validStatuses = ['active', 'idle', 'error', 'stopped'];

    for (const scenario of Object.values(SEED_SCENARIOS)) {
      for (const agent of scenario.agents) {
        expect(validRoles).toContain(agent.role);
        expect(validTiers).toContain(agent.tier);
        expect(validStatuses).toContain(agent.status);
      }
    }
  });

  it('all resource seeds have non-negative quantities', () => {
    for (const scenario of Object.values(SEED_SCENARIOS)) {
      for (const resource of scenario.resources) {
        expect(resource.quantity).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('all task seeds have valid statuses and priorities', () => {
    const validStatuses = ['pending', 'assigned', 'in_progress', 'completed', 'failed', 'blocked'];
    const validPriorities = ['critical', 'high', 'normal', 'low'];
    const validTypes = ['build', 'mine', 'haul', 'farm', 'guard', 'ceremony', 'procure', 'repair'];

    for (const scenario of Object.values(SEED_SCENARIOS)) {
      for (const task of scenario.tasks) {
        expect(validStatuses).toContain(task.status);
        expect(validPriorities).toContain(task.priority);
        expect(validTypes).toContain(task.type);
      }
    }
  });

  it('zone bounds have min <= max when present', () => {
    for (const scenario of Object.values(SEED_SCENARIOS)) {
      for (const zone of scenario.zones) {
        if (zone.bounds) {
          expect(zone.bounds.min.x).toBeLessThanOrEqual(zone.bounds.max.x);
          expect(zone.bounds.min.y).toBeLessThanOrEqual(zone.bounds.max.y);
          expect(zone.bounds.min.z).toBeLessThanOrEqual(zone.bounds.max.z);
        }
      }
    }
  });
});

describe('loadSeed', () => {
  let db: MockDatabase;

  beforeEach(() => {
    db = new MockDatabase();
    db.initialize();
  });

  it('loads empty scenario without errors', () => {
    expect(() => loadSeed(emptyScenario, db)).not.toThrow();
    const civRepo = db.getRepository('civilizations');
    expect(civRepo.count()).toBe(1);
  });

  it('loads basic scenario with correct entity counts', () => {
    loadSeed(basicScenario, db);

    expect(db.getRepository('civilizations').count()).toBe(1);
    expect(db.getRepository('agents').count()).toBe(basicScenario.agents.length);
    expect(db.getRepository('resources').count()).toBe(basicScenario.resources.length);
    expect(db.getRepository('zones').count()).toBe(basicScenario.zones.length);
    expect(db.getRepository('tasks').count()).toBe(basicScenario.tasks.length);
  });

  it('loads mid-build scenario with blueprints', () => {
    loadSeed(midBuildScenario, db);

    expect(db.getRepository('blueprints').count()).toBe(midBuildScenario.blueprints.length);
    const bp = db.getRepository('blueprints').getById('bp-pyramid1');
    expect(bp).toBeDefined();
    expect((bp as Record<string, unknown>)['percent_complete']).toBe(40);
  });

  it('loads all 6 scenarios into separate databases without errors', () => {
    for (const scenario of Object.values(SEED_SCENARIOS)) {
      const freshDb = new MockDatabase();
      freshDb.initialize();
      expect(() => loadSeed(scenario, freshDb)).not.toThrow();
    }
  });

  it('populates civilization_id on all seeded entities', () => {
    loadSeed(midBuildScenario, db);
    const civId = midBuildScenario.civilization.id;

    const agents = db.getRepository('agents').list();
    for (const agent of agents) {
      expect((agent as Record<string, unknown>)['civilization_id']).toBe(civId);
    }

    const resources = db.getRepository('resources').list();
    for (const resource of resources) {
      expect((resource as Record<string, unknown>)['civilization_id']).toBe(civId);
    }
  });

  it('failure-mode scenario has agents in error/stopped states', () => {
    loadSeed(failureModeScenario, db);

    const agents = db.getRepository('agents').list();
    const statuses = agents.map((a) => (a as Record<string, unknown>)['status']);
    expect(statuses).toContain('error');
    expect(statuses).toContain('stopped');
  });

  it('low-resources scenario has resources with very low quantities', () => {
    loadSeed(lowResourcesScenario, db);

    const resources = db.getRepository('resources').list();
    for (const r of resources) {
      expect((r as Record<string, unknown>)['quantity']).toBeLessThanOrEqual(5);
    }
  });
});
