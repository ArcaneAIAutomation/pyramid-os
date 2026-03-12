/**
 * BlueprintRepository — CRUD + filtering for Blueprint records.
 * Requirements: 10.1, 10.7
 */

import type Database from 'better-sqlite3';
import type { Blueprint, BlueprintProgress } from '@pyramid-os/shared-types';
import { withRetry } from '../retry.js';

interface BlueprintRow {
  id: string;
  name: string;
  version: number;
  type: string;
  civilization_id: string;
  metadata: string;
  placements: string;
  progress: string;
  dimensions: string;
}

function rowToBlueprint(row: BlueprintRow): Blueprint {
  return {
    id: row.id,
    name: row.name,
    version: row.version,
    type: row.type as Blueprint['type'],
    metadata: JSON.parse(row.metadata) as Blueprint['metadata'],
    placements: JSON.parse(row.placements) as Blueprint['placements'],
    progress: JSON.parse(row.progress) as BlueprintProgress,
    dimensions: JSON.parse(row.dimensions) as Blueprint['dimensions'],
  };
}

export class BlueprintRepository {
  constructor(private readonly db: Database.Database) {}

  findById(id: string): Blueprint | undefined {
    const row = this.db
      .prepare<[string], BlueprintRow>('SELECT * FROM blueprints WHERE id = ?')
      .get(id);
    return row ? rowToBlueprint(row) : undefined;
  }

  findAll(filter?: { type?: string; civilizationId?: string }): Blueprint[] {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filter?.type) {
      conditions.push('type = ?');
      params.push(filter.type);
    }
    if (filter?.civilizationId) {
      conditions.push('civilization_id = ?');
      params.push(filter.civilizationId);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = this.db
      .prepare<unknown[], BlueprintRow>(`SELECT * FROM blueprints ${where}`)
      .all(...params);
    return rows.map(rowToBlueprint);
  }

  upsert(blueprint: Blueprint & { civilizationId?: string }): void {
    // civilizationId may come from metadata or be passed directly
    const civId =
      blueprint.civilizationId ??
      (blueprint.metadata as unknown as { civilizationId?: string }).civilizationId ??
      '';

    withRetry(() => {
      this.db
        .prepare<[string, string, number, string, string, string, string, string, string]>(
          `INSERT OR REPLACE INTO blueprints
            (id, name, version, type, civilization_id, metadata, placements, progress, dimensions)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          blueprint.id,
          blueprint.name,
          blueprint.version,
          blueprint.type,
          civId,
          JSON.stringify(blueprint.metadata),
          JSON.stringify(blueprint.placements),
          JSON.stringify(blueprint.progress),
          JSON.stringify(blueprint.dimensions)
        );
    });
  }

  delete(id: string): void {
    withRetry(() => {
      this.db.prepare<[string]>('DELETE FROM blueprints WHERE id = ?').run(id);
    });
  }

  updateProgress(id: string, progress: BlueprintProgress): void {
    withRetry(() => {
      this.db
        .prepare<[string, string]>(
          'UPDATE blueprints SET progress = ? WHERE id = ?'
        )
        .run(JSON.stringify(progress), id);
    });
  }
}
