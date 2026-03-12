<p align="center">
  <img src="https://img.shields.io/badge/🏛️_PYRAMID_OS-v0.1.0-C2B280?style=for-the-badge&labelColor=1A1A2E" alt="PYRAMID OS" />
</p>

<h1 align="center">🏺 PYRAMID OS</h1>

<p align="center">
  <strong>An AI-powered multi-agent civilization that builds ancient Egypt — inside Minecraft.</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/TypeScript-5.5+-3178C6?logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Node.js-22+-339933?logo=node.js&logoColor=white" alt="Node.js" />
  <img src="https://img.shields.io/badge/Minecraft-Mineflayer-62B47A?logo=minecraft&logoColor=white" alt="Minecraft" />
  <img src="https://img.shields.io/badge/LLM-Ollama-FF6F00" alt="Ollama" />
  <img src="https://img.shields.io/badge/License-MIT-yellow" alt="MIT License" />
  <img src="https://img.shields.io/badge/Tests-22_Property_Tests-8A2BE2" alt="Property Tests" />
  <img src="https://img.shields.io/badge/Packages-10-blue" alt="10 Packages" />
</p>

<p align="center">
  Autonomous agents reason with local LLMs, coordinate through a hierarchical message bus, and command Minecraft bots to quarry sandstone, lay pyramids block by block, patrol temple walls, conduct coronation ceremonies, and hold harvest festivals — all without a single human click in-game.
</p>

---

## What is this?

Imagine dropping a team of AI agents into a Minecraft server and watching them build an entire Egyptian civilization from nothing. That's PYRAMID OS.

A Pharaoh agent sets the grand vision. A Vizier manages resources. An Architect designs pyramids. A Bot-Foreman dispatches workers. Guard bots patrol the perimeter with A* pathfinding, engaging hostile mobs on sight. Priest bots navigate to temples and perform ceremony rituals. Builder bots place blocks in exact blueprint order, layer by layer, from foundation to capstone. Farmer bots plant and harvest crops in grid patterns. And when sandstone runs low, the Vizier triggers emergency procurement before construction stalls.

Every decision flows through a local Ollama LLM. Every action is safety-checked before it reaches the game. Every block placement, resource transaction, and agent message is persisted to SQLite. And you can watch it all happen in real time through an Egyptian-themed terminal dashboard, a REST API, or a CLI.

It's part AI research platform, part Minecraft automation framework, part distributed systems playground — and it's entirely open source.

## Why does this exist?

PYRAMID OS explores a question: **what happens when you give AI agents a shared physical world, a social hierarchy, and real constraints?**

Unlike chatbot-style AI, these agents have to deal with spatial reasoning, resource scarcity, task dependencies, and coordination failures. The Pharaoh can't just "decide" to build a pyramid — it needs to check resource levels, generate a validated blueprint, decompose it into build phases, schedule tasks with dependency ordering, assign workers, and monitor progress. If the Minecraft server disconnects mid-build, circuit breakers kick in. If Ollama goes down, deterministic tasks keep running while LLM requests queue up. If a worker bot dies, its tasks get reassigned automatically.

This is multi-agent AI with real consequences, real physics, and real failure modes.


## How it works

