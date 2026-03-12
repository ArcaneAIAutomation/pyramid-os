# Changelog

All notable changes to PYRAMID OS will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2025-01-01

### Added

- Initial monorepo scaffold with pnpm workspaces and TypeScript strict mode
- **Orchestration (OpenClaw)**: Agent lifecycle management, workspace isolation, LLM routing via Ollama, inter-agent message bus, operating mode controller, safety enforcer
- **Minecraft Controller**: Mineflayer bot management, server connector with multi-auth support, A* pathfinding, action executor, rate limiting
- **Society Engine**: Priority task queues, dependency graph (DAG) with cycle detection, resource tracker with threshold alerts, zone manager, build phase sequencing, ceremony manager, metrics collector
- **Blueprint System**: Pyramid/district/farm/temple generators, JSON serializer with round-trip property, validator, progress tracker
- **Data Layer**: SQLite persistence with better-sqlite3, repository pattern, schema migrations, JSON snapshot export/import
- **API Layer**: Fastify REST API with all CRUD endpoints, WebSocket server for real-time events, API key authentication, rate limiting
- **Control Centre**: Egyptian-themed Canvas/A2UI dashboard with agent overview, build progress, resource levels, map view, alert feed, ceremony calendar, metrics charts, log viewer, system controls
- **CLI**: Full command suite (system, agent, task, resource, blueprint, snapshot, config, log, health, civilization)
- **Logger**: Structured JSON logging with rotation, correlation IDs, and multi-output
- **Shared Types**: Complete TypeScript type definitions for all domain entities
- **Configuration**: YAML/JSON config loader with Zod validation and environment variable overrides
- Agent hierarchy: Pharaoh, Vizier, Architect (Planner); Scribe, Bot-Foreman, Defense, Ops, UI-Master (Operational); Builder, Quarry, Hauler, Guard, Farmer, Priest (Worker)
- Three operating modes: Structured, Guided Autonomy, Free Thinking
- Free Thinking intention engine with personality traits
- PowerShell installation and health check scripts
- Property-based tests for blueprint round-trip, snapshot round-trip, and worker action idempotency
