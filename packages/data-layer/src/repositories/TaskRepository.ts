/**
 * TaskRepository — CRUD + filtering + dependency edges for Task records.
 * Requirements: 10.1, 10.7
 */

import type Database from 'better-sqlite3';
import type { Task, TaskFilter, TaskStatus } from '@pyramid-os/shared-types';
import { withRetry } from '../retry.js';

interface TaskRow {
  id: string;
  type: string;
  status: string;
  priority: string;
  agent_id: string | null;
  civilization_id: string;
  description: string;
  created_at: string;
  updated_at: string;
}

interface DependencyRow {
  depends_on: string;
}

function rowToTask(row: TaskRow, dependencies: string[]): Task {
  const task: Task = {
    id: row.id,
    type: row.type as Task['type'],
    status: row.status as TaskStatus,
    priority: row.priority as Task['priority'],
    civilizationId: row.civilization_id,
    description: row.description,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    dependencies,
  };
  if (row.agent_id !== null) {
    task.agentId = row.agent_id;
  }
  return task;
}

export class TaskRepository {
  constructor(private readonly db: Database.Database) {}

  findById(id: string): Task | undefined {
    const row = this.db
      .prepare<[string], TaskRow>('SELECT * FROM tasks WHERE id = ?')
      .get(id);
    if (!row) return undefined;
    const deps = this.getDependencies(id);
    return rowToTask(row, deps);
  }

  findAll(filter?: TaskFilter): Task[] {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filter?.status) {
      conditions.push('status = ?');
      params.push(filter.status);
    }
    if (filter?.type) {
      conditions.push('type = ?');
      params.push(filter.type);
    }
    if (filter?.priority) {
      conditions.push('priority = ?');
      params.push(filter.priority);
    }
    if (filter?.agentId) {
      conditions.push('agent_id = ?');
      params.push(filter.agentId);
    }
    if (filter?.civilizationId) {
      conditions.push('civilization_id = ?');
      params.push(filter.civilizationId);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = this.db
      .prepare<unknown[], TaskRow>(`SELECT * FROM tasks ${where}`)
      .all(...params);

    return rows.map((row) => rowToTask(row, this.getDependencies(row.id)));
  }

  upsert(task: Task): void {
    withRetry(() => {
      this.db
        .prepare<[string, string, string, string, string | null, string, string, string, string]>(
          `INSERT OR REPLACE INTO tasks
            (id, type, status, priority, agent_id, civilization_id, description, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          task.id,
          task.type,
          task.status,
          task.priority,
          task.agentId ?? null,
          task.civilizationId,
          task.description,
          task.createdAt,
          task.updatedAt
        );
    });
  }

  delete(id: string): void {
    withRetry(() => {
      this.db.prepare<[string]>('DELETE FROM task_dependencies WHERE task_id = ?').run(id);
      this.db.prepare<[string]>('DELETE FROM tasks WHERE id = ?').run(id);
    });
  }

  updateStatus(id: string, status: TaskStatus): void {
    withRetry(() => {
      this.db
        .prepare<[string, string, string]>(
          'UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?'
        )
        .run(status, new Date().toISOString(), id);
    });
  }

  addDependency(taskId: string, dependsOn: string): void {
    withRetry(() => {
      this.db
        .prepare<[string, string]>(
          'INSERT OR IGNORE INTO task_dependencies (task_id, depends_on) VALUES (?, ?)'
        )
        .run(taskId, dependsOn);
    });
  }

  removeDependency(taskId: string, dependsOn: string): void {
    withRetry(() => {
      this.db
        .prepare<[string, string]>(
          'DELETE FROM task_dependencies WHERE task_id = ? AND depends_on = ?'
        )
        .run(taskId, dependsOn);
    });
  }

  getDependencies(taskId: string): string[] {
    const rows = this.db
      .prepare<[string], DependencyRow>(
        'SELECT depends_on FROM task_dependencies WHERE task_id = ?'
      )
      .all(taskId);
    return rows.map((r) => r.depends_on);
  }
}
