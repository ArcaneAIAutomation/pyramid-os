# Implementation Plan: PYRAMID OS

## Overview

Incremental implementation of the PYRAMID OS TypeScript pnpm monorepo across 8 phases. Each phase builds on the previous, ending with all components wired together. The design document uses TypeScript throughout — no language selection needed.

## Tasks

- [x] 1. Monorepo scaffold, shared types, and configuration system
  - [x] 1.1 Initialize pnpm workspace with root package.json and pnpm-workspace.yaml
    - Create root `package.json` with workspace scripts (build, test, lint, format)
    - Create `pnpm-workspace.yaml` listing all packages
    - Create `tsconfig.base.json` with strict mode, Node 22 target, composite enabled
    - Create `.eslintrc.js` and `.prettierrc` at root
    - Create `.gitignore` excluding `dist/`, `node_modules/`, `*.db`, `logs/`, `data/`
    - _Requirements: 11.1, 11.2, 11.6, 11.7, 11.8, 11.9, 11.10, 42.1_

  - [x] 1.2 Create `packages/shared-types` package with all core TypeScript types
    - Define `AgentTier`, `AgentRole`, `PlannerRole`, `OperationalRole`, `WorkerRole`, `AgentStatus`, `OperatingMode` in `agent.ts`
    - Define `Task`, `TaskType`, `TaskStatus`, `TaskPriority`, `TaskResult` in `task.ts`
    - Define `Resource`, `ResourceType`, `ResourceThreshold`, `ResourceAlert` in `resource.ts`
    - Define `Blueprint`, `BlockPlacement`, `BlueprintMetadata`, `Dimensions`, `BlueprintProgress` in `blueprint.ts`
    - Define `PyramidConfig`, `OllamaConfig`, `ConnectionProfile`, `SafetyBoundary` in `config.ts`
    - Define all `WebSocketEvent` union types and `AlertSeverity`, `HealthStatus` in `events.ts`
    - Define all API request/response shapes in `api.ts`
    - Define `Vec3`, `BotInstance`, `LLMPrompt`, `LLMResponse`, `JsonSnapshot` in remaining files
    - Export everything from `index.ts`
    - _Requirements: 11.3, 11.4_

  - [x] 1.3 Create configuration loader in `packages/shared-types/src/config-loader.ts`
    - Implement YAML/JSON config file loading with `js-yaml`
    - Implement Zod schema validation for all config sections
    - Implement environment variable override support (`${VAR_NAME}` syntax)
    - Throw descriptive errors identifying the specific invalid field on validation failure
    - Export `loadConfig(path: string): PyramidConfig`
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 15.7, 15.8, 15.9, 15.10, 15.11, 38.3_

  - [x] 1.4 Write property test for config round-trip
    - **Property: Config serialized to JSON and re-parsed produces equivalent config object**
    - **Validates: Requirements 15.1, 15.9**

  - [x] 1.5 Create `config/default.yaml` with all default values from the design
    - Include Ollama, Minecraft profiles, agent counts, resource thresholds, safety boundaries, control-centre, logging, API, database, workspace sections
    - _Requirements: 15.1–15.8_


- [x] 2. Logger and data layer (SQLite + snapshots)
  - [x] 2.1 Create `packages/logger` with structured logging
    - Implement `Logger` interface with `debug`, `info`, `warn`, `error` methods
    - Output JSON structured logs with ISO timestamps to console and rotating files
    - Implement log rotation at 10MB with gzip compression of old files
    - Implement correlation ID tracking via `AsyncLocalStorage`
    - Implement log filtering by level, agent ID, and time range
    - _Requirements: 12.1, 12.2, 12.6, 12.7, 12.8, 12.10_

  - [x] 2.2 Create `packages/data-layer` with SQLite schema and migrations
    - Implement `DatabaseManager` with `better-sqlite3` connection pooling (pool size from config)
    - Create `migrations/001_initial_schema.ts` with all tables from the design (civilizations, agents, tasks, task_dependencies, resources, resource_transactions, zones, blueprints, build_phases, bots, ceremonies, agent_messages, health_checks, security_incidents, metrics)
    - Implement `migrate()` that runs pending migrations in order
    - Implement `backup(path)` that copies the DB file before migrations
    - Implement `verifyIntegrity()` using SQLite `PRAGMA integrity_check`
    - _Requirements: 10.1, 10.2, 10.5, 10.6, 10.8, 10.10_

  - [x] 2.3 Implement entity repositories in `packages/data-layer/src/repositories/`
    - Create `AgentRepository` (CRUD + list by tier/role/civilization)
    - Create `TaskRepository` (CRUD + list by status/agent/priority + dependency edges)
    - Create `ResourceRepository` (CRUD + list below threshold)
    - Create `ZoneRepository` (CRUD + list by civilization)
    - Create `BlueprintRepository` (CRUD + list by type)
    - Create `BotRepository` (CRUD + list by status)
    - Implement retry with exponential backoff (up to 3 attempts) on write failures
    - _Requirements: 10.1, 10.7_

  - [x] 2.4 Implement `SnapshotManager` in `packages/data-layer/src/snapshot.ts`
    - Implement `export(): Promise<JsonSnapshot>` reading all tables for a civilization
    - Implement `import(snapshot)` restoring all entities transactionally
    - Implement `validate(snapshot)` checking schema version and required fields
    - Implement `list()` scanning the snapshots directory
    - _Requirements: 10.3, 10.4, 10.9_

  - [x] 2.5 Write property test for JSON snapshot round-trip
    - **Property 1: `import(export())` restores an equivalent system state — all agents, tasks, resources, zones, blueprints, bots, and ceremonies match the original**
    - **Validates: Requirements 10.11, 18.7**


- [x] 3. Blueprint system
  - [x] 3.1 Implement `Blueprint` data model and serializer in `packages/blueprint`
    - Create `packages/blueprint` package with its own `package.json` and `tsconfig.json`
    - Implement `Blueprint`, `BlockPlacement`, `BlueprintMetadata`, `BlueprintProgress` types (re-export from shared-types)
    - Implement `BlueprintSerializer.serialize(blueprint): string` (JSON.stringify with stable key order)
    - Implement `BlueprintSerializer.deserialize(json): Blueprint` with structural validation
    - Implement `BlueprintSerializer.validateJson(json): boolean`
    - _Requirements: 4.1, 4.2, 4.9_

  - [x] 3.2 Write property test for Blueprint round-trip serialization
    - **Property 2: `deserialize(serialize(blueprint))` produces a structurally equivalent Blueprint for any valid blueprint — all fields, placements, and metadata match**
    - **Validates: Requirements 4.10, 18.6**

  - [x] 3.3 Implement `BlueprintGenerator` for pyramids and districts
    - Implement `generatePyramid(params: PyramidParams): Blueprint` using the layer-inset algorithm from the design
    - Implement `generateHousing(params: HousingParams): Blueprint`
    - Implement `generateFarm(params: FarmParams): Blueprint`
    - Implement `generateTemple(params: TempleParams): Blueprint`
    - Assign sequential `index` values to all `BlockPlacement` entries
    - Populate `metadata.requiredResources` by counting block types
    - _Requirements: 4.4, 4.5, 4.6, 20.1, 23.1, 23.2, 23.3_

  - [x] 3.4 Implement `BlueprintValidator`
    - Validate all block type strings are non-empty and follow Minecraft ID format (`namespace:block`)
    - Validate all coordinates are finite numbers within ±30,000,000 (Minecraft world border)
    - Validate no duplicate `(x, y, z)` positions in placements
    - Validate `dimensions` match the actual bounding box of placements
    - Return `ValidationResult` with typed `ValidationError[]` and `ValidationWarning[]`
    - _Requirements: 4.3, 35.1, 35.2, 35.3, 35.4, 35.8_

  - [x] 3.5 Implement `ProgressTracker` for construction progress
    - Track `placedBlocks` count and compute `percentComplete`
    - Expose `getNextPlacement(): BlockPlacement | undefined` returning the lowest unplaced `index`
    - _Requirements: 4.7, 4.8_

  - [x] 3.6 Checkpoint — ensure all blueprint tests pass
    - Ensure all tests pass, ask the user if questions arise.


