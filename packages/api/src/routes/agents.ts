/**
 * Agent route handlers for PYRAMID OS API.
 * GET /agents — list all agents
 * GET /agents/:id — get agent by ID
 */

import type { FastifyInstance } from 'fastify';
import type { ServiceContext } from './context.js';
import type { ApiError } from '@pyramid-os/shared-types';

export async function agentRoutes(
  server: FastifyInstance,
  ctx: ServiceContext,
): Promise<void> {
  server.get('/agents', async (request) => {
    const { tier, role, status, civilizationId } = request.query as Record<string, string | undefined>;

    if (ctx.openclaw) {
      const agents = ctx.openclaw.getState();
      // Return stub list derived from system state
      return [];
    }

    // Stub response when services are not wired
    return [];
  });

  server.get<{ Params: { id: string } }>('/agents/:id', async (request, reply) => {
    const { id } = request.params;

    if (!id) {
      const error: ApiError = {
        statusCode: 400,
        error: 'Bad Request',
        message: 'Agent ID is required',
        code: 'MISSING_AGENT_ID',
      };
      return reply.status(400).send(error);
    }

    // Stub: return 404 since no real agents exist yet
    const error: ApiError = {
      statusCode: 404,
      error: 'Not Found',
      message: `Agent '${id}' not found`,
      code: 'AGENT_NOT_FOUND',
    };
    return reply.status(404).send(error);
  });
}
