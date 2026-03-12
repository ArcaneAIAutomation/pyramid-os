import { describe, it, expect } from 'vitest';
import { MockOllama } from '../__mocks__/mock-ollama.js';
import type { AgentTier, LLMPrompt } from '@pyramid-os/shared-types';

const tierMap: Record<string, AgentTier> = {
  'pharaoh-1': 'planner',
  'scribe-1': 'operational',
  'builder-1': 'worker',
};

const resolver = (id: string): AgentTier | undefined => tierMap[id];

const prompt: LLMPrompt = {
  systemPrompt: 'You are a test agent.',
  userMessage: 'What should I do?',
  agentId: 'pharaoh-1',
};

describe('MockOllama', () => {
  it('implements LLMRouter interface — route returns LLMResponse', async () => {
    const mock = new MockOllama(resolver);
    const response = await mock.route('pharaoh-1', prompt);

    expect(response).toHaveProperty('content');
    expect(response).toHaveProperty('model');
    expect(response).toHaveProperty('latencyMs');
    expect(response).toHaveProperty('agentId');
    expect(typeof response.content).toBe('string');
    expect(response.content.length).toBeGreaterThan(0);
    expect(response.agentId).toBe('pharaoh-1');
  });

  it('selects model based on agent tier', async () => {
    const mock = new MockOllama(resolver);

    const planner = await mock.route('pharaoh-1', { ...prompt, agentId: 'pharaoh-1' });
    expect(planner.model).toBe('gpt-oss:20b');

    const operational = await mock.route('scribe-1', { ...prompt, agentId: 'scribe-1' });
    expect(operational.model).toBe('qwen3');

    const worker = await mock.route('builder-1', { ...prompt, agentId: 'builder-1' });
    expect(worker.model).toBe('qwen3');
  });

  it('cycles through canned responses', async () => {
    const mock = new MockOllama(resolver);
    const r1 = await mock.route('pharaoh-1', prompt);
    const r2 = await mock.route('pharaoh-1', prompt);
    const r3 = await mock.route('pharaoh-1', prompt);
    // After 3 responses it should cycle back
    const r4 = await mock.route('pharaoh-1', prompt);

    expect(r1.content).not.toBe(r2.content);
    expect(r4.content).toBe(r1.content);
  });

  it('applies configurable latency', async () => {
    const mock = new MockOllama(resolver, { latencyMs: 50 });
    const start = Date.now();
    await mock.route('pharaoh-1', prompt);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(40); // allow small timing variance
  });

  it('simulates failure after N requests', async () => {
    const mock = new MockOllama(resolver, { failAfterRequests: 2 });

    await mock.route('pharaoh-1', prompt);
    await mock.route('pharaoh-1', prompt);

    await expect(mock.route('pharaoh-1', prompt)).rejects.toThrow('simulated failure');
  });

  it('healthCheck returns configurable boolean', async () => {
    const healthy = new MockOllama(resolver, { healthy: true });
    expect(await healthy.healthCheck()).toBe(true);

    const unhealthy = new MockOllama(resolver, { healthy: false });
    expect(await unhealthy.healthCheck()).toBe(false);
  });

  it('setHealthy changes health status', async () => {
    const mock = new MockOllama(resolver);
    expect(await mock.healthCheck()).toBe(true);
    mock.setHealthy(false);
    expect(await mock.healthCheck()).toBe(false);
  });

  it('throws for unknown agent ID', async () => {
    const mock = new MockOllama(resolver);
    await expect(mock.route('unknown-agent', prompt)).rejects.toThrow('Unknown agent');
  });

  it('tracks request count', async () => {
    const mock = new MockOllama(resolver);
    expect(mock.getRequestCount()).toBe(0);
    await mock.route('pharaoh-1', prompt);
    await mock.route('pharaoh-1', prompt);
    expect(mock.getRequestCount()).toBe(2);
  });

  it('reset clears state', async () => {
    const mock = new MockOllama(resolver);
    await mock.route('pharaoh-1', prompt);
    await mock.route('pharaoh-1', prompt);
    mock.reset();
    expect(mock.getRequestCount()).toBe(0);
    // Should start from first canned response again
    const r = await mock.route('pharaoh-1', prompt);
    const fresh = new MockOllama(resolver);
    const r2 = await fresh.route('pharaoh-1', prompt);
    expect(r.content).toBe(r2.content);
  });
});
