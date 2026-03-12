/**
 * Route barrel — registers all REST route handlers on a Fastify instance.
 * Accepts a ServiceContext for dependency injection of backend services.
 */

import type { FastifyInstance } from 'fastify';
import type { ServiceContext } from './context.js';
import { agentRoutes } from './agents.js';
import { taskRoutes } from './tasks.js';
import { resourceRoutes } from './resources.js';
import { buildRoutes } from './builds.js';
import { systemRoutes } from './system.js';
import { snapshotRoutes } from './snapshots.js';
import { metricsRoutes } from './metrics.js';
import { civilizationRoutes } from './civilizations.js';
import { seedRoutes } from './seeds.js';

export type { ServiceContext } from './context.js';

/**
 * Register all REST routes on the given Fastify instance.
 */
export async function registerRoutes(
  server: FastifyInstance,
  ctx: ServiceContext = {},
): Promise<void> {
  await agentRoutes(server, ctx);
  await taskRoutes(server, ctx);
  await resourceRoutes(server, ctx);
  await buildRoutes(server, ctx);
  await systemRoutes(server, ctx);
  await snapshotRoutes(server, ctx);
  await metricsRoutes(server, ctx);
  await civilizationRoutes(server, ctx);
  await seedRoutes(server, ctx);
}
