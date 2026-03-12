/**
 * Resource route handlers for PYRAMID OS API.
 * GET /resources — query resource inventory
 */

import type { FastifyInstance } from 'fastify';
import type { ServiceContext } from './context.js';

export async function resourceRoutes(
  server: FastifyInstance,
  ctx: ServiceContext,
): Promise<void> {
  server.get('/resources', async () => {
    if (ctx.societyEngine) {
      // Delegate to society engine when wired
      return [];
    }

    // Stub response
    return [];
  });
}
