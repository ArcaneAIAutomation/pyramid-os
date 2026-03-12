import * as http from 'node:http';
import type { PyramidConfig } from '@pyramid-os/shared-types';
import type { Logger } from '@pyramid-os/logger';
import { EGYPTIAN_THEME } from './theme.js';

export interface DashboardApp {
  /** Start serving the dashboard on the configured port */
  start(): Promise<void>;
  /** Stop the dashboard server */
  stop(): Promise<void>;
  /** Whether the server is currently running */
  readonly isRunning: boolean;
  /** The port the server is listening on */
  readonly port: number;
}

export interface DashboardAppOptions {
  config: PyramidConfig;
  logger: Logger;
}

/**
 * Generates the dashboard HTML page with Egyptian theme styling.
 */
function generateDashboardHtml(): string {
  const { colors, fonts } = EGYPTIAN_THEME;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>PYRAMID OS - Control Centre</title>
  <style>
    :root {
      --sandstone: ${colors.sandstone};
      --gold: ${colors.gold};
      --lapis: ${colors.lapis};
      --papyrus: ${colors.papyrus};
      --obsidian: ${colors.obsidian};
      --copper: ${colors.copper};
      --turquoise: ${colors.turquoise};
      --hieroglyph-red: ${colors.hieroglyphRed};
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background-color: var(--obsidian);
      color: var(--papyrus);
      font-family: ${fonts.body};
    }
    h1, h2, h3 { font-family: ${fonts.heading}; color: var(--gold); }
    #app {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 12px;
      padding: 16px;
      min-height: 100vh;
    }
    header {
      grid-column: 1 / -1;
      background: linear-gradient(135deg, var(--obsidian), var(--sandstone));
      border: 2px solid var(--gold);
      padding: 16px;
      text-align: center;
    }
    .panel {
      background-color: rgba(194, 178, 128, 0.1);
      border: 1px solid var(--copper);
      border-radius: 4px;
      padding: 12px;
    }
    .panel h2 { font-size: 1rem; margin-bottom: 8px; border-bottom: 1px solid var(--copper); padding-bottom: 4px; }
    .status-ok { color: var(--turquoise); }
    .status-warn { color: var(--gold); }
    .status-error { color: var(--hieroglyph-red); }
  </style>
</head>
<body>
  <div id="app">
    <header>
      <h1>&#9650; PYRAMID OS Control Centre</h1>
      <p style="color: var(--sandstone);">Egyptian Civilization Multi-Agent Dashboard</p>
    </header>
    <div class="panel"><h2>Agent Overview</h2><p>Connecting...</p></div>
    <div class="panel"><h2>Build Progress</h2><p>Connecting...</p></div>
    <div class="panel"><h2>Resources</h2><p>Connecting...</p></div>
    <div class="panel"><h2>Map View</h2><p>Connecting...</p></div>
    <div class="panel"><h2>Alert Feed</h2><p>No alerts</p></div>
    <div class="panel"><h2>System Controls</h2><p>Connecting...</p></div>
  </div>
</body>
</html>`;
}

/**
 * Creates and returns a DashboardApp that serves the Control Centre
 * on the port specified in the PyramidConfig.
 */
export function createDashboardApp(options: DashboardAppOptions): DashboardApp {
  const { config, logger } = options;
  const port = config.controlCentre.port;
  let server: http.Server | null = null;
  let running = false;

  const dashboardHtml = generateDashboardHtml();

  const requestHandler: http.RequestListener = (_req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-cache',
    });
    res.end(dashboardHtml);
  };

  return {
    get isRunning() {
      return running;
    },
    get port() {
      return port;
    },
    async start() {
      if (running) {
        logger.warn('Dashboard app is already running');
        return;
      }
      server = http.createServer(requestHandler);
      await new Promise<void>((resolve, reject) => {
        server!.on('error', reject);
        server!.listen(port, () => {
          running = true;
          logger.info(`Control Centre dashboard started on port ${port}`);
          resolve();
        });
      });
    },
    async stop() {
      if (!running || !server) {
        logger.warn('Dashboard app is not running');
        return;
      }
      await new Promise<void>((resolve, reject) => {
        server!.close((err) => {
          if (err) {
            reject(err);
          } else {
            running = false;
            server = null;
            logger.info('Control Centre dashboard stopped');
            resolve();
          }
        });
      });
    },
  };
}
