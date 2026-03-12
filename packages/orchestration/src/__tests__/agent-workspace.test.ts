/**
 * Unit tests for AgentWorkspaceImpl and WORKSPACE_TEMPLATES
 *
 * Validates: Requirements 1.2, 1.3, 33.1–33.10
 */

import { describe, it, expect, vi } from 'vitest';
import {
  AgentWorkspaceImpl,
  WORKSPACE_TEMPLATES,
  generatePersonalityPromptModifier,
} from '../agent-workspace.js';
import type { AgentTier, PersonalityTrait, ToolName } from '@pyramid-os/shared-types';

// ---------------------------------------------------------------------------
// WORKSPACE_TEMPLATES
// ---------------------------------------------------------------------------

describe('WORKSPACE_TEMPLATES', () => {
  it('defines tools for all three tiers', () => {
    expect(WORKSPACE_TEMPLATES).toHaveProperty('planner');
    expect(WORKSPACE_TEMPLATES).toHaveProperty('operational');
    expect(WORKSPACE_TEMPLATES).toHaveProperty('worker');
  });

  it('planner tier has full strategic tools', () => {
    const tools = WORKSPACE_TEMPLATES.planner;
    expect(tools).toContain('llm_query');
    expect(tools).toContain('task_create');
    expect(tools).toContain('task_assign');
    expect(tools).toContain('broadcast');
    expect(tools).toContain('mode_change');
    expect(tools).toContain('blueprint_approve');
    expect(tools).toContain('resource_allocate');
    expect(tools).toContain('ceremony_approve');
    expect(tools).toContain('agent_spawn');
    expect(tools).toContain('agent_terminate');
    expect(tools).toHaveLength(10);
  });

  it('operational tier has mid-level tools', () => {
    const tools = WORKSPACE_TEMPLATES.operational;
    expect(tools).toContain('llm_query');
    expect(tools).toContain('task_create');
    expect(tools).toContain('task_assign');
    expect(tools).toContain('resource_query');
    expect(tools).toContain('zone_manage');
    expect(tools).toContain('bot_command');
    expect(tools).toContain('health_check');
    expect(tools).toContain('message_send');
    expect(tools).toContain('report_generate');
    expect(tools).toHaveLength(9);
  });

  it('worker tier has execution tools only', () => {
    const tools = WORKSPACE_TEMPLATES.worker;
    expect(tools).toContain('bot_move');
    expect(tools).toContain('bot_place_block');
    expect(tools).toContain('bot_dig');
    expect(tools).toContain('bot_attack');
    expect(tools).toContain('bot_equip');
    expect(tools).toContain('bot_drop');
    expect(tools).toContain('inventory_check');
    expect(tools).toContain('path_find');
    expect(tools).toContain('task_complete');
    expect(tools).toContain('message_send');
    expect(tools).toHaveLength(10);
  });

  it('worker tier does not have planner-only tools', () => {
    const tools = WORKSPACE_TEMPLATES.worker;
    expect(tools).not.toContain('agent_spawn');
    expect(tools).not.toContain('agent_terminate');
    expect(tools).not.toContain('mode_change');
    expect(tools).not.toContain('blueprint_approve');
  });

  it('operational tier does not have planner-only tools', () => {
    const tools = WORKSPACE_TEMPLATES.operational;
    expect(tools).not.toContain('agent_spawn');
    expect(tools).not.toContain('agent_terminate');
    expect(tools).not.toContain('mode_change');
  });
});

// ---------------------------------------------------------------------------
// AgentWorkspaceImpl
// ---------------------------------------------------------------------------

