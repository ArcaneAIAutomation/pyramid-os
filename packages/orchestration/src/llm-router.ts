/**
 * LLMRouterImpl — Routes LLM requests to Ollama models based on agent tier.
 * Implements concurrency limiting, timeout handling, health checks,
 * and descriptive error reporting.
 *
 * Requirements: 1.4, 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9, 9.10
 */

import type { AgentTier, LLMPrompt, LLMResponse } from '@pyramid-os/shared-types';
import { createPyramidError, type PyramidError } from '@pyramid-os/shared-types';
import type { Logger } from '@pyramid-os/logger';
import type { LLMRouter } from './interfaces.js';

/** Model selection by agent tier (req 9.2, 9.3) */
export const MODEL_MAP: Record<AgentTier, string> = {
  planner: 'gpt-oss:20b',
  operational: 'qwen3',
  worker: 'qwen3',
};

/** Configuration for the LLM router */
export interface LLMRouterConfig {
  ollamaUrl: string;
  maxConcurrentRequests: number;
  timeoutMs: number;
  /** Model overrides by tier — falls back to MODEL_MAP defaults if omitted */
  models?: {
    planner?: string;
    operational?: string;
    worker?: string;
  };
}

/** Function that resolves an agent ID to its tier */
export type AgentTierResolver = (agentId: string) => AgentTier | undefined;

/**
 * Simple semaphore for concurrency limiting.
 * Queues requests when the concurrency limit is reached.
 */
class Semaphore {
  private current = 0;
  private readonly queue: Array<() => void> = [];

  constructor(private readonly max: number) {}

  async acquire(): Promise<void> {
    if (this.current < this.max) {
      this.current++;
      return;
    }
    return new Promise<void>((resolve) => {
      this.queue.push(() => {
        this.current++;
        resolve();
      });
    });
  }

  release(): void {
    this.current--;
    const next = this.queue.shift();
    if (next) {
      next();
    }
  }

  get queueDepth(): number {
    return this.queue.length;
  }

  get activeCount(): number {
    return this.current;
  }
}

/** Error thrown when Ollama is unreachable (req 9.4) */
export class OllamaUnavailableError extends Error {
  pyramidError: PyramidError;
  constructor(url: string, cause?: Error) {
    super(
      `Ollama is not reachable at ${url}. ` +
      `Please ensure Ollama is running: start it with "ollama serve" ` +
      `or check that the configured host/port is correct.`,
    );
    this.name = 'OllamaUnavailableError';
    if (cause) this.cause = cause;
    this.pyramidError = createPyramidError(
      'PYRAMID_OLLAMA_UNAVAILABLE',
      { url },
      cause,
    );
  }
}

/** Error thrown when a required model is missing (req 9.5) */
export class ModelNotAvailableError extends Error {
  pyramidError: PyramidError;
  constructor(model: string) {
    super(
      `Required model "${model}" is not available in Ollama. ` +
      `Install it by running: ollama pull ${model}`,
    );
    this.name = 'ModelNotAvailableError';
    this.pyramidError = createPyramidError(
      'PYRAMID_OLLAMA_MODEL_MISSING',
      { model },
    );
  }
}

/** Error thrown when an LLM request times out (req 9.9) */
export class LLMTimeoutError extends Error {
  pyramidError: PyramidError;
  constructor(model: string, timeoutMs: number) {
    super(
      `LLM request to model "${model}" timed out after ${timeoutMs}ms. ` +
      `The model may be overloaded or the timeout may need to be increased.`,
    );
    this.name = 'LLMTimeoutError';
    this.pyramidError = createPyramidError(
      'PYRAMID_OLLAMA_TIMEOUT',
      { model, timeoutMs },
    );
  }
}

export class LLMRouterImpl implements LLMRouter {
  private readonly config: LLMRouterConfig;
  private readonly resolveAgentTier: AgentTierResolver;
  private readonly logger: Logger;
  private readonly semaphore: Semaphore;

  /** Tracks total requests and cumulative latency for metrics */
  private totalRequests = 0;
  private totalLatencyMs = 0;
  private errorCount = 0;

