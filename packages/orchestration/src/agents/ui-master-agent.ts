/**
 * UIMasterAgent — Control Centre state updates.
 *
 * Pushes state updates to the Control Centre via WebSocket.
 * Uses LLM only for high-level interpretation, not action execution.
 *
 * Validates: Requirements 7.2, 7.11
 */

import type { AgentMessage, LLMPrompt } from '@pyramid-os/shared-types';
import { BaseAgent } from './base-agent.js';
import type { LLMRequestDelegate, SendMessageDelegate } from './base-agent.js';

/** Delegate for pushing state updates to the Control Centre. */
export type StateUpdateDelegate = (update: string) => void;

export class UIMasterAgent extends BaseAgent {
  /** Most recent state update pushed to the Control Centre. */
  lastUpdate = '';

  /** Pending state updates to push on next tick. */
  readonly pendingUpdates: string[] = [];

  /** Optional delegate for pushing updates to the Control Centre. */
  private readonly pushUpdate: StateUpdateDelegate | undefined;

  constructor(
    id: string,
    llmDelegate: LLMRequestDelegate,
    sendDelegate: SendMessageDelegate,
    pushUpdate?: StateUpdateDelegate,
  ) {
    super(id, 'ui-master', 'operational', llmDelegate, sendDelegate);
    this.pushUpdate = pushUpdate ?? undefined;
  }

  async processMessage(message: AgentMessage): Promise<void> {
    // UI-Master collects state updates from other agents.
    this.pendingUpdates.push(message.content);
  }

  /**
   * Periodic tick: push accumulated state updates to the Control Centre.
   */
  async tick(): Promise<void> {
    if (this.pendingUpdates.length === 0) return;

    const prompt: LLMPrompt = {
      systemPrompt: 'You are the UI-Master. Summarize these state changes into a concise dashboard update.',
      userMessage: this.pendingUpdates.join('\n'),
      agentId: this.id,
    };
    const response = await this.requestLLM(prompt);
    this.lastUpdate = response.content;

    // Push to Control Centre if delegate is available
    if (this.pushUpdate) {
      this.pushUpdate(response.content);
    }

    // Clear processed updates
    this.pendingUpdates.length = 0;
  }
}
