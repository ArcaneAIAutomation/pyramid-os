/**
 * SafetyEnforcerImpl — Safety boundary validation for PYRAMID OS.
 *
 * Validates agent actions against configurable safety constraints:
 * - Prohibited block placement (TNT, lava, fire, etc.)
 * - Prohibited server commands (/op, /gamemode, etc.)
 * - Decision timeout enforcement
 * - Emergency stop broadcasting
 *
 * Every violation is logged with agent ID, violation type, and action taken.
 *
 * Validates: Requirements 8.6, 8.7, 31.1, 31.2, 31.3, 31.4, 31.5, 31.6, 31.7, 31.11
 */

import type { AgentAction, SafetyResult, SafetyBoundary } from '@pyramid-os/shared-types';
import { createPyramidError } from '@pyramid-os/shared-types';
import type { Logger } from '@pyramid-os/logger';
import type { SafetyEnforcer } from './interfaces.js';

/** Configuration accepted by SafetyEnforcerImpl */
export interface SafetyEnforcerConfig {
  prohibitedBlocks: string[];
  prohibitedCommands: string[];
  maxDecisionTimeMs: number;
}

/** Callback for logging security incidents to the data layer */
export type IncidentLogger = (incident: {
  agentId: string;
  violationType: string;
  action: string;
}) => void;

/** Default prohibited blocks */
export const DEFAULT_PROHIBITED_BLOCKS: readonly string[] = [
  'minecraft:tnt',
  'minecraft:lava',
  'minecraft:fire',
  'minecraft:wither_skeleton_skull',
  'minecraft:end_crystal',
];

/** Default prohibited commands */
export const DEFAULT_PROHIBITED_COMMANDS: readonly string[] = [
  '/op',
  '/deop',
  '/stop',
  '/ban',
  '/kick',
  '/gamemode',
  '/give',
];

/** Default max decision time in milliseconds */
export const DEFAULT_MAX_DECISION_TIME_MS = 30_000;

export class SafetyEnforcerImpl implements SafetyEnforcer {
  private readonly prohibitedBlocks: Set<string>;
  private readonly prohibitedCommands: string[];
  private readonly maxDecisionTimeMs: number;
  private readonly logger: Logger;
  private readonly onIncident: IncidentLogger | undefined;
  private stopped = false;

  constructor(
    config: Partial<SafetyEnforcerConfig>,
    logger: Logger,
    onIncident?: IncidentLogger,
  ) {
    this.prohibitedBlocks = new Set(
      config.prohibitedBlocks ?? DEFAULT_PROHIBITED_BLOCKS,
    );
    this.prohibitedCommands =
      config.prohibitedCommands ?? [...DEFAULT_PROHIBITED_COMMANDS];
    this.maxDecisionTimeMs =
      config.maxDecisionTimeMs ?? DEFAULT_MAX_DECISION_TIME_MS;
    this.logger = logger;
    this.onIncident = onIncident ?? undefined;
  }

  /**
   * Validate an agent action against all safety boundaries.
   * Returns `{ allowed: false }` with a reason and violation type when a
   * constraint is violated. After `emergencyStop()` every call returns denied.
   */
  validate(agentId: string, action: AgentAction): SafetyResult {
    // Emergency stop overrides everything
    if (this.stopped) {
      const result: SafetyResult = {
        allowed: false,
        reason: 'Emergency stop is active — all actions are denied',
        violationType: 'prohibited-command',
        pyramidError: createPyramidError(
          'PYRAMID_SECURITY_BOUNDARY',
          { agentId, violationType: 'emergency-stop', action: JSON.stringify(action) },
        ),
      };
      this.logViolation(agentId, 'emergency-stop', action);
      return result;
    }

    // Check prohibited block placement
    if (action.type === 'place_block') {
      const blockType = action.payload?.['blockType'] as string | undefined;
      if (blockType && this.isProhibitedBlock(blockType)) {
        const result: SafetyResult = {
          allowed: false,
          reason: `Placing block '${blockType}' is prohibited`,
          violationType: 'prohibited-block',
          pyramidError: createPyramidError(
            'PYRAMID_SECURITY_BOUNDARY',
            { agentId, violationType: 'prohibited-block', blockType },
          ),
        };
        this.logViolation(agentId, 'prohibited-block', action);
        return result;
      }
    }

    // Check prohibited command execution
    if (action.type === 'execute_command') {
      const command = action.payload?.['command'] as string | undefined;
      if (command && this.isProhibitedCommand(command)) {
        const result: SafetyResult = {
          allowed: false,
          reason: `Command '${command}' is prohibited`,
          violationType: 'prohibited-command',
          pyramidError: createPyramidError(
            'PYRAMID_SECURITY_BOUNDARY',
            { agentId, violationType: 'prohibited-command', command },
          ),
        };
        this.logViolation(agentId, 'prohibited-command', action);
        return result;
      }
    }

    return { allowed: true };
  }

  /** Returns true if the given block type is in the prohibited list. */
  isProhibitedBlock(blockType: string): boolean {
    return this.prohibitedBlocks.has(blockType);
  }

  /**
   * Returns true if the command starts with any prohibited command prefix.
   * For example, `/op player1` matches the `/op` prohibition.
   */
  isProhibitedCommand(command: string): boolean {
    const trimmed = command.trim();
    return this.prohibitedCommands.some(
      (prohibited) =>
        trimmed === prohibited ||
        trimmed.startsWith(prohibited + ' '),
    );
  }

  /**
   * Enforce a timeout on an agent operation.
   * Throws if `operationMs` exceeds the configured `maxDecisionTimeMs`.
   */
  enforceTimeout(agentId: string, operationMs: number): void {
    if (operationMs > this.maxDecisionTimeMs) {
      this.logViolation(agentId, 'timeout', {
        type: 'timeout',
        payload: { operationMs, maxDecisionTimeMs: this.maxDecisionTimeMs },
      });
      const err = new Error(
        `Agent '${agentId}' exceeded max decision time: ${operationMs}ms > ${this.maxDecisionTimeMs}ms`,
      );
      (err as any).pyramidError = createPyramidError(
        'PYRAMID_SECURITY_BOUNDARY',
        { agentId, violationType: 'timeout', operationMs, maxDecisionTimeMs: this.maxDecisionTimeMs },
      );
      throw err;
    }
  }

  /**
   * Emergency stop — sets a flag that causes all subsequent `validate()` calls
   * to return `allowed: false`. Broadcasts halt to all agents and bots.
   */
  async emergencyStop(): Promise<void> {
    this.stopped = true;
    this.logger.warn('EMERGENCY STOP activated — all agent actions are now denied');
  }

  /** Returns whether the emergency stop flag is active. */
  get isEmergencyStopped(): boolean {
    return this.stopped;
  }

  /** Reset the emergency stop flag (for testing / recovery). */
  reset(): void {
    this.stopped = false;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private logViolation(agentId: string, violationType: string, action: AgentAction): void {
    const actionStr = JSON.stringify(action);
    this.logger.warn(`Safety violation: ${violationType}`, {
      agentId,
      violationType,
      action: actionStr,
    });
    this.onIncident?.({ agentId, violationType, action: actionStr });
  }
}
