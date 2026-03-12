/**
 * CivilizationManager — CRUD + active civilization switching.
 * Manages multiple civilization instances with isolated state.
 * Requirements: 32.1, 32.2, 32.3, 32.4, 32.5, 32.6, 32.9, 32.10
 */

import type Database from 'better-sqlite3';
import { withRetry } from './retry.js';

export interface Civilization {
  id: string;
  name: string;
  createdAt: string;
}

interface CivilizationRow {
  id: string;
  name: string;
  created_at: string;
}

interface ActiveCivRow {
  civilization_id: string;
}

function rowToCivilization(row: CivilizationRow): Civilization {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
  };
}

/**
 * Generates a short random ID for civilizations.
 */
function generateId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = 'civ-';
  for (let i = 0; i < 8; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

export class CivilizationManager {
  constructor(private readonly db: Database.Database) {
    // Ensure the active_civilization tracking table exists
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS active_civilization (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        civilization_id TEXT NOT NULL
      );
    `);
  }

  /**
   * Create a new civilization with the given name.
   * Returns the created civilization.
   * Requirements: 32.1, 32.7
   */
  create(name: string): Civilization {
    if (!name || name.trim().length === 0) {
      throw new Error('Civilization name must be non-empty');
    }

    // Check for duplicate names
    const existing = this.db
      .prepare<[string], CivilizationRow>(
        'SELECT * FROM civilizations WHERE name = ?',
      )
      .get(name.trim());

    if (existing) {
      throw new Error(`Civilization with name "${name.trim()}" already exists`);
    }

    const civ: Civilization = {
      id: generateId(),
      name: name.trim(),
      createdAt: new Date().toISOString(),
    };

    withRetry(() => {
      this.db
        .prepare<[string, string, string]>(
          'INSERT INTO civilizations (id, name, created_at) VALUES (?, ?, ?)',
        )
        .run(civ.id, civ.name, civ.createdAt);
    });

    // If this is the first civilization, set it as active
    const count = this.db
      .prepare('SELECT COUNT(*) as cnt FROM civilizations')
      .get() as { cnt: number };
    if (count.cnt === 1) {
      this.setActive(civ.id);
    }

    return civ;
  }

  /**
   * List all civilizations.
   * Requirements: 32.7
   */
  list(): Civilization[] {
    const rows = this.db
      .prepare<[], CivilizationRow>('SELECT * FROM civilizations ORDER BY created_at ASC')
      .all();
    return rows.map(rowToCivilization);
  }

  /**
   * Find a civilization by ID.
   */
  findById(id: string): Civilization | undefined {
    const row = this.db
      .prepare<[string], CivilizationRow>(
        'SELECT * FROM civilizations WHERE id = ?',
      )
      .get(id);
    return row ? rowToCivilization(row) : undefined;
  }

  /**
   * Find a civilization by name.
   */
  findByName(name: string): Civilization | undefined {
    const row = this.db
      .prepare<[string], CivilizationRow>(
        'SELECT * FROM civilizations WHERE name = ?',
      )
      .get(name);
    return row ? rowToCivilization(row) : undefined;
  }

  /**
   * Delete a civilization by ID.
   * Cannot delete the active civilization.
   * Requirements: 32.7
   */
  delete(id: string): void {
    const active = this.getActive();
    if (active && active.id === id) {
      throw new Error('Cannot delete the active civilization. Switch to another first.');
    }

    const existing = this.findById(id);
    if (!existing) {
      throw new Error(`Civilization not found: ${id}`);
    }

    withRetry(() => {
      const deleteAll = this.db.transaction(() => {
        // Delete all scoped data for this civilization
        this.db.prepare('DELETE FROM agents WHERE civilization_id = ?').run(id);
        this.db.prepare('DELETE FROM tasks WHERE civilization_id = ?').run(id);
        this.db.prepare('DELETE FROM resources WHERE civilization_id = ?').run(id);
        this.db.prepare('DELETE FROM resource_transactions WHERE civilization_id = ?').run(id);
        this.db.prepare('DELETE FROM zones WHERE civilization_id = ?').run(id);
        this.db.prepare('DELETE FROM blueprints WHERE civilization_id = ?').run(id);
        this.db.prepare('DELETE FROM build_phases WHERE civilization_id = ?').run(id);
        this.db.prepare('DELETE FROM bots WHERE civilization_id = ?').run(id);
        this.db.prepare('DELETE FROM ceremonies WHERE civilization_id = ?').run(id);
        this.db.prepare('DELETE FROM agent_messages WHERE civilization_id = ?').run(id);
        this.db.prepare('DELETE FROM metrics WHERE civilization_id = ?').run(id);
        this.db.prepare('DELETE FROM civilizations WHERE id = ?').run(id);
      });
      deleteAll();
    });
  }

  /**
   * Get the currently active civilization, or undefined if none is set.
   * Requirements: 32.3, 32.10
   */
  getActive(): Civilization | undefined {
    const row = this.db
      .prepare<[], ActiveCivRow>('SELECT civilization_id FROM active_civilization WHERE id = 1')
      .get();

    if (!row) return undefined;

    return this.findById(row.civilization_id);
  }

  /**
   * Set the active civilization by ID.
   * Requirements: 32.3, 32.8
   */
  setActive(id: string): void {
    const civ = this.findById(id);
    if (!civ) {
      throw new Error(`Civilization not found: ${id}`);
    }

    withRetry(() => {
      this.db
        .prepare<[string]>(
          'INSERT OR REPLACE INTO active_civilization (id, civilization_id) VALUES (1, ?)',
        )
        .run(id);
    });
  }

  /**
   * Get the active civilization ID, throwing if none is set.
   * Convenience method for scoping queries.
   */
  getActiveCivilizationId(): string {
    const active = this.getActive();
    if (!active) {
      throw new Error('No active civilization. Create one first with civilization create <name>.');
    }
    return active.id;
  }
}
