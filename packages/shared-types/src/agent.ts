/**
 * Agent types for PYRAMID OS
 * Defines the hierarchy of agents: Planner → Operational → Worker
 */

import type { PyramidError } from './errors.js';

/** The three tiers of the agent hierarchy */
export type AgentTier = 'planner' | 'operational' | 'worker';

/** Planner-tier agent roles (use gpt-oss:20b model) */
export type PlannerRole = 'pharaoh' | 'vizier' | 'architect';

/** Operational-tier agent roles (use qwen3 model) */
export type OperationalRole = 'scribe' | 'bot-foreman' | 'defense' | 'ops' | 'ui-master';

/** Worker-tier agent roles (use qwen3 model) */
export type WorkerRole = 'builder' | 'quarry' | 'hauler' | 'guard' | 'farmer' | 'priest';

/** Union of all agent roles across all tiers */
export type AgentRole = PlannerRole | OperationalRole | WorkerRole;

/** Current lifecycle status of an agent */
export type AgentStatus = 'active' | 'idle' | 'error' | 'stopped';

/** Personality traits that influence agent decision-making style */
export type PersonalityTrait =
  | 'ambitious'
  | 'cautious'
  | 'diplomatic'
  | 'innovative'
  | 'traditional'
  | 'aggressive'
  | 'defensive';


/** System operating mode controlling agent autonomy level */
export type OperatingMode = 'structured' | 'guided_autonomy' | 'free_thinking';

/** A running agent instance in the system */
export interface AgentInstance {
  id: string;
  role: AgentRole;
  tier: AgentTier;
  status: AgentStatus;
  civilizationId: string;
  createdAt: string;
  lastActiveAt: string;
}

/** Configuration options when spawning a new agent */
export interface AgentConfig {
  role: AgentRole;
  civilizationId: string;
  personalityTraits?: string[];
}

/** Filter options for listing agents */
export interface AgentFilter {
  tier?: AgentTier;
  role?: AgentRole;
  status?: AgentStatus;
  civilizationId?: string;
}

/** Health report for a single agent */
export interface AgentHealthReport {
  agentId: string;
  role: AgentRole;
  status: AgentStatus;
  lastActiveAt: string;
  healthy: boolean;
  issues: string[];
}

/** Context and memory for an agent workspace */
export interface AgentContext {
  operatingMode: OperatingMode;
  recentDecisions: string[];
  personalityTraits?: PersonalityTrait[];
  workspaceState?: Record<string, unknown>;
}

/** Tool names available to agents (restricted by tier) */
export type ToolName =
  // Planner-tier strategic tools
  | 'llm_query'
  | 'task_create'
  | 'task_assign'
  | 'broadcast'
  | 'mode_change'
  | 'blueprint_approve'
  | 'resource_allocate'
  | 'ceremony_approve'
  | 'agent_spawn'
  | 'agent_terminate'
  // Operational-tier coordination tools
  | 'resource_query'
  | 'zone_manage'
  | 'bot_command'
  | 'health_check'
  | 'message_send'
  | 'report_generate'
  // Worker-tier execution tools
  | 'bot_move'
  | 'bot_place_block'
  | 'bot_dig'
  | 'bot_attack'
  | 'bot_equip'
  | 'bot_drop'
  | 'inventory_check'
  | 'path_find'
  | 'task_complete';

/** Message passed between agents via the message bus */
export interface AgentMessage {
  id: string;
  from: string;
  to: string;
  content: string;
  timestamp: string;
  correlationId?: string;
}

/** Result of a safety validation check */
export interface SafetyResult {
  allowed: boolean;
  reason?: string;
  violationType?: 'prohibited-block' | 'prohibited-command' | 'rate-limit' | 'timeout' | 'loop-limit';
  /** Structured PyramidError for programmatic handling (when allowed is false) */
  pyramidError?: PyramidError;
}

/** An action requested by an agent */
export interface AgentAction {
  type: string;
  payload: Record<string, unknown>;
}

/** Overall system state snapshot */
export interface SystemState {
  operatingMode: OperatingMode;
  agentCount: number;
  activeAgents: number;
  startedAt: string;
  civilizationId: string;
}
