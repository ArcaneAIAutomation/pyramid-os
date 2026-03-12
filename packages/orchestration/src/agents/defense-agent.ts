/**
 * DefenseAgent — Security coordination for Guard workers.
 *
 * Coordinates guard patrols and responds to threats.
 * Uses LLM only for high-level interpretation, not action execution.
 *
 * Validates: Requirements 7.2, 7.9
 */

import type { AgentMessage, LLMPrompt } from '@pyramid-os/shared-types';
import { BaseAgent } from './base-agent.js';
import type { LLMRequestDelegate, SendMessageDelegate } from './base-agent.js';

export class DefenseAgent extends BaseAgent {
  /** Most recent threat assessment. */
  lastThreatAssessment = '';

  /** Active threat alerts. */
  readonly activeAlerts: string[] = [];

  constructor(
    id: string,
    llmDelegate: LLMRequestDelegate,
    sendDelegate: SendMessageDelegate,
  ) {
    super(id, 'defense', 'operational', llmDelegate, sendDelegate);
  }

  async processMessage(message: AgentMessage): Promise<void> {
    // Defense receives threat reports from Guard workers.
    this.activeAlerts.push(message.content);

    const prompt: LLMPrompt = {
      systemPrompt: 'You are the Defense coordinator. Assess this threat report and decide on a response protocol.',
      userMessage: message.content,
      agentId: this.id,
    };
    const response = await this.requestLLM(prompt);
    this.lastThreatAssessment = response.content;
  }

  /**
   * Periodic tick: coordinate guard patrols and respond to active threats.
   */
  async tick(): Promise<void> {
    const prompt: LLMPrompt = {
      systemPrompt: 'You are the Defense coordinator. Review active threats and guard positions, then issue patrol orders.',
      userMessage: this.activeAlerts.length > 0
        ? `Active alerts: ${this.activeAlerts.join('; ')}`
        : 'No active threats. Maintain standard patrol routes.',
      agentId: this.id,
    };
    const response = await this.requestLLM(prompt);
    this.lastThreatAssessment = response.content;
    // Clear processed alerts
    this.activeAlerts.length = 0;
  }
}
