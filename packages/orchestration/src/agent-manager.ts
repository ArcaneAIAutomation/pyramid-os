/**
 * AgentManagerImpl — Agent lifecycle management with recovery.
 * Requirements: 1.5, 1.6, 13.1, 40.3, 40.4, 40.5
 */

import { randomUUID } from 'node:crypto';
import type {
  AgentRole,
  AgentTier,
  AgentConfig,
  AgentInstance,
  AgentHealthReport,
} from '@pyramid-os/shared-types';
import type { AgentRepository } from '@pyramid-os/data-layer';
import type { Logger } from '@pyramid-os/logger';
import type { AgentManager, AgentWorkspace } from './interfaces.js';
import { AgentWorkspaceImpl } from './agent-workspace.js';

/** Default mapping from AgentRole to AgentTier. */
export const DEFAULT_ROLE_TIER_MAP: Record<AgentRole, AgentTier> = {
  pharaoh: 'planner',
  vizier: 'planner',
  architect: 'planner',
  scribe: 'operational',
  'bot-foreman': 'operational',
  defense: 'operational',
  ops: 'operational',
  'ui-master': 'operational',
  builder: 'worker',
  quarry: 'worker',
  hauler: 'worker',
  guard: 'worker',
  farmer: 'worker',
  priest: 'worker',
};

/** Internal tracked agent with workspace reference. */
export interface ManagedAgent {
  instance: AgentInstance;
  workspace: AgentWorkspace;
}

export class AgentManagerImpl implements AgentManager {
  private readonly agents = new Map<string, ManagedAgent>();
  private readonly repository: AgentRepository | undefined;
  private readonly logger: Logger;
  private readonly roleTierMap: Record<AgentRole, AgentTier>;

  constructor(
    logger: Logger,
    repository?: AgentRepository,
    roleTierMap?: Record<AgentRole, AgentTier>,
  ) {
    this.logger = logger;
    this.repository = repository ?? undefined;
    this.roleTierMap = roleTierMap ?? DEFAULT_ROLE_TIER_MAP;
  }

  /**
   * Create a new agent with an isolated workspace.
   * Returns the generated agentId.
   */
  async create(role: AgentRole, config?: Partial<AgentConfig>): Promise<string> {
    const agentId = randomUUID();
    const tier = this.roleTierMap[role];
    const now = new Date().toISOString();

    const instance: AgentInstance = {
      id: agentId,
      role,
      tier,
      status: 'active',
      civilizationId: config?.civilizationId ?? 'default',
      createdAt: now,
      lastActiveAt: now,
    };

    const workspace = new AgentWorkspaceImpl(agentId, tier, this.repository);

    this.agents.set(agentId, { instance, workspace });

    // Persist to repository if available
    if (this.repository) {
      this.repository.upsert(instance);
    }

    this.logger.info(`Agent created: ${role} (${tier})`, { agentId });
    return agentId;
  }

  /** Get a managed agent by ID (internal helper). */
  get(agentId: string): ManagedAgent | undefined {
    return this.agents.get(agentId);
  }

  /**
   * Restart a failed agent: marks it as restarting, re-creates its workspace,
   * and restores persisted state.
   */
  async restart(agentId: string): Promise<void> {
    const managed = this.agents.get(agentId);
    if (!managed) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    this.logger.info('Restarting agent', { agentId });

    // Mark as restarting (temporarily error while we recover)
    managed.instance.status = 'error';
    managed.instance.lastActiveAt = new Date().toISOString();

    // Re-create workspace from template
    const newWorkspace = new AgentWorkspaceImpl(
      agentId,
      managed.instance.tier,
      this.repository,
    );

    // Restore persisted state if repository is available
    await newWorkspace.load();

    // Update the managed entry
    managed.workspace = newWorkspace;
    managed.instance.status = 'active';
    managed.instance.lastActiveAt = new Date().toISOString();

    // Persist updated status
    if (this.repository) {
      this.repository.upsert(managed.instance);
    }

    this.logger.info('Agent restarted successfully', { agentId });
  }

  /**
   * Return health reports for all managed agents.
   */
  async healthCheck(): Promise<AgentHealthReport[]> {
    const reports: AgentHealthReport[] = [];

    for (const [agentId, managed] of this.agents) {
      const { instance } = managed;
      const issues: string[] = [];

      if (instance.status === 'error') {
        issues.push('Agent is in error state');
      }

      if (instance.status === 'stopped') {
        issues.push('Agent is stopped');
      }

      // Check staleness — if lastActiveAt is more than 5 minutes ago, flag it
      const lastActive = new Date(instance.lastActiveAt).getTime();
      const staleThresholdMs = 5 * 60 * 1000;
      if (Date.now() - lastActive > staleThresholdMs) {
        issues.push('Agent has not been active recently');
      }

      reports.push({
        agentId,
        role: instance.role,
        status: instance.status,
        lastActiveAt: instance.lastActiveAt,
        healthy: issues.length === 0,
        issues,
      });
    }

    return reports;
  }

  /**
   * Persist agent workspace state via the repository.
   */
  async persistState(agentId: string): Promise<void> {
    const managed = this.agents.get(agentId);
    if (!managed) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    await managed.workspace.save();

    if (this.repository) {
      this.repository.upsert(managed.instance);
    }

    this.logger.info('Agent state persisted', { agentId });
  }

  /**
   * Restore agent workspace state from the repository.
   */
  async restoreState(agentId: string): Promise<void> {
    const managed = this.agents.get(agentId);
    if (!managed) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    await managed.workspace.load();

    // If repository has a persisted instance, update our in-memory copy
    if (this.repository) {
      const persisted = this.repository.findById(agentId);
      if (persisted) {
        managed.instance.status = persisted.status;
        managed.instance.lastActiveAt = persisted.lastActiveAt;
      }
    }

    this.logger.info('Agent state restored', { agentId });
  }
}
