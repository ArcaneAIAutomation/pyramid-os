/**
 * MockOllama — Mock LLM router for development and testing.
 * Implements the same LLMRouter interface with canned responses,
 * configurable latency, and optional failure simulation.
 *
 * Requirements: 44.1, 44.4
 */

import type { LLMPrompt, LLMResponse, AgentTier } from '@pyramid-os/shared-types';
import type { LLMRouter } from '../interfaces.js';

/** Model selection by tier (mirrors real LLMRouter) */
const MODEL_MAP: Record<AgentTier, string> = {
  planner: 'gpt-oss:20b',
  operational: 'qwen3',
  worker: 'qwen3',
};

/** Canned responses by agent tier */
const CANNED_RESPONSES: Record<AgentTier, string[]> = {
  planner: [
    'Strategic analysis complete. Recommend expanding quarry operations to the eastern sector.',
    'Resource allocation approved. Prioritize sandstone procurement for pyramid layer 3.',
    'Blueprint review complete. Structure meets all safety requirements.',
  ],
  operational: [
    'Task assignment confirmed. Builder-01 assigned to sector A construction.',
    'Health check complete. All systems nominal.',
    'Report generated. 47 tasks completed this cycle.',
  ],
  worker: [
    'Block placement confirmed at target coordinates.',
    'Mining operation complete. 64 sandstone blocks collected.',
    'Patrol route clear. No threats detected.',
  ],
};

export interface MockOllamaOptions {
  /** Simulated latency in ms (default: 0) */
  latencyMs?: number;
  /** Fail after this many requests (undefined = never fail) */
  failAfterRequests?: number;
  /** Whether healthCheck returns true (default: true) */
  healthy?: boolean;
}

/** Function that resolves an agent ID to its tier */
export type AgentTierResolver = (agentId: string) => AgentTier | undefined;

export class MockOllama implements LLMRouter {
  private requestCount = 0;
  private readonly latencyMs: number;
  private readonly failAfter: number | undefined;
  private healthy: boolean;
  private readonly resolveAgentTier: AgentTierResolver;
  private responseIndex: Record<AgentTier, number> = {
    planner: 0,
    operational: 0,
    worker: 0,
  };

  constructor(resolveAgentTier: AgentTierResolver, options: MockOllamaOptions = {}) {
    this.resolveAgentTier = resolveAgentTier;
    this.latencyMs = options.latencyMs ?? 0;
    this.failAfter = options.failAfterRequests;
    this.healthy = options.healthy ?? true;
  }

  async route(agentId: string, prompt: LLMPrompt): Promise<LLMResponse> {
    this.requestCount++;

    if (this.failAfter !== undefined && this.requestCount > this.failAfter) {
      throw new Error(`MockOllama: simulated failure after ${this.failAfter} requests`);
    }

    const tier = this.resolveAgentTier(agentId);
    if (!tier) {
      throw new Error(`Unknown agent "${agentId}": cannot determine tier for model selection.`);
    }

    if (this.latencyMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.latencyMs));
    }

    const model = MODEL_MAP[tier];
    const responses = CANNED_RESPONSES[tier];
    const idx = this.responseIndex[tier] % responses.length;
    this.responseIndex[tier]++;

    return {
      content: responses[idx] ?? 'Default mock response.',
      model,
      latencyMs: this.latencyMs,
      agentId,
    };
  }

  async healthCheck(): Promise<boolean> {
    return this.healthy;
  }

  /** Set health status for testing */
  setHealthy(healthy: boolean): void {
    this.healthy = healthy;
  }

  /** Get total request count */
  getRequestCount(): number {
    return this.requestCount;
  }

  /** Reset state */
  reset(): void {
    this.requestCount = 0;
    this.responseIndex = { planner: 0, operational: 0, worker: 0 };
  }
}
