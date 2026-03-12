/**
 * PYRAMID OS — Root entry point.
 *
 * Wires all packages together: config, logger, database, orchestration,
 * society engine, API server, and WebSocket server.
 *
 * Requirements: 13.10, 11.5
 */

import { loadConfig } from '@pyramid-os/shared-types';
import { createLogger } from '@pyramid-os/logger';
import type { Logger, LogLevel } from '@pyramid-os/logger';
import { DatabaseManager, AgentRepository, TaskRepository, ResourceRepository, BlueprintRepository, SnapshotManager, CivilizationManager } from '@pyramid-os/data-layer';
import { ServerConnector, BotManager } from '@pyramid-os/minecraft-controller';
import { OpenClawImpl } from '@pyramid-os/orchestration';
import { SocietyEngine } from '@pyramid-os/society-engine';
import { createServer, registerRoutes, WebSocketServer } from '@pyramid-os/api';
import type { FastifyInstance } from 'fastify';

export interface PyramidOSContext {
  logger: Logger;
  db: DatabaseManager;
  openclaw: OpenClawImpl;
  societyEngine: SocietyEngine;
  server: FastifyInstance;
  wsServer: WebSocketServer;
  botManager: BotManager;
}

/**
 * Bootstrap and start PYRAMID OS.
 *
 * 1. Load config from config/default.yaml
 * 2. Initialize logger
 * 3. Initialize database and run migrations
 * 4. Create repositories
 * 5. Initialize OpenClaw orchestrator
 * 6. Initialize SocietyEngine
 * 7. Create and start Fastify API + WebSocket server
 * 8. Register graceful shutdown handlers
 */
export async function main(): Promise<PyramidOSContext> {
  // 1. Load configuration
  const configPath = process.env['PYRAMID_CONFIG'] ?? 'config/default.yaml';
  const config = loadConfig(configPath);

  // 2. Initialize logger
  const logger = createLogger({
    level: config.logging.level as LogLevel,
    outputPath: config.logging.outputPath,
    maxFileSizeMb: config.logging.maxFileSizeMb,
  });

  logger.info('PYRAMID OS starting', { configPath });

  // 3. Initialize database and run migrations
  const db = new DatabaseManager();
  db.initialize(config.database.path, config.database.poolSize);
  db.migrate();
  logger.info('Database initialized and migrations applied');

  // 4. Create repositories
  const sqliteDb = db.getDb();
  const agentRepository = new AgentRepository(sqliteDb);
  const taskRepository = new TaskRepository(sqliteDb);
  const resourceRepository = new ResourceRepository(sqliteDb);
  const blueprintRepository = new BlueprintRepository(sqliteDb);
  const civilizationManager = new CivilizationManager(sqliteDb);
  const snapshotManager = new SnapshotManager(db, config.workspace.snapshotsDir ?? 'data/snapshots', 'default');

  // 5. Initialize OpenClaw orchestrator
  const openclaw = new OpenClawImpl(logger, agentRepository);
  await openclaw.initialize(config);
  logger.info('OpenClaw orchestrator initialized');

  // 6. Initialize SocietyEngine
  const societyEngine = new SocietyEngine(logger);
  await societyEngine.initialize(sqliteDb as any);
  logger.info('SocietyEngine initialized');

  // 7. Create Fastify API server and WebSocket server
  const server = await createServer({
    port: config.api.port,
    apiKey: config.api.apiKey,
    rateLimitPerMin: config.api.rateLimitPerMin,
  });

  // Register REST routes with service context
  await registerRoutes(server, {
    openclaw,
    societyEngine,
    snapshotManager,
    civilizationManager,
    agentRepository,
    taskRepository,
    resourceRepository,
    blueprintRepository,
  });

  // Register WebSocket server
  const wsServer = new WebSocketServer(config.api.apiKey);
  await wsServer.registerWithFastify(server);

  // Start listening
  await server.listen({ port: config.api.port, host: '0.0.0.0' });
  logger.info(`API server listening on port ${config.api.port}`);

  // 9. Spawn Mineflayer bots for each connection profile
  const serverConnector = new ServerConnector(config.connections, logger);
  const botManager = new BotManager({ serverConnector, logger });

  for (const profile of config.connections) {
    try {
      logger.info(`Spawning bot for connection: ${profile.name} (${profile.host}:${profile.port})`);
      const bot = await botManager.connectBot(profile, 'builder');
      logger.info(`Bot connected: ${bot.id} → ${profile.host}:${profile.port}`);

      // Broadcast bot:connect event over WebSocket
      wsServer.broadcast({
        type: 'bot:connect',
        botId: bot.id,
        server: `${profile.host}:${profile.port}`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`Failed to connect bot for ${profile.name}: ${msg}`);
    }
  }

  // 10. Register graceful shutdown handlers
  const context: PyramidOSContext = {
    logger,
    db,
    openclaw,
    societyEngine,
    server,
    wsServer,
    botManager,
  };

  registerShutdownHandlers(context);

  logger.info('PYRAMID OS startup complete');
  return context;
}
/**
 * Register SIGINT and SIGTERM handlers for graceful shutdown.
 * Saves all state before terminating.
 *
 * Requirement: 13.10
 */
function registerShutdownHandlers(ctx: PyramidOSContext): void {
  let shuttingDown = false;

  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;

    ctx.logger.info(`Received ${signal} — initiating graceful shutdown`);

    try {
      // 1. Close WebSocket connections
      ctx.wsServer.close();
      ctx.logger.info('WebSocket server closed');

      // 2. Stop API server
      await ctx.server.close();
      ctx.logger.info('API server closed');

      // 3. Disconnect all bots
      await ctx.botManager.shutdown();
      ctx.logger.info('Bots disconnected');

      // 4. Shutdown OpenClaw (persists all agent states)
      await ctx.openclaw.shutdown();
      ctx.logger.info('OpenClaw shutdown complete');

      // 5. Close database
      ctx.db.close();
      ctx.logger.info('Database closed');

      ctx.logger.info('PYRAMID OS shutdown complete');
    } catch (err) {
      ctx.logger.error(
        'Error during shutdown',
        err instanceof Error ? err : new Error(String(err)),
      );
    } finally {
      process.exit(0);
    }
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

// Run directly when executed as a script
if (process.argv[1]?.endsWith('main.ts') || process.argv[1]?.endsWith('main.js')) {
  main().catch((err) => {
    console.error('PYRAMID OS failed to start:', err);
    process.exit(1);
  });
}
