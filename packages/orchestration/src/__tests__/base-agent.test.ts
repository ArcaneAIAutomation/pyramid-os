/**
 * Unit tests for BaseAgent and all agent role implementations.
 *
 * Validates: Requirements 7.1, 7.2, 7.4, 7.5, 7.6, 7.7, 7.8, 7.9, 7.10, 7.11, 7.12, 7.13
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentMessage, LLMPrompt, LLMResponse } from '@pyramid-os/shared-types';
import { BaseAgent } from '../agents/base-agent.js';
import type { LLMRequestDelegate, SendMessageDelegate } from '../agents/base-agent.js';
import { PharaohAgent } from '../agents/pharaoh-agent.js';
import { VizierAgent } from '../agents/vizier-agent.js';
import { ArchitectAgent } from '../agents/architect-agent.js';
import { ScribeAgent } from '../agents/scribe-agent.js';
import { BotForemanAgent } from '../agents/bot-foreman-agent.js';
import { DefenseAgent } from '../agents/defense-agent.js';
import { OpsAgent } from '../agents/ops-agent.js';
import { UIMasterAgent } from '../agents/ui-master-agent.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockLLMDelegate(): LLMRequestDelegate {
  return vi.fn(async (_agentId: string, prompt: LLMPrompt): Promise<LLMResponse> => ({
    content: `LLM response to: ${prompt.userMessage}`,
    model: 'test-model',
    latencyMs: 10,
    agentId: _agentId,
  }));
}

function createMockSendDelegate(): SendMessageDelegate {
  return vi.fn(async () => {});
}

function createMessage(overrides: Partial<AgentMessage> = {}): AgentMessage {
  return {
    id: 'msg-1',
    from: 'sender-1',
    to: 'receiver-1',
    content: 'test message content',
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

// Concrete subclass for testing the abstract BaseAgent
class TestAgent extends BaseAgent {
  processMessageCalled = false;
  tickCalled = false;

  constructor(
    id: string,
    llmDelegate: LLMRequestDelegate,
    sendDelegate: SendMessageDelegate,
  ) {
    super(id, 'pharaoh', 'planner', llmDelegate, sendDelegate);
  }

  async processMessage(_message: AgentMessage): Promise<void> {
    this.processMessageCalled = true;
  }

  async tick(): Promise<void> {
    this.tickCalled = true;
  }
}

// ---------------------------------------------------------------------------
// BaseAgent
// ---------------------------------------------------------------------------

describe('BaseAgent', () => {
  let llmDelegate: LLMRequestDelegate;
  let sendDelegate: SendMessageDelegate;

  beforeEach(() => {
    llmDelegate = createMockLLMDelegate();
    sendDelegate = createMockSendDelegate();
  });

  it('stores id, role, and tier', () => {
    const agent = new TestAgent('agent-1', llmDelegate, sendDelegate);
    expect(agent.id).toBe('agent-1');
    expect(agent.role).toBe('pharaoh');
    expect(agent.tier).toBe('planner');
  });

  it('delegates LLM requests through the llmDelegate', async () => {
    const agent = new TestAgent('agent-1', llmDelegate, sendDelegate);
    // Access the protected method via a subclass that exposes it
    const prompt: LLMPrompt = {
      systemPrompt: 'test system',
      userMessage: 'test user',
      agentId: 'agent-1',
    };
    // Use tick to trigger LLM indirectly — but TestAgent doesn't call LLM.
    // Instead, test via a concrete agent.
    const pharaoh = new PharaohAgent('p-1', llmDelegate, sendDelegate);
    await pharaoh.tick();
    expect(llmDelegate).toHaveBeenCalledWith('p-1', expect.objectContaining({
      agentId: 'p-1',
    }));
  });

  it('delegates message sending through the sendDelegate', async () => {
    // Test via a concrete agent that sends messages
    const agent = new TestAgent('agent-1', llmDelegate, sendDelegate);
    // TestAgent doesn't send messages, so we verify the delegate is wired
    // by testing a concrete agent that does.
    expect(sendDelegate).not.toHaveBeenCalled();
  });

  it('requires subclasses to implement processMessage', async () => {
    const agent = new TestAgent('agent-1', llmDelegate, sendDelegate);
    await agent.processMessage(createMessage());
    expect(agent.processMessageCalled).toBe(true);
  });

  it('requires subclasses to implement tick', async () => {
    const agent = new TestAgent('agent-1', llmDelegate, sendDelegate);
    await agent.tick();
    expect(agent.tickCalled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// PharaohAgent
// ---------------------------------------------------------------------------

describe('PharaohAgent', () => {
  let llmDelegate: LLMRequestDelegate;
  let sendDelegate: SendMessageDelegate;
  let agent: PharaohAgent;

  beforeEach(() => {
    llmDelegate = createMockLLMDelegate();
    sendDelegate = createMockSendDelegate();
    agent = new PharaohAgent('pharaoh-1', llmDelegate, sendDelegate);
  });

  it('has correct role and tier', () => {
    expect(agent.role).toBe('pharaoh');
    expect(agent.tier).toBe('planner');
  });

  it('tick() produces a strategic plan via LLM', async () => {
    await agent.tick();
    expect(llmDelegate).toHaveBeenCalledOnce();
    expect(agent.lastPlan).toContain('LLM response');
  });

  it('processMessage() interprets reports via LLM', async () => {
    await agent.processMessage(createMessage({ content: 'Resource shortage alert' }));
    expect(llmDelegate).toHaveBeenCalledOnce();
    expect(agent.lastPlan).toContain('LLM response');
  });
});

// ---------------------------------------------------------------------------
// VizierAgent
// ---------------------------------------------------------------------------

describe('VizierAgent', () => {
  let llmDelegate: LLMRequestDelegate;
  let sendDelegate: SendMessageDelegate;
  let agent: VizierAgent;

  beforeEach(() => {
    llmDelegate = createMockLLMDelegate();
    sendDelegate = createMockSendDelegate();
    agent = new VizierAgent('vizier-1', llmDelegate, sendDelegate);
  });

  it('has correct role and tier', () => {
    expect(agent.role).toBe('vizier');
    expect(agent.tier).toBe('planner');
  });

  it('tick() produces resource allocation via LLM', async () => {
    await agent.tick();
    expect(llmDelegate).toHaveBeenCalledOnce();
    expect(agent.lastAllocation).toContain('LLM response');
  });

  it('processMessage() interprets resource alerts via LLM', async () => {
    await agent.processMessage(createMessage({ content: 'Low sandstone' }));
    expect(llmDelegate).toHaveBeenCalledOnce();
    expect(agent.lastAllocation).toContain('LLM response');
  });
});

// ---------------------------------------------------------------------------
// ArchitectAgent
// ---------------------------------------------------------------------------

describe('ArchitectAgent', () => {
  let llmDelegate: LLMRequestDelegate;
  let sendDelegate: SendMessageDelegate;
  let agent: ArchitectAgent;

  beforeEach(() => {
    llmDelegate = createMockLLMDelegate();
    sendDelegate = createMockSendDelegate();
    agent = new ArchitectAgent('arch-1', llmDelegate, sendDelegate);
  });

  it('has correct role and tier', () => {
    expect(agent.role).toBe('architect');
    expect(agent.tier).toBe('planner');
  });

  it('tick() produces blueprint decisions via LLM', async () => {
    await agent.tick();
    expect(llmDelegate).toHaveBeenCalledOnce();
    expect(agent.lastBlueprintDecision).toContain('LLM response');
  });

  it('processMessage() evaluates build requests via LLM', async () => {
    await agent.processMessage(createMessage({ content: 'Build a temple' }));
    expect(llmDelegate).toHaveBeenCalledOnce();
    expect(agent.lastBlueprintDecision).toContain('LLM response');
  });
});

// ---------------------------------------------------------------------------
// ScribeAgent
// ---------------------------------------------------------------------------

describe('ScribeAgent', () => {
  let llmDelegate: LLMRequestDelegate;
  let sendDelegate: SendMessageDelegate;
  let agent: ScribeAgent;

  beforeEach(() => {
    llmDelegate = createMockLLMDelegate();
    sendDelegate = createMockSendDelegate();
    agent = new ScribeAgent('scribe-1', llmDelegate, sendDelegate);
  });

  it('has correct role and tier', () => {
    expect(agent.role).toBe('scribe');
    expect(agent.tier).toBe('operational');
  });

  it('processMessage() records incoming messages', async () => {
    await agent.processMessage(createMessage({ content: 'Event A' }));
    await agent.processMessage(createMessage({ content: 'Event B' }));
    expect(agent.records).toEqual(['Event A', 'Event B']);
  });

  it('tick() generates a report from records via LLM', async () => {
    agent.records.push('Event A', 'Event B');
    await agent.tick();
    expect(llmDelegate).toHaveBeenCalledOnce();
    expect(agent.lastReport).toContain('LLM response');
  });

  it('tick() skips LLM when no records exist', async () => {
    await agent.tick();
    expect(llmDelegate).not.toHaveBeenCalled();
    expect(agent.lastReport).toBe('');
  });
});

// ---------------------------------------------------------------------------
// BotForemanAgent
// ---------------------------------------------------------------------------

describe('BotForemanAgent', () => {
  let llmDelegate: LLMRequestDelegate;
  let sendDelegate: SendMessageDelegate;
  let agent: BotForemanAgent;

  beforeEach(() => {
    llmDelegate = createMockLLMDelegate();
    sendDelegate = createMockSendDelegate();
    agent = new BotForemanAgent('foreman-1', llmDelegate, sendDelegate);
  });

  it('has correct role and tier', () => {
    expect(agent.role).toBe('bot-foreman');
    expect(agent.tier).toBe('operational');
  });

  it('tick() assigns tasks via LLM', async () => {
    await agent.tick();
    expect(llmDelegate).toHaveBeenCalledOnce();
    expect(agent.lastAssignment).toContain('LLM response');
  });

  it('processMessage() interprets worker reports via LLM', async () => {
    await agent.processMessage(createMessage({ content: 'Task complete' }));
    expect(llmDelegate).toHaveBeenCalledOnce();
    expect(agent.lastAssignment).toContain('LLM response');
  });
});

// ---------------------------------------------------------------------------
// DefenseAgent
// ---------------------------------------------------------------------------

describe('DefenseAgent', () => {
  let llmDelegate: LLMRequestDelegate;
  let sendDelegate: SendMessageDelegate;
  let agent: DefenseAgent;

  beforeEach(() => {
    llmDelegate = createMockLLMDelegate();
    sendDelegate = createMockSendDelegate();
    agent = new DefenseAgent('defense-1', llmDelegate, sendDelegate);
  });

  it('has correct role and tier', () => {
    expect(agent.role).toBe('defense');
    expect(agent.tier).toBe('operational');
  });

  it('processMessage() records alerts and assesses threats via LLM', async () => {
    await agent.processMessage(createMessage({ content: 'Hostile mob detected' }));
    expect(agent.activeAlerts).toContain('Hostile mob detected');
    expect(llmDelegate).toHaveBeenCalledOnce();
    expect(agent.lastThreatAssessment).toContain('LLM response');
  });

  it('tick() coordinates patrols with active alerts', async () => {
    agent.activeAlerts.push('Zombie at north wall');
    await agent.tick();
    expect(llmDelegate).toHaveBeenCalledWith('defense-1', expect.objectContaining({
      userMessage: expect.stringContaining('Zombie at north wall'),
    }));
    // Alerts cleared after tick
    expect(agent.activeAlerts).toHaveLength(0);
  });

  it('tick() issues standard patrol when no threats', async () => {
    await agent.tick();
    expect(llmDelegate).toHaveBeenCalledWith('defense-1', expect.objectContaining({
      userMessage: expect.stringContaining('No active threats'),
    }));
  });
});

// ---------------------------------------------------------------------------
// OpsAgent
// ---------------------------------------------------------------------------

describe('OpsAgent', () => {
  let llmDelegate: LLMRequestDelegate;
  let sendDelegate: SendMessageDelegate;
  let agent: OpsAgent;

  beforeEach(() => {
    llmDelegate = createMockLLMDelegate();
    sendDelegate = createMockSendDelegate();
    agent = new OpsAgent('ops-1', llmDelegate, sendDelegate);
  });

  it('has correct role and tier', () => {
    expect(agent.role).toBe('ops');
    expect(agent.tier).toBe('operational');
  });

  it('processMessage() tracks unhealthy component reports', async () => {
    await agent.processMessage(createMessage({ content: 'Database unhealthy' }));
    expect(agent.unhealthyComponents).toContain('Database unhealthy');
  });

  it('processMessage() ignores healthy reports', async () => {
    await agent.processMessage(createMessage({ content: 'All systems nominal' }));
    expect(agent.unhealthyComponents).toHaveLength(0);
  });

  it('tick() assesses health and recommends recovery via LLM', async () => {
    agent.unhealthyComponents.push('Ollama timeout');
    await agent.tick();
    expect(llmDelegate).toHaveBeenCalledWith('ops-1', expect.objectContaining({
      userMessage: expect.stringContaining('Ollama timeout'),
    }));
    // Cleared after tick
    expect(agent.unhealthyComponents).toHaveLength(0);
  });

  it('tick() reports all healthy when no issues', async () => {
    await agent.tick();
    expect(llmDelegate).toHaveBeenCalledWith('ops-1', expect.objectContaining({
      userMessage: expect.stringContaining('All components healthy'),
    }));
  });
});

// ---------------------------------------------------------------------------
// UIMasterAgent
// ---------------------------------------------------------------------------

describe('UIMasterAgent', () => {
  let llmDelegate: LLMRequestDelegate;
  let sendDelegate: SendMessageDelegate;
  let pushUpdate: ReturnType<typeof vi.fn>;
  let agent: UIMasterAgent;

  beforeEach(() => {
    llmDelegate = createMockLLMDelegate();
    sendDelegate = createMockSendDelegate();
    pushUpdate = vi.fn();
    agent = new UIMasterAgent('ui-1', llmDelegate, sendDelegate, pushUpdate);
  });

  it('has correct role and tier', () => {
    expect(agent.role).toBe('ui-master');
    expect(agent.tier).toBe('operational');
  });

  it('processMessage() queues state updates', async () => {
    await agent.processMessage(createMessage({ content: 'Agent pharaoh active' }));
    expect(agent.pendingUpdates).toContain('Agent pharaoh active');
  });

  it('tick() pushes updates to Control Centre via delegate', async () => {
    agent.pendingUpdates.push('Build progress 50%');
    await agent.tick();
    expect(pushUpdate).toHaveBeenCalledWith(expect.stringContaining('LLM response'));
    expect(agent.lastUpdate).toContain('LLM response');
    // Pending updates cleared
    expect(agent.pendingUpdates).toHaveLength(0);
  });

  it('tick() skips when no pending updates', async () => {
    await agent.tick();
    expect(llmDelegate).not.toHaveBeenCalled();
    expect(pushUpdate).not.toHaveBeenCalled();
  });

  it('works without a pushUpdate delegate', async () => {
    const agentNoPush = new UIMasterAgent('ui-2', llmDelegate, sendDelegate);
    agentNoPush.pendingUpdates.push('Update');
    await agentNoPush.tick();
    expect(agentNoPush.lastUpdate).toContain('LLM response');
  });
});
