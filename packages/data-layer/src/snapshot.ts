/**
 * SnapshotManager — JSON snapshot export, import, validation, and listing.
 * Requirements: 10.3, 10.4, 10.9
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { JsonSnapshot, SnapshotInfo } from '@pyramid-os/shared-types';
import type { DatabaseManager } from './database.js';
import { AgentRepository } from './repositories/AgentRepository.js';
import { TaskRepository } from './repositories/TaskRepository.js';
import { ResourceRepository } from './repositories/ResourceRepository.js';
import { BlueprintRepository } from './repositories/BlueprintRepository.js';

/** Result of snapshot validation */
export interface SnapshotValidationResult {
  valid: boolean;
  errors: string[];
}

export class SnapshotManager {
  private readonly agents: AgentRepository;
  private readonly tasks: TaskRepository;
  private readonly resources: ResourceRepository;
  private readonly blueprints: BlueprintRepository;

  constructor(
    private readonly db: DatabaseManager,
    private readonly snapshotsDir: string,
    private readonly civilizationId: string
  ) {
    const conn = db.getDb();
    this.agents = new AgentRepository(conn);
    this.tasks = new TaskRepository(conn);
    this.resources = new ResourceRepository(conn);
    this.blueprints = new BlueprintRepository(conn);
  }

  /**
   * Export all entities for the civilization to a JsonSnapshot.
   * Requirements: 10.3, 10.9
   */
  async export(): Promise<JsonSnapshot> {
    const agents = this.agents.findAll({ civilizationId: this.civilizationId });
    const tasks = this.tasks.findAll({ civilizationId: this.civilizationId });
    const resources = this.resources.findAll(this.civilizationId);
    const blueprints = this.blueprints.findAll({ civilizationId: this.civilizationId });

    return {
      version: '1.0',
      civilizationId: this.civilizationId,
      exportedAt: new Date().toISOString(),
      agents,
      tasks,
      resources,
      blueprints,
    };
  }

  /**
   * Import/restore all entities from a snapshot transactionally.
   * Validates first, then upserts all entities in a single SQLite transaction.
   * Requirements: 10.4
   */
  async import(snapshot: JsonSnapshot): Promise<void> {
    const validation = this.validate(snapshot);
    if (!validation.valid) {
      throw new Error(`Invalid snapshot: ${validation.errors.join('; ')}`);
    }

    const conn = this.db.getDb();

    const doImport = conn.transaction(() => {
      for (const agent of snapshot.agents) {
        this.agents.upsert(agent);
      }

      for (const task of snapshot.tasks) {
        // Upsert task without dependencies first
        this.tasks.upsert(task);
        // Then restore dependency edges
        for (const dep of task.dependencies ?? []) {
          this.tasks.addDependency(task.id, dep);
        }
      }

      for (const resource of snapshot.resources) {
        this.resources.upsert(resource);
      }

      for (const blueprint of snapshot.blueprints) {
        this.blueprints.upsert({
          ...blueprint,
          civilizationId: snapshot.civilizationId,
        });
      }
    });

    doImport();
  }

  /**
   * Validate snapshot structure — checks version, civilizationId, exportedAt, and array fields.
   * Requirements: 10.3
   */
  validate(snapshot: JsonSnapshot): SnapshotValidationResult {
    const errors: string[] = [];

    if (!snapshot || typeof snapshot !== 'object') {
      return { valid: false, errors: ['Snapshot must be a non-null object'] };
    }

    if (typeof snapshot.version !== 'string' || snapshot.version.trim() === '') {
      errors.push('version must be a non-empty string');
    }

    if (
      typeof snapshot.civilizationId !== 'string' ||
      snapshot.civilizationId.trim() === ''
    ) {
      errors.push('civilizationId must be a non-empty string');
    }

    if (typeof snapshot.exportedAt !== 'string' || isNaN(Date.parse(snapshot.exportedAt))) {
      errors.push('exportedAt must be a valid ISO date string');
    }

    if (!Array.isArray(snapshot.agents)) {
      errors.push('agents must be an array');
    }

    if (!Array.isArray(snapshot.tasks)) {
      errors.push('tasks must be an array');
    }

    if (!Array.isArray(snapshot.resources)) {
      errors.push('resources must be an array');
    }

    if (!Array.isArray(snapshot.blueprints)) {
      errors.push('blueprints must be an array');
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * List available snapshot files in snapshotsDir.
   * Scans for *.json files and reads metadata from each.
   * Requirements: 10.9
   */
  async list(): Promise<SnapshotInfo[]> {
    if (!fs.existsSync(this.snapshotsDir)) {
      return [];
    }

    const entries = fs.readdirSync(this.snapshotsDir);
    const jsonFiles = entries.filter((f) => f.endsWith('.json'));

    const results: SnapshotInfo[] = [];

    for (const filename of jsonFiles) {
      const filePath = path.join(this.snapshotsDir, filename);
      try {
        const stat = fs.statSync(filePath);
        const raw = fs.readFileSync(filePath, 'utf-8');
        const parsed = JSON.parse(raw) as Partial<JsonSnapshot>;

        results.push({
          filename,
          civilizationId: typeof parsed.civilizationId === 'string' ? parsed.civilizationId : '',
          exportedAt: typeof parsed.exportedAt === 'string' ? parsed.exportedAt : '',
          sizeBytes: stat.size,
        });
      } catch {
        // Skip files that can't be read or parsed
      }
    }

    return results;
  }

  /**
   * Read a snapshot file from disk and return the parsed JsonSnapshot.
   */
  async readSnapshot(filename: string): Promise<JsonSnapshot> {
    const filePath = path.join(this.snapshotsDir, filename);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Snapshot file not found: ${filename}`);
    }
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as JsonSnapshot;
  }

  /**
   * Save a snapshot to disk and return the file path.
   * Writes to snapshotsDir/snapshot-{civilizationId}-{timestamp}.json
   * Requirements: 10.9
   */
  async saveSnapshot(snapshot: JsonSnapshot): Promise<string> {
    if (!fs.existsSync(this.snapshotsDir)) {
      fs.mkdirSync(this.snapshotsDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `snapshot-${snapshot.civilizationId}-${timestamp}.json`;
    const filePath = path.join(this.snapshotsDir, filename);

    fs.writeFileSync(filePath, JSON.stringify(snapshot, null, 2), 'utf-8');

    return filePath;
  }
}
