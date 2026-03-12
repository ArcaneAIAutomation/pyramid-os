/**
 * AgentRepository — CRUD + filtering for AgentInstance records.
 * Requirements: 10.1, 10.7
 */

import type Database from 'better-sqlite3';
import type { AgentInstance, AgentFilter, AgentStatus } from '@pyramid-os/shared-types';
import { withRetry } from '../retry.js';

interface AgentRow {
  id: string;
  role: string;
  tier: string;
  status: string;
  civilization_id: string;
  created_at: string;
  last_active_at: string;
  workspace_state: string | null;
}

function rowToAgent(row: AgentRow): AgentInstance {
  return {
    id: row.id,
    role: row.role as AgentInstance['role'],
    tier: row.tier as AgentInstance['tier'],
    status: row.status as AgentStatus,
    civilizationId: row.civilization_id,
    createdAt: row.created_at,
    lastActiveAt: row.last_active_at,
  };
}

export class AgentRepository {
  constructor(private readonly db: Database.Database) {}

  findById(id: string): AgentInstance | undefined {
    const row = this.db
      .prepare<[string], AgentRow>('SELECT * FROM agents WHERE id = ?')
      .get(id);
    return row ? rowToAgent(row) : undefined;
  }

  findAll(filter?: AgentFilter): AgentInstance[] {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filter?.tier) {
      conditions.push('tier = ?');
      params.push(filter.tier);
    }
    if (filter?.role) {
      conditions.push('role = ?');
      params.push(filter.role);
    }
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
      .prepare<unknown[], AgentRow>(`SELECT * FROM agents ${where}`)
      .all(...params);
    return rows.map(rowToAgent);
  }

  upsert(agent: AgentInstance): void {
    withRetry(() => {
      this.db
        .prepare<[string, string, string, string, string, string, string]>(
          `INSERT OR REPLACE INTO agents
            (id, role, tier, status, civilization_id, created_at, last_active_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          agent.id,
          agent.role,
          agent.tier,
          agent.status,
          agent.civilizationId,
          agent.createdAt,
          agent.lastActiveAt
        );
    });
  }

  delete(id: string): void {
    withRetry(() => {
      this.db.prepare<[string]>('DELETE FROM agents WHERE id = ?').run(id);
    });
  }

  deleteByStatus(status: AgentStatus): number {
    return withRetry(() => {
      const result = this.db
        .prepare<[string]>('DELETE FROM agents WHERE status = ?')
        .run(status);
      return result.changes;
    });
  }

  updateStatus(id: string, status: AgentStatus): void {
    withRetry(() => {
      this.db
        .prepare<[string, string]>('UPDATE agents SET status = ? WHERE id = ?')
        .run(status, id);
    });
  }

  updateWorkspaceState(id: string, state: Record<string, unknown>): void {
    withRetry(() => {
      this.db
        .prepare<[string, string]>(
          'UPDATE agents SET workspace_state = ? WHERE id = ?'
        )
        .run(JSON.stringify(state), id);
    });
  }

  getWorkspaceState(id: string): Record<string, unknown> | undefined {
    const row = this.db
      .prepare<[string], Pick<AgentRow, 'workspace_state'>>(
        'SELECT workspace_state FROM agents WHERE id = ?'
      )
      .get(id);
    if (!row?.workspace_state) return undefined;
    try {
      return JSON.parse(row.workspace_state) as Record<string, unknown>;
    } catch {
      return undefined;
    }
  }
}
