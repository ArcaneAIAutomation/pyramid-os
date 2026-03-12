/**
 * ScribeAgent — Record-keeping and report generation.
 *
 * Maintains records and generates reports for the civilization.
 * Uses LLM only for high-level interpretation, not action execution.
 *
 * Validates: Requirements 7.2, 7.7
 */

import type { AgentMessage, LLMPrompt } from '@pyramid-os/shared-types';
import { BaseAgent } from './base-agent.js';
import type { LLMRequestDelegate, SendMessageDelegate } from './base-agent.js';

export class ScribeAgent extends BaseAgent {
  /** Most recent generated report. */
  lastReport = '';

  /** Running log of recorded events. */
  readonly records: string[] = [];

  constructor(
    id: string,
    llmDelegate: LLMRequestDelegate,
    sendDelegate: SendMessageDelegate,
  ) {
    super(id, 'scribe', 'operational', llmDelegate, sendDelegate);
  }

  async processMessage(message: AgentMessage): Promise<void> {
    // Scribe records incoming messages as historical events.
    this.records.push(message.content);
  }

  /**
   * Periodic tick: generate a summary report from accumulated records.
   */
  async tick(): Promise<void> {
    if (this.records.length === 0) return;

    const prompt: LLMPrompt = {
      systemPrompt: 'You are the Scribe. Summarize the following events into a concise report.',
      userMessage: this.records.join('\n'),
      agentId: this.id,
    };
    const response = await this.requestLLM(prompt);
    this.lastReport = response.content;
  }
}
