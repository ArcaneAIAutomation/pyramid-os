/**
 * Unit tests for CivilizationManager.
 * Tests create, list, delete, getActive, setActive methods.
 * Requirements: 32.1, 32.3, 32.4, 32.5, 32.7, 32.8, 32.10
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { DatabaseManager } from '../database.js';
import { CivilizationManager } from '../civilization.js';

let dbManager: DatabaseManager;
let civManager: CivilizationManager;

beforeEach(() => {
  dbManager = new DatabaseManager();
  dbManager.initialize(':memory:');
  dbManager.migrate();
  civManager = new CivilizationManager(dbManager.getDb());
});

describe('CivilizationManager', () => {
  describe('create', () => {
    it('creates a civilization with a generated ID', () => {
      const civ = civManager.create('Egypt');
      expect(civ.id).toMatch(/^civ-/);
      expect(civ.name).toBe('Egypt');
      expect(civ.createdAt).toBeTruthy();
    });

    it('trims whitespace from name', () => {
      const civ = civManager.create('  Egypt  ');
      expect(civ.name).toBe('Egypt');
    });

    it('throws on empty name', () => {
      expect(() => civManager.create('')).toThrow('non-empty');
      expect(() => civManager.create('   ')).toThrow('non-empty');
    });

    it('throws on duplicate name', () => {
      civManager.create('Egypt');
      expect(() => civManager.create('Egypt')).toThrow('already exists');
    });

    it('auto-sets first civilization as active', () => {
      const civ = civManager.create('Egypt');
      const active = civManager.getActive();
      expect(active).toBeDefined();
      expect(active!.id).toBe(civ.id);
    });

    it('does not change active when creating second civilization', () => {
      const first = civManager.create('Egypt');
      civManager.create('Rome');
      const active = civManager.getActive();
      expect(active!.id).toBe(first.id);
    });
  });

  describe('list', () => {
    it('returns empty array when no civilizations exist', () => {
      expect(civManager.list()).toEqual([]);
    });

    it('returns all civilizations in creation order', () => {
      civManager.create('Egypt');
      civManager.create('Rome');
      civManager.create('Greece');
      const list = civManager.list();
      expect(list).toHaveLength(3);
      expect(list.map((c) => c.name)).toEqual(['Egypt', 'Rome', 'Greece']);
    });
  });

  describe('findById / findByName', () => {
    it('finds civilization by ID', () => {
      const civ = civManager.create('Egypt');
      const found = civManager.findById(civ.id);
      expect(found).toBeDefined();
      expect(found!.name).toBe('Egypt');
    });

    it('finds civilization by name', () => {
      civManager.create('Egypt');
      const found = civManager.findByName('Egypt');
      expect(found).toBeDefined();
      expect(found!.name).toBe('Egypt');
    });

    it('returns undefined for non-existent ID', () => {
      expect(civManager.findById('nonexistent')).toBeUndefined();
    });

    it('returns undefined for non-existent name', () => {
      expect(civManager.findByName('nonexistent')).toBeUndefined();
    });
  });

  describe('delete', () => {
    it('deletes a non-active civilization', () => {
      const first = civManager.create('Egypt');
      const second = civManager.create('Rome');
      civManager.setActive(first.id);
      civManager.delete(second.id);
      expect(civManager.list()).toHaveLength(1);
      expect(civManager.findById(second.id)).toBeUndefined();
    });

    it('throws when deleting the active civilization', () => {
      const civ = civManager.create('Egypt');
      expect(() => civManager.delete(civ.id)).toThrow('Cannot delete the active');
    });

    it('throws when deleting non-existent civilization', () => {
      expect(() => civManager.delete('nonexistent')).toThrow('not found');
    });

    it('cascades deletion to scoped data', () => {
      const civ = civManager.create('Egypt');
      const second = civManager.create('Rome');
      civManager.setActive(second.id);

      // Insert some scoped data for Egypt
      const db = dbManager.getDb();
      db.prepare(
        'INSERT INTO agents (id, role, tier, status, civilization_id, created_at, last_active_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run('a1', 'builder', 'worker', 'active', civ.id, new Date().toISOString(), new Date().toISOString());
      db.prepare(
        'INSERT INTO resources (id, type, quantity, civilization_id) VALUES (?, ?, ?, ?)',
      ).run('r1', 'sandstone', 100, civ.id);

      civManager.delete(civ.id);

      // Verify scoped data is gone
      const agents = db.prepare('SELECT * FROM agents WHERE civilization_id = ?').all(civ.id);
      const resources = db.prepare('SELECT * FROM resources WHERE civilization_id = ?').all(civ.id);
      expect(agents).toHaveLength(0);
      expect(resources).toHaveLength(0);
    });
  });

  describe('getActive / setActive', () => {
    it('returns undefined when no active civilization', () => {
      expect(civManager.getActive()).toBeUndefined();
    });

    it('switches active civilization', () => {
      const egypt = civManager.create('Egypt');
      const rome = civManager.create('Rome');

      civManager.setActive(rome.id);
      expect(civManager.getActive()!.id).toBe(rome.id);

      civManager.setActive(egypt.id);
      expect(civManager.getActive()!.id).toBe(egypt.id);
    });

    it('throws when setting active to non-existent ID', () => {
      expect(() => civManager.setActive('nonexistent')).toThrow('not found');
    });
  });

  describe('getActiveCivilizationId', () => {
    it('returns the active civilization ID', () => {
      const civ = civManager.create('Egypt');
      expect(civManager.getActiveCivilizationId()).toBe(civ.id);
    });

    it('throws when no active civilization', () => {
      expect(() => civManager.getActiveCivilizationId()).toThrow('No active civilization');
    });
  });

  describe('isolation between civilizations (Req 32.1, 32.6)', () => {
    it('scoped data belongs only to its civilization', () => {
      const egypt = civManager.create('Egypt');
      const rome = civManager.create('Rome');

      const db = dbManager.getDb();
      db.prepare(
        'INSERT INTO agents (id, role, tier, status, civilization_id, created_at, last_active_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run('a-egypt', 'builder', 'worker', 'active', egypt.id, new Date().toISOString(), new Date().toISOString());
      db.prepare(
        'INSERT INTO agents (id, role, tier, status, civilization_id, created_at, last_active_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run('a-rome', 'guard', 'worker', 'active', rome.id, new Date().toISOString(), new Date().toISOString());

      const egyptAgents = db.prepare('SELECT * FROM agents WHERE civilization_id = ?').all(egypt.id);
      const romeAgents = db.prepare('SELECT * FROM agents WHERE civilization_id = ?').all(rome.id);

      expect(egyptAgents).toHaveLength(1);
      expect(romeAgents).toHaveLength(1);
      expect((egyptAgents[0] as { id: string }).id).toBe('a-egypt');
      expect((romeAgents[0] as { id: string }).id).toBe('a-rome');
    });
  });
});