  constructor(
    config: LLMRouterConfig,
    resolveAgentTier: AgentTierResolver,
    logger: Logger,
  ) {
    this.config = config;
    this.resolveAgentTier = resolveAgentTier;
    this.logger = logger;
    this.semaphore = new Semaphore(config.maxConcurrentRequests);
  }

  /**
   * Route an LLM request to the appropriate Ollama model based on agent tier.
   * Enforces concurrency limits and timeout handling.
   */
  async route(agentId: string, prompt: LLMPrompt): Promise<LLMResponse> {
    const tier = this.resolveAgentTier(agentId);
    if (!tier) {
      throw new Error(`Unknown agent "${agentId}": cannot determine tier for model selection.`);
    }

    const model = this.config.models?.[tier] ?? MODEL_MAP[tier];

    this.logger.info('LLM request queued', {
      agentId,
      model,
      queueDepth: this.semaphore.queueDepth,
    });

    // Acquire semaphore slot (waits if at concurrency limit) — req 9.7
    await this.semaphore.acquire();

    const startTime = Date.now();
    try {
      const response = await this.callOllama(model, prompt, agentId);
      const latencyMs = Date.now() - startTime;

      this.totalRequests++;
      this.totalLatencyMs += latencyMs;

      // Log response latency — req 9.8
      this.logger.info('LLM request completed', {
        agentId,
        model,
        latencyMs,
      });

      return {
        content: response,
        model,
        latencyMs,
        agentId,
      };
    } catch (error) {
      this.errorCount++;
      const latencyMs = Date.now() - startTime;
      this.totalRequests++;
      this.totalLatencyMs += latencyMs;

      this.logger.error(
        'LLM request failed',
        error instanceof Error ? error : new Error(String(error)),
        { agentId, model, latencyMs },
      );
      throw error;
    } finally {
      this.semaphore.release();
    }
  }

  /**
   * Check Ollama availability by calling GET /api/tags.
   * Returns true if Ollama is reachable, false otherwise.
   */
  async healthCheck(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);

      const response = await fetch(`${this.config.ollamaUrl}/api/tags`, {
        method: 'GET',
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      return response.ok;
    } catch {
      return false;
    }
  }

  /** Get performance metrics */
  getMetrics() {
    return {
      totalRequests: this.totalRequests,
      averageLatencyMs:
        this.totalRequests > 0
          ? Math.round(this.totalLatencyMs / this.totalRequests)
          : 0,
      queueDepth: this.semaphore.queueDepth,
      errorRate:
        this.totalRequests > 0
          ? this.errorCount / this.totalRequests
          : 0,
    };
  }

  /**
   * Call the Ollama generate API with timeout handling.
   * Throws OllamaUnavailableError, ModelNotAvailableError, or LLMTimeoutError.
   */
  private async callOllama(
    model: string,
    prompt: LLMPrompt,
    agentId: string,
  ): Promise<string> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const response = await fetch(`${this.config.ollamaUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          prompt: prompt.userMessage,
          system: prompt.systemPrompt,
          stream: false,
          think: false,
          options: {
            num_predict: 150,
            ...prompt.context,
          },
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const body = await response.text().catch(() => '');

        // Ollama returns 404 when a model is not found
        if (response.status === 404 || body.includes('not found')) {
          throw new ModelNotAvailableError(model);
        }

        throw new Error(
          `Ollama returned HTTP ${response.status}: ${body || response.statusText}`,
        );
      }

      const data = (await response.json()) as {
        response?: string;
        error?: string;
      };

      if (data.error) {
        if (data.error.includes('not found')) {
          throw new ModelNotAvailableError(model);
        }
        throw new Error(`Ollama error: ${data.error}`);
      }

      return data.response ?? '';
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof ModelNotAvailableError) {
        throw error;
      }

      // AbortError means timeout — req 9.9
      if (
        error instanceof DOMException &&
        error.name === 'AbortError'
      ) {
        throw new LLMTimeoutError(model, this.config.timeoutMs);
      }

      // Network errors mean Ollama is unreachable — req 9.4
      if (
        error instanceof TypeError ||
        (error instanceof Error && error.message.includes('fetch'))
      ) {
        throw new OllamaUnavailableError(
          this.config.ollamaUrl,
          error instanceof Error ? error : undefined,
        );
      }

      throw error;
    }
  }
}
