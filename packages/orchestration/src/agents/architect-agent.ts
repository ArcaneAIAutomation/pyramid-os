/**
 * ArchitectAgent — Structure design and blueprint approval planner.
 *
 * Generates blueprints for requested structures and approves build plans.
 * Uses LLM only for high-level interpretation, not action execution.
 *
 * Validates: Requirements 7.1, 7.6
 */

import type { AgentMessage, LLMPrompt } from '@pyramid-os/shared-types';
import { BaseAgent } from './base-agent.js';
import type { LLMRequestDelegate, SendMessageDelegate } from './base-agent.js';

export class ArchitectAgent extends BaseAgent {
  /** Most recent blueprint decision. */
  lastBlueprintDecision = '';

  constructor(
    id: string,
    llmDelegate: LLMRequestDelegate,
    sendDelegate: SendMessageDelegate,
  ) {
    super(id, 'architect', 'planner', llmDelegate, sendDelegate);
  }

  async processMessage(message: AgentMessage): Promise<void> {
    // Architect receives build requests and blueprint approval requests.
    const prompt: LLMPrompt = {
      systemPrompt: 'You are the Architect. Evaluate this build request and decide whether to approve or modify the blueprint.',
      userMessage: message.content,
      agentId: this.id,
    };
    const response = await this.requestLLM(prompt);
    this.lastBlueprintDecision = response.content;
  }

  /**
   * Periodic tick: generate blueprints for requested structures and review pending approvals.
   */
  async tick(): Promise<void> {
    const prompt: LLMPrompt = {
      systemPrompt: 'You are the Architect. Review pending structure requests and generate or approve blueprints.',
      userMessage: 'Evaluate pending blueprint requests and produce design decisions.',
      agentId: this.id,
    };
    const response = await this.requestLLM(prompt);
    this.lastBlueprintDecision = response.content;
  }
}
