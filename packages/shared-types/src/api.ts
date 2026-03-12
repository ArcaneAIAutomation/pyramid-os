/**
 * API request/response types for PYRAMID OS
 * Defines shapes for all REST API endpoints
 */

import type { AgentInstance, AgentFilter, OperatingMode } from './agent.js';
import type { Task, TaskFilter, TaskDefinition } from './task.js';
import type { Resource } from './resource.js';
import type { Blueprint } from './blueprint.js';
import type { SystemHealthReport } from './events.js';
import type { JsonSnapshot } from './misc.js';

// ─── Common ──────────────────────────────────────────────────────────────────

/** Standard error response returned by the API */
export interface ApiError {
  statusCode: number;
  error: string;
  message: string;
  /** Machine-readable error code, e.g. 'AGENT_NOT_FOUND' */
  code: string;
  details?: unknown;
}

/** Paginated list wrapper */
export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

// ─── Agents ──────────────────────────────────────────────────────────────────

/** GET /agents — query params */
export type ListAgentsQuery = AgentFilter;

/** GET /agents — response */
export type ListAgentsResponse = AgentInstance[];

/** GET /agents/:id — response */
export type GetAgentResponse = AgentInstance;

// ─── Tasks ───────────────────────────────────────────────────────────────────

/** GET /tasks — query params */
export type ListTasksQuery = TaskFilter;

/** GET /tasks — response */
export type ListTasksResponse = Task[];

/** GET /tasks/:id — response */
export type GetTaskResponse = Task;

/** POST /tasks — request body */
export type CreateTaskRequest = TaskDefinition;

/** POST /tasks — response */
export type CreateTaskResponse = Task;

// ─── Resources ───────────────────────────────────────────────────────────────

/** GET /resources — response */
export type GetResourcesResponse = Resource[];

// ─── Builds ──────────────────────────────────────────────────────────────────

/** GET /builds — response */
export type ListBuildsResponse = Blueprint[];

/** GET /builds/:id — response */
export type GetBuildResponse = Blueprint;

// ─── System Control ──────────────────────────────────────────────────────────

/** POST /system/start — response */
export interface SystemStartResponse {
  started: boolean;
  message: string;
}

/** POST /system/stop — response */
export interface SystemStopResponse {
  stopped: boolean;
  message: string;
}

/** POST /system/pause — response */
export interface SystemPauseResponse {
  paused: boolean;
  message: string;
}

/** POST /system/mode — request body */
export interface SetModeRequest {
  mode: OperatingMode;
}

/** POST /system/mode — response */
export interface SetModeResponse {
  mode: OperatingMode;
  message: string;
}

// ─── Snapshots ───────────────────────────────────────────────────────────────

/** GET /snapshots/export — response */
export type ExportSnapshotResponse = JsonSnapshot;

/** POST /snapshots/import — request body */
export type ImportSnapshotRequest = JsonSnapshot;

/** POST /snapshots/import — response */
export interface ImportSnapshotResponse {
  imported: boolean;
  message: string;
}

/** Metadata about a stored snapshot file */
export interface SnapshotInfo {
  filename: string;
  civilizationId: string;
  exportedAt: string;
  sizeBytes: number;
}

/** GET /snapshots — response */
export type ListSnapshotsResponse = SnapshotInfo[];

// ─── Health ──────────────────────────────────────────────────────────────────

/** GET /health — response */
export type HealthResponse = SystemHealthReport;

// ─── Metrics ─────────────────────────────────────────────────────────────────

/** GET /metrics — response (Prometheus text format or JSON) */
export interface MetricsResponse {
  taskCompletionRate: number;
  resourceConsumptionRates: Record<string, number>;
  botUptime: Record<string, number>;
  agentDecisionLatencyMs: Record<string, number>;
  blocksPlacedPerHour: number;
  timestamp: string;
}
