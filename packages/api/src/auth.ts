/**
 * API key authentication plugin for PYRAMID OS Fastify server.
 * Checks the `x-api-key` header against the configured API key.
 * Skips authentication for the `/health` endpoint.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import type { ApiError } from '@pyramid-os/shared-types';

export interface AuthPluginOptions {
  apiKey: string;
}

async function authPluginFn(
  fastify: FastifyInstance,
  opts: AuthPluginOptions,
): Promise<void> {
  fastify.addHook(
    'onRequest',
    async (request: FastifyRequest, reply: FastifyReply) => {
      // Skip auth for health and WebSocket endpoints (WS auth is handled in the WS handler)
      if (request.url === '/health' || request.url.startsWith('/ws')) {
        return;
      }

      const providedKey = request.headers['x-api-key'];

      if (!providedKey) {
        const error: ApiError = {
          statusCode: 401,
          error: 'Unauthorized',
          message: 'Missing x-api-key header',
          code: 'MISSING_API_KEY',
        };
        reply.status(401).send(error);
        return;
      }

      if (providedKey !== opts.apiKey) {
        const error: ApiError = {
          statusCode: 401,
          error: 'Unauthorized',
          message: 'Invalid API key',
          code: 'INVALID_API_KEY',
        };
        reply.status(401).send(error);
        return;
      }
    },
  );
}

export const authPlugin = fp(authPluginFn, {
  name: 'pyramid-os-auth',
});
