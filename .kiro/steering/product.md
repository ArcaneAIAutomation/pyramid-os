# PYRAMID OS — Product Overview

PYRAMID OS is a multi-agent automation system that builds and manages an Egyptian-themed civilization inside Minecraft. AI agents (powered by Ollama LLMs) autonomously coordinate to gather resources, construct pyramids and temples, manage zones, and run a simulated society — all controlled through a REST API, CLI, and visual dashboard.

## Core Concepts

- **Agents**: Tiered AI entities (planner, operational, worker) that make decisions and execute actions in-game via Mineflayer bots.
- **Blueprints**: Structural definitions (pyramids, housing, farms, temples) that agents follow when building.
- **Society Engine**: Scheduling, task queues, resource tracking, zone management, build phases, ceremonies, and dependency graphs.
- **Orchestration**: Agent lifecycle, LLM routing, message bus, circuit breakers, recovery, mode control, plugin system, and safety enforcement.
- **Control Centre**: Terminal-based dashboard with panels for agents, resources, maps, metrics, alerts, and build progress.

## External Dependencies

- **Minecraft server** — the world agents operate in
- **Ollama** — local LLM inference for agent reasoning
- **SQLite** (via better-sqlite3) — persistence layer
