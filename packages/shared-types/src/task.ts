/**
 * Task types for PYRAMID OS
 * Defines tasks assigned to agents and their lifecycle
 */

/** The category of work a task represents */
export type TaskType =
  | 'build'
  | 'mine'
  | 'haul'
  | 'farm'
  | 'guard'
  | 'ceremony'
  | 'procure'
  | 'repair';

/** Current lifecycle state of a task */
export type TaskStatus =
  | 'pending'
  | 'assigned'
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'blocked';

/** Execution priority for task queue ordering */
export type TaskPriority = 'critical' | 'high' | 'normal' | 'low';

/** A unit of work assigned to an agent */
export interface Task {
  id: string;
  type: TaskType;
  status: TaskStatus;
  priority: TaskPriority;
  agentId?: string;
  civilizationId: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  dependencies: string[];
}

/** The outcome of a completed or failed task */
export interface TaskResult {
  taskId: string;
  success: boolean;
  outcome: string;
  completedAt: string;
}

/** Input shape for creating a new task */
export interface TaskDefinition {
  type: TaskType;
  priority: TaskPriority;
  civilizationId: string;
  description: string;
  dependencies?: string[];
  agentId?: string;
}

/** Filter options for querying tasks */
export interface TaskFilter {
  status?: TaskStatus;
  type?: TaskType;
  priority?: TaskPriority;
  agentId?: string;
  civilizationId?: string;
}