- [x] 4. OpenClaw orchestration layer
  - [x] 4.1 Create `packages/orchestration` package scaffold
    - Create `package.json`, `tsconfig.json` referencing `shared-types`, `data-layer`, `logger`
    - Define all interfaces: `OpenClaw`, `AgentManager`, `AgentWorkspace`, `LLMRouter`, `SafetyEnforcer`
    - _Requirements: 1.1, 11.2_

  - [x] 4.2 Implement `AgentWorkspace` with tool permission enforcement
    - Implement `WORKSPACE_TEMPLATES` mapping each `AgentTier` to its allowed `ToolName[]`
    - Implement `validateToolAccess(tool): boolean` checking against the template
    - Implement `save()` and `load()` persisting workspace state via `AgentRepository`
    - _Requirements: 1.2, 1.3, 33.1, 33.2, 33.3, 33.4, 33.5, 33.6, 33.7, 33.8, 33.9, 33.10_

  - [x] 4.3 Implement `LLMRouter` with Ollama integration and request queuing
    - Implement `route(agentId, prompt)` selecting model via `MODEL_MAP` (`gpt-oss:20b` for planner, `qwen3` for others)
    - Implement request queue with concurrency limit from config (`max_concurrent_requests`)
    - Implement `healthCheck()` calling `GET /api/tags` on Ollama
    - Return descriptive error and halt agent ops when Ollama is unreachable (req 9.4)
    - Provide installation instructions when a required model is missing (req 9.5)
    - Implement timeout handling with fallback behavior (req 9.9)
    - Log response latency for every request (req 9.8)
    - _Requirements: 1.4, 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9, 9.10_

  - [x] 4.4 Implement `SafetyEnforcer` with boundary validation
    - Implement `validate(agentId, action): SafetyResult` checking prohibited blocks, commands, and rate limits
    - Implement `isProhibitedBlock(blockType)` and `isProhibitedCommand(command)` from config
    - Implement `enforceTimeout(agentId, operationMs)` aborting operations exceeding `max_decision_time_ms`
    - Implement `emergencyStop()` broadcasting halt to all agents and bots
    - Log every violation to `security_incidents` table with agent ID, violation type, and action taken
    - _Requirements: 8.6, 8.7, 31.1, 31.2, 31.3, 31.4, 31.5, 31.6, 31.7, 31.11_

  - [x] 4.5 Implement `MessageBus` for inter-agent communication
    - Implement hierarchy-enforced routing: Planner → Operational → Worker only
    - Implement async message queuing for unavailable agents
    - Implement broadcast from Planner to all agents in a civilization
    - Implement request-response pattern with correlation IDs
    - Log all messages to `agent_messages` table
    - _Requirements: 1.7, 24.1, 24.2, 24.3, 24.4, 24.5, 24.6, 24.7, 24.8, 24.9, 24.10_

  - [x] 4.6 Implement `AgentManager` with lifecycle and recovery
    - Implement `create(role, config)` spawning agent with workspace from template
    - Implement `restart(agentId)` recovering a failed agent and reassigning its tasks
    - Implement `healthCheck()` returning `AgentHealthReport[]` for all agents
    - Implement `persistState` / `restoreState` via `AgentRepository`
    - _Requirements: 1.5, 1.6, 13.1, 40.3, 40.4, 40.5_

  - [x] 4.7 Implement `ModeController` for operating mode transitions
    - Implement `setOperatingMode(mode)` with graceful transition (notify all agents, update DB)
    - Implement mode-specific behavior guards (Structured: strict queue, Guided: role-bounded, Free: self-directed with safety)
    - Log all mode changes with active mode for audit
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.8, 8.9, 8.10_

  - [x] 4.8 Implement `OpenClaw` main orchestrator wiring all sub-components
    - Implement `initialize(config)` loading persisted agent states from DB
    - Implement `spawnAgent`, `terminateAgent`, `requestLLM`, `sendMessage`, `broadcast`, `setOperatingMode`, `getState`, `shutdown`
    - Implement graceful shutdown saving all state before terminating
    - _Requirements: 1.1, 1.8, 13.10_

  - [x] 4.9 Write unit tests for SafetyEnforcer boundary validation
    - Test prohibited block rejection, prohibited command rejection, timeout enforcement, and emergency stop
    - _Requirements: 31.1, 31.2, 31.3, 31.4_

  - [x] 4.10 Write unit tests for MessageBus hierarchy enforcement
    - Test that Worker → Planner messages are rejected, Planner → Worker are allowed
    - _Requirements: 24.4_

  - [x] 4.11 Implement agent role behaviors (Pharaoh, Vizier, Architect, Scribe, Bot-Foreman, Defense, Ops, UI-Master)
    - Implement `PharaohAgent` making top-level strategic decisions via LLM
    - Implement `VizierAgent` coordinating resource allocation and task prioritization
    - Implement `ArchitectAgent` generating and approving blueprints
    - Implement `ScribeAgent` maintaining records and generating reports
    - Implement `BotForeman` assigning tasks to Worker agents
    - Implement `DefenseAgent` coordinating Guard workers
    - Implement `OpsAgent` monitoring health and triggering recovery
    - Implement `UIMasterAgent` pushing state updates to Control Centre
    - Each agent uses LLM only for high-level interpretation, not action execution
    - _Requirements: 7.1, 7.2, 7.4, 7.5, 7.6, 7.7, 7.8, 7.9, 7.10, 7.11, 7.12, 7.13_

  - [x] 4.12 Checkpoint — ensure orchestration tests pass
    - Ensure all tests pass, ask the user if questions arise.


