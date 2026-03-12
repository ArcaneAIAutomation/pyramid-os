/**
 * Metrics route handler for PYRAMID OS API.
 * GET /metrics — Prometheus-compatible metrics endpoint
 */

import type { FastifyInstance } from 'fastify';
import type { ServiceContext } from './context.js';
import type { MetricsResponse } from '@pyramid-os/shared-types';

export async function metricsRoutes(
  server: FastifyInstance,
  ctx: ServiceContext,
): Promise<void> {
  server.get('/metrics', async (request, reply) => {
    const accept = (request.headers.accept ?? '') as string;

    // Collect metrics from society engine if available
    const metrics: MetricsResponse = {
      taskCompletionRate: 0,
      resourceConsumptionRates: {},
      botUptime: {},
      agentDecisionLatencyMs: {},
      blocksPlacedPerHour: 0,
      timestamp: new Date().toISOString(),
    };

    // If Prometheus text format is requested, return text/plain
    if (accept.includes('text/plain')) {
      reply.header('content-type', 'text/plain; charset=utf-8');
      return formatPrometheus(metrics);
    }

    return metrics;
  });
}

/**
 * Format metrics as Prometheus exposition text.
 */
function formatPrometheus(m: MetricsResponse): string {
  const lines: string[] = [];

  lines.push('# HELP pyramid_task_completion_rate Tasks completed per minute');
  lines.push('# TYPE pyramid_task_completion_rate gauge');
  lines.push(`pyramid_task_completion_rate ${m.taskCompletionRate}`);

  lines.push('# HELP pyramid_blocks_placed_per_hour Blocks placed per hour');
  lines.push('# TYPE pyramid_blocks_placed_per_hour gauge');
  lines.push(`pyramid_blocks_placed_per_hour ${m.blocksPlacedPerHour}`);

  for (const [resource, rate] of Object.entries(m.resourceConsumptionRates)) {
    lines.push(`pyramid_resource_consumption{resource="${resource}"} ${rate}`);
  }

  for (const [botId, uptime] of Object.entries(m.botUptime)) {
    lines.push(`pyramid_bot_uptime{bot="${botId}"} ${uptime}`);
  }

  for (const [agentId, latency] of Object.entries(m.agentDecisionLatencyMs)) {
    lines.push(`pyramid_agent_decision_latency_ms{agent="${agentId}"} ${latency}`);
  }

  return lines.join('\n') + '\n';
}
