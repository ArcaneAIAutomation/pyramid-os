import type { FastifyInstance } from 'fastify';
import type { ServiceContext } from './context.js';
import type { ApiError } from '@pyramid-os/shared-types';

export async function agentRoutes(server: FastifyInstance, ctx: ServiceContext): Promise<void> {
  server.get('/agents', async (request) => {
    const { tier, role, status, civilizationId } = request.query as Record<string, string | undefined>;
    if (ctx.agentRepository) {
      const filter: Record<string, string> = {};
      if (tier) filter['tier'] = tier;
      if (role) filter['role'] = role;
      // Default to active agents only — pass status=all to see everything
      filter['status'] = status === 'all' ? '' : (status ?? 'active');
      if (!filter['status']) delete filter['status'];
      if (civilizationId) filter['civilizationId'] = civilizationId;
      return ctx.agentRepository.findAll(filter as any);
    }
    return [];
  });

  server.get<{ Params: { id: string } }>('/agents/:id', async (request, reply) => {
    const { id } = request.params;
    if (ctx.agentRepository) {
      const agent = ctx.agentRepository.findById(id);
      if (agent) return agent;
    }
    const error: ApiError = { statusCode: 404, error: 'Not Found', message: `Agent '${id}' not found`, code: 'AGENT_NOT_FOUND' };
    return reply.status(404).send(error);
  });
}