- [x] 5. Minecraft Controller service
  - [x] 5.1 Create `packages/minecraft-controller` package scaffold
    - Create `package.json` with `mineflayer`, `mineflayer-pathfinder` dependencies
    - Create `tsconfig.json` referencing `shared-types`, `data-layer`, `logger`
    - _Requirements: 2.1, 11.2_

  - [x] 5.2 Implement `ServerConnector` with multi-auth support
    - Implement `connectLocal(host, port)` using Mineflayer with no auth
    - Implement `connectWithCredentials(host, port, username, password)`
    - Implement `connectMicrosoft(host, port, msToken)`
    - Implement `validateServer(connection)` checking Minecraft version compatibility
    - Implement `onDisconnect` callback detecting disconnection within 10 seconds
    - Implement `getHealth(connectionId)` returning latency and connection stability
    - Return descriptive errors distinguishing network, auth, and server issues
    - Store connection profiles from config
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 38.5_

  - [x] 5.3 Implement `BotManager` with registry and reconnection
    - Implement bot registry mapping `botId → BotInstance` persisted in `bots` table
    - Implement `connectBot(profile, role)` creating a Mineflayer bot and registering it
    - Implement `disconnectBot(botId)` gracefully
    - Implement reconnection with exponential backoff on disconnect (req 2.5)
    - Implement `getBotStatus(botId)` returning position, health, inventory, connection status
    - Implement rate limiting via `BotRateLimiter` (token bucket: 10 actions/sec per bot)
    - Log all bot actions with timestamps and outcomes
    - _Requirements: 2.1, 2.4, 2.5, 2.7, 2.9, 2.10, 31.5_

  - [x] 5.4 Implement `Pathfinder` with A* navigation
    - Integrate `mineflayer-pathfinder` plugin for A* path calculation
    - Implement `findPath(start, goal, options)` respecting `PathOptions` (avoidWater, avoidLava, canSwim, canClimb, maxDistance)
    - Implement `recalculate(currentPath, obstacleAt)` for dynamic re-routing
    - Implement path caching with `cachePath` / `getCachedPath`
    - Implement `createPatrolRoute(waypoints)` for Guard bots
    - Log pathfinding failures with start/end coordinates and reason
    - _Requirements: 37.1, 37.2, 37.3, 37.4, 37.5, 37.6, 37.7, 37.8, 37.9, 37.10_

  - [x] 5.5 Implement `ActionExecutor` translating agent commands to Mineflayer calls
    - Implement `executeAction(botId, action)` dispatching to Mineflayer methods (placeBlock, dig, attack, equip, drop, chat)
    - Validate preconditions before execution (has required tools, sufficient inventory space)
    - Return `ActionResult` with success/failure and outcome details
    - Report errors back to the controlling agent via `MessageBus`
    - _Requirements: 2.3, 2.8, 16.9_

  - [x] 5.6 Implement Worker role behaviors (Builder, Quarry, Hauler, Guard, Farmer, Priest)
    - `BuilderWorker`: place blocks in exact Blueprint order via `ProgressTracker.getNextPlacement()`
    - `QuarryWorker`: mine blocks using deterministic row-by-row pattern
    - `HaulerWorker`: transport items using shortest-path routing
    - `GuardWorker`: patrol waypoints, detect hostile entities, report to Defense agent
    - `FarmerWorker`: plant/harvest crops in grid pattern
    - `PriestWorker`: execute ceremony actions at temple zones
    - All workers use pathfinding (not LLM) for navigation
    - All workers report task completion with task ID and outcome
    - _Requirements: 7.3, 16.1, 16.2, 16.3, 16.4, 16.5, 16.6, 16.7, 16.8, 22.2, 22.3, 22.7_

  - [x] 5.7 Write property test for worker action idempotency
    - **Property 3: Executing any `WorkerAction` twice with the same inputs produces the same observable outcome as executing it once — no duplicate block placements, no duplicate inventory changes**
    - **Validates: Requirements 16.10, 18.3**

  - [x] 5.8 Write unit tests for BotManager reconnection logic
    - Test exponential backoff timing and max retry behavior
    - _Requirements: 2.5, 13.2_

  - [x] 5.9 Checkpoint — ensure Minecraft Controller tests pass
    - Ensure all tests pass, ask the user if questions arise.


- [x] 6. Society Engine — planning, scheduling, and resource management
  - [x] 6.1 Create `packages/society-engine` package scaffold
    - Create `package.json` and `tsconfig.json` referencing `shared-types`, `data-layer`, `blueprint`, `logger`
    - _Requirements: 3.1, 11.2_

  - [x] 6.2 Implement `TaskQueue` with priority ordering
    - Implement `enqueue(task, priority)` inserting into priority-ordered queue persisted in `tasks` table
    - Implement `dequeue(agentId)` returning the highest-priority available task for that agent
    - Implement `blockTask(taskId, reason)` and `retryTask(taskId)`
    - Implement `getQueueLengths()` returning per-agent counts
    - _Requirements: 3.1, 3.9, 13.5_

  - [x] 6.3 Implement `DependencyGraph` as a DAG
    - Implement `addTask`, `addDependency`, `detectCycles`, `getReadyTasks`, `markComplete`, `markFailed`
    - Implement `getParallelGroups()` and `topologicalSort()`
    - Persist dependency edges to `task_dependencies` table
    - Reject task graphs with circular dependencies (req 36.4)
    - _Requirements: 3.6, 36.1, 36.2, 36.3, 36.4, 36.5, 36.6, 36.7, 36.8, 36.10_

  - [x] 6.4 Implement `ResourceTracker` with threshold monitoring
    - Implement `getLevel`, `update(resourceType, delta, reason)` persisting to `resources` and `resource_transactions`
    - Implement `isBelowThreshold` and `getLowResources()` returning `ResourceAlert[]`
    - Implement `predictNeeds(phases)` estimating future resource consumption from blueprint requirements
    - Notify Vizier agent when a resource falls below threshold
    - Log all resource transactions with before/after values
    - _Requirements: 3.2, 3.3, 21.1, 21.2, 21.3, 21.9, 21.11, 12.4_

  - [x] 6.5 Implement `ZoneManager` for spatial zone management
    - Implement `defineZone(zone)` persisting to `zones` table
    - Implement `assignAgentToZone(agentId, zoneId)` based on role and task requirements
    - Implement zone boundary checks for bot position validation
    - _Requirements: 3.4, 3.5, 23.8_

  - [x] 6.6 Implement `BuildPhaseManager` for pyramid construction sequencing
    - Implement `startBuildSequence(blueprintId)` decomposing blueprint into phases (foundation, layers, capstone)
    - Implement automatic phase advancement when a phase completes (verify all blocks placed, initiate next)
    - Implement `verifyPhase(phaseId)` checking all block placements are correct
    - Generate correction tasks when blocks are missing or incorrect
    - Calculate resource requirements for upcoming phases
    - _Requirements: 3.6, 3.7, 3.8, 20.2, 20.7, 20.8, 20.10_

  - [x] 6.7 Implement `CeremonyManager` for cultural ceremonies
    - Implement `scheduleCeremony(ceremony)` persisting to `ceremonies` table
    - Implement ceremony type definitions (harvest_festival, pyramid_dedication, coronation)
    - Assign Priest workers to ceremony tasks on schedule
    - Apply ceremony effects (morale boost, resource blessing) on completion
    - Require Pharaoh approval for major ceremonies
    - _Requirements: 28.1, 28.2, 28.3, 28.4, 28.6, 28.7, 28.8, 28.9, 28.10_

  - [x] 6.8 Implement `MetricsCollector` for performance metrics
    - Collect task completion rates by agent role
    - Collect resource consumption rates by resource type
    - Collect build progress (blocks placed per hour)
    - Collect agent decision latency
    - Persist to `metrics` table with timestamps for time-series queries
    - Expose `getMetrics(): SocietyMetrics`
    - _Requirements: 12.9, 39.1, 39.2, 39.4, 39.9_

  - [x] 6.9 Wire `SocietyEngine` main class connecting all sub-components
    - Implement `initialize(db)`, `createTask`, `assignTask`, `completeTask`, `getRecommendations`, `updateResource`, `defineZone`, `startBuildSequence`, `scheduleCeremony`, `getMetrics`
    - Persist all planning state to SQLite
    - _Requirements: 3.10, 3.11_

  - [x] 6.10 Write unit tests for DependencyGraph cycle detection and topological sort
    - Test cycle detection with a 3-node cycle, test topological sort ordering, test parallel group extraction
    - _Requirements: 36.4, 36.8_

  - [x] 6.11 Write unit tests for ResourceTracker threshold alerts
    - Test that alerts fire at minimum and critical thresholds, test prediction accuracy
    - _Requirements: 3.3, 21.2_

  - [x] 6.12 Checkpoint — ensure Society Engine tests pass
    - Ensure all tests pass, ask the user if questions arise.


