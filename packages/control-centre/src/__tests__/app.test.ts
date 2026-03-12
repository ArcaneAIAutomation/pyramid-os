import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDashboardApp } from '../app.js';
import type { DashboardApp } from '../app.js';
import type { PyramidConfig } from '@pyramid-os/shared-types';
import type { Logger } from '@pyramid-os/logger';

function createMockLogger(): Logger {
  return {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  };
}

function createMockConfig(port: number): PyramidConfig {
  return {
    ollama: { host: 'localhost', port: 11434, timeout: 30000, maxConcurrentRequests: 2 },
    connections: [],
    safety: { prohibitedBlocks: [], prohibitedCommands: [], maxDecisionTimeMs: 30000, maxActionsPerSecond: 10, maxReasoningLoops: 50 },
    controlCentre: { port, theme: 'egyptian', refreshRateMs: 1000 },
    logging: { level: 'info', outputPath: 'logs', maxFileSizeMb: 10 },
    api: { port: 3000, apiKey: 'test-key', rateLimitPerMin: 100 },
    database: { path: ':memory:', poolSize: 1 },
    workspace: { dataDir: '.pyramid-os', snapshotsDir: 'snapshots', logsDir: 'logs' },
  };
}

describe('createDashboardApp', () => {
  let app: DashboardApp;
  const testPort = 19876;

  beforeEach(() => {
    app = createDashboardApp({
      config: createMockConfig(testPort),
      logger: createMockLogger(),
    });
  });

  afterEach(async () => {
    if (app.isRunning) {
      await app.stop();
    }
  });

  it('should create a dashboard app with the configured port', () => {
    expect(app.port).toBe(testPort);
    expect(app.isRunning).toBe(false);
  });

  it('should start and serve HTML on the configured port', async () => {
    await app.start();
    expect(app.isRunning).toBe(true);

    const response = await fetch(`http://localhost:${testPort}`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');

    const html = await response.text();
    expect(html).toContain('PYRAMID OS Control Centre');
    expect(html).toContain('#C2B280'); // sandstone
    expect(html).toContain('#FFD700'); // gold
    expect(html).toContain('#1E90FF'); // lapis
  });

  it('should stop the server', async () => {
    await app.start();
    expect(app.isRunning).toBe(true);

    await app.stop();
    expect(app.isRunning).toBe(false);
  });

  it('should not throw when starting an already running app', async () => {
    await app.start();
    await expect(app.start()).resolves.toBeUndefined();
  });

  it('should not throw when stopping an already stopped app', async () => {
    await expect(app.stop()).resolves.toBeUndefined();
  });
});