describe('AgentWorkspaceImpl', () => {
  describe('constructor', () => {
    it('sets agentId and tier', () => {
      const ws = new AgentWorkspaceImpl('agent-1', 'planner');
      expect(ws.agentId).toBe('agent-1');
      expect(ws.tier).toBe('planner');
    });

    it('initializes allowedTools from WORKSPACE_TEMPLATES', () => {
      const ws = new AgentWorkspaceImpl('agent-1', 'worker');
      expect(ws.allowedTools).toEqual(WORKSPACE_TEMPLATES.worker);
    });

    it('creates a copy of the template (not a reference)', () => {
      const ws = new AgentWorkspaceImpl('agent-1', 'planner');
      expect(ws.allowedTools).not.toBe(WORKSPACE_TEMPLATES.planner);
      expect(ws.allowedTools).toEqual(WORKSPACE_TEMPLATES.planner);
    });
  });

  describe('validateToolAccess', () => {
    it('returns true for an allowed planner tool', () => {
      const ws = new AgentWorkspaceImpl('p-1', 'planner');
      expect(ws.validateToolAccess('llm_query')).toBe(true);
      expect(ws.validateToolAccess('agent_spawn')).toBe(true);
    });

    it('returns false for a tool not in the tier', () => {
      const ws = new AgentWorkspaceImpl('w-1', 'worker');
      expect(ws.validateToolAccess('agent_spawn')).toBe(false);
      expect(ws.validateToolAccess('mode_change')).toBe(false);
    });

    it('operational tier can access shared tools like llm_query', () => {
      const ws = new AgentWorkspaceImpl('o-1', 'operational');
      expect(ws.validateToolAccess('llm_query')).toBe(true);
    });

    it('worker tier can access message_send (shared with operational)', () => {
      const ws = new AgentWorkspaceImpl('w-1', 'worker');
      expect(ws.validateToolAccess('message_send')).toBe(true);
    });

    it('worker tier cannot access resource_allocate', () => {
      const ws = new AgentWorkspaceImpl('w-1', 'worker');
      expect(ws.validateToolAccess('resource_allocate')).toBe(false);
    });
  });

  describe('save and load without repository', () => {
    it('save resolves without error when no repository', async () => {
      const ws = new AgentWorkspaceImpl('agent-1', 'planner');
      await expect(ws.save()).resolves.toBeUndefined();
    });

    it('load resolves without error when no repository', async () => {
      const ws = new AgentWorkspaceImpl('agent-1', 'planner');
      await expect(ws.load()).resolves.toBeUndefined();
    });
  });

  describe('save and load with repository', () => {
    it('save calls updateWorkspaceState on the repository', async () => {
      const mockRepo = {
        updateWorkspaceState: vi.fn(),
      } as any;

      const ws = new AgentWorkspaceImpl('agent-1', 'operational', mockRepo);
      await ws.save();

      expect(mockRepo.updateWorkspaceState).toHaveBeenCalledWith('agent-1', {
        tier: 'operational',
        allowedTools: WORKSPACE_TEMPLATES.operational,
        personalityTraits: [],
      });
    });

    it('load does not throw with a repository', async () => {
      const mockRepo = {
        getWorkspaceState: vi.fn().mockReturnValue(undefined),
      } as any;
      const ws = new AgentWorkspaceImpl('agent-1', 'worker', mockRepo);
      await expect(ws.load()).resolves.toBeUndefined();
    });
  });

  describe('tier isolation', () => {
    const tiers: AgentTier[] = ['planner', 'operational', 'worker'];

    for (const tier of tiers) {
      it(`${tier} workspace only allows its own tools`, () => {
        const ws = new AgentWorkspaceImpl(`${tier}-1`, tier);
        for (const tool of WORKSPACE_TEMPLATES[tier]) {
          expect(ws.validateToolAccess(tool)).toBe(true);
        }
      });
    }

    it('planner tools are rejected by worker workspace', () => {
      const ws = new AgentWorkspaceImpl('w-1', 'worker');
      const plannerOnly = WORKSPACE_TEMPLATES.planner.filter(
        t => !WORKSPACE_TEMPLATES.worker.includes(t),
      );
      for (const tool of plannerOnly) {
        expect(ws.validateToolAccess(tool)).toBe(false);
      }
    });
  });
});

// ---------------------------------------------------------------------------
// Personality Traits
// ---------------------------------------------------------------------------

