/**
 * OpenClawImpl — Main orchestrator wiring all sub-components.
 *
 * Coordinates agent lifecycle, LLM routing, inter-agent messaging,
 * operating mode transitions, safety enforcement, and graceful shutdown.
 *
 * Validates: Requirements 1.1, 1.8, 13.10
 */

import type {
  PyramidConfig,
  AgentRole,
  AgentConfig,
  OperatingMode,
  LLMPrompt,
  LLMResponse,
  AgentMessage,
  SystemState,
} from '@pyramid-os/shared-types';
import type { Logger } from '@pyramid-os/logger';
import type { AgentRepository } from '@pyramid-os/data-layer';
import type { OpenClaw } from './interfaces.js';
import { AgentManagerImpl } from './agent-manager.js';
import { LLMRouterImpl } from './llm-router.js';
import type { LLMRouterConfig } from './llm-router.js';
import { SafetyEnforcerImpl } from './safety-enforcer.js';
import { MessageBusImpl } from './message-bus.js';
import { ModeControllerImpl } from './mode-controller.js';
import { BaseAgent } from './agents/base-agent.js';
import { PharaohAgent } from './agents/pharaoh-agent.js';
import { VizierAgent } from './agents/vizier-agent.js';
import { ArchitectAgent } from './agents/architect-agent.js';
import { ScribeAgent } from './agents/scribe-agent.js';
import { BotForemanAgent } from './agents/bot-foreman-agent.js';
import { DefenseAgent } from './agents/defense-agent.js';
import { OpsAgent } from './agents/ops-agent.js';

export class OpenClawImpl implements OpenClaw {
  private agentManager!: AgentManagerImpl;
  private llmRouter!: LLMRouterImpl;
  private safetyEnforcer!: SafetyEnforcerImpl;
  private messageBus!: MessageBusImpl;
  private modeController!: ModeControllerImpl;

  private readonly logger: Logger;
  private readonly agentRepository: AgentRepository | undefined;
  private initialized = false;
  private startedAt = '';

  /** Track all agent IDs managed by this orchestrator for sync access. */
  private readonly agentIds = new Set<string>();

  /** Concrete agent instances keyed by agentId, lazily instantiated on first tick. */
  private readonly concreteAgents = new Map<string, BaseAgent>();

  constructor(logger: Logger, agentRepository?: AgentRepository) {
    this.logger = logger;
    this.agentRepository = agentRepository;
  }

  /**
   * Initialize the orchestrator: create all sub-components and restore
   * persisted agent states from the database.
   */
  async initialize(config: PyramidConfig): Promise<void> {
    if (this.initialized) {
      throw new Error('OpenClaw is already initialized');
    }

    this.logger.info('Initializing OpenClaw orchestrator');
    this.startedAt = new Date().toISOString();

    // 1. Agent Manager
    this.agentManager = new AgentManagerImpl(this.logger, this.agentRepository);

    // 2. LLM Router
    const llmConfig: LLMRouterConfig = {
      ollamaUrl: `http://${config.ollama.host}:${config.ollama.port}`,
      maxConcurrentRequests: config.ollama.maxConcurrentRequests,
      timeoutMs: config.ollama.timeout,
      ...(config.ollama.models ? { models: config.ollama.models } : {}),
    };
    this.llmRouter = new LLMRouterImpl(
      llmConfig,
      (agentId) => this.agentManager.get(agentId)?.instance.tier,
      this.logger,
    );

    // 3. Safety Enforcer
    this.safetyEnforcer = new SafetyEnforcerImpl(
      {
        prohibitedBlocks: config.safety.prohibitedBlocks,
        prohibitedCommands: config.safety.prohibitedCommands,
        maxDecisionTimeMs: config.safety.maxDecisionTimeMs,
      },
      this.logger,
    );

    // 4. Message Bus
    this.messageBus = new MessageBusImpl(
      (agentId) => this.agentManager.get(agentId)?.instance.tier,
      this.logger,
    );

    // 5. Mode Controller
    this.modeController = new ModeControllerImpl(this.logger);

    // 6. Restore persisted agents from DB — deduplicate by role, keep most recent per role
    if (this.agentRepository) {
      // Query all agents (active or stopped) to find the canonical set by role
      const persisted = this.agentRepository.findAll();

      // Keep only the most recently active agent per role
      const latestByRole = new Map<string, (typeof persisted)[0]>();
      for (const agent of persisted) {
        const existing = latestByRole.get(agent.role);
        if (!existing || agent.lastActiveAt > existing.lastActiveAt) {
          latestByRole.set(agent.role, agent);
        }
      }

      for (const agent of latestByRole.values()) {
        try {
          const agentId = await this.agentManager.create(agent.role, {
            civilizationId: agent.civilizationId,
          });
          this.agentIds.add(agentId);
          this.logger.info('Restored persisted agent', {
            originalId: agent.id,
            newId: agentId,
            role: agent.role,
          });
        } catch (err) {
          this.logger.error(
            `Failed to restore agent ${agent.id}`,
            err instanceof Error ? err : new Error(String(err)),
            { agentId: agent.id, role: agent.role },
          );
        }
      }
    }

    this.initialized = true;
    this.logger.info('OpenClaw initialized successfully');
  }