- [x] 7. REST API, WebSocket server, and health checks
  - [x] 7.1 Create `packages/api` with Fastify server setup
    - Create `package.json` with `fastify`, `@fastify/websocket`, `@fastify/rate-limit`, `@fastify/cors` dependencies
    - Implement `server.ts` initializing Fastify with JSON schema validation and error serialization
    - Implement API key authentication middleware in `auth.ts` (header `x-api-key`)
    - Implement rate limiting (100 req/min from config)
    - Implement consistent `ApiError` response format with `statusCode`, `error`, `message`, `code`, `details`
    - _Requirements: 17.1, 17.10, 17.11, 17.12, 17.13_

  - [x] 7.2 Implement all REST route handlers in `packages/api/src/routes/`
    - `GET /agents`, `GET /agents/:id` — query agent status
    - `GET /tasks`, `GET /tasks/:id` — query task queues
    - `GET /resources` — query resource inventory
    - `GET /builds`, `GET /builds/:id` — query build progress
    - `POST /system/start`, `POST /system/stop`, `POST /system/pause` — system control
    - `POST /system/mode` — change operating mode
    - `GET /snapshots/export`, `POST /snapshots/import` — snapshot operations
    - `GET /health` — unauthenticated health check
    - `GET /metrics` — Prometheus-compatible metrics endpoint
    - _Requirements: 17.2, 17.3, 17.4, 17.5, 17.6, 17.7, 17.8, 17.9, 39.8_

  - [x] 7.3 Implement `WebSocketServer` with event broadcasting
    - Implement `broadcast(event)` and `send(clientId, event)` for all `WebSocketEvent` types
    - Implement event batching in 100ms windows to prevent client overload
    - Implement WebSocket authentication using the same API key mechanism
    - Support multiple concurrent Control Centre connections
    - _Requirements: 34.1, 34.2, 34.3, 34.4, 34.5, 34.8, 34.9, 34.10_

  - [x] 7.4 Implement health check system in `packages/api/src/health.ts`
    - Check Ollama connectivity and model availability
    - Check SQLite accessibility and integrity
    - Check Minecraft Controller connectivity
    - Check all required agents are running
    - Check disk space availability
    - Run on startup and every 60 seconds
    - Enter safe mode and halt agent operations on critical failures
    - Persist results to `health_checks` table
    - _Requirements: 13.6, 13.7, 29.1, 29.2, 29.3, 29.4, 29.5, 29.6, 29.7, 29.8, 29.9_

  - [x] 7.5 Write integration tests for REST API endpoints
    - Test all routes return correct status codes and response shapes
    - Test authentication rejection on missing/invalid API key
    - Test rate limiting triggers after threshold
    - _Requirements: 17.10, 17.11, 17.12, 17.13_


- [x] 8. Control Centre dashboard
  - [x] 8.1 Create `packages/control-centre` with Canvas/A2UI setup
    - Create `package.json` with Canvas/A2UI dependency
    - Implement `theme.ts` with `EGYPTIAN_THEME` constants (sandstone `#C2B280`, gold `#FFD700`, lapis `#1E90FF`, papyrus, obsidian, copper, turquoise, hieroglyphRed)
    - Implement `app.ts` initializing the dashboard application served on the configured port
    - _Requirements: 5.1, 5.10, 43.1, 43.2_

  - [x] 8.2 Implement WebSocket client for real-time updates
    - Implement `websocket-client.ts` connecting to the API WebSocket server
    - Handle all `WebSocketEvent` types and update local state
    - Implement reconnection with exponential backoff on connection drop
    - Display connection status indicator
    - _Requirements: 5.8, 34.6, 34.7_

  - [x] 8.3 Implement dashboard panels in `packages/control-centre/src/panels/`
    - `AgentOverviewPanel`: grid of all agents with status indicators (active/idle/error) and most recent reasoning summary
    - `BuildProgressPanel`: pyramid visualization with percentage complete, current phase, and ETA
    - `ResourceDashboardPanel`: bar charts with color-coded levels (green ≥ minimum, yellow < minimum, red < critical)
    - `MapViewPanel`: top-down view of bot positions and zone boundaries
    - `AlertFeedPanel`: scrolling list of alerts with severity icons
    - `CeremonyCalendarPanel`: upcoming ceremonies with countdown timers
    - `MetricsChartsPanel`: time-series graphs for task completion rate, resource consumption, bot uptime
    - `LogViewerPanel`: filterable log stream with severity highlighting
    - `SystemControlsPanel`: start/stop/pause buttons, mode selector, emergency stop button
    - _Requirements: 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.11, 21.10, 22.9, 29.11, 36.9, 39.10_

  - [x] 8.4 Write unit tests for ResourceDashboardPanel color threshold logic
    - Test green/yellow/red transitions at exact threshold boundaries
    - _Requirements: 5.5, 21.10_

  - [x] 8.5 Checkpoint — ensure Control Centre renders and connects to WebSocket
    - Ensure all tests pass, ask the user if questions arise.


- [x] 9. CLI tooling
  - [x] 9.1 Implement `packages/cli` with all command groups
    - Create `package.json` with `commander` or `yargs` dependency
    - Implement `pyramid-os system start|stop|restart|status`
    - Implement `pyramid-os agent list|spawn|terminate|inspect <id>`
    - Implement `pyramid-os task list|create|cancel|retry <id>`
    - Implement `pyramid-os resource inventory|thresholds|consumption`
    - Implement `pyramid-os blueprint generate|validate|export|import <file>`
    - Implement `pyramid-os snapshot create|restore|list`
    - Implement `pyramid-os config validate|test`
    - Implement `pyramid-os log query --level --agent --since`
    - Implement `pyramid-os health check`
    - Implement `pyramid-os civilization create|list|delete|switch <name>`
    - Implement `--format=json|table|text` output formatting for all commands
    - Include help text and usage examples for all commands
    - _Requirements: 27.1, 27.2, 27.3, 27.4, 27.5, 27.6, 27.7, 27.8, 27.9, 27.10, 27.11, 32.7, 32.8_


