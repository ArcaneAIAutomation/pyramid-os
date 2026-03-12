import { describe, it, expect, beforeEach } from 'vitest';
import { MockMinecraft, DETERMINISTIC_SEED } from '../__mocks__/mock-minecraft.js';
import type { ConnectionProfile, BotAction } from '@pyramid-os/shared-types';

const profile: ConnectionProfile = {
  name: 'test-server',
  host: 'localhost',
  port: 25565,
  authMethod: 'none',
};

describe('MockMinecraft', () => {
  let mc: MockMinecraft;

  beforeEach(() => {
    mc = new MockMinecraft();
  });

  it('exports a deterministic seed constant', () => {
    expect(typeof DETERMINISTIC_SEED).toBe('number');
  });

  describe('connectBot', () => {
    it('creates a bot with deterministic position', () => {
      const bot = mc.connectBot(profile, 'builder');
      expect(bot.id).toBeTruthy();
      expect(bot.role).toBe('builder');
      expect(bot.status).toBe('connected');
      expect(bot.position).toEqual({ x: 0, y: 64, z: 0 });
      expect(bot.health).toBe(20);
      expect(bot.connectionId).toBeTruthy();
    });

    it('assigns unique IDs to each bot', () => {
      const b1 = mc.connectBot(profile, 'builder');
      const b2 = mc.connectBot(profile, 'quarry');
      expect(b1.id).not.toBe(b2.id);
    });

    it('uses custom start position', () => {
      const custom = new MockMinecraft({ startPosition: { x: 100, y: 70, z: -50 } });
      const bot = custom.connectBot(profile, 'guard');
      expect(bot.position).toEqual({ x: 100, y: 70, z: -50 });
    });
  });

  describe('disconnectBot', () => {
    it('sets bot status to disconnected', () => {
      const bot = mc.connectBot(profile, 'builder');
      mc.disconnectBot(bot.id);
      const status = mc.getBotStatus(bot.id);
      expect(status?.connectionStatus).toBe('disconnected');
    });

    it('throws for unknown bot', () => {
      expect(() => mc.disconnectBot('nonexistent')).toThrow('not found');
    });
  });

  describe('executeAction', () => {
    it('returns success for place_block with valid params', () => {
      const bot = mc.connectBot(profile, 'builder');
      const action: BotAction = {
        type: 'place_block',
        params: { position: { x: 1, y: 65, z: 1 }, blockType: 'minecraft:sandstone' },
      };
      const result = mc.executeAction(bot.id, action);
      expect(result.success).toBe(true);
      expect(result.botId).toBe(bot.id);
      expect(result.action).toBe('place_block');
    });

    it('tracks placed blocks', () => {
      const bot = mc.connectBot(profile, 'builder');
      mc.executeAction(bot.id, {
        type: 'place_block',
        params: { position: { x: 1, y: 65, z: 1 }, blockType: 'minecraft:gold_block' },
      });
      const placed = mc.getPlacedBlocks(bot.id);
      expect(placed).toHaveLength(1);
      expect(placed[0]!.blockType).toBe('minecraft:gold_block');
      expect(placed[0]!.position).toEqual({ x: 1, y: 65, z: 1 });
    });

    it('tracks mined blocks and updates inventory', () => {
      const bot = mc.connectBot(profile, 'quarry');
      mc.executeAction(bot.id, {
        type: 'dig',
        params: { position: { x: 5, y: 60, z: 5 } },
      });
      const mined = mc.getMinedBlocks(bot.id);
      expect(mined).toHaveLength(1);
      const inv = mc.getInventory(bot.id);
      expect(inv.length).toBeGreaterThan(0);
    });

    it('updates position on move_to', () => {
      const bot = mc.connectBot(profile, 'hauler');
      mc.executeAction(bot.id, {
        type: 'move_to',
        params: { target: { x: 10, y: 64, z: 20 } },
      });
      const status = mc.getBotStatus(bot.id);
      expect(status?.position).toEqual({ x: 10, y: 64, z: 20 });
    });

    it('returns failure for unknown bot', () => {
      const result = mc.executeAction('nonexistent', { type: 'attack', params: {} });
      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    });

    it('returns failure for disconnected bot', () => {
      const bot = mc.connectBot(profile, 'builder');
      mc.disconnectBot(bot.id);
      const result = mc.executeAction(bot.id, { type: 'attack', params: {} });
      expect(result.success).toBe(false);
      expect(result.error).toContain('not connected');
    });

    it('handles all action types', () => {
      const bot = mc.connectBot(profile, 'builder');
      const types: BotAction['type'][] = ['attack', 'equip', 'drop', 'chat'];
      for (const type of types) {
        const result = mc.executeAction(bot.id, { type, params: { item: 'sword', message: 'hi', count: 1 } });
        expect(result.success).toBe(true);
        expect(result.action).toBe(type);
      }
    });

    it('returns failure for missing position on place_block', () => {
      const bot = mc.connectBot(profile, 'builder');
      const result = mc.executeAction(bot.id, { type: 'place_block', params: {} });
      expect(result.success).toBe(false);
    });
  });

  describe('getBotStatus', () => {
    it('returns full BotStatus shape', () => {
      const bot = mc.connectBot(profile, 'farmer');
      const status = mc.getBotStatus(bot.id);
      expect(status).toBeDefined();
      expect(status).toHaveProperty('botId');
      expect(status).toHaveProperty('position');
      expect(status).toHaveProperty('health');
      expect(status).toHaveProperty('food');
      expect(status).toHaveProperty('inventory');
      expect(status).toHaveProperty('connectionStatus');
      expect(status).toHaveProperty('latencyMs');
    });

    it('returns undefined for unknown bot', () => {
      expect(mc.getBotStatus('nonexistent')).toBeUndefined();
    });
  });

  describe('listBots', () => {
    it('lists all connected bots', () => {
      mc.connectBot(profile, 'builder');
      mc.connectBot(profile, 'quarry');
      expect(mc.listBots()).toHaveLength(2);
    });
  });

  describe('reset', () => {
    it('clears all state', () => {
      mc.connectBot(profile, 'builder');
      mc.reset();
      expect(mc.listBots()).toHaveLength(0);
    });
  });
});