```
┌──────────────────────────────────────────────────────────────────┐
│                          PYRAMID OS                              │
│                                                                  │
│  ┌───────────┐    ┌───────────────────┐    ┌─────────────────┐   │
│  │  Ollama   │◄──►│   Orchestration    │───►│ Society Engine   │   │
│  │  (LLM)   │    │    (OpenClaw)      │    │                 │   │
│  │           │    │                   │    │ Task Queues     │   │
│  │ gpt-oss   │    │ Agent Manager     │    │ Resource Track  │   │
│  │ qwen3     │    │ Safety Enforcer   │    │ Zone Manager    │   │
│  └───────────┘    │ Message Bus       │    │ Build Phases    │   │
│                   │ Mode Controller   │    │ Ceremonies      │   │
│                   │ Circuit Breakers  │    │ Dependency DAG  │   │
│                   │ Recovery Manager  │    │ Metrics         │   │
│                   │ Plugin System     │    └─────────────────┘   │
│                   │ Intention Engine  │                           │
│                   └────────┬──────────┘    ┌─────────────────┐   │
│                            │               │ Minecraft Ctrl  │   │
│                            ├──────────────►│                 │   │
│                            │               │ Server Connect  │   │
│  ┌───────────┐    ┌────────┴──────────┐    │ Bot Manager     │   │
│  │ Data      │◄──►│   Fastify API     │    │ A* Pathfinder   │   │
│  │ Layer     │    │   + WebSocket     │    │ Action Executor │   │
│  │           │    │                   │    │ Guard Workers   │   │
│  │ SQLite    │    │ REST Routes       │    │ Priest Workers  │   │
│  │ Repos     │    │ Rate Limiting     │    │ Builder Workers │   │
│  │ Snapshots │    │ API Key Auth      │    │ Farmer Workers  │   │
│  │ Migrations│    └────────┬──────────┘    └────────┬────────┘   │
│  │ Seeds     │             │                        │            │
│  └───────────┘             ▼                        ▼            │
│                   ┌─────────────────┐      ┌─────────────────┐   │
│                   │ Control Centre  │      │ Minecraft       │   │
│                   │ 🏛️ Egyptian UI   │      │ Server          │   │
│                   │ 9 Live Panels   │      │ (Java Edition)  │   │
│                   └─────────────────┘      └─────────────────┘   │
└──────────────────────────────────────────────────────────────────┘
```

## The Agent Hierarchy

This isn't a flat swarm. PYRAMID OS models a real society with a chain of command.

```
                       ┌──────────────┐
                       │   👑 Pharaoh  │  Planner Tier
                       │  Grand Vision │  "Build a pyramid at (100, 64, 200)"
                       └───────┬──────┘
                               │
          ┌────────────────────┼────────────────────┐
          ▼                    ▼                    ▼
   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
   │ 📜 Vizier     │   │ 📐 Architect  │   │ 🗡️ Defense    │  Operational Tier
   │ Resources &   │   │ Blueprints & │   │ Security &   │  Coordinates workers,
   │ Logistics     │   │ Construction │   │ Patrols      │  makes tactical calls
   └───────┬──────┘   └───────┬──────┘   └───────┬──────┘
           │                  │                   │
   ┌───────┴──────┐   ┌──────┴───────┐   ┌──────┴───────┐
   │ ⛏️ Quarry     │   │ 🧱 Builder    │   │ 🛡️ Guard     │  Worker Tier
   │ 🚚 Hauler     │   │ 🌾 Farmer     │   │ 🙏 Priest    │  Hands on the ground,
   │ 📦 Gatherer   │   │              │   │              │  executing in-game
   └──────────────┘   └──────────────┘   └──────────────┘
```

Messages flow through a hierarchy-enforced message bus — workers can't message the Pharaoh directly, and the Pharaoh's broadcasts reach everyone. Each agent has its own isolated workspace with role-specific tool permissions, personality traits that influence LLM reasoning, and persisted state that survives restarts.


## Features

### 🤖 Three Operating Modes

PYRAMID OS doesn't just have one way to run — you choose how much freedom the agents get:

| Mode | What happens | Example |
|---|---|---|
| `structured` | Strict task queue execution. Agents do exactly what they're told. No improvisation. | "Place block at (10, 65, 20). Done. Next task." |
| `guided_autonomy` | Role-bounded freedom. Planners can create new tasks and modify plans. Workers can suggest improvements. | Architect notices a design flaw and proposes a blueprint revision. |
| `free_thinking` | Self-directed with safety rails. Agents set their own goals, propose society reorganizations, and self-assign work. | Pharaoh decides to pivot from pyramid construction to temple expansion based on resource availability. |

Switch modes at runtime via the API or CLI. The Intention Engine powers Free Thinking mode — agents use LLM reasoning to generate their own goals and can even propose reorganizing the society's role structure. A reasoning loop guard (default: 50 iterations) prevents agents from spiraling into infinite LLM chains.

### 🏗️ Blueprint System

Structures aren't just "placed" — they're engineered:

1. **Generation** — Procedural algorithms create pyramids (layer-inset), temples, housing districts, and farms with exact block coordinates
2. **Validation** — Every blueprint is checked for valid Minecraft block IDs (`namespace:block` format), coordinate bounds (±30M world border), duplicate positions, and bounding box consistency
3. **Serialization** — Blueprints serialize to stable JSON for storage and transfer, with round-trip property tests guaranteeing fidelity
4. **Build Phases** — The BuildPhaseManager decomposes blueprints into sequential phases: foundation → layers → capstone. Each phase tracks its own resource requirements
5. **Progress Tracking** — Block-by-block progress with `getNextPlacement()` returning the lowest unplaced index. Builder workers follow this exactly
6. **Verification** — After each phase, the system verifies all blocks were placed correctly and generates correction tasks for anything missing

