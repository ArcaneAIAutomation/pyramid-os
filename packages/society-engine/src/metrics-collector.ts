import type { Logger } from '@pyramid-os/logger';

/**
 * Callback to persist a metric row to the `metrics` table.
 * @param entry - The metric entry to persist.
 */
export type MetricsPersistCallback = (entry: MetricEntry) => void;

export interface MetricEntry {
  id: string;
  metricName: string;
  value: number;
  tags: string;
  timestamp: string;
}

export interface SocietyMetrics {
  /** role → tasks completed per hour */
  taskCompletionRates: Record<string, number>;
  /** resourceType → units consumed per hour */
  resourceConsumptionRates: Record<string, number>;
  /** Build progress snapshot */
  buildProgress: { blocksPlacedPerHour: number; totalPlaced: number; totalBlocks: number };
  /** agentId → average decision latency in ms */
  agentDecisionLatency: Record<string, number>;
  /** ISO timestamp when metrics were collected */
  collectedAt: string;
}

export interface MetricsCollectorOptions {
  logger: Logger;
  persist?: MetricsPersistCallback;
}

interface TimestampedCount {
  count: number;
  firstRecordedAt: number;
}

interface LatencyAccumulator {
  totalMs: number;
  count: number;
}

/**
 * Collects performance metrics for the Society Engine.
 *
 * Tracks task completions, resource consumption, build progress,
 * and agent decision latency. Computes rates based on elapsed time
 * since the first recording in each category.
 */
export class MetricsCollector {
  private readonly logger: Logger;
  private readonly persist: MetricsPersistCallback | undefined;

  /** role → { count, firstRecordedAt } */
  private taskCompletions = new Map<string, TimestampedCount>();
  /** resourceType → { count (units), firstRecordedAt } */
  private resourceConsumptions = new Map<string, TimestampedCount>();
  /** blocks placed tracking */
  private blocksPlaced = 0;
  private blocksFirstPlacedAt: number | undefined;
  private totalBlocks = 0;
  /** agentId → latency accumulator */
  private decisionLatencies = new Map<string, LatencyAccumulator>();

  private idCounter = 0;

  constructor(options: MetricsCollectorOptions) {
    this.logger = options.logger;
    this.persist = options.persist;
  }

  /**
   * Record a task completion for a given agent role.
   */
  recordTaskCompletion(role: string): void {
    const now = Date.now();
    const existing = this.taskCompletions.get(role);
    if (existing) {
      existing.count += 1;
    } else {
      this.taskCompletions.set(role, { count: 1, firstRecordedAt: now });
    }
    this.logger.debug('Task completion recorded', { component: 'MetricsCollector', role });
    this.persistMetric('task_completion', 1, `role:${role}`);
  }

  /**
   * Record resource consumption for a given resource type.
   */
  recordResourceConsumption(resourceType: string, amount: number): void {
    const now = Date.now();
    const existing = this.resourceConsumptions.get(resourceType);
    if (existing) {
      existing.count += amount;
    } else {
      this.resourceConsumptions.set(resourceType, { count: amount, firstRecordedAt: now });
    }
    this.logger.debug('Resource consumption recorded', {
      component: 'MetricsCollector',
      resourceType,
      amount,
    });
    this.persistMetric('resource_consumption', amount, `type:${resourceType}`);
  }

  /**
   * Record a single block placement.
   */
  recordBlockPlaced(): void {
    const now = Date.now();
    this.blocksPlaced += 1;
    if (this.blocksFirstPlacedAt === undefined) {
      this.blocksFirstPlacedAt = now;
    }
    this.logger.debug('Block placed recorded', {
      component: 'MetricsCollector',
      totalPlaced: this.blocksPlaced,
    });
    this.persistMetric('block_placed', 1, 'build');
  }

  /**
   * Record an agent decision latency measurement.
   */
  recordDecisionLatency(agentId: string, latencyMs: number): void {
    const existing = this.decisionLatencies.get(agentId);
    if (existing) {
      existing.totalMs += latencyMs;
      existing.count += 1;
    } else {
      this.decisionLatencies.set(agentId, { totalMs: latencyMs, count: 1 });
    }
    this.logger.debug('Decision latency recorded', {
      component: 'MetricsCollector',
      agentId,
      latencyMs,
    });
    this.persistMetric('decision_latency', latencyMs, `agent:${agentId}`);
  }

  /**
   * Set the total number of blocks expected for the build.
   */
  setTotalBlocks(total: number): void {
    this.totalBlocks = total;
    this.logger.info('Total blocks target set', {
      component: 'MetricsCollector',
      totalBlocks: total,
    });
  }

  /**
   * Compute and return current metrics snapshot.
   */
  getMetrics(): SocietyMetrics {
    const now = Date.now();

    const taskCompletionRates: Record<string, number> = {};
    for (const [role, data] of this.taskCompletions) {
      const elapsedHours = (now - data.firstRecordedAt) / 3_600_000;
      taskCompletionRates[role] = elapsedHours > 0 ? data.count / elapsedHours : data.count;
    }

    const resourceConsumptionRates: Record<string, number> = {};
    for (const [resourceType, data] of this.resourceConsumptions) {
      const elapsedHours = (now - data.firstRecordedAt) / 3_600_000;
      resourceConsumptionRates[resourceType] =
        elapsedHours > 0 ? data.count / elapsedHours : data.count;
    }

    let blocksPlacedPerHour = 0;
    if (this.blocksFirstPlacedAt !== undefined) {
      const elapsedHours = (now - this.blocksFirstPlacedAt) / 3_600_000;
      blocksPlacedPerHour =
        elapsedHours > 0 ? this.blocksPlaced / elapsedHours : this.blocksPlaced;
    }

    const agentDecisionLatency: Record<string, number> = {};
    for (const [agentId, data] of this.decisionLatencies) {
      agentDecisionLatency[agentId] = data.totalMs / data.count;
    }

    return {
      taskCompletionRates,
      resourceConsumptionRates,
      buildProgress: {
        blocksPlacedPerHour,
        totalPlaced: this.blocksPlaced,
        totalBlocks: this.totalBlocks,
      },
      agentDecisionLatency,
      collectedAt: new Date().toISOString(),
    };
  }

  /**
   * Clear all counters and accumulated data.
   */
  reset(): void {
    this.taskCompletions.clear();
    this.resourceConsumptions.clear();
    this.blocksPlaced = 0;
    this.blocksFirstPlacedAt = undefined;
    this.totalBlocks = 0;
    this.decisionLatencies.clear();
    this.idCounter = 0;
    this.logger.info('Metrics collector reset', { component: 'MetricsCollector' });
  }

  // ── private helpers ───────────────────────────────────────────────

  private persistMetric(metricName: string, value: number, tags: string): void {
    if (!this.persist) return;
    this.idCounter += 1;
    const entry: MetricEntry = {
      id: `metric-${this.idCounter}`,
      metricName,
      value,
      tags,
      timestamp: new Date().toISOString(),
    };
    this.persist(entry);
  }
}
