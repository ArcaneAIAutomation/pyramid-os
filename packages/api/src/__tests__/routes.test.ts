import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createServer } from '../server.js';
import { registerRoutes } from '../routes/index.js';

const API_KEY = 'test-routes-key';
const headers = { 'x-api-key': API_KEY };

describe('REST route handlers', () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    server = await createServer({ port: 0, apiKey: API_KEY });
    await registerRoutes(server, {});
    await server.ready();
  });

  afterEach(async () => {
    await server.close();
  });

  // ── Agents ──────────────────────────────────────────────────────────

  describe('GET /agents', () => {
    it('returns an empty array when no services are wired', async () => {
      const res = await server.inject({ method: 'GET', url: '/agents', headers });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
    });

    it('requires authentication', async () => {
      const res = await server.inject({ method: 'GET', url: '/agents' });
      expect(res.statusCode).toBe(401);
    });
  });

  describe('GET /agents/:id', () => {
    it('returns 404 for unknown agent', async () => {
      const res = await server.inject({ method: 'GET', url: '/agents/unknown-id', headers });
      expect(res.statusCode).toBe(404);
      const body = res.json();
      expect(body.code).toBe('AGENT_NOT_FOUND');
    });
  });

  // ── Tasks ───────────────────────────────────────────────────────────

  describe('GET /tasks', () => {
    it('returns an empty array when no services are wired', async () => {
      const res = await server.inject({ method: 'GET', url: '/tasks', headers });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
    });
  });

  describe('GET /tasks/:id', () => {
    it('returns 404 for unknown task', async () => {
      const res = await server.inject({ method: 'GET', url: '/tasks/unknown-id', headers });
      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe('TASK_NOT_FOUND');
    });
  });


  // ── Resources ───────────────────────────────────────────────────────

  describe('GET /resources', () => {
    it('returns an empty array when no services are wired', async () => {
      const res = await server.inject({ method: 'GET', url: '/resources', headers });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
    });
  });

  // ── Builds ──────────────────────────────────────────────────────────

  describe('GET /builds', () => {
    it('returns an empty array when no services are wired', async () => {
      const res = await server.inject({ method: 'GET', url: '/builds', headers });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
    });
  });

  describe('GET /builds/:id', () => {
    it('returns 404 for unknown build', async () => {
      const res = await server.inject({ method: 'GET', url: '/builds/unknown-id', headers });
      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe('BUILD_NOT_FOUND');
    });
  });

  // ── System Control ─────────────────────────────────────────────────

  describe('POST /system/start', () => {
    it('returns started response', async () => {
      const res = await server.inject({ method: 'POST', url: '/system/start', headers });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ started: true, message: 'System started' });
    });
  });

  describe('POST /system/stop', () => {
    it('returns stopped response', async () => {
      const res = await server.inject({ method: 'POST', url: '/system/stop', headers });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ stopped: true, message: 'System stopped' });
    });
  });

  describe('POST /system/pause', () => {
    it('returns paused response', async () => {
      const res = await server.inject({ method: 'POST', url: '/system/pause', headers });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ paused: true, message: 'System paused' });
    });
  });

  describe('POST /system/mode', () => {
    it('accepts a valid mode', async () => {
      const res = await server.inject({
        method: 'POST',
        url: '/system/mode',
        headers: { ...headers, 'content-type': 'application/json' },
        payload: { mode: 'structured' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().mode).toBe('structured');
    });

    it('rejects missing mode', async () => {
      const res = await server.inject({
        method: 'POST',
        url: '/system/mode',
        headers: { ...headers, 'content-type': 'application/json' },
        payload: {},
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('MISSING_MODE');
    });

    it('rejects invalid mode', async () => {
      const res = await server.inject({
        method: 'POST',
        url: '/system/mode',
        headers: { ...headers, 'content-type': 'application/json' },
        payload: { mode: 'chaos' },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('INVALID_MODE');
    });
  });

  // ── Snapshots ──────────────────────────────────────────────────────

  describe('POST /system/recover', () => {
    it('returns 503 when snapshot manager is not wired', async () => {
      const res = await server.inject({ method: 'POST', url: '/system/recover', headers });
      expect(res.statusCode).toBe(503);
      expect(res.json().code).toBe('SNAPSHOT_MANAGER_UNAVAILABLE');
    });
  });

  describe('GET /snapshots/export', () => {
    it('returns a stub snapshot when no services are wired', async () => {
      const res = await server.inject({ method: 'GET', url: '/snapshots/export', headers });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.version).toBe('1.0.0');
      expect(body.civilizationId).toBe('default');
      expect(Array.isArray(body.agents)).toBe(true);
    });
  });

  describe('POST /snapshots/import', () => {
    it('accepts a valid snapshot', async () => {
      const res = await server.inject({
        method: 'POST',
        url: '/snapshots/import',
        headers: { ...headers, 'content-type': 'application/json' },
        payload: {
          version: '1.0.0',
          civilizationId: 'test',
          exportedAt: new Date().toISOString(),
          agents: [],
          tasks: [],
          resources: [],
          blueprints: [],
        },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().imported).toBe(true);
    });

    it('rejects invalid snapshot body', async () => {
      const res = await server.inject({
        method: 'POST',
        url: '/snapshots/import',
        headers: { ...headers, 'content-type': 'application/json' },
        payload: {},
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('INVALID_SNAPSHOT');
    });
  });

  // ── Metrics ────────────────────────────────────────────────────────

  describe('GET /metrics', () => {
    it('returns JSON metrics by default', async () => {
      const res = await server.inject({ method: 'GET', url: '/metrics', headers });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('taskCompletionRate');
      expect(body).toHaveProperty('timestamp');
    });

    it('returns Prometheus text format when requested', async () => {
      const res = await server.inject({
        method: 'GET',
        url: '/metrics',
        headers: { ...headers, accept: 'text/plain' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/plain');
      expect(res.payload).toContain('pyramid_task_completion_rate');
    });
  });

  // ── Health (already exists, verify still works) ────────────────────

  describe('GET /health', () => {
    it('returns ok without authentication', async () => {
      const res = await server.inject({ method: 'GET', url: '/health' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ status: 'ok' });
    });
  });
});
