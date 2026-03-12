/**
 * Cross-platform path resolver for PYRAMID OS.
 * All path operations use Node.js `path` module — never hardcoded separators.
 *
 * @module paths
 */

import path from 'node:path';

/**
 * Interface for resolving workspace-relative paths in a cross-platform manner.
 */
export interface PathResolver {
  /** Resolve path segments relative to the workspace root */
  resolve(...segments: string[]): string;

  /** Get the data directory */
  dataDir(): string;

  /** Get the snapshots directory */
  snapshotsDir(): string;

  /** Get the logs directory */
  logsDir(): string;

  /** Get the database file path */
  databasePath(): string;

  /** Normalize a user-provided path (handles drive letters, mixed separators) */
  normalize(userPath: string): string;
}

/**
 * Cross-platform path resolver that uses `path.join` / `path.resolve` exclusively.
 * Handles Windows drive letters, mixed separators, and relative segments.
 */
export class CrossPlatformPathResolver implements PathResolver {
  constructor(private workspaceRoot: string) {}

  resolve(...segments: string[]): string {
    return path.resolve(this.workspaceRoot, ...segments);
  }

  dataDir(): string {
    return path.join(this.workspaceRoot, 'data');
  }

  snapshotsDir(): string {
    return path.join(this.workspaceRoot, 'data', 'snapshots');
  }

  logsDir(): string {
    return path.join(this.workspaceRoot, 'logs');
  }

  databasePath(): string {
    return path.join(this.workspaceRoot, 'data', 'pyramid.db');
  }

  normalize(userPath: string): string {
    return path.normalize(userPath);
  }
}
