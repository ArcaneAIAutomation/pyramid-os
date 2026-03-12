/**
 * Plugin and extensibility types for PYRAMID OS
 * Defines interfaces for the plugin system that allows extending
 * the platform with new agent roles, task types, blueprint generators,
 * and event handlers.
 *
 * @see Requirement 26.1, 26.2
 */

import type { AgentTier, AgentConfig, AgentInstance, ToolName, SystemState } from './agent.js';
import type { Task, TaskResult } from './task.js';
import type { BotInstance } from './misc.js';
import type { ValidationResult } from './blueprint.js';

// ---------------------------------------------------------------------------
// Plugin Manifest & Extension Points
// ---------------------------------------------------------------------------

/** Metadata describing a plugin package */
export interface PluginManifest {
  /** Unique plugin identifier */
  id: string;
  /** Display name */
  name: string;
  /** Semver version string */
  version: string;
  /** Short description of what the plugin does */
  description: string;
  /** Plugin author */
  author: string;
  /** Minimum PYRAMID OS version required */
  minSystemVersion: string;
  /** What this plugin extends */
  extensionPoints: ExtensionPoint[];
  /** Entry module path */
  entryModule: string;
}

/** Discriminated union describing what a plugin extends */
export type ExtensionPoint =
  | { type: 'agent-factory'; role: string; tier: AgentTier }
  | { type: 'task-handler'; taskType: string }
  | { type: 'blueprint-generator'; structureType: string }
  | { type: 'event-handler'; events: SystemEvent[] }
  | { type: 'custom'; id: string; description: string };

// ---------------------------------------------------------------------------
// Plugin Lifecycle
// ---------------------------------------------------------------------------

/** Current status of a loaded plugin */
export type PluginStatus = 'loaded' | 'unloaded' | 'error';

/** Interface every plugin must implement */
export interface Plugin {
  /** Plugin metadata */
  manifest: PluginManifest;
  /** Called when the plugin is loaded into the system */
  onLoad(context: PluginContext): Promise<void>;
  /** Called when the plugin is unloaded */
  onUnload(): Promise<void>;
  /** Health check for the plugin */
  healthCheck(): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Plugin Context (provided by the system to plugins)
// ---------------------------------------------------------------------------

/** Minimal logger interface exposed to plugins */
export interface PluginLogger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, error?: Error, context?: Record<string, unknown>): void;
}

/** Context provided to a plugin during onLoad */
export interface PluginContext {
  /** Logger scoped to this plugin */
  logger: PluginLogger;
  /** Read-only configuration for the plugin */
  config: Record<string, unknown>;
  /** Register an agent factory for a custom role */
  registerAgentFactory(role: string, factory: AgentFactory): void;
  /** Register a handler for a custom task type */
  registerTaskHandler(taskType: string, handler: TaskHandler): void;
  /** Register a handler for system events */
  registerEventHandler(event: SystemEvent, handler: EventHandler): void;
  /** Access read-only system state */
  getSystemState(): Readonly<SystemState>;
}

// ---------------------------------------------------------------------------
// Extension Interfaces
// ---------------------------------------------------------------------------

/** Factory for creating custom agent types */
export interface AgentFactory {
  /** Create an agent instance for the given role and config */
  createAgent(role: string, config: AgentConfig): Promise<AgentInstance>;
  /** Return the tool permissions for agents created by this factory */
  getPermissions(): ToolName[];
}

/** Handler for custom task types */
export interface TaskHandler {
  /** Check whether this handler can process the given task type */
  canHandle(taskType: string): boolean;
  /** Validate task parameters before execution */
  validate(params: Record<string, unknown>): ValidationResult;
  /** Execute the task using the assigned bot */
  execute(task: Task, bot: BotInstance): Promise<TaskResult>;
}

/** Handler for system events */
export interface EventHandler {
  /** Handle a system event */
  handle(event: SystemEventPayload): void | Promise<void>;
}

// ---------------------------------------------------------------------------
// System Events
// ---------------------------------------------------------------------------

/** Union of all system event types */
export type SystemEvent =
  | 'agent:created'
  | 'agent:destroyed'
  | 'task:completed'
  | 'task:failed'
  | 'resource:low'
  | 'build:phase-complete'
  | 'ceremony:started'
  | 'ceremony:completed'
  | 'mode:changed'
  | 'system:shutdown';

/** Payload delivered with a system event */
export interface SystemEventPayload {
  /** The event type */
  type: SystemEvent;
  /** ISO-8601 timestamp of when the event occurred */
  timestamp: string;
  /** Event-specific data */
  data: Record<string, unknown>;
}
