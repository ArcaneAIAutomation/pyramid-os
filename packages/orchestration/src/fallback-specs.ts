/**
 * Fallback specifications for each PYRAMID OS component and
 * critical operation prioritization during degraded mode.
 *
 * Validates: Requirements 40.3, 40.4, 40.5, 40.6, 40.7, 40.8, 40.9
 */

import type { FallbackSpec } from './degradation.js';

// ---------------------------------------------------------------------------
// Component names — canonical identifiers used with DegradationManager
// ---------------------------------------------------------------------------

/** Canonical component names for DegradationManager registration. */
export const COMPONENT_NAMES = {
  OLLAMA: 'ollama',
  SQLITE: 'sqlite',
  MINECRAFT: 'minecraft',
  PLANNER_AGENT: 'planner-agent',
  OPERATIONAL_AGENT: 'operational-agent',
  WORKER_AGENT: 'worker-agent',
  CONTROL_CENTRE: 'control-centre',
} as const;

export type ComponentName = (typeof COMPONENT_NAMES)[keyof typeof COMPONENT_NAMES];

// ---------------------------------------------------------------------------
// Operation priority levels for degraded mode (Req 40.9)
// ---------------------------------------------------------------------------

/** Priority levels for critical operations during degraded mode. Lower = higher priority. */
export const OperationPriority = {
  /** Safety enforcement — boundary checks always active */
  SAFETY_ENFORCEMENT: 1,
  /** Data persistence — flush memory cache to DB when possible */
  DATA_PERSISTENCE: 2,
  /** Health monitoring — continue health checks to detect recovery */
  HEALTH_MONITORING: 3,
  /** Active task completion — finish in-progress tasks */
  ACTIVE_TASK_COMPLETION: 4,
  /** New task assignment — throttled or paused depending on degradation level */
  NEW_TASK_ASSIGNMENT: 5,
  /** UI updates — lowest priority, buffered */
  UI_UPDATES: 6,
} as const;

export type OperationPriorityLevel =
  (typeof OperationPriority)[keyof typeof OperationPriority];

// ---------------------------------------------------------------------------
// Fallback callbacks — thin wrappers that wire into existing components.
// The actual behaviour (queuing, caching, reconnecting) lives in the
// respective component implementations. These callbacks just flip the
// switches.
// ---------------------------------------------------------------------------

/** Dependencies injected into the FallbackRegistry so fallbacks can interact with the system. */
export interface FallbackDeps {
  /** Pause all LLM request processing. */
  pauseLLMRequests?: () => void;
  /** Resume LLM request processing. */
  resumeLLMRequests?: () => void;

  /** Start caching DB writes in memory. */
  enableMemoryCache?: () => void;
  /** Flush memory cache to DB and stop caching. */
  disableMemoryCache?: () => void;

  /** Pause all bot actions. */
  pauseBotActions?: () => void;
  /** Resume bot actions and trigger reconnection. */
  resumeBotActions?: () => void;

  /** Notify that planner is unavailable — agents work from last directives. */
  onPlannerUnavailable?: () => void;
  /** Notify that planner has recovered. */
  onPlannerRecovered?: () => void;

  /** Redistribute operational agent responsibilities. */
  redistributeOperationalAgent?: () => void;
  /** Restore operational agent responsibilities. */
  restoreOperationalAgent?: () => void;

  /** Reassign worker tasks and restart agent. */
  reassignWorkerTasks?: () => void;
  /** Restore worker agent. */
  restoreWorkerAgent?: () => void;

  /** Buffer control centre events. */
  bufferControlCentreEvents?: () => void;
  /** Flush buffered events to control centre. */
  flushControlCentreEvents?: () => void;
}

// ---------------------------------------------------------------------------
// FallbackRegistry — creates all 7 component FallbackSpecs
// ---------------------------------------------------------------------------

/** Registry that creates all component fallback specs with correct priorities. */
export class FallbackRegistry {
  private readonly specs = new Map<string, FallbackSpec>();

  constructor(private readonly deps: FallbackDeps = {}) {
    this.specs.set(COMPONENT_NAMES.OLLAMA, this.createOllamaFallback());
    this.specs.set(COMPONENT_NAMES.SQLITE, this.createSQLiteFallback());
    this.specs.set(COMPONENT_NAMES.MINECRAFT, this.createMinecraftFallback());
    this.specs.set(COMPONENT_NAMES.PLANNER_AGENT, this.createPlannerFallback());
    this.specs.set(COMPONENT_NAMES.OPERATIONAL_AGENT, this.createOperationalAgentFallback());
    this.specs.set(COMPONENT_NAMES.WORKER_AGENT, this.createWorkerAgentFallback());
    this.specs.set(COMPONENT_NAMES.CONTROL_CENTRE, this.createControlCentreFallback());
  }

  /** Get all fallback specs keyed by component name. */
  getAll(): Map<string, FallbackSpec> {
    return new Map(this.specs);
  }

  /** Get a single fallback spec by component name. */
  get(component: string): FallbackSpec | undefined {
    return this.specs.get(component);
  }