  /**
   * Spawn a new agent with a role-specific workspace.
   * Delegates to AgentManager.create().
   */
  async spawnAgent(role: AgentRole, config?: Partial<AgentConfig>): Promise<string> {
    this.ensureInitialized();
    const agentId = await this.agentManager.create(role, config);
    this.agentIds.add(agentId);
    this.logger.info(`Agent spawned: ${role}`, { agentId });
    return agentId;
  }

  /**
   * Terminate an agent: persist its state, then remove it.
   */
  async terminateAgent(agentId: string): Promise<void> {
    this.ensureInitialized();
    const managed = this.agentManager.get(agentId);
    if (!managed) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    this.logger.info('Terminating agent', { agentId, role: managed.instance.role });

    // Persist state before removal
    await this.agentManager.persistState(agentId);

    // Unsubscribe from message bus
    this.messageBus.unsubscribe(agentId);

    // Mark as stopped
    managed.instance.status = 'stopped';
    if (this.agentRepository) {
      this.agentRepository.upsert(managed.instance);
    }

    this.agentIds.delete(agentId);
    this.logger.info('Agent terminated', { agentId });
  }

  /**
   * Submit an LLM request: validate safety first, then route via LLMRouter.
   */
  async requestLLM(agentId: string, prompt: LLMPrompt): Promise<LLMResponse> {
    this.ensureInitialized();
    const managed = this.agentManager.get(agentId);
    if (!managed) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    // Validate the LLM request action against safety boundaries
    const safetyResult = this.safetyEnforcer.validate(agentId, {
      type: 'llm_request',
      payload: { prompt: prompt.userMessage },
    });

    if (!safetyResult.allowed) {
      throw new Error(`LLM request denied by safety enforcer: ${safetyResult.reason}`);
    }

    return this.llmRouter.route(agentId, prompt);
  }

  /**
   * Send a message between agents (hierarchy-enforced).
   * Delegates to MessageBus.send().
   */
  async sendMessage(_from: string, _to: string, message: AgentMessage): Promise<void> {
    this.ensureInitialized();
    await this.messageBus.send(message);
  }

  /**
   * Broadcast a message from a planner agent to all agents.
   * Delegates to MessageBus.broadcast().
   */
  async broadcast(_from: string, message: AgentMessage): Promise<void> {
    this.ensureInitialized();
    await this.messageBus.broadcast(_from, message);
  }

  /**
   * Change the operating mode with graceful transition.
   * Delegates to ModeController.setOperatingMode().
   */
  async setOperatingMode(mode: OperatingMode): Promise<void> {
    this.ensureInitialized();
    await this.modeController.setOperatingMode(mode);
  }

  /**
   * Get current system state snapshot.
   */
  getState(): SystemState {
    this.ensureInitialized();
    let activeCount = 0;
    for (const id of this.agentIds) {
      const managed = this.agentManager.get(id);
      if (managed?.instance.status === 'active') {
        activeCount++;
      }
    }

    return {
      operatingMode: this.modeController.getCurrentMode(),
      agentCount: this.agentIds.size,
      activeAgents: activeCount,
      startedAt: this.startedAt,
      civilizationId: 'default',
    };
  }

