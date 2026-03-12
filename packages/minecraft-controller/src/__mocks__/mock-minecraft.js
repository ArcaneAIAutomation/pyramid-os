"use strict";
/**
 * MockMinecraft — Mock Minecraft controller for development and testing.
 * Simulates bot actions with deterministic world seed, tracks placed/mined
 * blocks and inventory changes in memory.
 *
 * Requirements: 44.1, 44.4
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MockMinecraft = exports.DETERMINISTIC_SEED = void 0;
/** Deterministic seed for reproducible mock world state */
exports.DETERMINISTIC_SEED = 42;
/** Starting position for all mock bots */
const DEFAULT_POSITION = { x: 0, y: 64, z: 0 };
class MockMinecraft {
    bots = new Map();
    nextBotId = 1;
    startPosition;
    constructor(options = {}) {
        this.startPosition = options.startPosition ?? { ...DEFAULT_POSITION };
    }
    /** Connect a mock bot with deterministic position */
    connectBot(profile, role) {
        const id = `mock-bot-${this.nextBotId++}`;
        const instance = {
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
    disconnectBot(botId) {
        const state = this.bots.get(botId);
        if (!state) {
            throw new Error(`Bot "${botId}" not found`);
        }
        state.instance.status = 'disconnected';
    }
    /** Execute a bot action, returning deterministic results */
    executeAction(botId, action) {
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
                const pos = action.params['position'];
                const blockType = action.params['blockType'] ?? 'minecraft:sandstone';
                if (!pos) {
                    return { success: false, action: action.type, botId, outcome: 'Missing position', timestamp, error: 'Missing position' };
                }
                state.placedBlocks.push({ position: { ...pos }, blockType });
                return { success: true, action: action.type, botId, outcome: `Placed ${blockType} at ${pos.x},${pos.y},${pos.z}`, timestamp };
            }
            case 'dig': {
                const pos = action.params['position'];
                if (!pos) {
                    return { success: false, action: action.type, botId, outcome: 'Missing position', timestamp, error: 'Missing position' };
                }
                const blockType = 'minecraft:stone';
                state.minedBlocks.push({ position: { ...pos }, blockType });
                state.inventory.push({ type: blockType, count: 1, slot: state.inventory.length });
                return { success: true, action: action.type, botId, outcome: `Mined block at ${pos.x},${pos.y},${pos.z}`, timestamp };
            }
            case 'move_to': {
                const target = action.params['target'];
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
                const itemType = action.params['item'] ?? 'unknown';
                return { success: true, action: action.type, botId, outcome: `Equipped ${itemType}`, timestamp };
            }
            case 'drop': {
                const itemType = action.params['item'] ?? 'unknown';
                const count = action.params['count'] ?? 1;
                state.inventory = state.inventory.filter((i) => i.type !== itemType);
                return { success: true, action: action.type, botId, outcome: `Dropped ${count}x ${itemType}`, timestamp };
            }
            case 'chat': {
                const message = action.params['message'] ?? '';
                return { success: true, action: action.type, botId, outcome: `Chat: ${message}`, timestamp };
            }
            default:
                return { success: false, action: action.type, botId, outcome: `Unknown action type: ${action.type}`, timestamp, error: `Unknown action type` };
        }
    }
    /** Get bot status */
    getBotStatus(botId) {
        const state = this.bots.get(botId);
        if (!state)
            return undefined;
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
    listBots() {
        return Array.from(this.bots.values()).map((s) => ({ ...s.instance }));
    }
    /** Get placed blocks for a bot */
    getPlacedBlocks(botId) {
        return this.bots.get(botId)?.placedBlocks ?? [];
    }
    /** Get mined blocks for a bot */
    getMinedBlocks(botId) {
        return this.bots.get(botId)?.minedBlocks ?? [];
    }
    /** Get inventory for a bot */
    getInventory(botId) {
        return this.bots.get(botId)?.inventory ?? [];
    }
    /** Reset all state */
    reset() {
        this.bots.clear();
        this.nextBotId = 1;
    }
}
exports.MockMinecraft = MockMinecraft;
//# sourceMappingURL=mock-minecraft.js.map