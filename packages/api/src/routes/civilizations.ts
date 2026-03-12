/**
 * Civilization route handlers for PYRAMID OS API.
 * POST /civilizations — create a new civilization
 * GET /civilizations — list all civilizations
 * DELETE /civilizations/:name — delete a civilization by name
 * POST /civilizations/:name/activate — switch active civilization
 * GET /civilizations/active — get the active civilization
 *
 * Requirements: 32.1, 32.3, 32.7, 32.8, 32.10
 */

import type { FastifyInstance } from 'fastify';
import type { ServiceContext } from './context.js';
import type { ApiError } from '@pyramid-os/shared-types';

export async function civilizationRoutes(
  server: FastifyInstance,
  ctx: ServiceContext,
): Promise<void> {
  server.post('/civilizations', async (request, reply) => {
    const { name } = request.body as { name?: string };

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      const error: ApiError = {
        statusCode: 400,
        error: 'Bad Request',
        message: 'Civilization name is required',
        code: 'MISSING_NAME',
      };
      return reply.status(400).send(error);
    }

    if (!ctx.civilizationManager) {
      return reply.status(503).send({
        statusCode: 503,
        error: 'Service Unavailable',
        message: 'Civilization manager not available',
        code: 'SERVICE_UNAVAILABLE',
      } satisfies ApiError);
    }

    try {
      const civ = ctx.civilizationManager.create(name);
      return reply.status(201).send(civ);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return reply.status(409).send({
        statusCode: 409,
        error: 'Conflict',
        message,
        code: 'CIVILIZATION_EXISTS',
      } satisfies ApiError);
    }
  });

  server.get('/civilizations', async (_request, _reply) => {
    if (!ctx.civilizationManager) {
      return [];
    }
    return ctx.civilizationManager.list();
  });

  server.get('/civilizations/active', async (_request, reply) => {
    if (!ctx.civilizationManager) {
      return reply.status(503).send({
        statusCode: 503,
        error: 'Service Unavailable',
        message: 'Civilization manager not available',
        code: 'SERVICE_UNAVAILABLE',
      } satisfies ApiError);
    }

    const active = ctx.civilizationManager.getActive();
    if (!active) {
      return reply.status(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: 'No active civilization set',
        code: 'NO_ACTIVE_CIVILIZATION',
      } satisfies ApiError);
    }

    return active;
  });

  server.delete<{ Params: { name: string } }>(
    '/civilizations/:name',
    async (request, reply) => {
      const { name } = request.params;

      if (!ctx.civilizationManager) {
        return reply.status(503).send({
          statusCode: 503,
          error: 'Service Unavailable',
          message: 'Civilization manager not available',
          code: 'SERVICE_UNAVAILABLE',
        } satisfies ApiError);
      }

      const civ = ctx.civilizationManager.findByName(name);
      if (!civ) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: `Civilization '${name}' not found`,
          code: 'CIVILIZATION_NOT_FOUND',
        } satisfies ApiError);
      }

      try {
        ctx.civilizationManager.delete(civ.id);
        return { status: 'ok', message: `Civilization '${name}' deleted` };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message,
          code: 'DELETE_FAILED',
        } satisfies ApiError);
      }
    },
  );

  server.post<{ Params: { name: string } }>(
    '/civilizations/:name/activate',
    async (request, reply) => {
      const { name } = request.params;

      if (!ctx.civilizationManager) {
        return reply.status(503).send({
          statusCode: 503,
          error: 'Service Unavailable',
          message: 'Civilization manager not available',
          code: 'SERVICE_UNAVAILABLE',
        } satisfies ApiError);
      }

      const civ = ctx.civilizationManager.findByName(name);
      if (!civ) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: `Civilization '${name}' not found`,
          code: 'CIVILIZATION_NOT_FOUND',
        } satisfies ApiError);
      }

      ctx.civilizationManager.setActive(civ.id);
      return { status: 'ok', message: `Switched to civilization '${name}'`, civilization: civ };
    },
  );
}
