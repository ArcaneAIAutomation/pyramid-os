/**
 * ModeController — Operating mode management for PYRAMID OS.
 *
 * Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5, 8.8, 8.9, 8.10
 *
 * Operating modes:
 *   structured      — Strict task queue execution. No improvisation.
 *   guided_autonomy — Role-bounded autonomy. Agents improvise within role scope.
 *   free_thinking   — Self-directed with safety constraints.
 *
 * Mode-specific action guards:
 *   structured:      execute_task, report_status, request_resources (all tiers)
 *   guided_autonomy: above + create_task, assign_task, modify_plan (planner/operational);
 *                    workers also get suggest_improvement
 *   free_thinking:   all above + propose_goal, reorganize, self_assign (planner);
 *                    operational gets propose_goal; workers get self_assign
 */

import type { OperatingMode, AgentTier } from '@pyramid-os/shared-types';
import type { Logger } from '@pyramid-os/logger';

/** Listener invoked when the operating mode changes. */
export type ModeChangeListener = (oldMode: OperatingMode, newMode: OperatingMode) => void;

/** Optional callback for persisting mode changes (e.g. to DB). */
export type ModePersister = (mode: OperatingMode) => Promise<void>;

/** Actions allowed in structured mode — available to all tiers. */
const STRUCTURED_ACTIONS = new Set<string>([
  'execute_task',
  'report_status',
  'request_resources',
]);

/** Additional actions unlocked in guided_autonomy mode, keyed by tier. */
const GUIDED_EXTRA: Record<AgentTier, Set<string>> = {
  planner: new Set(['create_task', 'assign_task', 'modify_plan']),
  operational: new Set(['create_task', 'assign_task', 'modify_plan']),
  worker: new Set(['suggest_improvement']),
};

/** Additional actions unlocked in free_thinking mode, keyed by tier. */
const FREE_EXTRA: Record<AgentTier, Set<string>> = {
  planner: new Set(['propose_goal', 'reorganize', 'self_assign']),
  operational: new Set(['propose_goal']),
  worker: new Set(['self_assign']),
};

export class ModeControllerImpl {
  private currentMode: OperatingMode;
  private readonly logger: Logger;
  private readonly listeners: ModeChangeListener[] = [];
  private readonly persister?: ModePersister | undefined;

  constructor(logger: Logger, persister?: ModePersister, initialMode: OperatingMode = 'structured') {
    this.logger = logger;
    this.persister = persister;
    this.currentMode = initialMode;
    this.logger.info(`ModeController initialized`, { mode: initialMode });
  }

  /** Returns the current operating mode. */
  getCurrentMode(): OperatingMode {
    return this.currentMode;
  }

  /**
   * Transition to a new operating mode.
   * Validates the mode, persists the change, logs it, and notifies all listeners.
   *
   * Validates: Requirements 8.8, 8.9, 8.10
   */
  async setOperatingMode(mode: OperatingMode): Promise<void> {
    const validModes: OperatingMode[] = ['structured', 'guided_autonomy', 'free_thinking'];
    if (!validModes.includes(mode)) {
      throw new Error(`Invalid operating mode: "${mode}". Must be one of: ${validModes.join(', ')}`);
    }

    const oldMode = this.currentMode;

    if (oldMode === mode) {
      this.logger.info(`Operating mode already set to "${mode}", no transition needed`);
      return;
    }

    // Persist mode change (e.g. to DB) before notifying listeners
    if (this.persister) {
      await this.persister(mode);
    }

    this.currentMode = mode;

    // Log mode change for audit (Req 8.10)
    this.logger.info(`Operating mode changed: ${oldMode} → ${mode}`, {
      oldMode,
      newMode: mode,
    });

    // Notify all registered listeners (Req 8.9)
    for (const listener of this.listeners) {
      try {
        listener(oldMode, mode);
      } catch (err) {
        this.logger.error(
          `Error in mode change listener`,
          err instanceof Error ? err : new Error(String(err)),
        );
      }
    }
  }

  /**
   * Check whether an action is allowed for a given agent tier in the current mode.
   *
   * Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5
   */
  isAllowed(action: string, agentTier: AgentTier): boolean {
    // Structured actions are always allowed for all tiers
    if (STRUCTURED_ACTIONS.has(action)) {
      return true;
    }

    if (this.currentMode === 'structured') {
      // In structured mode, only the base actions are allowed
      return false;
    }

    // Guided autonomy: base + guided extras for the tier
    if (GUIDED_EXTRA[agentTier]?.has(action)) {
      return true;
    }

    if (this.currentMode === 'guided_autonomy') {
      // In guided mode, only base + guided extras
      return false;
    }

    // Free thinking: base + guided extras + free extras for the tier
    if (FREE_EXTRA[agentTier]?.has(action)) {
      return true;
    }

    // Action not recognized in any mode for this tier
    return false;
  }

  /**
   * Register a listener that is called whenever the operating mode changes.
   *
   * Validates: Requirement 8.9
   */
  onModeChange(listener: ModeChangeListener): void {
    this.listeners.push(listener);
  }
}
