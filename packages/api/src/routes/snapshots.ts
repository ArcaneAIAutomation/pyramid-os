/**
 * Snapshot route handlers for PYRAMID OS API.
 * GET /snapshots/export — export JSON snapshot
 * POST /snapshots/import — import JSON snapshot
 */

import type { FastifyInstance } from 'fastify';
import type { ServiceContext } from './context.js';
import type { ApiError, JsonSnapshot } from '@pyramid-os/shared-types';

export async function snapshotRoutes(
  server: FastifyInstance,
  ctx: ServiceContext,
): Promise<void> {
  server.get('/snapshots/export', async (request, reply) => {
    if (ctx.snapshotManager) {
      const snapshot = await ctx.snapshotManager.export();
      return snapshot;
    }

    // Stub response when snapshot manager is not wired
    const stub: JsonSnapshot = {
      version: '1.0.0',
      civilizationId: 'default',
      exportedAt: new Date().toISOString(),
      agents: [],
      tasks: [],
      resources: [],
      blueprints: [],
    };
    return stub;
  });

  server.post('/snapshots/import', async (request, reply) => {
    const body = request.body as JsonSnapshot | undefined;

    if (!body || !body.version || !body.civilizationId) {
      const error: ApiError = {
        statusCode: 400,
        error: 'Bad Request',
        message: 'Request body must be a valid JSON snapshot with version and civilizationId',
        code: 'INVALID_SNAPSHOT',
      };
      return reply.status(400).send(error);
    }

    if (ctx.snapshotManager) {
      await ctx.snapshotManager.import(body);
    }

    return { imported: true, message: 'Snapshot imported successfully' };
  });
}
