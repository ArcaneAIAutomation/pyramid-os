/**
 * Seeds route — load development seed scenarios into the database.
 * POST /seeds/load  { scenario: string }
 * GET  /seeds       list available scenarios
 */
import type { FastifyInstance } from 'fastify';
import type { ServiceContext } from './context.js';
import type { ApiError } from '@pyramid-os/shared-types';
import {
  getScenario,
  listScenarios,
  AgentRepository,
  TaskRepository,
  ResourceRepository,
  BlueprintRepository,
  CivilizationManager,
} from '@pyramid-os/data-layer';

export async function seedRoutes(server: FastifyInstance, ctx: ServiceContext): Promise<void> {
  server.get('/seeds', async () => {
    return { scenarios: listScenarios() };
  });

  server.post('/seeds/load', async (request, reply) => {
    const { scenario: scenarioName } = (request.body ?? {}) as { scenario?: string };

    if (!scenarioName) {
      const error: ApiError = { statusCode: 400, error: 'Bad Request', message: 'scenario is required', code: 'MISSING_SCENARIO' };
      return reply.status(400).send(error);
    }

    const scenario = getScenario(scenarioName);
    if (!scenario) {
      const error: ApiError = { statusCode: 404, error: 'Not Found', message: `Scenario '${scenarioName}' not found. Available: ${listScenarios().join(', ')}`, code: 'SCENARIO_NOT_FOUND' };
      return reply.status(404).send(error);
    }

    if (!ctx.agentRepository || !ctx.taskRepository || !ctx.resourceRepository || !ctx.blueprintRepository || !ctx.civilizationManager) {
      const error: ApiError = { statusCode: 503, error: 'Service Unavailable', message: 'Repositories not available', code: 'SERVICE_UNAVAILABLE' };
      return reply.status(503).send(error);
    }

    const civId = scenario.civilization.id;

    // Seed civilization
    try { ctx.civilizationManager.create(scenario.civilization.name); } catch { /* already exists */ }

    // Seed agents
    const now = new Date().toISOString();
    for (const a of scenario.agents) {
      ctx.agentRepository.upsert({ id: a.id, role: a.role, tier: a.tier, status: a.status, civilizationId: civId, createdAt: now, lastActiveAt: now });
    }

    // Seed resources
    for (const r of scenario.resources) {
      ctx.resourceRepository.upsert({ id: r.id, type: r.type, quantity: r.quantity, civilizationId: civId });
    }

    // Seed tasks
    for (const t of scenario.tasks) {
      const task: Record<string, unknown> = { id: t.id, type: t.type, status: t.status, priority: t.priority, description: t.description, civilizationId: civId, createdAt: now, updatedAt: now, dependencies: t.dependencies ?? [] };
      if (t.agentId) task['agentId'] = t.agentId;
      ctx.taskRepository.upsert(task as any);
    }

    // Seed blueprints
    for (const bp of scenario.blueprints) {
      const pct = bp.totalBlocks > 0 ? Math.round((bp.placedBlocks / bp.totalBlocks) * 100) : 0;
      ctx.blueprintRepository.upsert({
        id: bp.id, name: bp.name, version: 1, type: bp.type, civilizationId: civId,
        metadata: { author: 'seed', tags: [], civilizationId: civId } as any,
        placements: [],
        progress: { totalBlocks: bp.totalBlocks, placedBlocks: bp.placedBlocks, percentComplete: pct, currentPhase: 'construction' },
        dimensions: { width: 0, height: 0, depth: 0 },
      });
    }

    return {
      loaded: scenarioName,
      agents: scenario.agents.length,
      resources: scenario.resources.length,
      tasks: scenario.tasks.length,
      blueprints: scenario.blueprints.length,
    };
  });
}