### ⚔️ A Living Society

This isn't just task execution — it's a simulated civilization:

- **Task Dependency DAG** — Tasks form a directed acyclic graph. The system detects cycles on insertion, computes topological ordering, identifies parallel execution groups, and propagates failure (if task A fails, all downstream dependents are automatically blocked)
- **Resource Economy** — Sandstone, limestone, gold, wood, food, tools, stone, iron — all tracked with configurable minimum and critical thresholds. When resources drop below minimum, the Vizier gets alerted. Below critical? Emergency procurement tasks spawn automatically
- **Zone Management** — Construction sites, quarries, farms, temples, palaces, patrol routes — each with 3D bounding boxes. Agents are assigned to zones based on role and task requirements
- **Build Phase Sequencing** — Pyramids are built bottom-up: foundation first, then each layer, then the capstone. The system auto-advances phases on completion and calculates resource needs for upcoming phases
- **Cultural Ceremonies** — Harvest festivals (auto-approved, +10 morale, +15 resource blessing), pyramid dedications (requires Pharaoh approval, +25 morale, +10 production), and coronations (+50 morale, +20 resource blessing, +15 production). Priest workers navigate to temples and execute ceremony action sequences. Effects have configurable durations
- **Metrics Collection** — Task completion rates by role, resource consumption rates, blocks placed per hour, agent decision latency — all persisted as time-series data

### 🛡️ Resilience That Actually Works

PYRAMID OS is built for the real world where things break:

- **Circuit Breakers** — Three-state (closed → open → half-open) circuit breakers for Ollama (3 failures / 30s cooldown), Minecraft (5 failures / 10s), and SQLite (3 failures / 5s). Configurable thresholds, probe logic in half-open state, and state change listeners
- **Recovery Manager** — A state machine tracking system health: `healthy` → `degraded` → `recovering` → `critical` → `shutdown`. Per-component failure tracking with registered recovery strategies and exponential backoff
- **Graceful Degradation** — Seven component-specific fallback behaviors with priority ordering:
  1. SQLite down → cache writes in memory, retry every 5s (Priority 1)
  2. Ollama down → queue LLM requests, deterministic tasks keep running (Priority 2)
  3. Minecraft disconnected → preserve agent state, pause bots, reconnect with backoff (Priority 3)
  4. Planner agent fails → existing plans continue, operational agents work from last directives (Priority 4)
  5. Worker fails → reassign tasks, restart agent (Priority 5)
  6. Control Centre disconnects → buffer events, no impact on operations (Priority 6)
- **Critical Operation Prioritization** — During degraded mode, operations are prioritized: safety enforcement (always on) > data persistence > health monitoring > active task completion > new task assignment > UI updates
- **Safety Enforcer** — Blocks prohibited blocks (TNT, lava, fire), prohibited commands (`/op`, `/gamemode`, `/kill`, `/ban`), enforces action rate limits (10/sec per bot), and operation timeouts (30s max decision time). Every violation is logged to a `security_incidents` table. Emergency stop halts everything instantly
- **Graceful Shutdown** — Ordered sequence: pause agents → disconnect bots → persist all state → create snapshot → close database. Nothing is lost

### 🔌 Extensible Plugin System

Want to add custom agent types, task handlers, or event hooks? The plugin system has you covered:

- **Manifest-based loading** with semver compatibility checking — plugins declare a `minSystemVersion` and get rejected if incompatible
- **Sandboxed execution** — plugin calls are wrapped in try/catch with per-plugin failure tracking. Three consecutive failures? Auto-unloaded. No plugin can crash the system
- **Hot-reload** — unload old version, validate new manifest, load new version. No restart needed
- **Event hooks** — subscribe to system events (task completed, agent spawned, resource alert, etc.) from plugin code
- **Extension points** — register custom `AgentFactory`, `TaskHandler`, or `EventHandler` implementations

### 📡 Observable Everything

You're never flying blind:

