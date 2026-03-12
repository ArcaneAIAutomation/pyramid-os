/**
 * PharaohAgent — Top-level strategic planner.
 *
 * Evaluates civilization state and creates strategic plans via LLM.
 * Uses LLM only for high-level interpretation, not action execution.
 *
 * Validates: Requirements 7.1, 7.4
 */

import type { AgentMessage, LLMPrompt } from '@pyramid-os/shared-types';
import { BaseAgent } from './base-agent.js';
import type { LLMRequestDelegate, SendMessageDelegate } from './base-agent.js';

export class PharaohAgent extends BaseAgent {
  /** Most recent strategic plan produced by tick(). */
  lastPlan = '';

  constructor(
    id: string,
    llmDelegate: LLMRequestDelegate,
    sendDelegate: SendMessageDelegate,
  ) {
    super(id, 'pharaoh', 'planner', llmDelegate, sendDelegate);
  }

  async processMessage(message: AgentMessage): Promise<void> {
    // Pharaoh receives status reports and adjusts strategy accordingly.
    const prompt: LLMPrompt = {
      systemPrompt: 'You are the Pharaoh. Interpret this report and decide if strategic adjustments are needed.',
      userMessage: message.content,
      agentId: this.id,
    };
    const response = await this.requestLLM(prompt);
    this.lastPlan = response.content;
  }

  /**
   * Periodic tick: evaluate civilization state and produce a strategic plan.
   */
  async tick(): Promise<void> {
    const prompt: LLMPrompt = {
      systemPrompt: 'You are the Pharaoh. Evaluate the current civilization state and produce a strategic plan.',
      userMessage: 'Provide the next strategic directive for the civilization.',
      agentId: this.id,
    };
    const response = await this.requestLLM(prompt);
    this.lastPlan = response.content;
  }
}
