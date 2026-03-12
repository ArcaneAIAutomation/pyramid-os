/**
 * BotForemanAgent — Task assignment to Worker agents.
 *
 * Assigns tasks to available workers and monitors worker progress.
 * Uses LLM only for high-level interpretation, not action execution.
 *
 * Validates: Requirements 7.2, 7.8
 */

import type { AgentMessage, LLMPrompt } from '@pyramid-os/shared-types';
import { BaseAgent } from './base-agent.js';
import type { LLMRequestDelegate, SendMessageDelegate } from './base-agent.js';

export class BotForemanAgent extends BaseAgent {
  /** Most recent task assignment decision. */
  lastAssignment = '';

  /** IDs of workers currently being tracked. */
  readonly trackedWorkers: string[] = [];

  constructor(
    id: string,
    llmDelegate: LLMRequestDelegate,
    sendDelegate: SendMessageDelegate,
  ) {
    super(id, 'bot-foreman', 'operational', llmDelegate, sendDelegate);
  }

  async processMessage(message: AgentMessage): Promise<void> {
    // Bot-Foreman receives task completion reports and new task requests.
    const prompt: LLMPrompt = {
      systemPrompt: 'You are the Bot-Foreman. Interpret this worker report and decide on task reassignment if needed.',
      userMessage: message.content,
      agentId: this.id,
    };
    const response = await this.requestLLM(prompt);
    this.lastAssignment = response.content;
  }

  /**
   * Periodic tick: assign tasks to available workers and monitor progress.
   */
  async tick(): Promise<void> {
    const prompt: LLMPrompt = {
      systemPrompt: 'You are the Bot-Foreman. Review available workers and pending tasks, then assign work.',
      userMessage: 'Assign tasks to available workers for this cycle.',
      agentId: this.id,
    };
    const response = await this.requestLLM(prompt);
    this.lastAssignment = response.content;
  }
}
