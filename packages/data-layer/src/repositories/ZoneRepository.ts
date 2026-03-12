/**
 * ZoneRepository — CRUD + list by civilization for Zone records.
 * Requirements: 10.1, 10.7
 */

import type Database from 'better-sqlite3';
import type { Vec3 } from '@pyramid-os/shared-types';
import { withRetry } from '../retry.js';

/** Local Zone interface — bounds stored as separate min/max columns in DB */
export interface Zone {
  id: string;
  name: string;
  type: string;
  civilizationId: string;
  bounds?: { min: Vec3; max: Vec3 };
}

interface ZoneRow {
  id: string;
  name: string;
  type: string;
  civilization_id: string;
  min_x: number | null;
  min_y: number | null;
  min_z: number | null;
  max_x: number | null;
  max_y: number | null;
  max_z: number | null;
}

function rowToZone(row: ZoneRow): Zone {
  const zone: Zone = {
    id: row.id,
    name: row.name,
    type: row.type,
    civilizationId: row.civilization_id,
  };

  if (
    row.min_x !== null &&
    row.min_y !== null &&
    row.min_z !== null &&
    row.max_x !== null &&
    row.max_y !== null &&
    row.max_z !== null
  ) {
    zone.bounds = {
      min: { x: row.min_x, y: row.min_y, z: row.min_z },
      max: { x: row.max_x, y: row.max_y, z: row.max_z },
    };
  }

  return zone;
}

export class ZoneRepository {
  constructor(private readonly db: Database.Database) {}

  findById(id: string): Zone | undefined {
    const row = this.db
      .prepare<[string], ZoneRow>('SELECT * FROM zones WHERE id = ?')
      .get(id);
    return row ? rowToZone(row) : undefined;
  }

  findByCivilization(civilizationId: string): Zone[] {
    const rows = this.db
      .prepare<[string], ZoneRow>(
        'SELECT * FROM zones WHERE civilization_id = ?'
      )
      .all(civilizationId);
    return rows.map(rowToZone);
  }

  upsert(zone: Zone): void {
    withRetry(() => {
      const b = zone.bounds;
      this.db
        .prepare<
          [
            string,
            string,
            string,
            string,
            number | null,
            number | null,
            number | null,
            number | null,
            number | null,
            number | null,
          ]
        >(
          `INSERT OR REPLACE INTO zones
            (id, name, type, civilization_id, min_x, min_y, min_z, max_x, max_y, max_z)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          zone.id,
          zone.name,
          zone.type,
          zone.civilizationId,
          b?.min.x ?? null,
          b?.min.y ?? null,
          b?.min.z ?? null,
          b?.max.x ?? null,
          b?.max.y ?? null,
          b?.max.z ?? null
        );
    });
  }

  delete(id: string): void {
    withRetry(() => {
      this.db.prepare<[string]>('DELETE FROM zones WHERE id = ?').run(id);
    });
  }
}
