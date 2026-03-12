/**
 * BotRepository — CRUD + filtering for BotInstance records.
 * Requirements: 10.1, 10.7
 */

import type Database from 'better-sqlite3';
import type { BotInstance } from '@pyramid-os/shared-types';
import { withRetry } from '../retry.js';

/** Extended bot type that includes civilizationId for persistence */
export type BotRecord = BotInstance & { civilizationId: string };

interface BotRow {
  id: string;
  role: string;
  status: string;
  connection_id: string;
  civilization_id: string;
  position: string | null;
  health: number | null;
}

function rowToBot(row: BotRow): BotRecord {
  const bot: BotRecord = {
    id: row.id,
    role: row.role as BotInstance['role'],
    status: row.status as BotInstance['status'],
    connectionId: row.connection_id,
    civilizationId: row.civilization_id,
  };

  if (row.position) {
    const parsed = JSON.parse(row.position) as BotInstance['position'];
    if (parsed !== undefined) {
      bot.position = parsed;
    }
  }
  if (row.health !== null) {
    bot.health = row.health;
  }

  return bot;
}

export class BotRepository {
  constructor(private readonly db: Database.Database) {}

  findById(id: string): BotRecord | undefined {
    const row = this.db
      .prepare<[string], BotRow>('SELECT * FROM bots WHERE id = ?')
      .get(id);
    return row ? rowToBot(row) : undefined;
  }

  findAll(filter?: { status?: string; civilizationId?: string }): BotRecord[] {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filter?.status) {
      conditions.push('status = ?');
      params.push(filter.status);
    }
    if (filter?.civilizationId) {
      conditions.push('civilization_id = ?');
      params.push(filter.civilizationId);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = this.db
      .prepare<unknown[], BotRow>(`SELECT * FROM bots ${where}`)
      .all(...params);
    return rows.map(rowToBot);
  }

  upsert(bot: BotRecord): void {
    withRetry(() => {
      this.db
        .prepare<[string, string, string, string, string, string | null, number | null]>(
          `INSERT OR REPLACE INTO bots
            (id, role, status, connection_id, civilization_id, position, health)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          bot.id,
          bot.role,
          bot.status,
          bot.connectionId,
          bot.civilizationId,
          bot.position ? JSON.stringify(bot.position) : null,
          bot.health ?? null
        );
    });
  }

  delete(id: string): void {
    withRetry(() => {
      this.db.prepare<[string]>('DELETE FROM bots WHERE id = ?').run(id);
    });
  }

  updateStatus(id: string, status: string): void {
    withRetry(() => {
      this.db
        .prepare<[string, string]>('UPDATE bots SET status = ? WHERE id = ?')
        .run(status, id);
    });
  }
}
