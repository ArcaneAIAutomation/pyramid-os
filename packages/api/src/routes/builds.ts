/**
 * Build route handlers for PYRAMID OS API.
 * GET /builds — list active builds
 * GET /builds/:id — get build progress
 */

import type { FastifyInstance } from 'fastify';
import type { ServiceContext } from './context.js';
import type { ApiError } from '@pyramid-os/shared-types';

export async function buildRoutes(
  server: FastifyInstance,
  ctx: ServiceContext,
): Promise<void> {
  server.get('/builds', async () => {
    if (ctx.societyEngine) {
      // Delegate to society engine when wired
      return [];
    }

    // Stub response
    return [];
  });

  server.get<{ Params: { id: string } }>('/builds/:id', async (request, reply) => {
    const { id } = request.params;

    if (!id) {
      const error: ApiError = {
        statusCode: 400,
        error: 'Bad Request',
        message: 'Build ID is required',
        code: 'MISSING_BUILD_ID',
      };
      return reply.status(400).send(error);
    }

    const error: ApiError = {
      statusCode: 404,
      error: 'Not Found',
      message: `Build '${id}' not found`,
      code: 'BUILD_NOT_FOUND',
    };
    return reply.status(404).send(error);
  });
}
