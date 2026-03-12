import type { FastifyInstance } from 'fastify';
import type { ServiceContext } from './context.js';
import type { ApiError } from '@pyramid-os/shared-types';

export async function taskRoutes(server: FastifyInstance, ctx: ServiceContext): Promise<void> {
  server.get('/tasks', async (request) => {
    const { status, type, priority, agentId, civilizationId } = request.query as Record<string, string | undefined>;
    if (ctx.taskRepository) {
      const filter: Record<string, string> = {};
      if (status) filter['status'] = status;
      if (type) filter['type'] = type;
      if (priority) filter['priority'] = priority;
      if (agentId) filter['agentId'] = agentId;
      if (civilizationId) filter['civilizationId'] = civilizationId;
      return ctx.taskRepository.findAll(filter as any);
    }
    return [];
  });

  server.get<{ Params: { id: string } }>('/tasks/:id', async (request, reply) => {
    const { id } = request.params;
    if (ctx.taskRepository) {
      const task = ctx.taskRepository.findById(id);
      if (task) return task;
    }
    const error: ApiError = { statusCode: 404, error: 'Not Found', message: `Task '${id}' not found`, code: 'TASK_NOT_FOUND' };
    return reply.status(404).send(error);
  });
}
