import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createServer } from '../server.js';

const TEST_API_KEY = 'test-key-12345';

describe('createServer', () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    server = await createServer({
      port: 0,
      apiKey: TEST_API_KEY,
      rateLimitPerMin: 100,
    });
  });

  afterEach(async () => {
    await server.close();
  });

  describe('health endpoint', () => {
    it('should respond 200 without authentication', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/health',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ status: 'ok' });
    });

    it('should respond 200 even with an invalid API key', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/health',
        headers: { 'x-api-key': 'wrong-key' },
      });

      expect(response.statusCode).toBe(200);
    });
  });

  describe('authentication', () => {
    it('should return 401 when x-api-key header is missing', async () => {
      // Register a dummy route to test auth
      server.get('/test-auth', async () => ({ ok: true }));

      const response = await server.inject({
        method: 'GET',
        url: '/test-auth',
      });

      expect(response.statusCode).toBe(401);
      const body = response.json();
      expect(body.statusCode).toBe(401);
      expect(body.error).toBe('Unauthorized');
      expect(body.code).toBe('MISSING_API_KEY');
      expect(body.message).toContain('Missing');
    });

    it('should return 401 when x-api-key is invalid', async () => {
      server.get('/test-auth', async () => ({ ok: true }));

      const response = await server.inject({
        method: 'GET',
        url: '/test-auth',
        headers: { 'x-api-key': 'wrong-key' },
      });

      expect(response.statusCode).toBe(401);
      const body = response.json();
      expect(body.statusCode).toBe(401);
      expect(body.error).toBe('Unauthorized');
      expect(body.code).toBe('INVALID_API_KEY');
      expect(body.message).toContain('Invalid');
    });

    it('should allow requests with a valid API key', async () => {
      server.get('/test-auth', async () => ({ ok: true }));

      const response = await server.inject({
        method: 'GET',
        url: '/test-auth',
        headers: { 'x-api-key': TEST_API_KEY },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ ok: true });
    });
  });

  describe('error handling', () => {
    it('should return consistent ApiError format for route errors', async () => {
      server.get('/error-test', async () => {
        const err = new Error('Something went wrong');
        (err as any).statusCode = 400;
        (err as any).code = 'BAD_INPUT';
        throw err;
      });

      const response = await server.inject({
        method: 'GET',
        url: '/error-test',
        headers: { 'x-api-key': TEST_API_KEY },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.statusCode).toBe(400);
      expect(body.error).toBe('Bad Request');
      expect(body.message).toBe('Something went wrong');
      expect(body.code).toBe('BAD_INPUT');
    });

    it('should return 500 for unhandled errors', async () => {
      server.get('/crash', async () => {
        throw new Error('Unexpected failure');
      });

      const response = await server.inject({
        method: 'GET',
        url: '/crash',
        headers: { 'x-api-key': TEST_API_KEY },
      });

      expect(response.statusCode).toBe(500);
      const body = response.json();
      expect(body.statusCode).toBe(500);
      expect(body.error).toBe('Internal Server Error');
      expect(body.code).toBe('INTERNAL_ERROR');
    });

    it('should return 404 for unknown routes', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/nonexistent',
        headers: { 'x-api-key': TEST_API_KEY },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('CORS', () => {
    it('should include CORS headers in responses', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/health',
        headers: { origin: 'http://localhost:3000' },
      });

      expect(response.headers['access-control-allow-origin']).toBeDefined();
    });
  });

  describe('rate limiting', () => {
    it('should include rate limit headers', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/health',
      });

      expect(response.statusCode).toBe(200);
      // Rate limit headers are present
      expect(response.headers['x-ratelimit-limit']).toBeDefined();
      expect(response.headers['x-ratelimit-remaining']).toBeDefined();
    });
  });
});
