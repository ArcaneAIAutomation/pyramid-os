import type { FastifyInstance } from 'fastify';
import type { ServiceContext } from './context.js';

export async function resourceRoutes(server: FastifyInstance, ctx: ServiceContext): Promise<void> {
  server.get('/resources', async (request) => {
    const { civilizationId } = request.query as Record<string, string | undefined>;
    if (ctx.resourceRepository) {
      if (civilizationId) return ctx.resourceRepository.findAll(civilizationId);
      return ctx.resourceRepository.findAllResources();
    }
    return [];
  });
}