- [x] 10. Free Thinking mode — intention engine and personality traits
  - [x] 10.1 Implement `IntentionEngine` in `packages/orchestration/src/intention-engine.ts`
    - Implement self-goal assignment for agents in `free_thinking` mode
    - Implement society structure reorganization proposals (agents can suggest role changes)
    - Enforce all `SafetyBoundary` constraints remain active in Free Thinking mode
    - Implement `max_reasoning_loops` guard to prevent infinite LLM loops
    - _Requirements: 8.4, 8.5, 8.6_

  - [x] 10.2 Implement personality trait system for Planner agents
    - Add `personalityTraits` field to `AgentWorkspace` context (e.g., ambitious, cautious, diplomatic)
    - Inject traits into LLM system prompts to influence decision-making style
    - Persist traits in `workspace_state` JSON column
    - _Requirements: 8.3, 8.4_

  - [x] 10.3 Write unit tests for IntentionEngine safety boundary enforcement in Free Thinking mode
    - Test that prohibited actions are still rejected when mode is `free_thinking`
    - _Requirements: 8.5, 8.6, 8.7_


- [x] 11. Bootstrap scripts and GitHub readiness
  - [x] 11.1 Create PowerShell installation script `scripts/install.ps1`
    - Verify Node.js 22+ is installed; exit with remediation message if not
    - Verify pnpm is installed; install it automatically if missing
    - Verify Ollama is running; provide start instructions if not
    - Check for `gpt-oss:20b` and `qwen3` models; prompt to pull if missing
    - Run `pnpm install`
    - Run `pnpm build`
    - Initialize SQLite schema via `pyramid-os db:init` CLI command
    - Create `config/default.yaml` if it doesn't exist
    - Run health checks and report results
    - Print clear error messages with remediation steps on any failure
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7, 14.8, 14.9, 14.10, 14.11_

  - [x] 11.2 Create `scripts/health-check.ps1` for standalone diagnostics
    - Check all components (Ollama, SQLite, Minecraft connectivity, agent processes)
    - Output results in table format with pass/fail indicators
    - _Requirements: 29.10, 42.2_

  - [x] 11.3 Create GitHub repository files
    - Create `README.md` with project overview, badges, feature highlights, quick start, and architecture diagram
    - Create `LICENSE` (MIT)
    - Create `CONTRIBUTING.md` with contribution guidelines and code of conduct
    - Create `CHANGELOG.md`
    - Create `.github/workflows/ci.yml` with test, build, and lint jobs
    - Create `.github/ISSUE_TEMPLATE/bug_report.md` and `feature_request.md`
    - Create `.github/pull_request_template.md`
    - Create `CODE_OF_CONDUCT.md`
    - Create `examples/` directory with annotated example config files
    - _Requirements: 30.1, 30.2, 30.3, 30.4, 30.5, 30.6, 30.7, 30.8, 30.9, 30.10, 30.11_


- [x] 12. Integration wiring, fault tolerance, and final tests
  - [x] 12.1 Wire all packages together in a root `src/main.ts` entry point
    - Load config, initialize logger, initialize database, run migrations
    - Initialize OpenClaw, SocietyEngine, MinecraftController
    - Start Fastify API server and WebSocket server
    - Spawn all configured agents from config
    - Register graceful shutdown handler (SIGINT/SIGTERM) saving all state
    - _Requirements: 13.10, 11.5_

  - [x] 12.2 Implement circuit breaker for external dependencies
    - Implement circuit breaker pattern for Ollama and Minecraft server connections
    - Configure thresholds from config (failure count, reset timeout)
    - _Requirements: 13.8_

  - [x] 12.3 Implement recovery mode from latest valid snapshot
    - Implement `pyramid-os system recover` CLI command
    - Load most recent valid snapshot, restore all state, resume agent operations
    - _Requirements: 13.9_

  - [x] 12.4 Implement multi-civilization support
    - Ensure all DB queries are scoped by `civilization_id`
    - Implement separate agent pools and SQLite databases per civilization
    - Implement civilization switching in Control Centre and CLI
    - _Requirements: 32.1, 32.2, 32.3, 32.4, 32.5, 32.6, 32.9, 32.10_

  - [x] 12.5 Write integration tests for OpenClaw ↔ SocietyEngine interaction
    - Test task creation flows through to agent assignment and completion
    - Test resource threshold triggers generating procurement tasks
    - _Requirements: 18.2_

  - [x] 12.6 Write integration tests for SocietyEngine ↔ SQLite persistence
    - Test that task state survives a simulated restart (write, reload DB, verify)
    - _Requirements: 18.2_

  - [x] 12.7 Write integration tests for Minecraft Controller bot lifecycle
    - Test bot connect → action execute → disconnect → reconnect flow using a mock server
    - _Requirements: 18.3_

  - [x] 12.8 Write unit tests for graceful degradation scenarios
    - Test Ollama unavailable: queued deterministic tasks continue executing
    - Test Planner agent failure: existing plans continue until recovery
    - Test DB write failure: in-memory cache and retry behavior
    - _Requirements: 40.1, 40.3, 40.6_

  - [x] 12.9 Final checkpoint — full system integration
    - Ensure all tests pass, ask the user if questions arise.

- [x] 13. Recovery and fault tolerance — circuit breaker and recovery manager
  - [x] 13.1 Implement `CircuitBreaker<T>` in `packages/orchestration/src/circuit-breaker.ts`
    - Implement generic circuit breaker with `closed`, `open`, `half-open` states
    - Implement `execute(operation)` that tracks consecutive failures and opens after `failureThreshold`
    - Implement cooldown timer transitioning from `open` to `half-open` after `cooldownMs`
    - Implement probe logic in `half-open` state closing after `successThreshold` successes
    - Implement `onStateChange` callback for state transition listeners
    - Implement `reset()` for manual override
    - Configure per-dependency defaults (Ollama: 3 failures/30s cooldown, Minecraft: 5/10s, SQLite: 3/5s)
    - _Requirements: 13.8_

  - [x] 13.2 Write property test for circuit breaker state transitions
    - **Property 1: Circuit breaker state transitions**
    - Generate random sequences of success/failure results and verify state machine correctness
    - **Validates: Requirements 13.8**

  - [x] 13.3 Implement `RecoveryManager` in `packages/orchestration/src/recovery.ts`
    - Implement `SystemHealthState` state machine (`healthy` → `degraded` → `recovering` → `critical` → `shutdown`)
    - Implement `reportFailure(component, error)` tracking consecutive failures per component
    - Implement `reportRecovery(component)` transitioning back toward healthy
    - Implement `attemptRecovery(component)` executing registered `RecoveryStrategy` with exponential backoff
    - Implement `registerStrategy(component, strategy)` for per-component recovery actions
    - Implement `initiateShutdown()` coordinating graceful shutdown flow (pause agents → disconnect bots → persist state → auto-snapshot → close DB)
    - _Requirements: 13.1, 13.2, 13.9, 13.10_

  - [x] 13.4 Write property test for graceful shutdown state persistence
    - **Property 2: Graceful shutdown persists all state**
    - Generate random agent states and workspace contexts, verify all are persisted after shutdown
    - **Validates: Requirements 13.10**

  - [x] 13.5 Write property test for task failure escalation
    - **Property 3: Task failure escalation to blocked**
    - Generate random task graphs with failure sequences, verify blocked propagation
    - **Validates: Requirements 13.5**

  - [x] 13.6 Write property test for worker failure task reassignment
    - **Property 4: Worker failure task reassignment**
    - Generate random worker pools and task assignments, simulate failure, verify no tasks lost
    - **Validates: Requirements 13.1, 40.5**


