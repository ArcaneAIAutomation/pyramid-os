/**
 * GuardWorker — patrols waypoints, detects hostile entities, reports to Defense agent.
 *
 * Uses Pathfinder.createPatrolRoute() for waypoint cycling and ActionExecutor
 * for combat. Reports threats via the completion reporter callback.
 *
 * Requirements: 16.4, 16.6, 16.7, 22.2, 22.3, 22.7
 */

import type { Vec3 } from '@pyramid-os/shared-types';
import type { ActionExecutor } from '../action-executor.js';
import type { Pathfinder } from '../pathfinder.js';
import { BaseWorker, type WorkerTickResult, type CompletionReporter } from './base-worker.js';

/** Minimal hostile entity descriptor. */
export interface HostileEntity {
  id: number;
  name: string;
  position: Vec3;
}

/** Callback to detect nearby hostile entities (injected by the controller). */
export type HostileDetector = (botId: string) => HostileEntity[];

export class GuardWorker extends BaseWorker {
  private readonly waypoints: Vec3[];
  private waypointIndex = 0;
  private readonly detectHostiles: HostileDetector;
  private taskId?: string;

  constructor(options: {
    botId: string;
    actionExecutor: ActionExecutor;
    pathfinder: Pathfinder;
    waypoints: Vec3[];
    detectHostiles: HostileDetector;
    taskId?: string;
    completionReporter?: CompletionReporter;
  }) {
    super({
      botId: options.botId,
      role: 'guard',
      actionExecutor: options.actionExecutor,
      pathfinder: options.pathfinder,
      ...(options.completionReporter !== undefined ? { completionReporter: options.completionReporter } : {}),
    });
    this.waypoints = options.waypoints;
    this.detectHostiles = options.detectHostiles;
    if (options.taskId !== undefined) {
      this.taskId = options.taskId;
    }
  }

  async tick(): Promise<WorkerTickResult> {
    // Check for hostiles first
    const hostiles = this.detectHostiles(this.botId);
    if (hostiles.length > 0) {
      const target = hostiles[0]!;
      const result = await this.actionExecutor.executeAction(this.botId, {
        type: 'attack',
        params: { entityId: target.id },
      });
      // Report threat to Defense agent
      this.reportCompletion(
        this.taskId ?? 'guard-patrol',
        `Hostile detected: ${target.name} at (${target.position.x}, ${target.position.y}, ${target.position.z})`,
      );
      return {
        action: 'attack',
        success: result.success,
        details: result.success ? `Engaged ${target.name}` : `Attack failed: ${result.error ?? result.outcome}`,
      };
    }

    // No hostiles — continue patrol
    if (this.waypoints.length === 0) {
      return { action: 'idle', success: true, details: 'No waypoints assigned' };
    }

    const nextWaypoint = this.waypoints[this.waypointIndex]!;
    const navigated = await this.navigateTo(nextWaypoint);

    this.waypointIndex = (this.waypointIndex + 1) % this.waypoints.length;

    return {
      action: 'patrol',
      success: navigated,
      details: navigated
        ? `Patrolled to waypoint ${this.waypointIndex}`
        : `Failed to reach waypoint (${nextWaypoint.x}, ${nextWaypoint.y}, ${nextWaypoint.z})`,
    };
  }
}
