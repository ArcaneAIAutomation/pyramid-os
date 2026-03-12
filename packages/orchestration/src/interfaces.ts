/**
 * @pyramid-os/orchestration
 * Core interfaces for the OpenClaw orchestration layer.
 * These define the contracts for agent management, LLM routing,
 * workspace isolation, and safety enforcement.
 */

import type {
  AgentTier,
  AgentRole,
  AgentConfig,
  AgentMessage,
  AgentAction,
  AgentHealthReport,
  SafetyResult,
  SystemState,
  ToolName,
  OperatingMode,
  PersonalityTrait,
  LLMPrompt,
  LLMResponse,
  PyramidConfig,
} from '@pyramid-os/shared-types';

/**
 * OpenClaw — Main orchestrator interface.
 * Coordinates all agents with hierarchical control, routes LLM requests,
 * manages inter-agent communication, and enforces operating modes.
 */
export interface OpenClaw {
  /** Initialize orchestrator, load persisted agent states */
  initialize(config: PyramidConfig): Promise<void>;

  /** Spawn a new agent with role-specific workspace, returns agentId */
  spawnAgent(role: AgentRole, config?: Partial<AgentConfig>): Promise<string>;

  /** Terminate an agent, persisting its state */
  terminateAgent(agentId: string): Promise<void>;

  /** Submit an LLM request routed by agent tier */
  requestLLM(agentId: string, prompt: LLMPrompt): Promise<LLMResponse>;

  /** Send a message between agents (hierarchy-enforced) */
  sendMessage(from: string, to: string, message: AgentMessage): Promise<void>;

  /** Broadcast message from planner to all agents */
  broadcast(from: string, message: AgentMessage): Promise<void>;

  /** Change operating mode with graceful transition */
  setOperatingMode(mode: OperatingMode): Promise<void>;

  /** Get current system state */
  getState(): SystemState;

  /** Graceful shutdown — persist all state */
  shutdown(): Promise<void>;
}

/**
 * AgentManager — Agent lifecycle management.
 * Handles creation, restart, health checks, and state persistence/restoration.
 */
export interface AgentManager {
  /** Create agent instance with isolated workspace, returns agentId */
  create(role: AgentRole, config?: Partial<AgentConfig>): Promise<string>;

  /** Restart a failed agent, reassigning its tasks */
  restart(agentId: string): Promise<void>;

  /** Health check all agents */
  healthCheck(): Promise<AgentHealthReport[]>;

  /** Persist agent state to storage */
  persistState(agentId: string): Promise<void>;

  /** Restore agent state from storage */
  restoreState(agentId: string): Promise<void>;
}

/**
 * AgentWorkspace — Per-agent isolated workspace.
 * Provides tool access control and state persistence for each agent.
 */
export interface AgentWorkspace {
  /** The agent this workspace belongs to */
  agentId: string;

  /** The agent's tier (planner, operational, worker) */
  tier: AgentTier;

  /** Tools this agent is allowed to use */
  allowedTools: ToolName[];

  /** Personality traits influencing decision-making style (optional) */
  personalityTraits: PersonalityTrait[];

  /** Validate a tool request against workspace permissions */
  validateToolAccess(tool: ToolName): boolean;

  /** Persist workspace state */
  save(): Promise<void>;

  /** Restore workspace state */
  load(): Promise<void>;
}

/**
 * LLMRouter — LLM request routing.
 * Routes agent requests to the appropriate Ollama model based on agent tier.
 */
export interface LLMRouter {
  /** Route request to appropriate Ollama model based on agent tier */
  route(agentId: string, prompt: LLMPrompt): Promise<LLMResponse>;

  /** Check Ollama availability */
  healthCheck(): Promise<boolean>;
}

/**
 * SafetyEnforcer — Safety boundary validation.
 * Validates agent actions against safety constraints and enforces boundaries.
 */
export interface SafetyEnforcer {
  /** Validate an agent action against safety boundaries */
  validate(agentId: string, action: AgentAction): SafetyResult;

  /** Check for prohibited block types (TNT, lava, fire) */
  isProhibitedBlock(blockType: string): boolean;

  /** Check for prohibited commands */
  isProhibitedCommand(command: string): boolean;

  /** Enforce timeout on agent operations */
  enforceTimeout(agentId: string, operationMs: number): void;

  /** Emergency stop — halt all agents and bots immediately */
  emergencyStop(): Promise<void>;
}
