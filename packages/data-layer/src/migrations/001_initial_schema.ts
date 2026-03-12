import type { Database } from 'better-sqlite3';

export interface Migration {
  id: string;
  name: string;
  up: (db: Database) => void;
}

export const migration001: Migration = {
  id: '001',
  name: 'initial_schema',
  up: (db: Database) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS civilizations (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        role TEXT NOT NULL,
        tier TEXT NOT NULL,
        status TEXT NOT NULL,
        civilization_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_active_at TEXT NOT NULL,
        workspace_state TEXT
      );

      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        status TEXT NOT NULL,
        priority TEXT NOT NULL,
        agent_id TEXT,
        civilization_id TEXT NOT NULL,
        description TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS task_dependencies (
        task_id TEXT NOT NULL,
        depends_on TEXT NOT NULL,
        PRIMARY KEY (task_id, depends_on)
      );

      CREATE TABLE IF NOT EXISTS resources (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        quantity REAL NOT NULL,
        civilization_id TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS resource_transactions (
        id TEXT PRIMARY KEY,
        resource_type TEXT NOT NULL,
        delta REAL NOT NULL,
        before_quantity REAL NOT NULL,
        after_quantity REAL NOT NULL,
        reason TEXT NOT NULL,
        civilization_id TEXT NOT NULL,
        timestamp TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS zones (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        civilization_id TEXT NOT NULL,
        min_x REAL,
        min_y REAL,
        min_z REAL,
        max_x REAL,
        max_y REAL,
        max_z REAL
      );

      CREATE TABLE IF NOT EXISTS blueprints (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        version INTEGER NOT NULL,
        type TEXT NOT NULL,
        civilization_id TEXT NOT NULL,
        metadata TEXT NOT NULL,
        placements TEXT NOT NULL,
        progress TEXT NOT NULL,
        dimensions TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS build_phases (
        id TEXT PRIMARY KEY,
        blueprint_id TEXT NOT NULL,
        phase_name TEXT NOT NULL,
        status TEXT NOT NULL,
        civilization_id TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS bots (
        id TEXT PRIMARY KEY,
        role TEXT NOT NULL,
        status TEXT NOT NULL,
        connection_id TEXT NOT NULL,
        civilization_id TEXT NOT NULL,
        position TEXT,
        health REAL
      );

      CREATE TABLE IF NOT EXISTS ceremonies (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        status TEXT NOT NULL,
        civilization_id TEXT NOT NULL,
        scheduled_at TEXT NOT NULL,
        completed_at TEXT
      );

      CREATE TABLE IF NOT EXISTS agent_messages (
        id TEXT PRIMARY KEY,
        from_agent TEXT NOT NULL,
        to_agent TEXT NOT NULL,
        content TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        correlation_id TEXT,
        civilization_id TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS health_checks (
        id TEXT PRIMARY KEY,
        component TEXT NOT NULL,
        status TEXT NOT NULL,
        checked_at TEXT NOT NULL,
        latency_ms REAL,
        details TEXT
      );

      CREATE TABLE IF NOT EXISTS security_incidents (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        violation_type TEXT NOT NULL,
        action TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        resolved INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS metrics (
        id TEXT PRIMARY KEY,
        metric_name TEXT NOT NULL,
        value REAL NOT NULL,
        tags TEXT,
        timestamp TEXT NOT NULL,
        civilization_id TEXT NOT NULL
      );
    `);
  },
};
