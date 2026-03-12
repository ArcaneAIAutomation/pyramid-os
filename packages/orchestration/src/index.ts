/**
 * @pyramid-os/orchestration
 * OpenClaw orchestration layer for PYRAMID OS.
 * Exports all core interfaces for agent management, LLM routing,
 * workspace isolation, and safety enforcement.
 */

export type {
  OpenClaw,
  AgentManager,
  AgentWorkspace,
  LLMRouter,
  SafetyEnforcer,
} from './interfaces.js';

export { AgentWorkspaceImpl, WORKSPACE_TEMPLATES, generatePersonalityPromptModifier } from './agent-workspace.js';

export {
  LLMRouterImpl,
  MODEL_MAP,
  OllamaUnavailableError,
  ModelNotAvailableError,
  LLMTimeoutError,
} from './llm-router.js';
export type { LLMRouterConfig, AgentTierResolver } from './llm-router.js';

export {
  SafetyEnforcerImpl,
  DEFAULT_PROHIBITED_BLOCKS,
  DEFAULT_PROHIBITED_COMMANDS,
  DEFAULT_MAX_DECISION_TIME_MS,
} from './safety-enforcer.js';
export type { SafetyEnforcerConfig, IncidentLogger } from './safety-enforcer.js';

export { MessageBusImpl } from './message-bus.js';
export type { TierResolver, MessageLogger } from './message-bus.js';

export { AgentManagerImpl, DEFAULT_ROLE_TIER_MAP } from './agent-manager.js';
export type { ManagedAgent } from './agent-manager.js';

export { ModeControllerImpl } from './mode-controller.js';
export type { ModeChangeListener, ModePersister } from './mode-controller.js';

export { OpenClawImpl } from './openclaw.js';

export { IntentionEngineImpl } from './intention-engine.js';
export type {
  Intention,
  RoleChangeProposal,
  ReorganizationProposal,
  IntentionEngineConfig,
} from './intention-engine.js';

export {
  CircuitBreakerImpl,
  CircuitOpenError,
  CIRCUIT_BREAKER_DEFAULTS,
} from './circuit-breaker.js';
export type {
  CircuitState,
  CircuitBreakerConfig,
  StateChangeCallback,
} from './circuit-breaker.js';

// Agent role implementations
export {
  BaseAgent,
  PharaohAgent,
  VizierAgent,
  ArchitectAgent,
  ScribeAgent,
  BotForemanAgent,
  DefenseAgent,
  OpsAgent,
  UIMasterAgent,
} from './agents/index.js';
export type {
  LLMRequestDelegate,
  SendMessageDelegate,
  StateUpdateDelegate,
} from './agents/index.js';

export { RecoveryManagerImpl } from './recovery.js';
export type {
  SystemHealthState,
  ComponentFailure,
  RecoveryStrategy,
  ShutdownDeps,
  HealthStateChangeCallback,
  RecoveryManagerConfig,
} from './recovery.js';

export { PluginRegistryImpl } from './plugin-registry.js';
export type { PluginInfo, PluginEntry } from './plugin-registry.js';

export {
  PluginLoaderImpl,
  PluginIncompatibleError,
  PluginManifestError,
  PluginLoadError,
  parseSemver,
  compareSemver,
} from './plugin-loader.js';
export type { PluginLoaderConfig } from './plugin-loader.js';

export { EventHookManager } from './event-hooks.js';

export { PluginSandboxImpl, PLUGIN_FAILURE_THRESHOLD } from './plugin-sandbox.js';


export { DegradationManager } from './degradation.js';
export type {
  DegradationLevel,
  ComponentState,
  FallbackSpec,
  LevelChangeCallback,
} from './degradation.js';

export {
  FallbackRegistry,
  CriticalOperationManager,
  OperationPriority,
  COMPONENT_NAMES,
} from './fallback-specs.js';
export type {
  FallbackDeps,
  PrioritizedOperation,
  ComponentName,
  OperationPriorityLevel,
} from './fallback-specs.js';

