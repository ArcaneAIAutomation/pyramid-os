import Database from 'better-sqlite3';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createPyramidError } from '@pyramid-os/shared-types';
import { migration001, type Migration } from './migrations/001_initial_schema.js';

import type { PyramidError } from '@pyramid-os/shared-types';

export interface IntegrityReport {
  ok: boolean;
  messages: string[];
  /** Present when integrity check fails */
  pyramidError?: PyramidError;
}

const ALL_MIGRATIONS: Migration[] = [migration001];

export class DatabaseManager {
  private db: Database.Database | null = null;
  private dbPath: string = '';

  /**
   * Opens the database, enables WAL mode, and creates the migrations table.
   * Requirements: 10.1, 10.6
   */
  initialize(dbPath: string, _poolSize?: number): void {
    this.dbPath = dbPath;

    // Ensure parent directory exists
    const dir = path.dirname(dbPath);
    if (dir && dir !== '.') {
      fs.mkdirSync(dir, { recursive: true });
    }

    try {
      this.db = new Database(dbPath);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.toLowerCase().includes('locked') || message.toLowerCase().includes('busy')) {
        throw createPyramidError(
          'PYRAMID_DATABASE_LOCKED',
          { dbPath },
          err instanceof Error ? err : undefined,
        );
      }
      throw err;
    }

    // Enable WAL mode for better concurrent read performance
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');

    // Create migrations tracking table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS migrations (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
    `);
  }

  /**
   * Runs all pending migrations in order.
   * Requirements: 10.2, 10.5
   */
  migrate(): void {
    const db = this.getDb();

    const applied = db
      .prepare('SELECT id FROM migrations')
      .all() as { id: string }[];
    const appliedIds = new Set(applied.map((r) => r.id));

    const pending = ALL_MIGRATIONS.filter((m) => !appliedIds.has(m.id));

    if (pending.length === 0) {
      return;
    }

    const insertMigration = db.prepare(
      'INSERT INTO migrations (id, name, applied_at) VALUES (?, ?, ?)'
    );

    const runAll = db.transaction(() => {
      for (const migration of pending) {
        migration.up(db);
        insertMigration.run(migration.id, migration.name, new Date().toISOString());
      }
    });

    runAll();
  }

  /**
   * Copies the DB file to backupPath before migrations.
   * Requirements: 10.5
   */
  backup(backupPath: string): void {
    if (!this.dbPath) {
      throw new Error('DatabaseManager not initialized');
    }

    if (!fs.existsSync(this.dbPath)) {
      throw new Error(`Database file not found: ${this.dbPath}`);
    }

    const backupDir = path.dirname(backupPath);
    if (backupDir && backupDir !== '.') {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    fs.copyFileSync(this.dbPath, backupPath);
  }

  /**
   * Runs SQLite PRAGMA integrity_check and returns a report.
   * Requirements: 10.8
   */
  verifyIntegrity(): IntegrityReport {
    const db = this.getDb();
    const rows = db.pragma('integrity_check') as { integrity_check: string }[];
    const messages = rows.map((r) => r.integrity_check);
    const ok = messages.length === 1 && messages[0] === 'ok';
    if (!ok) {
      const pyramidError = createPyramidError(
        'PYRAMID_DATABASE_INTEGRITY',
        { dbPath: this.dbPath, messages },
      );
      return { ok, messages, pyramidError };
    }
    return { ok, messages };
  }

  /**
   * Returns the underlying better-sqlite3 Database instance.
   */
  getDb(): Database.Database {
    if (!this.db) {
      throw new Error('DatabaseManager not initialized. Call initialize() first.');
    }
    return this.db;
  }

  /**
   * Closes the database connection.
   */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}
