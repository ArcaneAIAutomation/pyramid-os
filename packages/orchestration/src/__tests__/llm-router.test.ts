/**
 * Unit tests for LLMRouterImpl, MODEL_MAP, and error classes.
 *
 * Validates: Requirements 1.4, 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9, 9.10
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  LLMRouterImpl,
  MODEL_MAP,
  OllamaUnavailableError,
  ModelNotAvailableError,
  LLMTimeoutError,
} from '../llm-router.js';
import type { LLMRouterConfig, AgentTierResolver } from '../llm-router.js';
import type { AgentTier, LLMPrompt } from '@pyramid-os/shared-types';
import type { Logger } from '@pyramid-os/logger';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function createPrompt(overrides?: Partial<LLMPrompt>): LLMPrompt {
  return {
    systemPrompt: 'You are a helpful assistant.',
    userMessage: 'Hello',
    agentId: 'agent-1',
    ...overrides,
  };
}

const defaultConfig: LLMRouterConfig = {
  ollamaUrl: 'http://localhost:11434',
  maxConcurrentRequests: 2,
  timeoutMs: 30_000,
};

function tierResolver(map: Record<string, AgentTier>): AgentTierResolver {
  return (agentId: string) => map[agentId];
}

// ---------------------------------------------------------------------------
// MODEL_MAP
// ---------------------------------------------------------------------------

describe('MODEL_MAP', () => {
  it('maps planner tier to gpt-oss:20b', () => {
    expect(MODEL_MAP.planner).toBe('gpt-oss:20b');
  });

  it('maps operational tier to qwen3', () => {
    expect(MODEL_MAP.operational).toBe('qwen3');
  });

  it('maps worker tier to qwen3', () => {
    expect(MODEL_MAP.worker).toBe('qwen3');
  });

  it('covers all three tiers', () => {
    expect(Object.keys(MODEL_MAP)).toEqual(['planner', 'operational', 'worker']);
  });
});

// ---------------------------------------------------------------------------
// Error classes
// ---------------------------------------------------------------------------

describe('OllamaUnavailableError', () => {
  it('includes the URL and start instructions in the message', () => {
    const err = new OllamaUnavailableError('http://localhost:11434');
    expect(err.message).toContain('http://localhost:11434');
    expect(err.message).toContain('ollama serve');
    expect(err.name).toBe('OllamaUnavailableError');
  });

  it('preserves the cause when provided', () => {
    const cause = new Error('ECONNREFUSED');
    const err = new OllamaUnavailableError('http://localhost:11434', cause);
    expect(err.cause).toBe(cause);
  });
});

describe('ModelNotAvailableError', () => {
  it('includes the model name and pull instructions', () => {
    const err = new ModelNotAvailableError('gpt-oss:20b');
    expect(err.message).toContain('gpt-oss:20b');
    expect(err.message).toContain('ollama pull gpt-oss:20b');
    expect(err.name).toBe('ModelNotAvailableError');
  });
});

describe('LLMTimeoutError', () => {
  it('includes the model name and timeout duration', () => {
    const err = new LLMTimeoutError('qwen3', 30000);
    expect(err.message).toContain('qwen3');
    expect(err.message).toContain('30000ms');
    expect(err.name).toBe('LLMTimeoutError');
  });
});

// ---------------------------------------------------------------------------
// LLMRouterImpl
// ---------------------------------------------------------------------------

describe('LLMRouterImpl', () => {
  const originalFetch = globalThis.fetch;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    globalThis.fetch = mockFetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // ---- route() ----

  describe('route()', () => {
    it('selects gpt-oss:20b for planner agents (req 9.2)', async () => {
      const logger = createMockLogger();
      const router = new LLMRouterImpl(
        defaultConfig,
        tierResolver({ 'planner-1': 'planner' }),
        logger,
      );

      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ response: 'Hello from LLM' }), { status: 200 }),
      );

      const result = await router.route('planner-1', createPrompt({ agentId: 'planner-1' }));

      expect(result.model).toBe('gpt-oss:20b');
      expect(result.content).toBe('Hello from LLM');
      expect(result.agentId).toBe('planner-1');

      const callArgs = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(callArgs[1].body as string);
      expect(body.model).toBe('gpt-oss:20b');
    });

    it('selects qwen3 for operational agents (req 9.3)', async () => {
      const logger = createMockLogger();
      const router = new LLMRouterImpl(
        defaultConfig,
        tierResolver({ 'ops-1': 'operational' }),
        logger,
      );

      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ response: 'Operational response' }), { status: 200 }),
      );

      const result = await router.route('ops-1', createPrompt({ agentId: 'ops-1' }));
      expect(result.model).toBe('qwen3');
    });

    it('selects qwen3 for worker agents (req 9.3)', async () => {
      const logger = createMockLogger();
      const router = new LLMRouterImpl(
        defaultConfig,
        tierResolver({ 'worker-1': 'worker' }),
        logger,
      );

      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ response: 'Worker response' }), { status: 200 }),
      );

      const result = await router.route('worker-1', createPrompt({ agentId: 'worker-1' }));
      expect(result.model).toBe('qwen3');
    });

    it('throws for unknown agent ID', async () => {
      const logger = createMockLogger();
      const router = new LLMRouterImpl(defaultConfig, tierResolver({}), logger);

      await expect(
        router.route('unknown-agent', createPrompt()),
      ).rejects.toThrow('Unknown agent');
    });

    it('includes latencyMs in the response (req 9.8)', async () => {
      const logger = createMockLogger();
      const router = new LLMRouterImpl(
        defaultConfig,
        tierResolver({ 'a-1': 'worker' }),
        logger,
      );

      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ response: 'ok' }), { status: 200 }),
      );

      const result = await router.route('a-1', createPrompt({ agentId: 'a-1' }));
      expect(typeof result.latencyMs).toBe('number');
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('logs latency for every request (req 9.8)', async () => {
      const logger = createMockLogger();
      const router = new LLMRouterImpl(
        defaultConfig,
        tierResolver({ 'a-1': 'worker' }),
        logger,
      );

      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ response: 'ok' }), { status: 200 }),
      );

      await router.route('a-1', createPrompt({ agentId: 'a-1' }));

      expect(logger.info).toHaveBeenCalledWith(
        'LLM request queued',
        expect.objectContaining({ agentId: 'a-1', model: 'qwen3' }),
      );
      expect(logger.info).toHaveBeenCalledWith(
        'LLM request completed',
        expect.objectContaining({ agentId: 'a-1', model: 'qwen3', latencyMs: expect.any(Number) }),
      );
    });

    it('sends system prompt and user message to Ollama', async () => {
      const logger = createMockLogger();
      const router = new LLMRouterImpl(
        defaultConfig,
        tierResolver({ 'a-1': 'planner' }),
        logger,
      );

      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ response: 'ok' }), { status: 200 }),
      );

      await router.route(
        'a-1',
        createPrompt({
          agentId: 'a-1',
          systemPrompt: 'Be a pharaoh.',
          userMessage: 'Plan the pyramid.',
        }),
      );

      const callArgs = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(callArgs[1].body as string);
      expect(body.system).toBe('Be a pharaoh.');
      expect(body.prompt).toBe('Plan the pyramid.');
      expect(body.stream).toBe(false);
    });
  });

  // ---- Error handling ----

  describe('error handling', () => {
    it('throws OllamaUnavailableError when fetch fails with TypeError (req 9.4)', async () => {
      const logger = createMockLogger();
      const router = new LLMRouterImpl(
        defaultConfig,
        tierResolver({ 'a-1': 'worker' }),
        logger,
      );

      mockFetch.mockRejectedValueOnce(new TypeError('fetch failed'));

      await expect(
        router.route('a-1', createPrompt({ agentId: 'a-1' })),
      ).rejects.toThrow(OllamaUnavailableError);
    });

    it('OllamaUnavailableError message includes start instructions (req 9.4)', async () => {
      const logger = createMockLogger();
      const router = new LLMRouterImpl(
        defaultConfig,
        tierResolver({ 'a-1': 'worker' }),
        logger,
      );

      mockFetch.mockRejectedValueOnce(new TypeError('fetch failed'));

      await expect(
        router.route('a-1', createPrompt({ agentId: 'a-1' })),
      ).rejects.toThrow(/ollama serve/);
    });

    it('throws ModelNotAvailableError on 404 response (req 9.5)', async () => {
      const logger = createMockLogger();
      const router = new LLMRouterImpl(
        defaultConfig,
        tierResolver({ 'a-1': 'planner' }),
        logger,
      );

      mockFetch.mockResolvedValueOnce(
        new Response('model not found', { status: 404 }),
      );

      await expect(
        router.route('a-1', createPrompt({ agentId: 'a-1' })),
      ).rejects.toThrow(ModelNotAvailableError);
    });

    it('ModelNotAvailableError includes pull instructions (req 9.5)', async () => {
      const logger = createMockLogger();
      const router = new LLMRouterImpl(
        defaultConfig,
        tierResolver({ 'a-1': 'planner' }),
        logger,
      );

      mockFetch.mockResolvedValueOnce(
        new Response('model not found', { status: 404 }),
      );

      await expect(
        router.route('a-1', createPrompt({ agentId: 'a-1' })),
      ).rejects.toThrow(/ollama pull gpt-oss:20b/);
    });

    it('throws ModelNotAvailableError when response body contains "not found"', async () => {
      const logger = createMockLogger();
      const router = new LLMRouterImpl(
        defaultConfig,
        tierResolver({ 'a-1': 'worker' }),
        logger,
      );

      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'model "qwen3" not found' }), { status: 200 }),
      );

      await expect(
        router.route('a-1', createPrompt({ agentId: 'a-1' })),
      ).rejects.toThrow(ModelNotAvailableError);
    });

    it('throws LLMTimeoutError when request is aborted (req 9.9)', async () => {
      const logger = createMockLogger();
      const router = new LLMRouterImpl(
        { ...defaultConfig, timeoutMs: 50 },
        tierResolver({ 'a-1': 'worker' }),
        logger,
      );

      mockFetch.mockImplementationOnce(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            const signal = init.signal!;
            signal.addEventListener('abort', () => {
              reject(new DOMException('The operation was aborted.', 'AbortError'));
            });
          }),
      );

      await expect(
        router.route('a-1', createPrompt({ agentId: 'a-1' })),
      ).rejects.toThrow(LLMTimeoutError);
    });

    it('logs errors on failure (req 9.8)', async () => {
      const logger = createMockLogger();
      const router = new LLMRouterImpl(
        defaultConfig,
        tierResolver({ 'a-1': 'worker' }),
        logger,
      );

      mockFetch.mockRejectedValueOnce(new TypeError('fetch failed'));

      await router.route('a-1', createPrompt({ agentId: 'a-1' })).catch(() => {});

      expect(logger.error).toHaveBeenCalledWith(
        'LLM request failed',
        expect.any(Error),
        expect.objectContaining({ agentId: 'a-1' }),
      );
    });
  });

  // ---- Concurrency limiting (req 9.7) ----

  describe('concurrency limiting', () => {
    it('limits concurrent requests to maxConcurrentRequests', async () => {
      const logger = createMockLogger();
      const router = new LLMRouterImpl(
        { ...defaultConfig, maxConcurrentRequests: 1 },
        tierResolver({ 'a-1': 'worker', 'a-2': 'worker' }),
        logger,
      );

      let resolveFirst!: (value: Response) => void;
      const firstPromise = new Promise<Response>((resolve) => {
        resolveFirst = resolve;
      });

      let secondCalled = false;
      mockFetch.mockImplementation(() => {
        if (!secondCalled) {
          secondCalled = true;
          return firstPromise;
        }
        return Promise.resolve(
          new Response(JSON.stringify({ response: 'second' }), { status: 200 }),
        );
      });

      const r1 = router.route('a-1', createPrompt({ agentId: 'a-1' }));

      // Let microtasks settle so the first request acquires the semaphore and calls fetch
      await new Promise((r) => setTimeout(r, 10));

      const r2 = router.route('a-2', createPrompt({ agentId: 'a-2' }));

      // Give microtasks a chance — second request should be queued, not calling fetch yet
      await new Promise((r) => setTimeout(r, 10));

      // Only one fetch call should have been made so far (semaphore blocks the second)
      expect(mockFetch).toHaveBeenCalledTimes(1);

      resolveFirst(new Response(JSON.stringify({ response: 'first' }), { status: 200 }));

      const [result1, result2] = await Promise.all([r1, r2]);
      expect(result1.content).toBe('first');
      expect(result2.content).toBe('second');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('allows parallel requests up to the limit', async () => {
      const logger = createMockLogger();
      const router = new LLMRouterImpl(
        { ...defaultConfig, maxConcurrentRequests: 3 },
        tierResolver({ 'a-1': 'worker', 'a-2': 'worker', 'a-3': 'worker' }),
        logger,
      );

      mockFetch.mockImplementation(() =>
        Promise.resolve(
          new Response(JSON.stringify({ response: 'ok' }), { status: 200 }),
        ),
      );

      await Promise.all([
        router.route('a-1', createPrompt({ agentId: 'a-1' })),
        router.route('a-2', createPrompt({ agentId: 'a-2' })),
        router.route('a-3', createPrompt({ agentId: 'a-3' })),
      ]);

      expect(mockFetch).toHaveBeenCalledTimes(3);
    });
  });

  // ---- healthCheck() ----

  describe('healthCheck()', () => {
    it('returns true when Ollama responds with 200', async () => {
      const logger = createMockLogger();
      const router = new LLMRouterImpl(defaultConfig, tierResolver({}), logger);

      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ models: [] }), { status: 200 }),
      );

      const result = await router.healthCheck();
      expect(result).toBe(true);
      const callArgs = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(callArgs[0]).toBe('http://localhost:11434/api/tags');
    });

    it('returns false when Ollama is unreachable', async () => {
      const logger = createMockLogger();
      const router = new LLMRouterImpl(defaultConfig, tierResolver({}), logger);

      mockFetch.mockRejectedValueOnce(new TypeError('fetch failed'));

      const result = await router.healthCheck();
      expect(result).toBe(false);
    });

    it('returns false when Ollama returns non-200', async () => {
      const logger = createMockLogger();
      const router = new LLMRouterImpl(defaultConfig, tierResolver({}), logger);

      mockFetch.mockResolvedValueOnce(
        new Response('Internal Server Error', { status: 500 }),
      );

      const result = await router.healthCheck();
      expect(result).toBe(false);
    });
  });

  // ---- getMetrics() ----

  describe('getMetrics()', () => {
    it('returns zero metrics initially', () => {
      const logger = createMockLogger();
      const router = new LLMRouterImpl(defaultConfig, tierResolver({}), logger);

      const metrics = router.getMetrics();
      expect(metrics.totalRequests).toBe(0);
      expect(metrics.averageLatencyMs).toBe(0);
      expect(metrics.queueDepth).toBe(0);
      expect(metrics.errorRate).toBe(0);
    });

    it('tracks metrics after successful requests', async () => {
      const logger = createMockLogger();
      const router = new LLMRouterImpl(
        defaultConfig,
        tierResolver({ 'a-1': 'worker' }),
        logger,
      );

      mockFetch.mockImplementation(() =>
        Promise.resolve(
          new Response(JSON.stringify({ response: 'ok' }), { status: 200 }),
        ),
      );

      await router.route('a-1', createPrompt({ agentId: 'a-1' }));
      await router.route('a-1', createPrompt({ agentId: 'a-1' }));

      const metrics = router.getMetrics();
      expect(metrics.totalRequests).toBe(2);
      expect(metrics.averageLatencyMs).toBeGreaterThanOrEqual(0);
      expect(metrics.errorRate).toBe(0);
    });

    it('tracks error rate after failed requests', async () => {
      const logger = createMockLogger();
      const router = new LLMRouterImpl(
        defaultConfig,
        tierResolver({ 'a-1': 'worker' }),
        logger,
      );

      mockFetch
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ response: 'ok' }), { status: 200 }),
        )
        .mockRejectedValueOnce(new TypeError('fetch failed'));

      await router.route('a-1', createPrompt({ agentId: 'a-1' }));
      await router.route('a-1', createPrompt({ agentId: 'a-1' })).catch(() => {});

      const metrics = router.getMetrics();
      expect(metrics.totalRequests).toBe(2);
      expect(metrics.errorRate).toBe(0.5);
    });
  });

  // ---- No external API calls (req 9.10) ----

  describe('local-only enforcement (req 9.10)', () => {
    it('only calls the configured ollamaUrl, never external APIs', async () => {
      const logger = createMockLogger();
      const router = new LLMRouterImpl(
        { ...defaultConfig, ollamaUrl: 'http://127.0.0.1:11434' },
        tierResolver({ 'a-1': 'worker' }),
        logger,
      );

      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ response: 'ok' }), { status: 200 }),
      );

      await router.route('a-1', createPrompt({ agentId: 'a-1' }));

      for (const call of mockFetch.mock.calls) {
        const url = call[0] as string;
        expect(url).toMatch(/^http:\/\/127\.0\.0\.1:11434/);
      }
    });
  });
});
