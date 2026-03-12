/**
 * IntentionEngine — Self-goal assignment and society reorganization for Free Thinking mode.
 *
 * Validates: Requirements 8.4, 8.5, 8.6
 *
 * In Free Thinking mode, agents can:
 *   - Self-assign goals via LLM reasoning (generateIntention)
 *   - Propose society structure reorganization (proposeReorganization)
 *
 * All operations:
 *   - Only execute when mode is 'free_thinking'
 *   - Validate against SafetyEnforcer before execution
 *   - Track reasoning loop count per agent, aborting at max_reasoning_loops
 */

import type {
  AgentRole,
  LLMPrompt,
  SafetyBoundary,
} from '@pyramid-os/shared-types';
import type { Logger } from '@pyramid-os/logger';
import type { SafetyEnforcer, LLMRouter, AgentManager } from './interfaces.js';
import type { ModeControllerImpl } from './mode-controller.js';
import type { AgentManagerImpl, ManagedAgent } from './agent-manager.js';

/** Result of a self-goal generation */
export interface Intention {
  agentId: string;
  goal: string;
  reasoning: string;
  createdAt: string;
}

/** A proposed role change for society reorganization */
export interface RoleChangeProposal {
  agentId: string;
  currentRole: AgentRole;
  proposedRole: AgentRole;
  rationale: string;
}

/** Result of a reorganization proposal */
export interface ReorganizationProposal {
  proposedBy: string;
  changes: RoleChangeProposal[];
  reasoning: string;
  createdAt: string;
}

/** Configuration for the IntentionEngine */
export interface IntentionEngineConfig {
  maxReasoningLoops: number;
}

const DEFAULT_MAX_REASONING_LOOPS = 50;

export class IntentionEngineImpl {
  private readonly safetyEnforcer: SafetyEnforcer;
  private readonly llmRouter: LLMRouter;
  private readonly agentManager: AgentManagerImpl;
  private readonly modeController: ModeControllerImpl;
  private readonly logger: Logger;
  private readonly maxReasoningLoops: number;

  /** Tracks reasoning loop count per agent */
  private readonly loopCounts = new Map<string, number>();

  constructor(
    safetyEnforcer: SafetyEnforcer,
    llmRouter: LLMRouter,
    agentManager: AgentManagerImpl,
    modeController: ModeControllerImpl,
    logger: Logger,
    config?: Partial<IntentionEngineConfig>,
  ) {
    this.safetyEnforcer = safetyEnforcer;
    this.llmRouter = llmRouter;
    this.agentManager = agentManager;
    this.modeController = modeController;
    this.logger = logger;
    this.maxReasoningLoops = config?.maxReasoningLoops ?? DEFAULT_MAX_REASONING_LOOPS;
  }

  /**
   * Generate a self-assigned goal for an agent using LLM reasoning.
   * Only operates in free_thinking mode.
   * Validates safety boundaries and enforces reasoning loop limits.
   */
  async generateIntention(agentId: string): Promise<Intention> {
    this.assertFreeThinkingMode();
    this.assertAgentExists(agentId);
    this.incrementAndCheckLoopCount(agentId);

    // Validate the self_assign action against safety boundaries
    const safetyResult = this.safetyEnforcer.validate(agentId, {
      type: 'self_assign',
      payload: { agentId },
    });

    if (!safetyResult.allowed) {
      this.logger.warn(`Safety boundary blocked intention generation for agent ${agentId}`, {
        agentId,
        reason: safetyResult.reason,
      });
      throw new Error(
        `Safety boundary violation: ${safetyResult.reason ?? 'action not allowed'}`,
      );
    }

    const managed = this.agentManager.get(agentId)!;
    const { role, tier } = managed.instance;

    const prompt: LLMPrompt = {
      systemPrompt:
        `You are a ${role} agent (${tier} tier) in an Egyptian civilization simulation. ` +
        `The system is in Free Thinking mode. Generate a single, specific goal you want to pursue. ` +
        `The goal must be achievable within your role capabilities and must not violate safety boundaries. ` +
        `Respond with a JSON object: { "goal": "<goal description>", "reasoning": "<why this goal>" }`,
      userMessage: `As a ${role}, what goal do you want to pursue next?`,
      agentId,
    };

    this.logger.info(`Generating intention for agent ${agentId}`, { agentId, role });

    const response = await this.llmRouter.route(agentId, prompt);

    let goal: string;
    let reasoning: string;

    try {
      const parsed = JSON.parse(response.content) as { goal?: string; reasoning?: string };
      goal = parsed.goal ?? response.content;
      reasoning = parsed.reasoning ?? '';
    } catch {
      // If LLM doesn't return valid JSON, use the raw content as the goal
      goal = response.content;
      reasoning = 'Raw LLM output (non-JSON response)';
    }

    const intention: Intention = {
      agentId,
      goal,
      reasoning,
      createdAt: new Date().toISOString(),
    };

    this.logger.info(`Intention generated for agent ${agentId}: ${goal}`, { agentId });

    return intention;
  }