- [x] 14. Performance and scalability — caching, pooling, and throttling
  - [x] 14.1 Implement `Cache<T>` with LRU eviction in `packages/shared-types/src/cache.ts`
    - Implement `get`, `set`, `invalidate`, `invalidatePattern`, `clear`, `stats`
    - Implement LRU eviction when `maxSize` is exceeded
    - Implement TTL-based expiry per `CacheConfig`
    - Implement write-through mode for `agentStates` and `resourceLevels` caches
    - Configure per-data-type cache configs (blueprints: 50/5min, agentStates: 100/10s, resourceLevels: 200/5s, pathCache: 500/1min, configValues: 50/no-expiry)
    - _Requirements: 25.1, 25.2, 25.9_

  - [x] 14.2 Write property test for cache consistency on invalidation
    - **Property 5: Cache consistency on invalidation**
    - Generate random get/set/invalidate sequences, verify no stale reads after invalidation
    - **Validates: Requirements 25.9**

  - [x] 14.3 Implement `ConnectionPool` in `packages/data-layer/src/pool.ts`
    - Implement `acquire()` returning a connection from the pool (blocking up to `acquireTimeoutMs`)
    - Implement `release(connection)` returning connection to idle pool
    - Implement idle eviction after `idleTimeoutMs`
    - Implement `stats()` returning total/active/idle/waiting counts
    - Implement `drain()` closing all connections
    - Maintain `minIdle` connections at all times
    - Configure defaults for SQLite (5 max, 1 min idle) and Ollama (4 max, 1 min idle)
    - _Requirements: 25.3, 25.8_

  - [x] 14.4 Write property test for connection pool bounds
    - **Property 6: Connection pool bounds**
    - Generate random acquire/release sequences, verify active never exceeds `maxConnections`
    - **Validates: Requirements 25.8**

  - [x] 14.5 Implement `TaskThrottle` in `packages/society-engine/src/throttle.ts`
    - Implement `canAssign()` checking current rate against `maxAssignmentsPerSecond`
    - Implement `recordAssignment()` updating sliding window counter
    - Implement backpressure when `queueDepthThreshold` is exceeded
    - Implement rejection when `maxPendingAssignments` is reached
    - Implement `getLoad()` returning current throttle metrics
    - Configure defaults: 50 assignments/sec, queue depth threshold 200, max pending 500
    - _Requirements: 25.4, 25.10_

  - [x] 14.6 Write property test for throttle rate limit
    - **Property 7: Throttle respects rate limit**
    - Generate random assignment bursts, verify throughput never exceeds configured limit
    - **Validates: Requirements 25.10**

  - [x] 14.7 Checkpoint — ensure performance and scalability tests pass
    - Ensure all tests pass, ask the user if questions arise.


- [x] 15. Plugin and extensibility system
  - [x] 15.1 Define plugin types in `packages/shared-types/src/plugin.ts`
    - Define `PluginManifest`, `ExtensionPoint`, `Plugin`, `PluginContext`, `AgentFactory`, `TaskHandler`, `EventHandler` interfaces
    - Define `SystemEvent` union type and `SystemEventPayload` interface
    - _Requirements: 26.1, 26.2_

  - [x] 15.2 Implement `PluginRegistry` in `packages/orchestration/src/plugin-registry.ts`
    - Implement `register(manifest, instance)` storing plugin info with `loaded` status
    - Implement `deregister(pluginId)` removing plugin from registry
    - Implement `list()`, `get(pluginId)`, `findByExtensionPoint(type)`, `has(pluginId)`
    - _Requirements: 26.3, 26.10_

  - [x] 15.3 Implement `PluginLoader` with manifest validation in `packages/orchestration/src/plugin-loader.ts`
    - Implement manifest validation (required fields, semver format, `minSystemVersion` compatibility check)
    - Implement `loadPlugin(manifestPath)` reading manifest, validating, creating sandbox context, calling `onLoad`
    - Implement `unloadPlugin(pluginId)` calling `onUnload`, deregistering from registry
    - Implement hot-reload: unload old version → validate new → load new
    - Reject plugins with incompatible `minSystemVersion` with `PYRAMID_PLUGIN_INCOMPATIBLE` error
    - _Requirements: 26.3, 26.4, 26.7_

  - [x] 15.4 Implement `EventHookManager` in `packages/orchestration/src/event-hooks.ts`
    - Implement `on(event, handler, pluginId?)` registering handlers per event type
    - Implement `off(event, handler)` removing specific handler
    - Implement `removeAllForPlugin(pluginId)` cleaning up on plugin unload
    - Implement `emit(event, data)` invoking all registered handlers for the event
    - _Requirements: 26.5, 26.6_

  - [x] 15.5 Implement `PluginSandbox` with failure isolation in `packages/orchestration/src/plugin-sandbox.ts`
    - Implement `execute(pluginId, fn)` wrapping plugin calls in try/catch
    - Track consecutive failure count per plugin
    - Auto-unload plugin after 3 consecutive failures (`PLUGIN_FAILURE_THRESHOLD`)
    - Reset failure count on successful execution
    - Log all plugin errors with plugin ID and error details
    - _Requirements: 26.8, 26.9_

  - [x] 15.6 Write property test for plugin failure isolation
    - **Property 8: Plugin failure isolation**
    - Generate plugins that throw random errors, verify system continues and other plugins unaffected
    - **Validates: Requirements 26.8**

  - [x] 15.7 Write property test for plugin registry consistency
    - **Property 9: Plugin registry consistency**
    - Generate random load/unload sequences, verify registry count matches loaded plugins
    - **Validates: Requirements 26.10**

  - [x] 15.8 Write property test for plugin validation
    - **Property 10: Plugin validation rejects incompatible plugins**
    - Generate random manifests with varying version constraints, verify incompatible ones are rejected
    - **Validates: Requirements 26.7**

  - [x] 15.9 Write property test for event hooks
    - **Property 11: Event hooks fire for all subscribers**
    - Generate random event subscriptions and emissions, verify all N handlers invoked exactly once
    - **Validates: Requirements 26.5**

  - [x] 15.10 Checkpoint — ensure plugin system tests pass
    - Ensure all tests pass, ask the user if questions arise.