describe('Personality Traits', () => {
  describe('AgentWorkspaceImpl personality traits', () => {
    it('defaults to empty traits when none provided', () => {
      const ws = new AgentWorkspaceImpl('agent-1', 'planner');
      expect(ws.personalityTraits).toEqual([]);
    });

    it('accepts personality traits via constructor', () => {
      const traits: PersonalityTrait[] = ['ambitious', 'diplomatic'];
      const ws = new AgentWorkspaceImpl('agent-1', 'planner', undefined, traits);
      expect(ws.personalityTraits).toEqual(['ambitious', 'diplomatic']);
    });

    it('creates a copy of the traits array (not a reference)', () => {
      const traits: PersonalityTrait[] = ['cautious'];
      const ws = new AgentWorkspaceImpl('agent-1', 'planner', undefined, traits);
      traits.push('aggressive');
      expect(ws.personalityTraits).toEqual(['cautious']);
    });

    it('persists personality traits via save()', async () => {
      const mockRepo = {
        updateWorkspaceState: vi.fn(),
      } as any;

      const ws = new AgentWorkspaceImpl('agent-1', 'planner', mockRepo, ['innovative', 'ambitious']);
      await ws.save();

      expect(mockRepo.updateWorkspaceState).toHaveBeenCalledWith('agent-1', {
        tier: 'planner',
        allowedTools: WORKSPACE_TEMPLATES.planner,
        personalityTraits: ['innovative', 'ambitious'],
      });
    });

    it('restores personality traits via load()', async () => {
      const mockRepo = {
        getWorkspaceState: vi.fn().mockReturnValue({
          tier: 'planner',
          allowedTools: [],
          personalityTraits: ['cautious', 'defensive'],
        }),
      } as any;

      const ws = new AgentWorkspaceImpl('agent-1', 'planner', mockRepo);
      expect(ws.personalityTraits).toEqual([]);

      await ws.load();
      expect(ws.personalityTraits).toEqual(['cautious', 'defensive']);
      expect(mockRepo.getWorkspaceState).toHaveBeenCalledWith('agent-1');
    });

    it('load() keeps empty traits when workspace state has no personalityTraits', async () => {
      const mockRepo = {
        getWorkspaceState: vi.fn().mockReturnValue({
          tier: 'planner',
          allowedTools: [],
        }),
      } as any;

      const ws = new AgentWorkspaceImpl('agent-1', 'planner', mockRepo);
      await ws.load();
      expect(ws.personalityTraits).toEqual([]);
    });

    it('load() keeps empty traits when getWorkspaceState returns undefined', async () => {
      const mockRepo = {
        getWorkspaceState: vi.fn().mockReturnValue(undefined),
      } as any;

      const ws = new AgentWorkspaceImpl('agent-1', 'planner', mockRepo);
      await ws.load();
      expect(ws.personalityTraits).toEqual([]);
    });
  });

  describe('generatePersonalityPromptModifier', () => {
    it('returns empty string for empty traits array', () => {
      expect(generatePersonalityPromptModifier([])).toBe('');
    });

    it('returns empty string for undefined-like input', () => {
      expect(generatePersonalityPromptModifier([] as PersonalityTrait[])).toBe('');
    });

    it('generates modifier for a single trait', () => {
      const result = generatePersonalityPromptModifier(['ambitious']);
      expect(result).toContain('[Personality]');
      expect(result).toContain('ambitious');
      expect(result).toContain('bold goals');
    });

    it('generates modifier for multiple traits', () => {
      const result = generatePersonalityPromptModifier(['cautious', 'diplomatic']);
      expect(result).toContain('[Personality]');
      expect(result).toContain('cautious');
      expect(result).toContain('diplomatic');
      expect(result).toContain('safe, well-tested');
      expect(result).toContain('consensus');
    });

    it('generates modifier for all seven traits', () => {
      const allTraits: PersonalityTrait[] = [
        'ambitious', 'cautious', 'diplomatic', 'innovative',
        'traditional', 'aggressive', 'defensive',
      ];
      const result = generatePersonalityPromptModifier(allTraits);
      expect(result).toContain('[Personality]');
      for (const trait of allTraits) {
        expect(result.toLowerCase()).toContain(trait);
      }
    });

    it('starts with newlines for clean prompt injection', () => {
      const result = generatePersonalityPromptModifier(['innovative']);
      expect(result.startsWith('\n\n')).toBe(true);
    });
  });
});
