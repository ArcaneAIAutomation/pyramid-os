/**
 * Integration tests for Minecraft Controller bot lifecycle.
 *
 * Tests the full flow: bot connect → action execute → disconnect → reconnect
 * using a mocked mineflayer module, but exercising real interaction between
 * BotManager, ActionExecutor, and ServerConnector.
 *
 * Validates: Requirements 18.3
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ConnectionProfile, BotAction } from '@pyramid-os/shared-types';

// ---------------------------------------------------------------------------
// Mock mineflayer at module level
// ---------------------------------------------------------------------------

vi.mock('mineflayer', () => ({
  createBot: vi.fn(),
}));

vi.mock('@pyramid-os/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { createBot } from 'mineflayer';
import { ServerConnector } from '../server-connector.js';
import { BotManager } from '../bot-manager.js';
import { ActionExecutor } from '../action-executor.js';

const mockedCreateBot = vi.mocked(createBot);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockBot(overrides: Record<string, any> = {}) {
  const listeners = new Map<string, Function[]>();
  const bot: any = {
    game: { version: '1.20.4' },
    player: { ping: 42 },
    on(event: string, fn: Function) {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event)!.push(fn);
      return bot;
    },
    once(event: string, fn: Function) {
      bot.on(event, fn);
      return bot;
    },
    emit(event: string, ...args: any[]) {
      for (const fn of listeners.get(event) ?? []) fn(...args);
    },
    quit: vi.fn(),
    ...overrides,
  };
  return { bot, emit: (e: string, ...a: any[]) => bot.emit(e, ...a) };
}

const LOCAL_PROFILE: ConnectionProfile = {
  name: 'test-local',
  host: 'localhost',
  port: 25565,
  authMethod: 'none',
};

// ---------------------------------------------------------------------------
// Integration: Bot Lifecycle
// ---------------------------------------------------------------------------

describe('Integration: Bot Lifecycle', () => {
  let connector: ServerConnector;
  let botManager: BotManager;
  let actionExecutor: ActionExecutor;

  beforeEach(() => {
    vi.useFakeTimers();
    connector = new ServerConnector([]);
    botManager = new BotManager({
      serverConnector: connector,
      reconnectionConfig: {
        initialDelayMs: 1000,
        maxDelayMs: 16000,
        multiplier: 2,
        maxAttempts: 5,
      },
    });
    actionExecutor = new ActionExecutor({ botManager });
  });

  afterEach(async () => {
    await botManager.shutdown();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  // ---- Full lifecycle: connect → execute → disconnect → reconnect ---------

  it('connect → execute action → disconnect → reconnect', async () => {
    // 1. Connect a bot
    const { bot: bot1, emit: emit1 } = createMockBot();
    mockedCreateBot.mockReturnValue(bot1);

    const connectPromise = botManager.connectBot(LOCAL_PROFILE, 'builder');
    emit1('spawn');
    const instance = await connectPromise;

    expect(instance.status).toBe('connected');
    expect(instance.role).toBe('builder');

    // 2. Execute an action (dig — no inventory precondition)
    const digAction: BotAction = {
      type: 'dig',
      params: { position: { x: 10, y: 64, z: -5 } },
    };
    const digResult = await actionExecutor.executeAction(instance.id, digAction);
    expect(digResult.success).toBe(true);
    expect(digResult.action).toBe('dig');

    // 3. Disconnect the bot (simulated server-side disconnect)
    emit1('end', 'server closed');

    const statusAfterDisconnect = botManager.getBotStatus(instance.id);
    expect(statusAfterDisconnect?.connectionStatus).toBe('reconnecting');

    // 4. Actions should fail while reconnecting
    const failResult = await actionExecutor.executeAction(instance.id, digAction);
    expect(failResult.success).toBe(false);
    expect(failResult.error).toContain('not connected');

    // 5. Reconnect succeeds after backoff delay
    const { bot: bot2 } = createMockBot();
    mockedCreateBot.mockImplementation((() => {
      setTimeout(() => (bot2 as any).emit('spawn'), 0);
      return bot2;
    }) as any);

    await vi.advanceTimersByTimeAsync(1100);
    await vi.advanceTimersByTimeAsync(10);

    const statusAfterReconnect = botManager.getBotStatus(instance.id);
    expect(statusAfterReconnect?.connectionStatus).toBe('connected');

    // 6. Actions work again after reconnection
    const postReconnectResult = await actionExecutor.executeAction(instance.id, digAction);
    expect(postReconnectResult.success).toBe(true);
  });

  // ---- Multiple bots lifecycle --------------------------------------------

  it('manages multiple bots independently', async () => {
    const { bot: bot1, emit: emit1 } = createMockBot();
    const { bot: bot2, emit: emit2 } = createMockBot();
    mockedCreateBot.mockReturnValueOnce(bot1).mockReturnValueOnce(bot2);

    const p1 = botManager.connectBot(LOCAL_PROFILE, 'builder');
    emit1('spawn');
    const builder = await p1;

    const p2 = botManager.connectBot(LOCAL_PROFILE, 'quarry');
    emit2('spawn');
    const quarry = await p2;

    // Both bots can execute actions
    const builderChat: BotAction = { type: 'chat', params: { message: 'Building!' } };
    const quarryDig: BotAction = { type: 'dig', params: { position: { x: 0, y: 60, z: 0 } } };

    const [r1, r2] = await Promise.all([
      actionExecutor.executeAction(builder.id, builderChat),
      actionExecutor.executeAction(quarry.id, quarryDig),
    ]);

    expect(r1.success).toBe(true);
    expect(r2.success).toBe(true);

    // Disconnect only builder — quarry should still work
    emit1('end', 'timeout');

    expect(botManager.getBotStatus(builder.id)?.connectionStatus).toBe('reconnecting');
    expect(botManager.getBotStatus(quarry.id)?.connectionStatus).toBe('connected');

    const quarryResult = await actionExecutor.executeAction(quarry.id, quarryDig);
    expect(quarryResult.success).toBe(true);

    const builderResult = await actionExecutor.executeAction(builder.id, builderChat);
    expect(builderResult.success).toBe(false);
  });

  // ---- Reconnection with exponential backoff ------------------------------

  it('reconnection uses exponential backoff and gives up after maxAttempts', async () => {
    const { bot: bot1, emit: emit1 } = createMockBot();
    mockedCreateBot.mockReturnValue(bot1);

    const connectPromise = botManager.connectBot(LOCAL_PROFILE, 'guard');
    emit1('spawn');
    const instance = await connectPromise;

    // Make all reconnection attempts fail
    mockedCreateBot.mockImplementation(() => {
      throw new Error('connect ECONNREFUSED');
    });

    emit1('end', 'server crash');

    expect(botManager.getBotStatus(instance.id)?.connectionStatus).toBe('reconnecting');

    // Attempt 1: delay 1000ms
    await vi.advanceTimersByTimeAsync(1100);
    expect(botManager.getBotStatus(instance.id)?.connectionStatus).toBe('reconnecting');

    // Attempt 2: delay 2000ms
    await vi.advanceTimersByTimeAsync(2100);
    expect(botManager.getBotStatus(instance.id)?.connectionStatus).toBe('reconnecting');

    // Attempt 3: delay 4000ms
    await vi.advanceTimersByTimeAsync(4100);
    expect(botManager.getBotStatus(instance.id)?.connectionStatus).toBe('reconnecting');

    // Attempt 4: delay 8000ms
    await vi.advanceTimersByTimeAsync(8100);
    expect(botManager.getBotStatus(instance.id)?.connectionStatus).toBe('reconnecting');

    // Attempt 5: delay 16000ms — this is the last attempt (maxAttempts=5)
    await vi.advanceTimersByTimeAsync(16100);

    expect(botManager.getBotStatus(instance.id)?.connectionStatus).toBe('disconnected');
  });

  // ---- Reconnection succeeds on second attempt ----------------------------

  it('reconnection succeeds on a later attempt after initial failures', async () => {
    const { bot: bot1, emit: emit1 } = createMockBot();
    mockedCreateBot.mockReturnValue(bot1);

    const connectPromise = botManager.connectBot(LOCAL_PROFILE, 'farmer');
    emit1('spawn');
    const instance = await connectPromise;

    // First reconnection attempt fails
    let attemptCount = 0;
    mockedCreateBot.mockImplementation((() => {
      attemptCount++;
      if (attemptCount < 2) {
        throw new Error('connect ECONNREFUSED');
      }
      // Second attempt succeeds
      const { bot: newBot } = createMockBot();
      setTimeout(() => (newBot as any).emit('spawn'), 0);
      return newBot;
    }) as any);

    emit1('end', 'network error');

    // Attempt 1 fails: delay 1000ms
    await vi.advanceTimersByTimeAsync(1100);
    expect(botManager.getBotStatus(instance.id)?.connectionStatus).toBe('reconnecting');

    // Attempt 2 succeeds: delay 2000ms
    await vi.advanceTimersByTimeAsync(2100);
    await vi.advanceTimersByTimeAsync(10);

    expect(botManager.getBotStatus(instance.id)?.connectionStatus).toBe('connected');

    // Bot can execute actions again
    const moveAction: BotAction = {
      type: 'move_to',
      params: { position: { x: 100, y: 64, z: 100 } },
    };
    const result = await actionExecutor.executeAction(instance.id, moveAction);
    expect(result.success).toBe(true);
  });

  // ---- Graceful disconnect does not trigger reconnection ------------------

  it('graceful disconnect does not trigger reconnection', async () => {
    const { bot: bot1, emit: emit1 } = createMockBot();
    mockedCreateBot.mockReturnValue(bot1);

    const connectPromise = botManager.connectBot(LOCAL_PROFILE, 'hauler');
    emit1('spawn');
    const instance = await connectPromise;

    // Graceful disconnect via BotManager API
    await botManager.disconnectBot(instance.id);

    expect(botManager.getBotStatus(instance.id)?.connectionStatus).toBe('disconnected');

    // Advance time — no reconnection should be attempted
    await vi.advanceTimersByTimeAsync(5000);

    expect(botManager.getBotStatus(instance.id)?.connectionStatus).toBe('disconnected');
  });

  // ---- Action validation during lifecycle ---------------------------------

  it('rejects actions for non-existent bots', async () => {
    const action: BotAction = { type: 'chat', params: { message: 'hello' } };
    const result = await actionExecutor.executeAction('nonexistent-bot', action);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Bot not found');
  });

  it('executes multiple action types in sequence', async () => {
    const { bot, emit } = createMockBot();
    mockedCreateBot.mockReturnValue(bot);

    const connectPromise = botManager.connectBot(LOCAL_PROFILE, 'builder');
    emit('spawn');
    const instance = await connectPromise;

    const actions: BotAction[] = [
      { type: 'move_to', params: { position: { x: 10, y: 64, z: 10 } } },
      { type: 'dig', params: { position: { x: 10, y: 63, z: 10 } } },
      { type: 'chat', params: { message: 'Done digging!' } },
    ];

    for (const action of actions) {
      const result = await actionExecutor.executeAction(instance.id, action);
      expect(result.success).toBe(true);
      expect(result.botId).toBe(instance.id);
    }
  });

  // ---- Error reporting integration ----------------------------------------

  it('error reporter is called on action failure', async () => {
    const { bot, emit } = createMockBot();
    mockedCreateBot.mockReturnValue(bot);

    const errors: Array<{ botId: string; error: string; action: string }> = [];
    actionExecutor.setErrorReporter((botId, error, action) => {
      errors.push({ botId, error, action });
    });

    const connectPromise = botManager.connectBot(LOCAL_PROFILE, 'builder');
    emit('spawn');
    const instance = await connectPromise;

    // Invalid action params should trigger error reporter
    const badAction: BotAction = {
      type: 'place_block',
      params: { position: { x: 0, y: 0, z: 0 }, blockType: 'sandstone' },
    };
    const result = await actionExecutor.executeAction(instance.id, badAction);

    // place_block fails because inventory is empty
    expect(result.success).toBe(false);
    expect(errors.length).toBe(1);
    expect(errors[0]!.botId).toBe(instance.id);
    expect(errors[0]!.action).toBe('place_block');
  });
});
