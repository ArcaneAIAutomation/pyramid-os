/**
 * Fastify server setup for PYRAMID OS REST API.
 * Configures CORS, rate limiting, authentication, and error handling.
 */

import Fastify, { type FastifyInstance, type FastifyError } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import type { ApiError } from '@pyramid-os/shared-types';
import { authPlugin } from './auth.js';

export interface ServerConfig {
  /** Port to listen on */
  port: number;
  /** API key for authentication */
  apiKey: string;
  /** Max requests per minute per client (default: 100) */
  rateLimitPerMin?: number;
}

/**
 * Create and configure a Fastify server instance with CORS,
 * rate limiting, API key auth, and consistent error formatting.
 */
export async function createServer(config: ServerConfig): Promise<FastifyInstance> {
  const server = Fastify({
    logger: false,
    ajv: {
      customOptions: {
        allErrors: true,
        removeAdditional: 'all',
      },
    },
  });

  // Register CORS
  await server.register(cors, {
    origin: true,
  });

  // Register rate limiting
  await server.register(rateLimit, {
    max: config.rateLimitPerMin ?? 100,
    timeWindow: '1 minute',
  });

  // Register API key authentication
  await server.register(authPlugin, {
    apiKey: config.apiKey,
  });

  // Health endpoint (unauthenticated — auth plugin skips /health)
  server.get('/health', async () => {
    return { status: 'ok' };
  });

  // Custom error handler returning consistent ApiError format
  server.setErrorHandler((error: FastifyError, _request, reply) => {
    const statusCode = error.statusCode ?? 500;

    const apiError: ApiError = {
      statusCode,
      error: statusCodeToError(statusCode),
      message: error.message,
      code: error.code ?? 'INTERNAL_ERROR',
      details: error.validation ?? undefined,
    };

    reply.status(statusCode).send(apiError);
  });

  return server;
}

function statusCodeToError(statusCode: number): string {
  switch (statusCode) {
    case 400:
      return 'Bad Request';
    case 401:
      return 'Unauthorized';
    case 403:
      return 'Forbidden';
    case 404:
      return 'Not Found';
    case 409:
      return 'Conflict';
    case 429:
      return 'Too Many Requests';
    default:
      return statusCode >= 500 ? 'Internal Server Error' : 'Error';
  }
}