- [x] 16. CLI enhancements — API client and output formatters
  - [x] 16.1 Implement `CliApiClient` in `packages/cli/src/api-client.ts`
    - Implement `get<T>(path, params)` and `post<T>(path, body)` using HTTP client
    - Implement `ping()` checking API reachability
    - Read `baseUrl` and `apiKey` from CLI flags → env vars → config file (in priority order)
    - Handle connection errors with descriptive messages
    - _Requirements: 27.1, 27.2_

  - [x] 16.2 Implement output formatters in `packages/cli/src/formatters.ts`
    - Implement `TableFormatter.formatTable(rows, columns)` with aligned columns
    - Implement `JsonFormatter.formatJson(data)` with pretty-printed output
    - Implement `TextFormatter.formatText(data, template)` for minimal scripting output
    - Wire `--format=json|table|text` global flag to formatter selection
    - _Requirements: 27.10_

  - [x] 16.3 Write property test for CLI output format validity
    - **Property 12: CLI output format validity**
    - Generate random command results, verify JSON output is parseable and table output has aligned headers
    - **Validates: Requirements 27.10**

  - [x] 16.4 Write property test for CLI help text completeness
    - **Property 13: CLI help text completeness**
    - Enumerate all registered commands, verify each produces non-empty help with name and description
    - **Validates: Requirements 27.11**


- [x] 17. Error handling — structured errors, registry, and aggregation
  - [x] 17.1 Define `PyramidError` type and `ErrorCategory` enum in `packages/shared-types/src/errors.ts`
    - Define `ErrorCategory` enum (CONFIG, CONNECTION, AGENT, TASK, RESOURCE, BLUEPRINT, DATABASE, OLLAMA, MINECRAFT, PLUGIN, SECURITY, SYSTEM)
    - Define `PyramidError` interface with `code`, `category`, `severity`, `message`, `remediation`, `docsUrl`, `context`, `cause`, `timestamp`
    - Define `ERROR_REGISTRY` mapping error codes to default messages and remediation steps
    - Include all error codes from the design (CONFIG_INVALID_FIELD, CONFIG_MISSING_FILE, CONNECTION_NETWORK, CONNECTION_AUTH, CONNECTION_SERVER, OLLAMA_UNAVAILABLE, OLLAMA_MODEL_MISSING, OLLAMA_TIMEOUT, DATABASE_LOCKED, DATABASE_INTEGRITY, AGENT_PERMISSION, PLUGIN_INCOMPATIBLE, PLUGIN_LOAD_FAILED, SECURITY_BOUNDARY)
    - _Requirements: 38.1, 38.2, 38.3, 38.6, 38.7_

  - [x] 17.2 Implement `ErrorAggregator` in `packages/logger/src/error-aggregator.ts`
    - Implement `report(error)` keying by `code + context hash` within a 10-second window
    - Implement `flush()` emitting single log entries with occurrence count for aggregated errors
    - Configure defaults: 10s window, max 100 tracked unique errors
    - Auto-flush when window expires or max tracked is reached
    - _Requirements: 38.9_

  - [x] 17.3 Wire `PyramidError` creation throughout existing components
    - Update `ServerConnector` to classify connection failures into NETWORK/AUTH/SERVER categories
    - Update `LLMRouter` to use OLLAMA_UNAVAILABLE, OLLAMA_MODEL_MISSING, OLLAMA_TIMEOUT codes
    - Update `DatabaseManager` to use DATABASE_LOCKED, DATABASE_INTEGRITY codes
    - Update `SafetyEnforcer` to use SECURITY_BOUNDARY code
    - Update config loader to use CONFIG_INVALID_FIELD, CONFIG_MISSING_FILE codes
    - _Requirements: 38.4, 38.5, 38.8_

  - [x] 17.4 Write property test for error structure completeness
    - **Property 14: Error structure completeness**
    - Generate random error codes and contexts, verify all have valid `PYRAMID_{CATEGORY}_{SPECIFIC}` pattern, severity, and message
    - **Validates: Requirements 38.1, 38.6, 38.7**

  - [x] 17.5 Write property test for error aggregation
    - **Property 15: Error aggregation prevents spam**
    - Generate sequences of identical errors within aggregation window, verify at most 1 log entry emitted
    - **Validates: Requirements 38.9**

  - [x] 17.6 Write property test for connection error classification
    - **Property 16: Connection error classification**
    - Generate different failure types (timeout, 401, ECONNREFUSED), verify correct error category
    - **Validates: Requirements 38.5**

  - [x] 17.7 Checkpoint — ensure error handling tests pass
    - Ensure all tests pass, ask the user if questions arise.


- [x] 18. Graceful degradation — degradation manager and fallback specs
  - [x] 18.1 Implement `DegradationManager` in `packages/orchestration/src/degradation.ts`
    - Implement `getComponentStates()` returning health state per component
    - Implement `getOverallLevel()` computing `full` / `degraded` / `critical` / `minimal` from component states
    - Implement `registerComponent(component, fallback)` with `FallbackSpec` per component
    - Implement `notifyFailure(component)` activating fallback and updating degradation level
    - Implement `notifyRecovery(component)` deactivating fallback and restoring degradation level
    - _Requirements: 40.1, 40.2, 40.3, 40.10_

  - [x] 18.2 Implement fallback behaviors for each component
    - Ollama fallback: queue LLM requests, continue deterministic worker tasks, no new agent reasoning (priority 2)
    - SQLite fallback: cache writes in memory Map, retry every 5s, reads from cache or last known state (priority 1)
    - Minecraft fallback: preserve agent state, pause bot actions, reconnect with exponential backoff (priority 3)
    - Planner agent fallback: continue existing plans, operational agents work from last directives (priority 4)
    - Operational agent fallback: redistribute to other agents of same/similar role (priority 3)
    - Worker agent fallback: reassign tasks, restart agent (priority 5)
    - Control Centre fallback: buffer events for reconnection, no impact on operations (priority 6)
    - _Requirements: 40.3, 40.4, 40.5, 40.6, 40.7, 40.8_

  - [x] 18.3 Implement critical operation prioritization during degraded mode
    - Safety enforcement always active (priority 1)
    - Data persistence — flush memory cache when possible (priority 2)
    - Health monitoring — continue health checks (priority 3)
    - Active task completion (priority 4)
    - New task assignment — throttled or paused (priority 5)
    - UI updates — buffered, lowest priority (priority 6)
    - _Requirements: 40.9_

  - [x] 18.4 Write property test for deterministic tasks without Ollama
    - **Property 17: Deterministic tasks continue without Ollama**
    - Generate deterministic task queues, simulate Ollama circuit breaker opening, verify tasks complete
    - **Validates: Requirements 40.1**

  - [x] 18.5 Write property test for degradation recovery
    - **Property 18: Degradation recovery restores full operation**
    - Generate failure/recovery sequences, verify degradation level returns to pre-failure state
    - **Validates: Requirements 40.10**

  - [x] 18.6 Write property test for memory-cached writes surviving DB recovery
    - **Property 19: Memory-cached writes survive DB recovery**
    - Generate random writes during DB failure, simulate recovery, verify all cached writes flushed
    - **Validates: Requirements 40.6**


