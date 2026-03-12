/**
 * Agent role implementations for PYRAMID OS.
 * Re-exports all agent classes and the BaseAgent abstract class.
 */

export { BaseAgent } from './base-agent.js';
export type { LLMRequestDelegate, SendMessageDelegate } from './base-agent.js';

export { PharaohAgent } from './pharaoh-agent.js';
export { VizierAgent } from './vizier-agent.js';
export { ArchitectAgent } from './architect-agent.js';
export { ScribeAgent } from './scribe-agent.js';
export { BotForemanAgent } from './bot-foreman-agent.js';
export { DefenseAgent } from './defense-agent.js';
export { OpsAgent } from './ops-agent.js';
export { UIMasterAgent } from './ui-master-agent.js';
export type { StateUpdateDelegate } from './ui-master-agent.js';