- **REST API** — Fastify 5 with CORS, rate limiting (100 req/min), API key auth, and consistent error formatting. Endpoints for agents, tasks, resources, builds, system control, snapshots, health, and metrics
- **WebSocket** — Real-time event broadcasting with 100ms batching to prevent client overload. Same API key auth. Multiple concurrent dashboard connections
- **Control Centre** — An Egyptian-themed terminal dashboard (sandstone `#C2B280`, gold `#FFD700`, lapis lazuli `#1E90FF`, with ankh corner decorations and hieroglyphic borders) featuring 9 live panels:
  - Agent Overview — status indicators and latest reasoning summaries
  - Build Progress — pyramid visualization with percentage, phase, and ETA
  - Resource Dashboard — color-coded bars (green/yellow/red at threshold boundaries)
  - Map View — top-down bot positions and zone boundaries
  - Alert Feed — scrolling alerts with severity icons
  - Ceremony Calendar — upcoming ceremonies with countdown timers
  - Metrics Charts — time-series graphs for completion rates, consumption, uptime
  - Log Viewer — filterable log stream with severity highlighting
  - System Controls — start/stop/pause, mode selector, emergency stop
- **Structured Logging** — JSON logs with ISO timestamps, correlation IDs via `AsyncLocalStorage`, rotating files at 10MB with gzip compression, error aggregation (deduplicates identical errors within 10s windows)
- **CLI** — Full command-line interface for everything:

```bash
pyramid-os system start|stop|pause|status     # System lifecycle
pyramid-os agent list|spawn|terminate|inspect  # Agent management
pyramid-os task list|create|cancel|retry       # Task operations
pyramid-os resource inventory|thresholds       # Resource monitoring
pyramid-os blueprint generate|validate|export  # Blueprint management
pyramid-os snapshot create|restore|list        # State snapshots
pyramid-os health check                        # System health
pyramid-os config validate|test                # Configuration
pyramid-os log query --level --agent --since   # Log access
pyramid-os civilization create|list|switch     # Multi-civilization
pyramid-os seed load <scenario>                # Load dev scenarios
```


### 🌍 Multi-Civilization Support

Run multiple independent civilizations simultaneously. Each gets its own agent pool, database scope, resource economy, and build projects. Switch between them from the CLI or Control Centre. Want to race two AI civilizations against each other? Go for it.

### 🧪 Serious About Testing

This isn't a prototype held together with hope — it's backed by 22 property-based tests using fast-check that verify invariants across thousands of random inputs:

- Circuit breaker state machine correctness across random success/failure sequences
- Graceful shutdown persists all agent states regardless of random workspace configurations
- Task failure propagation through arbitrary dependency graphs
- Worker failure never loses tasks — reassignment is verified across random pools
- Cache consistency after random get/set/invalidate sequences
- Connection pool never exceeds max connections under random acquire/release pressure
- Throttle rate limits hold under random assignment bursts
- Plugin failures are isolated — random errors in one plugin never affect others
- Blueprint serialization round-trips perfectly for any valid blueprint
- JSON snapshot round-trips restore equivalent system state
- Worker actions are idempotent — executing twice produces the same result as once
- Cross-platform path normalization handles mixed separators, drive letters, and relative segments
- Seed data produces valid state for all 6 scenarios
- ...and 9 more

Plus comprehensive unit tests and integration tests covering the full stack.

## Quick Start

### Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| Node.js | ≥ 22 | Required for ES2022 features |
| pnpm | ≥ 9 | Workspace monorepo management |
| Ollama | Latest | Local LLM inference ([install guide](https://ollama.ai)) |
| Minecraft Server | Java Edition | Optional for development — mocks available |

### Install & Build

```bash
git clone https://github.com/ArcaneAIAutomation/pyramid-os.git
cd pyramid-os
pnpm install
pnpm build
```

Or use the automated installer (checks all prerequisites, pulls LLM models, runs health checks):

```powershell
./scripts/install.ps1
```

### Configure

Copy the minimal config and adjust for your setup:

```bash
cp examples/config-minimal.yaml config/default.yaml
```

```yaml
# Minimal — just these three sections to get started
ollama:
  host: localhost
  port: 11434

connections:
  - name: local
    host: localhost
    port: 25565
    authMethod: none  # Also supports: credentials, microsoft

api:
  port: 8080
  apiKey: change-me-in-production
```

The [full config example](examples/config-full.yaml) exposes everything: safety boundaries, resource thresholds, connection pooling, logging levels, dashboard theming, rate limits, and more.

### Run

```bash
# Start the API server
pnpm dev:api

# In another terminal — launch the Control Centre
pnpm dev:control-centre

# Or drive everything from the CLI
pnpm --filter @pyramid-os/cli exec pyramid-os system start
pnpm --filter @pyramid-os/cli exec pyramid-os agent list
pnpm --filter @pyramid-os/cli exec pyramid-os health check
```

### Development Without External Dependencies

Don't have a Minecraft server or Ollama running? No problem. PYRAMID OS ships with full mock implementations:

- **MockOllama** — canned LLM responses with configurable latency and optional failure simulation
- **MockMinecraft** — simulates bot actions with a deterministic world seed
- **MockDatabase** — in-memory Map with the same repository interfaces

Plus 6 seed scenarios to jump into any development state instantly:

| Scenario | What you get |
|---|---|
| `empty` | Fresh civilization, blank slate |
| `basic` | One of each agent tier, basic resources, empty task queue |
| `mid-build` | Pyramid 40% complete, active workers, resource procurement in progress |
| `low-resources` | Critical resource levels, emergency procurement tasks pending |
| `full-society` | All agents active, multiple districts, ceremonies scheduled, completed pyramid |
| `failure-mode` | Agents in error state, failed tasks, zero resources — for testing recovery |

```bash
pyramid-os seed load mid-build
```

## Project Structure

```
pyramid-os/
├── packages/
│   ├── shared-types/          # Central TypeScript types — the foundation everything imports
│   ├── logger/                # Structured logging, rotation, correlation IDs, error aggregation
│   ├── data-layer/            # SQLite persistence, repositories, migrations, seeds, snapshots
│   ├── blueprint/             # Structure generation, validation, serialization, progress tracking
│   ├── orchestration/         # OpenClaw orchestrator — agents, LLM, safety, plugins, recovery
│   ├── society-engine/        # Task queues, resources, zones, ceremonies, build phases, metrics
│   ├── minecraft-controller/  # Mineflayer bots, A* pathfinding, guard/priest/builder workers
│   ├── api/                   # Fastify REST API + WebSocket server
│   ├── control-centre/        # Egyptian-themed terminal dashboard with 9 live panels
│   └── cli/                   # Full command-line interface (commander)
├── config/                    # Default YAML configuration
├── examples/                  # Annotated example configs (minimal & full)
├── scripts/                   # PowerShell install & health-check scripts
└── .github/                   # CI workflow, issue templates, PR template
```

10 packages, clean dependency graph, zero circular imports. Each package builds independently with `tsc --build` project references.

## Development

```bash
pnpm test              # Run all unit + integration tests
pnpm test:property     # Run all 22 property-based tests
pnpm lint              # ESLint with strict TypeScript rules
pnpm typecheck         # Type-check all packages (no emit)
pnpm format            # Prettier auto-format
pnpm format:check      # Verify formatting (CI mode)

# Work on a single package
pnpm --filter @pyramid-os/orchestration test
pnpm --filter @pyramid-os/orchestration build

# Watch mode for development
pnpm dev               # tsc --build --watch across all packages
```

## What's Possible

PYRAMID OS is a platform. Here's what you can build on top of it:

- **Competitive AI civilizations** — spin up multiple civilizations on the same server and watch them compete for resources
- **Custom agent roles** — use the plugin system to define new agent types with custom LLM prompts and tool permissions
- **Different LLM backends** — swap Ollama models per agent tier (planners get the big model, workers get the fast one)
- **Automated Minecraft content** — use the blueprint system to procedurally generate and build any structure
- **AI behavior research** — study emergent behavior across operating modes, especially in Free Thinking where agents set their own goals
- **Distributed systems education** — circuit breakers, graceful degradation, dependency graphs, message buses — it's all here with real consequences
- **Ceremony and event systems** — extend the ceremony framework for custom in-game events with configurable effects
- **Real-time monitoring dashboards** — build custom UIs on top of the WebSocket event stream

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full guide. The short version:

- TypeScript strict mode, no `any`, no floating promises
- Vitest for tests, fast-check for property tests
- Conventional Commits: `feat(orchestration): add agent recovery`
- All PRs must pass lint, typecheck, and test

## License

[MIT](LICENSE) — build pyramids freely.
