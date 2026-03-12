import type { FastifyInstance } from 'fastify';
import type { ServiceContext } from './context.js';
import type { ApiError } from '@pyramid-os/shared-types';

export async function buildRoutes(server: FastifyInstance, ctx: ServiceContext): Promise<void> {
  server.get('/builds', async (request) => {
    const { civilizationId } = request.query as Record<string, string | undefined>;
    if (ctx.blueprintRepository) {
      return ctx.blueprintRepository.findAll(civilizationId ? { civilizationId } : undefined);
    }
    return [];
  });

  server.get<{ Params: { id: string } }>('/builds/:id', async (request, reply) => {
    const { id } = request.params;
    if (ctx.blueprintRepository) {
      const bp = ctx.blueprintRepository.findById(id);
      if (bp) return bp;
    }
    const error: ApiError = { statusCode: 404, error: 'Not Found', message: `Build '${id}' not found`, code: 'BUILD_NOT_FOUND' };
    return reply.status(404).send(error);
  });
}
