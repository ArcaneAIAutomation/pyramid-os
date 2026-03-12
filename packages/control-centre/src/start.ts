/**
 * Control Centre standalone entry point.
 * Starts the dashboard HTTP server and connects to the PYRAMID OS WebSocket.
 */
import { loadConfig } from '@pyramid-os/shared-types';
import { createLogger } from '@pyramid-os/logger';
import type { LogLevel } from '@pyramid-os/logger';
import { createDashboardApp } from './app.js';
import { WebSocketClient } from './websocket-client.js';

(async () => {
  const configPath = process.env['PYRAMID_CONFIG'] ?? 'config/default.yaml';
  const config = loadConfig(configPath);

  const logger = createLogger({
    level: config.logging.level as LogLevel,
    outputPath: config.logging.outputPath,
    maxFileSizeMb: config.logging.maxFileSizeMb,
  });

  const app = createDashboardApp({ config, logger });

  const wsClient = new WebSocketClient({
    url: `ws://localhost:${config.api.port}`,
    apiKey: config.api.apiKey,
    maxReconnectDelayMs: 2000,
    maxReconnectAttempts: 10,
  });

  await app.start();
  logger.info(`Control Centre running at http://localhost:${config.controlCentre.port}`);

  wsClient.connect();
  logger.info(`WebSocket client connecting to ws://localhost:${config.api.port}`);

  process.on('SIGINT', async () => {
    wsClient.disconnect();
    await app.stop();
    process.exit(0);
  });
})().catch(console.error);
