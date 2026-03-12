/**
 * OpsAgent — System health monitoring and recovery.
 *
 * Monitors health of all components and triggers recovery for failures.
 * Uses LLM only for high-level interpretation, not action execution.
 *
 * Validates: Requirements 7.2, 7.10
 */

import type { AgentMessage, LLMPrompt } from '@pyramid-os/shared-types';
import { BaseAgent } from './base-agent.js';
import type { LLMRequestDelegate, SendMessageDelegate } from './base-agent.js';

export class OpsAgent extends BaseAgent {
  /** Most recent health assessment. */
  lastHealthAssessment = '';

  /** Components flagged as unhealthy. */
  readonly unhealthyComponents: string[] = [];

  constructor(
    id: string,
    llmDelegate: LLMRequestDelegate,
    sendDelegate: SendMessageDelegate,
  ) {
    super(id, 'ops', 'operational', llmDelegate, sendDelegate);
  }

  async processMessage(message: AgentMessage): Promise<void> {
    // Ops receives health reports and failure notifications.
    if (message.content.toLowerCase().includes('unhealthy') || message.content.toLowerCase().includes('error')) {
      this.unhealthyComponents.push(message.content);
    }
  }

  /**
   * Periodic tick: run health checks and trigger recovery for failed components.
   */
  async tick(): Promise<void> {
    const prompt: LLMPrompt = {
      systemPrompt: 'You are the Ops agent. Assess system health and recommend recovery actions for any failures.',
      userMessage: this.unhealthyComponents.length > 0
        ? `Unhealthy components: ${this.unhealthyComponents.join('; ')}`
        : 'All components healthy. No recovery actions needed.',
      agentId: this.id,
    };
    const response = await this.requestLLM(prompt);
    this.lastHealthAssessment = response.content;
    // Clear processed issues
    this.unhealthyComponents.length = 0;
  }
}
