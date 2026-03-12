/**
 * ResourceRepository — CRUD + threshold filtering for Resource records.
 * Requirements: 10.1, 10.7
 */

import type Database from 'better-sqlite3';
import type { Resource, ResourceThreshold } from '@pyramid-os/shared-types';
import { withRetry } from '../retry.js';

interface ResourceRow {
  id: string;
  type: string;
  quantity: number;
  civilization_id: string;
}

function rowToResource(row: ResourceRow): Resource {
  return {
    id: row.id,
    type: row.type as Resource['type'],
    quantity: row.quantity,
    civilizationId: row.civilization_id,
  };
}

export class ResourceRepository {
  constructor(private readonly db: Database.Database) {}

  findById(id: string): Resource | undefined {
    const row = this.db
      .prepare<[string], ResourceRow>('SELECT * FROM resources WHERE id = ?')
      .get(id);
    return row ? rowToResource(row) : undefined;
  }

  findAll(civilizationId: string): Resource[] {
    const rows = this.db
      .prepare<[string], ResourceRow>(
        'SELECT * FROM resources WHERE civilization_id = ?'
      )
      .all(civilizationId);
    return rows.map(rowToResource);
  }

  /**
   * Returns resources whose quantity is below the threshold's minimum level.
   */
  findBelowThreshold(thresholds: ResourceThreshold[]): Resource[] {
    if (thresholds.length === 0) return [];

    const results: Resource[] = [];
    for (const threshold of thresholds) {
      const rows = this.db
        .prepare<[string, number], ResourceRow>(
          'SELECT * FROM resources WHERE type = ? AND quantity < ?'
        )
        .all(threshold.resourceType, threshold.minimum);
      results.push(...rows.map(rowToResource));
    }
    return results;
  }

  upsert(resource: Resource): void {
    withRetry(() => {
      this.db
        .prepare<[string, string, number, string]>(
          `INSERT OR REPLACE INTO resources (id, type, quantity, civilization_id)
           VALUES (?, ?, ?, ?)`
        )
        .run(resource.id, resource.type, resource.quantity, resource.civilizationId);
    });
  }

  delete(id: string): void {
    withRetry(() => {
      this.db.prepare<[string]>('DELETE FROM resources WHERE id = ?').run(id);
    });
  }
}