  // -- Individual fallback factories --

  /** Ollama: queue LLM requests, continue deterministic tasks, no new reasoning. Priority 2. */
  private createOllamaFallback(): FallbackSpec {
    return {
      priority: 2,
      activate: () => { this.deps.pauseLLMRequests?.(); },
      deactivate: () => { this.deps.resumeLLMRequests?.(); },
    };
  }

  /** SQLite: cache writes in memory, retry every 5s, reads from cache. Priority 1 (critical). */
  private createSQLiteFallback(): FallbackSpec {
    return {
      priority: 1,
      activate: () => { this.deps.enableMemoryCache?.(); },
      deactivate: () => { this.deps.disableMemoryCache?.(); },
    };
  }

  /** Minecraft: preserve agent state, pause bot actions, reconnect with backoff. Priority 3. */
  private createMinecraftFallback(): FallbackSpec {
    return {
      priority: 3,
      activate: () => { this.deps.pauseBotActions?.(); },
      deactivate: () => { this.deps.resumeBotActions?.(); },
    };
  }

  /** Planner agent: continue existing plans, operational agents work from last directives. Priority 4. */
  private createPlannerFallback(): FallbackSpec {
    return {
      priority: 4,
      activate: () => { this.deps.onPlannerUnavailable?.(); },
      deactivate: () => { this.deps.onPlannerRecovered?.(); },
    };
  }

  /** Operational agent: redistribute to other agents of same/similar role. Priority 3. */
  private createOperationalAgentFallback(): FallbackSpec {
    return {
      priority: 3,
      activate: () => { this.deps.redistributeOperationalAgent?.(); },
      deactivate: () => { this.deps.restoreOperationalAgent?.(); },
    };
  }

  /** Worker agent: reassign tasks, restart agent. Priority 5. */
  private createWorkerAgentFallback(): FallbackSpec {
    return {
      priority: 5,
      activate: () => { this.deps.reassignWorkerTasks?.(); },
      deactivate: () => { this.deps.restoreWorkerAgent?.(); },
    };
  }

  /** Control Centre: buffer events for reconnection, no impact on operations. Priority 6. */
  private createControlCentreFallback(): FallbackSpec {
    return {
      priority: 6,
      activate: () => { this.deps.bufferControlCentreEvents?.(); },
      deactivate: () => { this.deps.flushControlCentreEvents?.(); },
    };
  }
}

// ---------------------------------------------------------------------------
// CriticalOperationManager — manages operation prioritization (Req 40.9)
// ---------------------------------------------------------------------------

/** Represents a prioritized operation that can be enabled/disabled. */
export interface PrioritizedOperation {
  name: string;
  priority: OperationPriorityLevel;
  enabled: boolean;
}

/**
 * Manages critical operation prioritization during degraded mode.
 *
 * When the system enters degraded mode, lower-priority operations can be
 * throttled or paused while higher-priority operations continue.
 */
export class CriticalOperationManager {
  private readonly operations: PrioritizedOperation[] = [
    { name: 'safety-enforcement', priority: OperationPriority.SAFETY_ENFORCEMENT, enabled: true },
    { name: 'data-persistence', priority: OperationPriority.DATA_PERSISTENCE, enabled: true },
    { name: 'health-monitoring', priority: OperationPriority.HEALTH_MONITORING, enabled: true },
    { name: 'active-task-completion', priority: OperationPriority.ACTIVE_TASK_COMPLETION, enabled: true },
    { name: 'new-task-assignment', priority: OperationPriority.NEW_TASK_ASSIGNMENT, enabled: true },
    { name: 'ui-updates', priority: OperationPriority.UI_UPDATES, enabled: true },
  ];

  /**
   * Apply a priority cutoff — disable operations below the given priority level.
   * Operations at or above (numerically ≤) the cutoff remain enabled.
   * Safety enforcement (priority 1) can never be disabled.
   */
  applyCutoff(maxPriority: OperationPriorityLevel): void {
    for (const op of this.operations) {
      if (op.priority === OperationPriority.SAFETY_ENFORCEMENT) {
        op.enabled = true; // Safety is always active
      } else {
        op.enabled = op.priority <= maxPriority;
      }
    }
  }

  /** Restore all operations to enabled (full operation mode). */
  restoreAll(): void {
    for (const op of this.operations) {
      op.enabled = true;
    }
  }

  /** Check whether a specific operation is currently enabled. */
  isEnabled(name: string): boolean {
    const op = this.operations.find((o) => o.name === name);
    return op?.enabled ?? false;
  }

  /** Get all operations sorted by priority (highest first). */
  getOperations(): ReadonlyArray<Readonly<PrioritizedOperation>> {
    return [...this.operations].sort((a, b) => a.priority - b.priority);
  }

  /** Get only the currently enabled operations, sorted by priority. */
  getEnabledOperations(): ReadonlyArray<Readonly<PrioritizedOperation>> {
    return this.getOperations().filter((op) => op.enabled);
  }
}
