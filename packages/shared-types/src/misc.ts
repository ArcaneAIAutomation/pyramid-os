/**
 * Miscellaneous types for PYRAMID OS
 * Defines BotInstance, LLM types, and JSON snapshot
 */

import type { WorkerRole } from './agent.js';
import type { AgentInstance } from './agent.js';
import type { Task } from './task.js';
import type { Resource } from './resource.js';
import type { Blueprint } from './blueprint.js';
import type { Vec3 } from './blueprint.js';

/** Re-export Vec3 from blueprint for convenience */
export type { Vec3 };

/** A Mineflayer bot instance connected to a Minecraft server */
export interface BotInstance {
  id: string;
  role: WorkerRole;
  status: 'connected' | 'disconnected' | 'reconnecting';
  position?: Vec3;
  health?: number;
  connectionId: string;
}

/** Current status details for a bot */
export interface BotStatus {
  botId: string;
  position: Vec3;
  health: number;
  food: number;
  inventory: InventoryItem[];
  connectionStatus: 'connected' | 'disconnected' | 'reconnecting';
  latencyMs: number;
}

/** An item in a bot's inventory */
export interface InventoryItem {
  type: string;
  count: number;
  slot: number;
}

/** A prompt sent to the Ollama LLM */
export interface LLMPrompt {
  systemPrompt: string;
  userMessage: string;
  agentId: string;
  context?: Record<string, unknown>;
}

/** A response received from the Ollama LLM */
export interface LLMResponse {
  content: string;
  model: string;
  latencyMs: number;
  agentId: string;
}

/** A queued LLM request */
export interface LLMRequest {
  id: string;
  agentId: string;
  prompt: LLMPrompt;
  enqueuedAt: string;
}

/** Ollama server health status */
export interface OllamaHealth {
  available: boolean;
  models: string[];
  latencyMs: number;
}

/** LLM performance metrics */
export interface LLMMetrics {
  totalRequests: number;
  averageLatencyMs: number;
  queueDepth: number;
  errorRate: number;
}

/**
 * A complete point-in-time export of civilization state.
 * Round-trip property: import(export()) restores equivalent state.
 */
export interface JsonSnapshot {
  version: string;
  civilizationId: string;
  exportedAt: string;
  agents: AgentInstance[];
  tasks: Task[];
  resources: Resource[];
  blueprints: Blueprint[];
}

/** A bot action to be executed by the Minecraft Controller */
export interface BotAction {
  type: 'place_block' | 'dig' | 'attack' | 'equip' | 'drop' | 'chat' | 'move_to';
  params: Record<string, unknown>;
}

/** Result of a bot action execution */
export interface ActionResult {
  success: boolean;
  action: string;
  botId: string;
  outcome: string;
  timestamp: string;
  error?: string;
}

/** Result of a navigation operation */
export interface NavigationResult {
  success: boolean;
  path: Vec3[];
  distanceTraveled: number;
  reason?: string;
}

/** A cached or computed navigation path */
export interface Path {
  nodes: Vec3[];
  totalDistance: number;
  computedAt: string;
}

/** A patrol route defined by waypoints */
export interface PatrolRoute {
  id: string;
  waypoints: Vec3[];
  looping: boolean;
}

/** Connection health metrics */
export interface ConnectionHealth {
  connectionId: string;
  latencyMs: number;
  packetLoss: number;
  stable: boolean;
  lastCheckedAt: string;
}

/** Result of server compatibility validation */
export interface ServerValidation {
  compatible: boolean;
  serverVersion: string;
  issues: string[];
}

/** A Minecraft server connection */
export interface Connection {
  id: string;
  host: string;
  port: number;
  connectedAt: string;
  status: 'connected' | 'disconnected';
}
