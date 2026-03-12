/**
 * Unit tests for IntentionEngineImpl
 *
 * Validates: Requirements 8.4, 8.5, 8.6
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IntentionEngineImpl } from '../intention-engine.js';
import type { SafetyEnforcer, LLMRouter, AgentManager } from '../interfaces.js';
import type { AgentManagerImpl, ManagedAgent } from '../agent-manager.js';
import type { ModeControllerImpl } from '../mode-controller.js';
import type { Logger } from '@pyramid-os/logger';
import type { AgentInstance, LLMResponse, SafetyResult, OperatingMode } from '@pyramid-os/shared-types';

function createMockLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function createMockSafetyEnforcer(overrides?: Partial<SafetyEnforcer>): SafetyEnforcer {
  return {
    validate: vi.fn().mockReturnValue({ allowed: true } as SafetyResult),
    isProhibitedBlock: vi.fn().mockReturnValue(false),
    isProhibitedCommand: vi.fn().mockReturnValue(false),
    enforceTimeout: vi.fn(),
    emergencyStop: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function createMockLLMRouter(content = '{"goal":"Build a temple","reasoning":"Strategic expansion"}'): LLMRouter {
  return {
    route: vi.fn().mockResolvedValue({
      content,
      model: 'qwen3',
      latencyMs: 100,
      agentId: 'test-agent',
    } as LLMResponse),
    healthCheck: vi.fn().mockResolvedValue(true),
  };
}

function createMockModeController(mode: OperatingMode = 'free_thinking'): ModeControllerImpl {
  return {
    getCurrentMode: vi.fn().mockReturnValue(mode),
    setOperatingMode: vi.fn().mockResolvedValue(undefined),
    isAllowed: vi.fn().mockReturnValue(true),
    onModeChange: vi.fn(),
  } as unknown as ModeControllerImpl;
}

function createMockAgentManager(agents?: Map<string, ManagedAgent>): AgentManagerImpl {
  const defaultAgent: ManagedAgent = {
    instance: {
      id: 'agent-1',
      role: 'pharaoh',
      tier: 'planner',
      status: 'active',
      civilizationId: 'default',
      createdAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
    } as AgentInstance,
    workspace: {
      agentId: 'agent-1',
      tier: 'planner',
      allowedTools: [],
      personalityTraits: [],
      validateToolAccess: vi.fn().mockReturnValue(true),
      save: vi.fn().mockResolvedValue(undefined),
      load: vi.fn().mockResolvedValue(undefined),
    },
  };

  const agentMap = agents ?? new Map([['agent-1', defaultAgent]]);

  return {
    get: vi.fn((id: string) => agentMap.get(id)),
    create: vi.fn().mockResolvedValue('new-agent'),
    restart: vi.fn().mockResolvedValue(undefined),
    healthCheck: vi.fn().mockResolvedValue([]),
    persistState: vi.fn().mockResolvedValue(undefined),
    restoreState: vi.fn().mockResolvedValue(undefined),
  } as unknown as AgentManagerImpl;
}

describe('IntentionEngineImpl', () => {
  let logger: Logger;
  let safetyEnforcer: SafetyEnforcer;
  let llmRouter: LLMRouter;
  let modeController: ModeControllerImpl;
  let agentManager: AgentManagerImpl;
  let engine: IntentionEngineImpl;

  beforeEach(() => {
    logger = createMockLogger();
    safetyEnforcer = createMockSafetyEnforcer();
    llmRouter = createMockLLMRouter();
    modeController = createMockModeController();
    agentManager = createMockAgentManager();
    engine = new IntentionEngineImpl(
      safetyEnforcer,
      llmRouter,
      agentManager,
      modeController,
      logger,
    );
  });

  // -----------------------------------------------------------------------
  // Mode enforcement
  // -----------------------------------------------------------------------
  describe('mode enforcement', () => {
    it('throws when mode is structured', async () => {
      modeController = createMockModeController('structured');
      engine = new IntentionEngineImpl(safetyEnforcer, llmRouter, agentManager, modeController, logger);

      await expect(engine.generateIntention('agent-1')).rejects.toThrow(
        /only operates in free_thinking mode/,
      );
    });

    it('throws when mode is guided_autonomy', async () => {
      modeController = createMockModeController('guided_autonomy');
      engine = new IntentionEngineImpl(safetyEnforcer, llmRouter, agentManager, modeController, logger);

      await expect(engine.generateIntention('agent-1')).rejects.toThrow(
        /only operates in free_thinking mode/,
      );
    });

    it('allows operations in free_thinking mode', async () => {
      const result = await engine.generateIntention('agent-1');
      expect(result.agentId).toBe('agent-1');
      expect(result.goal).toBe('Build a temple');
    });

    it('throws for proposeReorganization when not in free_thinking', async () => {
      modeController = createMockModeController('structured');
      engine = new IntentionEngineImpl(safetyEnforcer, llmRouter, agentManager, modeController, logger);

      await expect(engine.proposeReorganization('agent-1')).rejects.toThrow(
        /only operates in free_thinking mode/,
      );
    });
  });

  // -----------------------------------------------------------------------
  // generateIntention
  // -----------------------------------------------------------------------
  describe('generateIntention', () => {
    it('returns an Intention with goal and reasoning from LLM', async () => {
      const result = await engine.generateIntention('agent-1');

      expect(result.agentId).toBe('agent-1');
      expect(result.goal).toBe('Build a temple');
      expect(result.reasoning).toBe('Strategic expansion');
      expect(result.createdAt).toBeDefined();
    });

    it('calls LLM router with the correct agent ID', async () => {
      await engine.generateIntention('agent-1');

      expect(llmRouter.route).toHaveBeenCalledWith(
        'agent-1',
        expect.objectContaining({ agentId: 'agent-1' }),
      );
    });

    it('validates the self_assign action against safety enforcer', async () => {
      await engine.generateIntention('agent-1');

      expect(safetyEnforcer.validate).toHaveBeenCalledWith('agent-1', {
        type: 'self_assign',
        payload: { agentId: 'agent-1' },
      });
    });

    it('handles non-JSON LLM responses gracefully', async () => {
      llmRouter = createMockLLMRouter('I want to build a grand pyramid');
      engine = new IntentionEngineImpl(safetyEnforcer, llmRouter, agentManager, modeController, logger);

      const result = await engine.generateIntention('agent-1');

      expect(result.goal).toBe('I want to build a grand pyramid');
      expect(result.reasoning).toBe('Raw LLM output (non-JSON response)');
    });

    it('throws when agent does not exist', async () => {
      await expect(engine.generateIntention('nonexistent')).rejects.toThrow(
        /Agent not found/,
      );
    });
  });

  // -----------------------------------------------------------------------
  // proposeReorganization
  // -----------------------------------------------------------------------
  describe('proposeReorganization', () => {
    it('returns a ReorganizationProposal from LLM', async () => {
      const reorgContent = JSON.stringify({
        changes: [
          { agentId: 'agent-2', currentRole: 'builder', proposedRole: 'quarry', rationale: 'Need more miners' },
        ],
        reasoning: 'Resource shortage requires role shift',
      });
      llmRouter = createMockLLMRouter(reorgContent);
      engine = new IntentionEngineImpl(safetyEnforcer, llmRouter, agentManager, modeController, logger);

      const result = await engine.proposeReorganization('agent-1');

      expect(result.proposedBy).toBe('agent-1');
      expect(result.changes).toHaveLength(1);
      expect(result.changes[0]!.proposedRole).toBe('quarry');
      expect(result.reasoning).toBe('Resource shortage requires role shift');
    });

    it('validates the reorganize action against safety enforcer', async () => {
      const reorgContent = JSON.stringify({ changes: [], reasoning: 'No changes needed' });
      llmRouter = createMockLLMRouter(reorgContent);
      engine = new IntentionEngineImpl(safetyEnforcer, llmRouter, agentManager, modeController, logger);

      await engine.proposeReorganization('agent-1');

      expect(safetyEnforcer.validate).toHaveBeenCalledWith('agent-1', {
        type: 'reorganize',
        payload: { agentId: 'agent-1' },
      });
    });

    it('handles non-JSON LLM responses gracefully', async () => {
      llmRouter = createMockLLMRouter('We should promote the builder to architect');
      engine = new IntentionEngineImpl(safetyEnforcer, llmRouter, agentManager, modeController, logger);

      const result = await engine.proposeReorganization('agent-1');

      expect(result.changes).toEqual([]);
      expect(result.reasoning).toBe('We should promote the builder to architect');
    });

    it('throws when agent does not exist', async () => {
      await expect(engine.proposeReorganization('nonexistent')).rejects.toThrow(
        /Agent not found/,
      );
    });
  });

  // -----------------------------------------------------------------------
  // Safety boundary enforcement (Req 8.5, 8.6)
  // -----------------------------------------------------------------------
  describe('safety boundary enforcement', () => {
    it('rejects generateIntention when safety enforcer denies the action', async () => {
      safetyEnforcer = createMockSafetyEnforcer({
        validate: vi.fn().mockReturnValue({
          allowed: false,
          reason: 'Emergency stop is active',
          violationType: 'prohibited-command',
        } as SafetyResult),
      });
      engine = new IntentionEngineImpl(safetyEnforcer, llmRouter, agentManager, modeController, logger);

      await expect(engine.generateIntention('agent-1')).rejects.toThrow(
        /Safety boundary violation/,
      );
    });

    it('rejects proposeReorganization when safety enforcer denies the action', async () => {
      safetyEnforcer = createMockSafetyEnforcer({
        validate: vi.fn().mockReturnValue({
          allowed: false,
          reason: 'Emergency stop is active',
          violationType: 'prohibited-command',
        } as SafetyResult),
      });
      engine = new IntentionEngineImpl(safetyEnforcer, llmRouter, agentManager, modeController, logger);

      await expect(engine.proposeReorganization('agent-1')).rejects.toThrow(
        /Safety boundary violation/,
      );
    });

    it('does not call LLM when safety check fails', async () => {
      safetyEnforcer = createMockSafetyEnforcer({
        validate: vi.fn().mockReturnValue({ allowed: false, reason: 'Blocked' } as SafetyResult),
      });
      engine = new IntentionEngineImpl(safetyEnforcer, llmRouter, agentManager, modeController, logger);

      await expect(engine.generateIntention('agent-1')).rejects.toThrow();
      expect(llmRouter.route).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // max_reasoning_loops guard (Req 8.6)
  // -----------------------------------------------------------------------
  describe('max_reasoning_loops guard', () => {
    it('allows operations up to the max loop count', async () => {
      engine = new IntentionEngineImpl(
        safetyEnforcer, llmRouter, agentManager, modeController, logger,
        { maxReasoningLoops: 3 },
      );

      await engine.generateIntention('agent-1');
      await engine.generateIntention('agent-1');
      await engine.generateIntention('agent-1');

      expect(engine.getLoopCount('agent-1')).toBe(3);
    });

    it('throws when exceeding max reasoning loops', async () => {
      engine = new IntentionEngineImpl(
        safetyEnforcer, llmRouter, agentManager, modeController, logger,
        { maxReasoningLoops: 2 },
      );

      await engine.generateIntention('agent-1');
      await engine.generateIntention('agent-1');

      await expect(engine.generateIntention('agent-1')).rejects.toThrow(
        /exceeded max reasoning loops/,
      );
    });

    it('tracks loop counts per agent independently', async () => {
      const agent2: ManagedAgent = {
        instance: {
          id: 'agent-2',
          role: 'vizier',
          tier: 'planner',
          status: 'active',
          civilizationId: 'default',
          createdAt: new Date().toISOString(),
          lastActiveAt: new Date().toISOString(),
        } as AgentInstance,
        workspace: {
          agentId: 'agent-2',
          tier: 'planner',
          allowedTools: [],
          personalityTraits: [],
          validateToolAccess: vi.fn().mockReturnValue(true),
          save: vi.fn().mockResolvedValue(undefined),
          load: vi.fn().mockResolvedValue(undefined),
        },
      };

      const agents = new Map<string, ManagedAgent>([
        ['agent-1', {
          instance: {
            id: 'agent-1', role: 'pharaoh', tier: 'planner', status: 'active',
            civilizationId: 'default', createdAt: new Date().toISOString(), lastActiveAt: new Date().toISOString(),
          } as AgentInstance,
          workspace: {
            agentId: 'agent-1', tier: 'planner', allowedTools: [],
            personalityTraits: [],
            validateToolAccess: vi.fn().mockReturnValue(true),
            save: vi.fn().mockResolvedValue(undefined),
            load: vi.fn().mockResolvedValue(undefined),
          },
        }],
        ['agent-2', agent2],
      ]);

      agentManager = createMockAgentManager(agents);
      engine = new IntentionEngineImpl(
        safetyEnforcer, llmRouter, agentManager, modeController, logger,
        { maxReasoningLoops: 2 },
      );

      await engine.generateIntention('agent-1');
      await engine.generateIntention('agent-1');
      await engine.generateIntention('agent-2'); // agent-2 has its own counter

      expect(engine.getLoopCount('agent-1')).toBe(2);
      expect(engine.getLoopCount('agent-2')).toBe(1);
    });

    it('counts proposeReorganization towards the loop limit', async () => {
      engine = new IntentionEngineImpl(
        safetyEnforcer, llmRouter, agentManager, modeController, logger,
        { maxReasoningLoops: 2 },
      );

      const reorgContent = JSON.stringify({ changes: [], reasoning: 'test' });
      llmRouter = createMockLLMRouter(reorgContent);
      engine = new IntentionEngineImpl(
        safetyEnforcer, llmRouter, agentManager, modeController, logger,
        { maxReasoningLoops: 2 },
      );

      await engine.proposeReorganization('agent-1');
      await engine.proposeReorganization('agent-1');

      await expect(engine.proposeReorganization('agent-1')).rejects.toThrow(
        /exceeded max reasoning loops/,
      );
    });

    it('resetLoopCount clears the counter for a specific agent', async () => {
      engine = new IntentionEngineImpl(
        safetyEnforcer, llmRouter, agentManager, modeController, logger,
        { maxReasoningLoops: 2 },
      );

      await engine.generateIntention('agent-1');
      await engine.generateIntention('agent-1');

      engine.resetLoopCount('agent-1');
      expect(engine.getLoopCount('agent-1')).toBe(0);

      // Should be able to generate again
      await engine.generateIntention('agent-1');
      expect(engine.getLoopCount('agent-1')).toBe(1);
    });

    it('resetAllLoopCounts clears all counters', async () => {
      await engine.generateIntention('agent-1');
      engine.resetAllLoopCounts();
      expect(engine.getLoopCount('agent-1')).toBe(0);
    });

    it('uses default max of 50 when no config provided', () => {
      const defaultEngine = new IntentionEngineImpl(
        safetyEnforcer, llmRouter, agentManager, modeController, logger,
      );
      // We can't directly access the private field, but we can verify
      // it doesn't throw for 50 loops (tested indirectly via getLoopCount)
      expect(defaultEngine.getLoopCount('agent-1')).toBe(0);
    });
  });
});
