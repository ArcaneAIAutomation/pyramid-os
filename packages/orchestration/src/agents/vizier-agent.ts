/**
 * VizierAgent — Resource allocation and task prioritization planner.
 *
 * Reviews resource levels, prioritizes tasks, and allocates resources.
 * Uses LLM only for high-level interpretation, not action execution.
 *
 * Validates: Requirements 7.1, 7.5
 */

import type { AgentMessage, LLMPrompt } from '@pyramid-os/shared-types';
import { BaseAgent } from './base-agent.js';
import type { LLMRequestDelegate, SendMessageDelegate } from './base-agent.js';

export class VizierAgent extends BaseAgent {
  /** Most recent resource allocation decision. */
  lastAllocation = '';

  constructor(
    id: string,
    llmDelegate: LLMRequestDelegate,
    sendDelegate: SendMessageDelegate,
  ) {
    super(id, 'vizier', 'planner', llmDelegate, sendDelegate);
  }

  async processMessage(message: AgentMessage): Promise<void> {
    // Vizier receives resource alerts and task requests from operational agents.
    const prompt: LLMPrompt = {
      systemPrompt: 'You are the Vizier. Interpret this resource or task report and decide on allocation priorities.',
      userMessage: message.content,
      agentId: this.id,
    };
    const response = await this.requestLLM(prompt);
    this.lastAllocation = response.content;
  }

  /**
   * Periodic tick: review resource levels and prioritize tasks.
   */
  async tick(): Promise<void> {
    const prompt: LLMPrompt = {
      systemPrompt: 'You are the Vizier. Review current resource levels and task queues, then prioritize allocations.',
      userMessage: 'Determine resource allocation and task priorities for this cycle.',
      agentId: this.id,
    };
    const response = await this.requestLLM(prompt);
    this.lastAllocation = response.content;
  }
}
