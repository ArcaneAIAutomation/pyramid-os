import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ActionExecutor, type ErrorReporter } from '../action-executor.js';
import type { BotManager } from '../bot-manager.js';
import type { BotAction, BotInstance, BotStatus } from '@pyramid-os/shared-types';

// ---------------------------------------------------------------------------
// Mock logger
// ---------------------------------------------------------------------------

vi.mock('@pyramid-os/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockBotManager(overrides: Partial<BotManager> = {}): BotManager {
  return {
    getBot: vi.fn().mockReturnValue({
      id: 'bot-1',
      role: 'builder',
      status: 'connected',
      connectionId: 'conn-1',
    } satisfies BotInstance),
    checkRateLimit: vi.fn().mockReturnValue(true),
    getBotStatus: vi.fn().mockReturnValue({
      botId: 'bot-1',
      position: { x: 0, y: 64, z: 0 },
      health: 20,
      food: 20,
      inventory: [
        { type: 'minecraft:sandstone', count: 64, slot: 0 },
        { type: 'minecraft:diamond_pickaxe', count: 1, slot: 1 },
      ],
      connectionStatus: 'connected',
      latencyMs: 10,
    } satisfies BotStatus),
    ...overrides,
  } as unknown as BotManager;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ActionExecutor', () => {
  let executor: ActionExecutor;
  let mockBotManager: BotManager;

  beforeEach(() => {
    mockBotManager = createMockBotManager();
    executor = new ActionExecutor({ botManager: mockBotManager });
  });

  // ---- Bot validation -----------------------------------------------------

  describe('bot validation', () => {
    it('fails when bot is not found', async () => {
      (mockBotManager.getBot as any).mockReturnValue(undefined);

      const result = await executor.executeAction('unknown-bot', {
        type: 'chat',
        params: { message: 'hello' },
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Bot not found');
      expect(result.botId).toBe('unknown-bot');
      expect(result.action).toBe('chat');
    });

    it('fails when bot is disconnected', async () => {
      (mockBotManager.getBot as any).mockReturnValue({
        id: 'bot-1',
        role: 'builder',
        status: 'disconnected',
        connectionId: 'conn-1',
      });

      const result = await executor.executeAction('bot-1', {
        type: 'chat',
        params: { message: 'hello' },
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not connected');
    });

    it('fails when rate limit is exceeded', async () => {
      (mockBotManager.checkRateLimit as any).mockReturnValue(false);

      const result = await executor.executeAction('bot-1', {
        type: 'chat',
        params: { message: 'hello' },
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Rate limit exceeded');
    });
  });

  // ---- place_block --------------------------------------------------------

  describe('place_block', () => {
    it('succeeds with valid params and inventory', async () => {
      const result = await executor.executeAction('bot-1', {
        type: 'place_block',
        params: { position: { x: 10, y: 64, z: -5 }, blockType: 'minecraft:sandstone' },
      });

      expect(result.success).toBe(true);
      expect(result.action).toBe('place_block');
      expect(result.outcome).toContain('Placed minecraft:sandstone');
      expect(result.timestamp).toBeTruthy();
    });

    it('fails with missing position', async () => {
      const result = await executor.executeAction('bot-1', {
        type: 'place_block',
        params: { blockType: 'minecraft:sandstone' },
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('position');
    });

    it('fails with missing blockType', async () => {
      const result = await executor.executeAction('bot-1', {
        type: 'place_block',
        params: { position: { x: 0, y: 0, z: 0 } },
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('blockType');
    });

    it('fails when block is not in inventory', async () => {
      const result = await executor.executeAction('bot-1', {
        type: 'place_block',
        params: { position: { x: 0, y: 0, z: 0 }, blockType: 'minecraft:diamond_block' },
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Missing required block');
    });
  });

  // ---- dig ----------------------------------------------------------------

  describe('dig', () => {
    it('succeeds with valid position', async () => {
      const result = await executor.executeAction('bot-1', {
        type: 'dig',
        params: { position: { x: 5, y: 60, z: 3 } },
      });

      expect(result.success).toBe(true);
      expect(result.outcome).toContain('Dug block');
    });

    it('fails with missing position', async () => {
      const result = await executor.executeAction('bot-1', {
        type: 'dig',
        params: {},
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('position');
    });
  });

  // ---- attack ---------------------------------------------------------------

  describe('attack', () => {
    it('succeeds with valid entityId', async () => {
      const result = await executor.executeAction('bot-1', {
        type: 'attack',
        params: { entityId: 42 },
      });

      expect(result.success).toBe(true);
      expect(result.outcome).toContain('Attacked entity 42');
    });

    it('fails with missing entityId', async () => {
      const result = await executor.executeAction('bot-1', {
        type: 'attack',
        params: {},
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('entityId');
    });

    it('fails with non-numeric entityId', async () => {
      const result = await executor.executeAction('bot-1', {
        type: 'attack',
        params: { entityId: 'abc' },
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('entityId');
    });
  });

  // ---- equip ----------------------------------------------------------------

  describe('equip', () => {
    it('succeeds with valid item and destination', async () => {
      (mockBotManager.getBotStatus as any).mockReturnValue({
        botId: 'bot-1',
        position: { x: 0, y: 64, z: 0 },
        health: 20,
        food: 20,
        inventory: [{ type: 'minecraft:diamond_sword', count: 1, slot: 0 }],
        connectionStatus: 'connected',
        latencyMs: 10,
      });

      const result = await executor.executeAction('bot-1', {
        type: 'equip',
        params: { itemName: 'minecraft:diamond_sword', destination: 'hand' },
      });

      expect(result.success).toBe(true);
      expect(result.outcome).toContain('Equipped minecraft:diamond_sword to hand');
    });

    it('fails with invalid destination', async () => {
      const result = await executor.executeAction('bot-1', {
        type: 'equip',
        params: { itemName: 'minecraft:diamond_sword', destination: 'pocket' },
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid destination');
    });

    it('fails with missing itemName', async () => {
      const result = await executor.executeAction('bot-1', {
        type: 'equip',
        params: { destination: 'hand' },
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('itemName');
    });

    it('fails when item is not in inventory', async () => {
      const result = await executor.executeAction('bot-1', {
        type: 'equip',
        params: { itemName: 'minecraft:netherite_sword', destination: 'hand' },
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not in inventory');
    });
  });

  // ---- drop -----------------------------------------------------------------

  describe('drop', () => {
    it('succeeds with valid item', async () => {
      const result = await executor.executeAction('bot-1', {
        type: 'drop',
        params: { itemName: 'minecraft:sandstone', count: 10 },
      });

      expect(result.success).toBe(true);
      expect(result.outcome).toContain('Dropped 10x minecraft:sandstone');
    });

    it('defaults count to 1 when not specified', async () => {
      const result = await executor.executeAction('bot-1', {
        type: 'drop',
        params: { itemName: 'minecraft:sandstone' },
      });

      expect(result.success).toBe(true);
      expect(result.outcome).toContain('Dropped 1x');
    });

    it('fails with missing itemName', async () => {
      const result = await executor.executeAction('bot-1', {
        type: 'drop',
        params: {},
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('itemName');
    });

    it('fails when item is not in inventory', async () => {
      const result = await executor.executeAction('bot-1', {
        type: 'drop',
        params: { itemName: 'minecraft:emerald' },
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not in inventory');
    });

    it('fails when count exceeds inventory', async () => {
      const result = await executor.executeAction('bot-1', {
        type: 'drop',
        params: { itemName: 'minecraft:sandstone', count: 100 },
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Insufficient quantity');
    });

    it('fails with invalid count', async () => {
      const result = await executor.executeAction('bot-1', {
        type: 'drop',
        params: { itemName: 'minecraft:sandstone', count: -1 },
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('count must be a positive number');
    });
  });

  // ---- chat -----------------------------------------------------------------

  describe('chat', () => {
    it('succeeds with valid message', async () => {
      const result = await executor.executeAction('bot-1', {
        type: 'chat',
        params: { message: 'Hello world!' },
      });

      expect(result.success).toBe(true);
      expect(result.outcome).toContain('Sent chat: Hello world!');
    });

    it('fails with missing message', async () => {
      const result = await executor.executeAction('bot-1', {
        type: 'chat',
        params: {},
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('message');
    });
  });

  // ---- move_to --------------------------------------------------------------

  describe('move_to', () => {
    it('succeeds with valid position', async () => {
      const result = await executor.executeAction('bot-1', {
        type: 'move_to',
        params: { position: { x: 100, y: 64, z: -200 } },
      });

      expect(result.success).toBe(true);
      expect(result.outcome).toContain('Moved to (100, 64, -200)');
    });

    it('fails with missing position', async () => {
      const result = await executor.executeAction('bot-1', {
        type: 'move_to',
        params: {},
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('position');
    });
  });

  // ---- Error reporting (req 2.8) ------------------------------------------

  describe('error reporting', () => {
    it('calls errorReporter on failure', async () => {
      const reporter = vi.fn();
      executor.setErrorReporter(reporter);

      (mockBotManager.getBot as any).mockReturnValue(undefined);

      await executor.executeAction('bot-1', {
        type: 'chat',
        params: { message: 'hello' },
      });

      expect(reporter).toHaveBeenCalledWith('bot-1', 'Bot not found', 'chat');
    });

    it('does not call errorReporter on success', async () => {
      const reporter = vi.fn();
      executor.setErrorReporter(reporter);

      await executor.executeAction('bot-1', {
        type: 'chat',
        params: { message: 'hello' },
      });

      expect(reporter).not.toHaveBeenCalled();
    });

    it('swallows errorReporter exceptions', async () => {
      const reporter = vi.fn().mockImplementation(() => {
        throw new Error('reporter crash');
      });
      executor.setErrorReporter(reporter);

      (mockBotManager.getBot as any).mockReturnValue(undefined);

      const result = await executor.executeAction('bot-1', {
        type: 'chat',
        params: { message: 'hello' },
      });

      // Should still return the failure result without throwing
      expect(result.success).toBe(false);
    });
  });

  // ---- ActionResult shape ---------------------------------------------------

  describe('ActionResult shape', () => {
    it('includes all required fields on success', async () => {
      const result = await executor.executeAction('bot-1', {
        type: 'chat',
        params: { message: 'test' },
      });

      expect(result).toHaveProperty('success', true);
      expect(result).toHaveProperty('action', 'chat');
      expect(result).toHaveProperty('botId', 'bot-1');
      expect(result).toHaveProperty('outcome');
      expect(result).toHaveProperty('timestamp');
      expect(result).not.toHaveProperty('error');
    });

    it('includes error field on failure', async () => {
      (mockBotManager.getBot as any).mockReturnValue(undefined);

      const result = await executor.executeAction('bot-1', {
        type: 'chat',
        params: { message: 'test' },
      });

      expect(result).toHaveProperty('success', false);
      expect(result).toHaveProperty('error');
      expect(typeof result.error).toBe('string');
    });
  });

  // ---- Unsupported action ---------------------------------------------------

  describe('unsupported action', () => {
    it('fails for unknown action type', async () => {
      const result = await executor.executeAction('bot-1', {
        type: 'fly' as any,
        params: {},
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unsupported action type');
    });
  });
});
