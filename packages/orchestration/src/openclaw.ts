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

    // 6. Restore persisted agents from DB
    if (this.agentRepository) {
      const persisted = this.agentRepository.findAll();
      for (const agent of persisted) {
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
  async sendMessage(from: string, to: string, message: AgentMessage): Promise<void> {
    this.ensureInitialized();
    await this.messageBus.send(message);
  }

  /**
   * Broadcast a message from a planner agent to all agents.
   * Delegates to MessageBus.broadcast().
   */
  async broadcast(from: string, message: AgentMessage): Promise<void> {
    this.ensureInitialized();
    await this.messageBus.broadcast(from, message);
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
