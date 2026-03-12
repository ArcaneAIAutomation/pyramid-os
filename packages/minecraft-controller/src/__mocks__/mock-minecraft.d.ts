/**
 * MockMinecraft — Mock Minecraft controller for development and testing.
 * Simulates bot actions with deterministic world seed, tracks placed/mined
 * blocks and inventory changes in memory.
 *
 * Requirements: 44.1, 44.4
 */
import type { BotInstance, BotStatus, BotAction, ActionResult, Vec3, InventoryItem, WorkerRole, ConnectionProfile } from '@pyramid-os/shared-types';
/** Deterministic seed for reproducible mock world state */
export declare const DETERMINISTIC_SEED = 42;
export interface MockMinecraftOptions {
    /** Starting position for new bots (default: 0, 64, 0) */
    startPosition?: Vec3;
}
export declare class MockMinecraft {
    private bots;
    private nextBotId;
    private readonly startPosition;
    constructor(options?: MockMinecraftOptions);
    /** Connect a mock bot with deterministic position */
    connectBot(profile: ConnectionProfile, role: WorkerRole): BotInstance;
    /** Disconnect a mock bot */
    disconnectBot(botId: string): void;
    /** Execute a bot action, returning deterministic results */
    executeAction(botId: string, action: BotAction): ActionResult;
    /** Get bot status */
    getBotStatus(botId: string): BotStatus | undefined;
    /** List all bots */
    listBots(): BotInstance[];
    /** Get placed blocks for a bot */
    getPlacedBlocks(botId: string): Array<{
        position: Vec3;
        blockType: string;
    }>;
    /** Get mined blocks for a bot */
    getMinedBlocks(botId: string): Array<{
        position: Vec3;
        blockType: string;
    }>;
    /** Get inventory for a bot */
    getInventory(botId: string): InventoryItem[];
    /** Reset all state */
    reset(): void;
}
//# sourceMappingURL=mock-minecraft.d.ts.map