  /**
   * Tick all active agents — instantiates concrete agent classes on first call
   * (keyed by agentId) and calls their tick() method.
   * After each successful tick, fires the optional broadcast callback with
   * agent:state and agent:activity events so the dashboard stays current.
   * Errors from individual agents are caught and logged so one bad agent
   * cannot stall the entire loop.
   */
  async tickAllAgents(
    broadcast?: (event: { type: string; [key: string]: unknown }) => void,
  ): Promise<void> {
    this.ensureInitialized();

    for (const agentId of this.agentIds) {
      const managed = this.agentManager.get(agentId);
      if (!managed || managed.instance.status !== 'active') continue;

      // Lazily instantiate the concrete agent class
      if (!this.concreteAgents.has(agentId)) {
        const agent = this.createConcreteAgent(agentId, managed.instance.role);
        if (agent) this.concreteAgents.set(agentId, agent);
      }

      const agent = this.concreteAgents.get(agentId);
      if (!agent) continue;

      try {
        await agent.tick();
        managed.instance.lastActiveAt = new Date().toISOString();

        if (broadcast) {
          // Notify dashboard of updated agent status
          broadcast({ type: 'agent:state', agentId, state: managed.instance.status });

          // Surface the agent's last decision so the dashboard can display it
          const decision = this.getLastDecision(agent, managed.instance.role);
          if (decision) {
            broadcast({
              type: 'agent:activity',
              agentId,
              role: managed.instance.role,
              decision,
              timestamp: managed.instance.lastActiveAt,
            });
          }
        }
      } catch (err) {
        this.logger.error(
          `Agent tick failed: ${managed.instance.role} (${agentId})`,
          err instanceof Error ? err : new Error(String(err)),
          { agentId, role: managed.instance.role },
        );
        if (broadcast) {
          broadcast({
            type: 'alert',
            severity: 'warning',
            message: `Agent ${managed.instance.role} tick failed: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
      }
    }
  }

  /** Extract the most recent decision text from a concrete agent instance. */
  private getLastDecision(agent: BaseAgent, role: AgentRole): string {
    // Each concrete agent stores its last LLM output under a role-specific field
    const a = agent as BaseAgent & Record<string, unknown>;
    const decision =
      (a['lastPlan'] as string | undefined) ??
      (a['lastAllocation'] as string | undefined) ??
      (a['lastAssignment'] as string | undefined) ??
      (a['lastReport'] as string | undefined) ??
      (a['lastDirective'] as string | undefined) ??
      (a['lastDecision'] as string | undefined);
    if (!decision) return '';
    // Truncate to 200 chars for the dashboard
    return decision.length > 200 ? `${decision.slice(0, 197)}...` : decision;
  }

  /** Factory: create the concrete agent class for a given role. */
  private createConcreteAgent(agentId: string, role: AgentRole): BaseAgent | undefined {
    const llmDelegate = (id: string, prompt: LLMPrompt): Promise<LLMResponse> =>
      this.requestLLM(id, prompt);
    const sendDelegate = (_from: string, to: string, content: string): Promise<void> => {
      const msg: AgentMessage = {
        id: `${agentId}-${Date.now()}`,
        from: agentId,
        to,
        content,
        timestamp: new Date().toISOString(),
      };
      return this.messageBus.send(msg).catch((err: unknown) => {
        this.logger.warn(`Agent message send failed: ${String(err)}`, { agentId, to });
      });
    };

    switch (role) {
      case 'pharaoh':    return new PharaohAgent(agentId, llmDelegate, sendDelegate);
      case 'vizier':     return new VizierAgent(agentId, llmDelegate, sendDelegate);
      case 'architect':  return new ArchitectAgent(agentId, llmDelegate, sendDelegate);
      case 'scribe':     return new ScribeAgent(agentId, llmDelegate, sendDelegate);
      case 'bot-foreman': return new BotForemanAgent(agentId, llmDelegate, sendDelegate);
      case 'defense':    return new DefenseAgent(agentId, llmDelegate, sendDelegate);
      case 'ops':        return new OpsAgent(agentId, llmDelegate, sendDelegate);
      default:
        this.logger.warn(`No concrete agent class for role: ${role}`, { agentId });
        return undefined;
    }
  }

  /**
   * Graceful shutdown: persist all agent states, then clean up.
   * Validates: Requirement 13.10
   */
  async shutdown(): Promise<void> {
    this.ensureInitialized();
    this.logger.info('OpenClaw shutdown initiated — persisting all agent states');

    for (const agentId of this.agentIds) {
      try {
        await this.agentManager.persistState(agentId);
      } catch (err) {
        this.logger.error(
          `Failed to persist state for agent ${agentId} during shutdown`,
          err instanceof Error ? err : new Error(String(err)),
          { agentId },
        );
      }
    }

    this.initialized = false;
    this.logger.info('OpenClaw shutdown complete');
  }

  // -----------------------------------------------------------------------
  // Accessors for sub-components (useful for testing / advanced wiring)
  // -----------------------------------------------------------------------

  getAgentManager(): AgentManagerImpl { return this.agentManager; }
  getLLMRouter(): LLMRouterImpl { return this.llmRouter; }
  getSafetyEnforcer(): SafetyEnforcerImpl { return this.safetyEnforcer; }
  getMessageBus(): MessageBusImpl { return this.messageBus; }
  getModeController(): ModeControllerImpl { return this.modeController; }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('OpenClaw is not initialized. Call initialize(config) first.');
    }
  }
}
