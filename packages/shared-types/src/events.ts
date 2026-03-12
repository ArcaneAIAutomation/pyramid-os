/**
 * Event types for PYRAMID OS
 * Defines WebSocket events and system alert/health types
 */

import type { AgentStatus, AgentMessage } from './agent.js';
import type { TaskResult } from './task.js';

/** Severity level for system alerts */
export type AlertSeverity = 'info' | 'warning' | 'error' | 'critical';

/** Health status for a system component */
export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy';

/**
 * Discriminated union of all WebSocket events broadcast by the API server.
 * Clients should switch on the `type` field to handle each event.
 */
export type WebSocketEvent =
  | { type: 'agent:state'; agentId: string; state: AgentStatus }
  | { type: 'agent:activity'; agentId: string; role: string; decision: string; timestamp: string }
  | { type: 'task:complete'; taskId: string; result: TaskResult }
  | { type: 'resource:update'; resourceType: string; level: number }
  | { type: 'bot:connect'; botId: string; server: string }
  | { type: 'bot:disconnect'; botId: string; reason: string }
  | { type: 'build:progress'; buildId: string; percent: number }
  | { type: 'alert'; severity: AlertSeverity; message: string }
  | { type: 'ceremony:start'; ceremonyId: string }
  | { type: 'health:update'; component: string; status: HealthStatus };

/** A health check result for a single component */
export interface HealthCheckResult {
  component: string;
  status: HealthStatus;
  checkedAt: string;
  latencyMs?: number;
  details?: string;
}

/** Overall system health report */
export interface SystemHealthReport {
  overall: HealthStatus;
  components: HealthCheckResult[];
  checkedAt: string;
}

/** A system alert raised by any component */
export interface SystemAlert {
  id: string;
  severity: AlertSeverity;
  message: string;
  component: string;
  timestamp: string;
  resolved: boolean;
}

/** A security incident logged by the SafetyEnforcer */
export interface SecurityIncident {
  id: string;
  agentId: string;
  violationType: string;
  action: string;
  timestamp: string;
  resolved: boolean;
}

/** Re-export AgentMessage for convenience */
export type { AgentMessage };