  /**
   * Propose a society structure reorganization (role changes).
   * Only operates in free_thinking mode.
   * Validates safety boundaries and enforces reasoning loop limits.
   */
  async proposeReorganization(agentId: string): Promise<ReorganizationProposal> {
    this.assertFreeThinkingMode();
    this.assertAgentExists(agentId);
    this.incrementAndCheckLoopCount(agentId);

    // Validate the reorganize action against safety boundaries
    const safetyResult = this.safetyEnforcer.validate(agentId, {
      type: 'reorganize',
      payload: { agentId },
    });

    if (!safetyResult.allowed) {
      this.logger.warn(`Safety boundary blocked reorganization proposal from agent ${agentId}`, {
        agentId,
        reason: safetyResult.reason,
      });
      throw new Error(
        `Safety boundary violation: ${safetyResult.reason ?? 'action not allowed'}`,
      );
    }

    const managed = this.agentManager.get(agentId)!;
    const { role, tier } = managed.instance;

    const prompt: LLMPrompt = {
      systemPrompt:
        `You are a ${role} agent (${tier} tier) in an Egyptian civilization simulation. ` +
        `The system is in Free Thinking mode. Propose role changes to improve society efficiency. ` +
        `Respond with a JSON object: { "changes": [{ "agentId": "<id>", "currentRole": "<role>", "proposedRole": "<role>", "rationale": "<why>" }], "reasoning": "<overall reasoning>" }`,
      userMessage: `As a ${role}, what society reorganization do you propose?`,
      agentId,
    };

    this.logger.info(`Generating reorganization proposal from agent ${agentId}`, { agentId, role });

    const response = await this.llmRouter.route(agentId, prompt);

    let changes: RoleChangeProposal[];
    let reasoning: string;

    try {
      const parsed = JSON.parse(response.content) as {
        changes?: RoleChangeProposal[];
        reasoning?: string;
      };
      changes = parsed.changes ?? [];
      reasoning = parsed.reasoning ?? '';
    } catch {
      changes = [];
      reasoning = response.content;
    }

    const proposal: ReorganizationProposal = {
      proposedBy: agentId,
      changes,
      reasoning,
      createdAt: new Date().toISOString(),
    };

    this.logger.info(
      `Reorganization proposal from agent ${agentId}: ${changes.length} changes proposed`,
      { agentId },
    );

    return proposal;
  }

  /** Get the current reasoning loop count for an agent. */
  getLoopCount(agentId: string): number {
    return this.loopCounts.get(agentId) ?? 0;
  }

  /** Reset the reasoning loop counter for an agent. */
  resetLoopCount(agentId: string): void {
    this.loopCounts.delete(agentId);
  }

  /** Reset all reasoning loop counters. */
  resetAllLoopCounts(): void {
    this.loopCounts.clear();
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /** Throws if the current mode is not free_thinking. */
  private assertFreeThinkingMode(): void {
    const mode = this.modeController.getCurrentMode();
    if (mode !== 'free_thinking') {
      throw new Error(
        `IntentionEngine only operates in free_thinking mode (current: ${mode})`,
      );
    }
  }

  /** Throws if the agent does not exist in the AgentManager. */
  private assertAgentExists(agentId: string): void {
    const managed = this.agentManager.get(agentId);
    if (!managed) {
      throw new Error(`Agent not found: ${agentId}`);
    }
  }

  /**
   * Increment the reasoning loop counter for an agent and throw if it
   * exceeds the configured max_reasoning_loops limit.
   */
  private incrementAndCheckLoopCount(agentId: string): void {
    const current = this.loopCounts.get(agentId) ?? 0;
    const next = current + 1;

    if (next > this.maxReasoningLoops) {
      this.logger.warn(
        `Agent ${agentId} exceeded max reasoning loops (${this.maxReasoningLoops})`,
        { agentId, loopCount: next, maxReasoningLoops: this.maxReasoningLoops },
      );
      throw new Error(
        `Agent "${agentId}" exceeded max reasoning loops: ${next} > ${this.maxReasoningLoops}`,
      );
    }

    this.loopCounts.set(agentId, next);
  }
}
