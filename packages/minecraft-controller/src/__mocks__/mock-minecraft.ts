/**
 * MockMinecraft — Mock Minecraft controller for development and testing.
 * Simulates bot actions with deterministic world seed, tracks placed/mined
 * blocks and inventory changes in memory.
 *
 * Requirements: 44.1, 44.4
 */

import type {
  BotInstance,
  BotStatus,
  BotAction,
  ActionResult,
  Vec3,
  InventoryItem,
  WorkerRole,
  ConnectionProfile,
} from '@pyramid-os/shared-types';

/** Deterministic seed for reproducible mock world state */
export const DETERMINISTIC_SEED = 42;

/** Starting position for all mock bots */
const DEFAULT_POSITION: Vec3 = { x: 0, y: 64, z: 0 };

interface MockBotState {
  instance: BotInstance;
  position: Vec3;
  health: number;
  food: number;
  inventory: InventoryItem[];
  placedBlocks: Array<{ position: Vec3; blockType: string }>;
  minedBlocks: Array<{ position: Vec3; blockType: string }>;
}

export interface MockMinecraftOptions {
  /** Starting position for new bots (default: 0, 64, 0) */
  startPosition?: Vec3;
}

export class MockMinecraft {
  private bots = new Map<string, MockBotState>();
  private nextBotId = 1;
  private readonly startPosition: Vec3;

  constructor(options: MockMinecraftOptions = {}) {
    this.startPosition = options.startPosition ?? { ...DEFAULT_POSITION };
  }

  /** Connect a mock bot with deterministic position */
  connectBot(profile: ConnectionProfile, role: WorkerRole): BotInstance {
    const id = `mock-bot-${this.nextBotId++}`;
    const instance: BotInstance = {
      id,
      role,
      status: 'connected',
      position: { ...this.startPosition },
      health: 20,
      connectionId: `mock-conn-${id}`,
    };

    this.bots.set(id, {
      instance,
      position: { ...this.startPosition },
      health: 20,
      food: 20,
      inventory: [],
      placedBlocks: [],
      minedBlocks: [],
    });

    return instance;
  }

  /** Disconnect a mock bot */
  disconnectBot(botId: string): void {
    const state = this.bots.get(botId);
    if (!state) {
      throw new Error(`Bot "${botId}" not found`);
    }
    state.instance.status = 'disconnected';
  }

  /** Execute a bot action, returning deterministic results */
  executeAction(botId: string, action: BotAction): ActionResult {
    const state = this.bots.get(botId);
    if (!state) {
      return {
        success: false,
        action: action.type,
        botId,
        outcome: `Bot "${botId}" not found`,
        timestamp: new Date().toISOString(),
        error: `Bot "${botId}" not found`,
      };
    }

    if (state.instance.status !== 'connected') {
      return {
        success: false,
        action: action.type,
        botId,
        outcome: 'Bot is not connected',
        timestamp: new Date().toISOString(),
        error: 'Bot is not connected',
      };
    }

    const timestamp = new Date().toISOString();

    switch (action.type) {
      case 'place_block': {
        const pos = action.params['position'] as Vec3 | undefined;
        const blockType = (action.params['blockType'] as string) ?? 'minecraft:sandstone';
        if (!pos) {
          return { success: false, action: action.type, botId, outcome: 'Missing position', timestamp, error: 'Missing position' };
        }
        state.placedBlocks.push({ position: { ...pos }, blockType });
        return { success: true, action: action.type, botId, outcome: `Placed ${blockType} at ${pos.x},${pos.y},${pos.z}`, timestamp };
      }

      case 'dig': {
        const pos = action.params['position'] as Vec3 | undefined;
        if (!pos) {
          return { success: false, action: action.type, botId, outcome: 'Missing position', timestamp, error: 'Missing position' };
        }
        const blockType = 'minecraft:stone';
        state.minedBlocks.push({ position: { ...pos }, blockType });
        state.inventory.push({ type: blockType, count: 1, slot: state.inventory.length });
        return { success: true, action: action.type, botId, outcome: `Mined block at ${pos.x},${pos.y},${pos.z}`, timestamp };
      }

      case 'move_to': {
        const target = action.params['target'] as Vec3 | undefined;
        if (!target) {
          return { success: false, action: action.type, botId, outcome: 'Missing target', timestamp, error: 'Missing target' };
        }
        state.position = { ...target };
        state.instance.position = { ...target };
        return { success: true, action: action.type, botId, outcome: `Moved to ${target.x},${target.y},${target.z}`, timestamp };
      }

      case 'attack':
        return { success: true, action: action.type, botId, outcome: 'Attack executed', timestamp };

      case 'equip': {
        const itemType = (action.params['item'] as string) ?? 'unknown';
        return { success: true, action: action.type, botId, outcome: `Equipped ${itemType}`, timestamp };
      }

      case 'drop': {
        const itemType = (action.params['item'] as string) ?? 'unknown';
        const count = (action.params['count'] as number) ?? 1;
        state.inventory = state.inventory.filter((i) => i.type !== itemType);
        return { success: true, action: action.type, botId, outcome: `Dropped ${count}x ${itemType}`, timestamp };
      }

      case 'chat': {
        const message = (action.params['message'] as string) ?? '';
        return { success: true, action: action.type, botId, outcome: `Chat: ${message}`, timestamp };
      }

      default:
        return { success: false, action: action.type, botId, outcome: `Unknown action type: ${action.type}`, timestamp, error: `Unknown action type` };
    }
  }

  /** Get bot status */
  getBotStatus(botId: string): BotStatus | undefined {
    const state = this.bots.get(botId);
    if (!state) return undefined;

    return {
      botId,
      position: { ...state.position },
      health: state.health,
      food: state.food,
      inventory: [...state.inventory],
      connectionStatus: state.instance.status,
      latencyMs: 0,
    };
  }

  /** List all bots */
  listBots(): BotInstance[] {
    return Array.from(this.bots.values()).map((s) => ({ ...s.instance }));
  }

  /** Get placed blocks for a bot */
  getPlacedBlocks(botId: string): Array<{ position: Vec3; blockType: string }> {
    return this.bots.get(botId)?.placedBlocks ?? [];
  }

  /** Get mined blocks for a bot */
  getMinedBlocks(botId: string): Array<{ position: Vec3; blockType: string }> {
    return this.bots.get(botId)?.minedBlocks ?? [];
  }

  /** Get inventory for a bot */
  getInventory(botId: string): InventoryItem[] {
    return this.bots.get(botId)?.inventory ?? [];
  }

  /** Reset all state */
  reset(): void {
    this.bots.clear();
    this.nextBotId = 1;
  }
}
