# Project Structure

PYRAMID OS is a pnpm workspace monorepo. All packages live under `packages/` and are scoped as `@pyramid-os/*`.

## Package Dependency Graph (high-level)

```
shared-types  ←── logger  ←── data-layer  ←── blueprint
                                  ↑               ↑
                            orchestration    society-engine
                                  ↑               ↑
                         minecraft-controller      │
                                  ↑               ↑
                                api ──── control-centre
                                  ↑
                                 cli
```

## Packages

| Package | Purpose |
|---|---|
| `shared-types` | Central TypeScript types, error definitions, cache, config loader, path resolver. No runtime deps — everything else depends on this. |
| `logger` | Structured logging, log rotation, correlation IDs, error aggregation. |
| `data-layer` | SQLite persistence (better-sqlite3), connection pooling, repositories (Agent, Blueprint, Bot, Resource, Zone), migrations, seeds, snapshots, civilization management. |
| `blueprint` | Blueprint generation, validation, serialization, and build progress tracking for structures (pyramids, housing, farms, temples). |
| `orchestration` | Agent management, LLM routing (Ollama), message bus, circuit breakers, recovery, mode control, safety enforcement, intention engine, plugin system (loader, registry, sandbox), event hooks. |
| `society-engine` | Society simulation — task queues, resource tracking, zone management, build phase management, dependency graphs, ceremony scheduling, metrics collection, throttling. |
| `minecraft-controller` | Mineflayer bot lifecycle (server connector, bot manager), pathfinding, action execution, specialized workers (guard, priest). |
| `api` | Fastify REST API + WebSocket server. Routes for agents, tasks, civilizations, system control, health checks. |
| `control-centre` | Terminal dashboard app with themed panels (agent overview, alerts, build progress, ceremony calendar, logs, map, metrics, resources, system controls). Hot-reload and WebSocket client. |
| `cli` | Command-line interface — commands for agents, blueprints, civilizations, config, health, logs, resources, seeds, snapshots, system, tasks. |

## Directory Conventions

```
packages/<name>/
  src/
    index.ts              # Public API barrel export
    __tests__/            # Unit tests (*.test.ts) and property tests (*.property.test.ts)
    __mocks__/            # Test mocks (where needed)
    routes/               # (api only) Route handlers
    panels/               # (control-centre only) Dashboard panels
    repositories/         # (data-layer only) DB repositories
    migrations/           # (data-layer only) Schema migrations
    seeds/                # (data-layer only) Seed data
    workers/              # (minecraft-controller only) Specialized bot workers
    agents/               # (orchestration only) Agent implementations
    commands/             # (cli only) CLI command handlers
  package.json
  tsconfig.json
  vitest.config.ts
```

## Other Top-Level Directories

| Path | Purpose |
|---|---|
| `config/` | Default YAML configuration (`default.yaml`) |
| `examples/` | Example config files (full and minimal) |
| `scripts/` | PowerShell utility scripts (install, health-check) |
| `.kiro/specs/` | Spec-driven development documents |
| `.kiro/steering/` | Steering rules for AI assistants |
