/**
 * Task route handlers for PYRAMID OS API.
 * GET /tasks — list tasks (filterable)
 * GET /tasks/:id — get task by ID
 */

import type { FastifyInstance } from 'fastify';
import type { ServiceContext } from './context.js';
import type { ApiError } from '@pyramid-os/shared-types';

export async function taskRoutes(
  server: FastifyInstance,
  ctx: ServiceContext,
): Promise<void> {
  server.get('/tasks', async (request) => {
    const { status, type, priority, agentId, civilizationId } = request.query as Record<
      string,
      string | undefined
    >;

    if (ctx.societyEngine) {
      // Delegate to society engine when wired
      return [];
    }

    // Stub response
    return [];
  });

  server.get<{ Params: { id: string } }>('/tasks/:id', async (request, reply) => {
    const { id } = request.params;

    if (!id) {
      const error: ApiError = {
        statusCode: 400,
        error: 'Bad Request',
        message: 'Task ID is required',
        code: 'MISSING_TASK_ID',
      };
      return reply.status(400).send(error);
    }

    const error: ApiError = {
      statusCode: 404,
      error: 'Not Found',
      message: `Task '${id}' not found`,
      code: 'TASK_NOT_FOUND',
    };
    return reply.status(404).send(error);
  });
}
