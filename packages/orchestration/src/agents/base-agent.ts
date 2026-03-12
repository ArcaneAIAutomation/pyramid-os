/**
 * BaseAgent — Abstract base class for all PYRAMID OS agents.
 *
 * Provides common infrastructure: identity, LLM access, messaging,
 * and the abstract tick/processMessage lifecycle hooks that each
 * concrete role must implement.
 *
 * Validates: Requirements 7.1, 7.2, 7.12, 7.13
 */

import type {
  AgentRole,
  AgentTier,
  AgentMessage,
  LLMPrompt,
  LLMResponse,
} from '@pyramid-os/shared-types';

/** Delegate for routing LLM requests through OpenClaw. */
export type LLMRequestDelegate = (agentId: string, prompt: LLMPrompt) => Promise<LLMResponse>;

/** Delegate for sending messages through the MessageBus. */
export type SendMessageDelegate = (from: string, to: string, content: string) => Promise<void>;

export abstract class BaseAgent {
  readonly id: string;
  readonly role: AgentRole;
  readonly tier: AgentTier;

  private readonly llmDelegate: LLMRequestDelegate;
  private readonly sendDelegate: SendMessageDelegate;

  constructor(
    id: string,
    role: AgentRole,
    tier: AgentTier,
    llmDelegate: LLMRequestDelegate,
    sendDelegate: SendMessageDelegate,
  ) {
    this.id = id;
    this.role = role;
    this.tier = tier;
    this.llmDelegate = llmDelegate;
    this.sendDelegate = sendDelegate;
  }

  /**
   * Process an incoming message from another agent.
   * Each role defines its own handling logic.
   */
  abstract processMessage(message: AgentMessage): Promise<void>;

  /**
   * Periodic behavior loop invoked by the orchestrator.
   * Each role defines its own tick behavior.
   */
  abstract tick(): Promise<void>;

  /**
   * Helper — request LLM reasoning via OpenClaw.
   * Agents use this for high-level interpretation only, not action execution.
   */
  protected async requestLLM(prompt: LLMPrompt): Promise<LLMResponse> {
    return this.llmDelegate(this.id, prompt);
  }

  /** Helper — send a message to another agent via the MessageBus. */
  protected async sendMessage(to: string, content: string): Promise<void> {
    return this.sendDelegate(this.id, to, content);
  }
}
