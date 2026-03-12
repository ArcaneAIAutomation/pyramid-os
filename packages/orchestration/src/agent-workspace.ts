/**
 * AgentWorkspaceImpl — Per-agent isolated workspace with tool permission enforcement.
 * Requirements: 1.2, 1.3, 8.3, 8.4, 33.1–33.10
 */

import type { AgentTier, PersonalityTrait, ToolName } from '@pyramid-os/shared-types';
import type { AgentRepository } from '@pyramid-os/data-layer';
import type { AgentWorkspace } from './interfaces.js';

/**
 * Descriptions of how each personality trait influences decision-making.
 * Used to generate LLM system prompt modifiers.
 */
const TRAIT_DESCRIPTIONS: Record<PersonalityTrait, string> = {
  ambitious: 'You are ambitious — you pursue bold goals, prioritize expansion, and push for faster progress even when resources are tight.',
  cautious: 'You are cautious — you prefer safe, well-tested approaches, avoid unnecessary risks, and always maintain resource reserves.',
  diplomatic: 'You are diplomatic — you seek consensus, balance competing interests, and prefer negotiation over confrontation.',
  innovative: 'You are innovative — you favor creative solutions, experiment with new approaches, and challenge conventional methods.',
  traditional: 'You are traditional — you follow established procedures, respect hierarchy, and prefer proven methods over experimentation.',
  aggressive: 'You are aggressive — you act decisively, prioritize speed over caution, and push hard to achieve objectives quickly.',
  defensive: 'You are defensive — you prioritize protection, fortification, and security over expansion or speed.',
};

/**
 * Generate an LLM system prompt modifier based on personality traits.
 * Returns a string to inject into the system prompt, or empty string if no traits.
 */
export function generatePersonalityPromptModifier(traits: PersonalityTrait[]): string {
  if (!traits || traits.length === 0) return '';

  const descriptions = traits
    .filter((t) => TRAIT_DESCRIPTIONS[t])
    .map((t) => TRAIT_DESCRIPTIONS[t]);

  if (descriptions.length === 0) return '';

  return `\n\n[Personality]\n${descriptions.join('\n')}`;
}

/**
 * Tool permissions by tier.
 * Planner: full strategic access.
 * Operational: mid-level coordination tools.
 * Worker: execution-only tools.
 */
export const WORKSPACE_TEMPLATES: Record<AgentTier, ToolName[]> = {
  planner: [
    'llm_query',
    'task_create',
    'task_assign',
    'broadcast',
    'mode_change',
    'blueprint_approve',
    'resource_allocate',
    'ceremony_approve',
    'agent_spawn',
    'agent_terminate',
  ],
  operational: [
    'llm_query',
    'task_create',
    'task_assign',
    'resource_query',
    'zone_manage',
    'bot_command',
    'health_check',
    'message_send',
    'report_generate',
  ],
  worker: [
    'bot_move',
    'bot_place_block',
    'bot_dig',
    'bot_attack',
    'bot_equip',
    'bot_drop',
    'inventory_check',
    'path_find',
    'task_complete',
    'message_send',
  ],
};

export class AgentWorkspaceImpl implements AgentWorkspace {
  readonly agentId: string;
  readonly tier: AgentTier;
  readonly allowedTools: ToolName[];
  personalityTraits: PersonalityTrait[];

  private readonly repository: AgentRepository | undefined;

  constructor(
    agentId: string,
    tier: AgentTier,
    repository?: AgentRepository,
    personalityTraits?: PersonalityTrait[],
  ) {
    this.agentId = agentId;
    this.tier = tier;
    this.allowedTools = [...WORKSPACE_TEMPLATES[tier]];
    this.repository = repository ?? undefined;
    this.personalityTraits = personalityTraits ? [...personalityTraits] : [];
  }

  /** Returns true if the tool is permitted for this workspace's tier. */
  validateToolAccess(tool: ToolName): boolean {
    return this.allowedTools.includes(tool);
  }

  /** Persist workspace state (including personality traits) via AgentRepository. */
  async save(): Promise<void> {
    if (!this.repository) return;
    this.repository.updateWorkspaceState(this.agentId, {
      tier: this.tier,
      allowedTools: this.allowedTools,
      personalityTraits: this.personalityTraits,
    });
  }

  /** Restore workspace state (including personality traits) via AgentRepository. */
  async load(): Promise<void> {
    if (!this.repository) return;
    const state = this.repository.getWorkspaceState(this.agentId);
    if (state && Array.isArray(state.personalityTraits)) {
      this.personalityTraits = state.personalityTraits as PersonalityTrait[];
    }
  }
}