- [x] 19. Platform compatibility — cross-platform path resolver
  - [x] 19.1 Implement `CrossPlatformPathResolver` in `packages/shared-types/src/paths.ts`
    - Implement `resolve(...segments)` using `path.resolve` from workspace root
    - Implement `dataDir()`, `snapshotsDir()`, `logsDir()`, `databasePath()` convenience methods
    - Implement `normalize(userPath)` handling mixed separators, drive letters, and relative segments
    - Never use hardcoded `/` or `\` — always use `path.join` / `path.resolve`
    - _Requirements: 42.1, 42.3, 42.4_

  - [x] 19.2 Add `.gitattributes` and Windows-specific handling
    - Create `.gitattributes` with `* text=auto` for consistent line endings
    - Use `os.tmpdir()` for temporary files throughout the codebase
    - Ensure SQLite uses WAL mode with retry on `SQLITE_BUSY`
    - _Requirements: 42.2, 42.5_

  - [x] 19.3 Write property test for cross-platform path normalization
    - **Property 20: Cross-platform path normalization**
    - Generate paths with mixed separators, drive letters, relative segments; verify `normalize()` produces valid paths and `resolve()` produces absolute paths
    - **Validates: Requirements 42.3, 42.4**


- [x] 20. Development workflow — mocks, seed data, and dev scripts
  - [x] 20.1 Implement mock dependencies in `packages/*/src/__mocks__/`
    - Implement `MockOllama` with canned responses, configurable latency, and optional failure simulation
    - Implement `MockMinecraft` simulating bot actions with deterministic world seed
    - Implement `MockDatabase` using in-memory Map with same repository interfaces
    - All mocks implement the same interfaces as real dependencies
    - _Requirements: 44.1, 44.4_

  - [x] 20.2 Implement seed data system in `packages/data-layer/src/seeds/`
    - Define `SeedScenario` interface with civilization, agents, blueprints, resources, zones, tasks
    - Implement 6 seed scenarios: `empty`, `basic`, `mid-build`, `low-resources`, `full-society`, `failure-mode`
    - Implement `pyramid-os seed load <scenario-name>` CLI command
    - Implement seed loader in `packages/data-layer/src/seeds/loader.ts`
    - _Requirements: 44.2, 44.5_

  - [x] 20.3 Add development scripts to root `package.json`
    - Add `dev` (tsc --build --watch), `dev:api`, `dev:control-centre`, `dev:mock-minecraft`, `dev:mock-ollama`, `seed` scripts
    - Add `test:property` script with vitest property config
    - Add `typecheck`, `format:check` scripts
    - _Requirements: 44.3_

  - [x] 20.4 Implement hot-reload for Control Centre development
    - Implement file watcher on `packages/control-centre/src` with 300ms debounce
    - Trigger incremental tsc build on change
    - Notify connected clients via WebSocket `reload` event
    - _Requirements: 44.6_

  - [x] 20.5 Write property test for mock interface conformance
    - **Property 21: Mock interface conformance**
    - Generate random inputs for each mock, verify output types match real interface
    - **Validates: Requirements 44.4**

  - [x] 20.6 Write property test for seed data validity
    - **Property 22: Seed data produces valid state**
    - Load each seed scenario, verify valid agent roles, task statuses, non-negative resources, valid zone bounds
    - **Validates: Requirements 44.5**


- [x] 21. CI workflow and final integration checkpoint
  - [x] 21.1 Create `.github/workflows/ci.yml` with full pipeline
    - Implement `lint` job: checkout, pnpm setup, Node 22, `pnpm install --frozen-lockfile`, `pnpm run lint`, `pnpm run format:check`
    - Implement `typecheck` job (depends on lint): `pnpm run typecheck`
    - Implement `test` job (depends on typecheck): `pnpm run test -- --run`, `pnpm run test:property -- --run`
    - Implement `build` job (depends on test): `pnpm run build`, upload `packages/*/dist/` as artifact
    - All jobs run on `windows-latest`
    - Trigger on push to `main` and pull requests to `main`
    - _Requirements: 30.5, 30.6_

  - [x] 21.2 Final checkpoint — full system integration with new components
    - Ensure all tests pass including new property tests, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP
- Each task references specific requirements for traceability
- Property tests use fast-check (or vitest-fast-check) for TypeScript property-based testing
- Original correctness properties (tasks 2.5, 3.2, 5.7):
  - **Property** (task 2.5): JSON snapshot round-trip — validates Requirements 10.11, 18.7
  - **Property** (task 3.2): Blueprint serialization round-trip — validates Requirements 4.10, 18.6
  - **Property** (task 5.7): Worker action idempotency — validates Requirements 16.10, 18.3
- New correctness properties (22 total, tasks 13.2–21.2):
  - **Property 1** (task 13.2): Circuit breaker state transitions — validates Req 13.8
  - **Property 2** (task 13.4): Graceful shutdown persists all state — validates Req 13.10
  - **Property 3** (task 13.5): Task failure escalation to blocked — validates Req 13.5
  - **Property 4** (task 13.6): Worker failure task reassignment — validates Req 13.1, 40.5
  - **Property 5** (task 14.2): Cache consistency on invalidation — validates Req 25.9
  - **Property 6** (task 14.4): Connection pool bounds — validates Req 25.8
  - **Property 7** (task 14.6): Throttle respects rate limit — validates Req 25.10
  - **Property 8** (task 15.6): Plugin failure isolation — validates Req 26.8
  - **Property 9** (task 15.7): Plugin registry consistency — validates Req 26.10
  - **Property 10** (task 15.8): Plugin validation rejects incompatible — validates Req 26.7
  - **Property 11** (task 15.9): Event hooks fire for all subscribers — validates Req 26.5
  - **Property 12** (task 16.3): CLI output format validity — validates Req 27.10
  - **Property 13** (task 16.4): CLI help text completeness — validates Req 27.11
  - **Property 14** (task 17.4): Error structure completeness — validates Req 38.1, 38.6, 38.7
  - **Property 15** (task 17.5): Error aggregation prevents spam — validates Req 38.9
  - **Property 16** (task 17.6): Connection error classification — validates Req 38.5
  - **Property 17** (task 18.4): Deterministic tasks without Ollama — validates Req 40.1
  - **Property 18** (task 18.5): Degradation recovery restores full operation — validates Req 40.10
  - **Property 19** (task 18.6): Memory-cached writes survive DB recovery — validates Req 40.6
  - **Property 20** (task 19.3): Cross-platform path normalization — validates Req 42.3, 42.4
  - **Property 21** (task 20.5): Mock interface conformance — validates Req 44.4
  - **Property 22** (task 20.6): Seed data produces valid state — validates Req 44.5
- Checkpoints at tasks 3.6, 4.12, 5.9, 6.12, 8.5, 12.9, 14.7, 15.10, 17.7, and 21.2 ensure incremental validation
