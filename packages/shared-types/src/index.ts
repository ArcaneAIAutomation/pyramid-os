/**
 * @pyramid-os/shared-types
 * Central export of all shared TypeScript types for PYRAMID OS
 */

// Agent types
export type {
  AgentTier,
  PlannerRole,
  OperationalRole,
  WorkerRole,
  AgentRole,
  AgentStatus,
  PersonalityTrait,
  OperatingMode,
  AgentInstance,
  AgentConfig,
  AgentFilter,
  AgentHealthReport,
  AgentContext,
  ToolName,
  AgentMessage,
  SafetyResult,
  AgentAction,
  SystemState,
} from './agent.js';

// Task types
export type {
  TaskType,
  TaskStatus,
  TaskPriority,
  Task,
  TaskResult,
  TaskDefinition,
  TaskFilter,
} from './task.js';

// Resource types
export type {
  ResourceType,
  Resource,
  ResourceThreshold,
  ResourceAlert,
  ResourceTransaction,
  TransactionFilter,
  ResourcePrediction,
  ResourceRequirement,
} from './resource.js';

// Blueprint types
export type {
  Vec3,
  BlockPlacement,
  Dimensions,
  BlueprintMetadata,
  BlueprintProgress,
  Blueprint,
  PyramidParams,
  HousingParams,
  FarmParams,
  TempleParams,
  ValidationResult,
  ValidationError,
  ValidationWarning,
  ConflictReport,
} from './blueprint.js';

// Config types
export type {
  OllamaConfig,
  SafetyBoundary,
  ConnectionProfile,
  PyramidConfig,
} from './config.js';

// Config loader
export { loadConfig } from './config-loader.js';

// Event types
export type {
  AlertSeverity,
  HealthStatus,
  WebSocketEvent,
  HealthCheckResult,
  SystemHealthReport,
  SystemAlert,
  SecurityIncident,
} from './events.js';

// API types
export type {
  ApiError,
  PaginatedResponse,
  ListAgentsQuery,
  ListAgentsResponse,
  GetAgentResponse,
  ListTasksQuery,
  ListTasksResponse,
  GetTaskResponse,
  CreateTaskRequest,
  CreateTaskResponse,
  GetResourcesResponse,
  ListBuildsResponse,
  GetBuildResponse,
  SystemStartResponse,
  SystemStopResponse,
  SystemPauseResponse,
  SetModeRequest,
  SetModeResponse,
  ExportSnapshotResponse,
  ImportSnapshotRequest,
  ImportSnapshotResponse,
  SnapshotInfo,
  ListSnapshotsResponse,
  HealthResponse,
  MetricsResponse,
} from './api.js';

// Misc types
export type {
  BotInstance,
  BotStatus,
  InventoryItem,
  LLMPrompt,
  LLMResponse,
  LLMRequest,
  OllamaHealth,
  LLMMetrics,
  JsonSnapshot,
  BotAction,
  ActionResult,
  NavigationResult,
  Path,
  PatrolRoute,
  ConnectionHealth,
  ServerValidation,
  Connection,
} from './misc.js';

// Cache
export type { CacheConfig, CacheStats } from './cache.js';
export { Cache, CACHE_CONFIGS } from './cache.js';

// Plugin types
export type {
  PluginManifest,
  ExtensionPoint,
  Plugin,
  PluginContext,
  PluginLogger,
  PluginStatus,
  AgentFactory,
  TaskHandler,
  EventHandler,
  SystemEvent,
  SystemEventPayload,
} from './plugin.js';

// Error types
export {
  ErrorCategory,
  PyramidError,
  ERROR_REGISTRY,
  createPyramidError,
} from './errors.js';
export type { ErrorSeverity, ErrorRegistryEntry } from './errors.js';

// Path resolver
export type { PathResolver } from './paths.js';
export { CrossPlatformPathResolver } from './paths.js';
