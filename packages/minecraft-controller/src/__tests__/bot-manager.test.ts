import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BotManager, BotRateLimiter, type BotActionLogEntry } from '../bot-manager.js';
import { ServerConnector } from '../server-connector.js';
import type { ConnectionProfile } from '@pyramid-os/shared-types';

// ---------------------------------------------------------------------------
// Mocks
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

// Helper: create a mock bot that emits events
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

import { createBot } from 'mineflayer';
const mockedCreateBot = vi.mocked(createBot);

const LOCAL_PROFILE: ConnectionProfile = {
  name: 'test-local',
  host: 'localhost',
  port: 25565,
  authMethod: 'none',
};

// ---------------------------------------------------------------------------
// BotRateLimiter
// ---------------------------------------------------------------------------

describe('BotRateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows up to maxTokens actions immediately', () => {
    const limiter = new BotRateLimiter(10, 10);
    for (let i = 0; i < 10; i++) {
      expect(limiter.tryConsume('bot1')).toBe(true);
    }
    expect(limiter.tryConsume('bot1')).toBe(false);
  });

  it('refills tokens over time', () => {
    const limiter = new BotRateLimiter(10, 10);
    // Drain all tokens
    for (let i = 0; i < 10; i++) limiter.tryConsume('bot1');
    expect(limiter.tryConsume('bot1')).toBe(false);

    // Advance 500ms → should refill 5 tokens
    vi.advanceTimersByTime(500);
    for (let i = 0; i < 5; i++) {
      expect(limiter.tryConsume('bot1')).toBe(true);
    }
    expect(limiter.tryConsume('bot1')).toBe(false);
  });

  it('does not exceed maxTokens on refill', () => {
    const limiter = new BotRateLimiter(10, 10);
    // Advance 5 seconds without consuming — should still cap at 10
    vi.advanceTimersByTime(5000);
    let consumed = 0;
    while (limiter.tryConsume('bot1')) consumed++;
    expect(consumed).toBe(10);
  });

  it('tracks separate buckets per bot', () => {
    const limiter = new BotRateLimiter(3, 3);
    for (let i = 0; i < 3; i++) limiter.tryConsume('a');
    expect(limiter.tryConsume('a')).toBe(false);
    // Bot 'b' should still have tokens
    expect(limiter.tryConsume('b')).toBe(true);
  });

  it('reset removes the bucket', () => {
    const limiter = new BotRateLimiter(2, 2);
    limiter.tryConsume('bot1');
    limiter.tryConsume('bot1');
    expect(limiter.tryConsume('bot1')).toBe(false);

    limiter.reset('bot1');
    // After reset, full tokens available
    expect(limiter.tryConsume('bot1')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// BotManager
// ---------------------------------------------------------------------------

describe('BotManager', () => {
  let connector: ServerConnector;
  let manager: BotManager;

  beforeEach(() => {
    vi.useFakeTimers();
    connector = new ServerConnector([]);
    manager = new BotManager({ serverConnector: connector });
  });

  afterEach(async () => {
    await manager.shutdown();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  // ---- connectBot ---------------------------------------------------------

  describe('connectBot', () => {
    it('creates a bot and registers it in the registry', async () => {
      const { bot, emit } = createMockBot();
      mockedCreateBot.mockReturnValue(bot);

      const promise = manager.connectBot(LOCAL_PROFILE, 'builder');
      emit('spawn');
      const instance = await promise;

      expect(instance.id).toMatch(/^bot_/);
      expect(instance.role).toBe('builder');
      expect(instance.status).toBe('connected');
      expect(instance.connectionId).toBeTruthy();
    });

    it('appears in listBots after connection', async () => {
      const { bot, emit } = createMockBot();
      mockedCreateBot.mockReturnValue(bot);

      const promise = manager.connectBot(LOCAL_PROFILE, 'quarry');
      emit('spawn');
      await promise;

      const bots = manager.listBots();
      expect(bots).toHaveLength(1);
      expect(bots[0]!.role).toBe('quarry');
    });

    it('fires onBotChanged callback', async () => {
      const { bot, emit } = createMockBot();
      mockedCreateBot.mockReturnValue(bot);

      const changes: any[] = [];
      manager.onBotChanged = (b) => changes.push(b);

      const promise = manager.connectBot(LOCAL_PROFILE, 'builder');
      emit('spawn');
      await promise;

      expect(changes.length).toBeGreaterThanOrEqual(1);
      expect(changes[0].status).toBe('connected');
    });

    it('logs the connect action', async () => {
      const { bot, emit } = createMockBot();
      mockedCreateBot.mockReturnValue(bot);

      const logs: BotActionLogEntry[] = [];
      manager.onActionLog = (e) => logs.push(e);

      const promise = manager.connectBot(LOCAL_PROFILE, 'builder');
      emit('spawn');
      await promise;

      expect(logs.some((l) => l.action === 'connect' && l.success)).toBe(true);
    });

    it('supports credentials auth', async () => {
      const { bot, emit } = createMockBot();
      mockedCreateBot.mockReturnValue(bot);

      const profile: ConnectionProfile = {
        name: 'remote',
        host: 'mc.example.com',
        port: 25565,
        authMethod: 'credentials',
        credentials: { username: 'user', password: 'pass' },
      };

      const promise = manager.connectBot(profile, 'hauler');
      emit('spawn');
      const instance = await promise;

      expect(instance.status).toBe('connected');
    });

    it('supports microsoft auth', async () => {
      const { bot, emit } = createMockBot();
      mockedCreateBot.mockReturnValue(bot);

      const profile: ConnectionProfile = {
        name: 'ms',
        host: 'mc.example.com',
        port: 25565,
        authMethod: 'microsoft',
        msToken: 'token-123',
      };

      const promise = manager.connectBot(profile, 'guard');
      emit('spawn');
      const instance = await promise;

      expect(instance.status).toBe('connected');
    });
  });

  // ---- disconnectBot ------------------------------------------------------

  describe('disconnectBot', () => {
    it('disconnects and updates status', async () => {
      const { bot, emit } = createMockBot();
      mockedCreateBot.mockReturnValue(bot);

      const promise = manager.connectBot(LOCAL_PROFILE, 'builder');
      emit('spawn');
      const instance = await promise;

      await manager.disconnectBot(instance.id);

      const status = manager.getBotStatus(instance.id);
      expect(status?.connectionStatus).toBe('disconnected');
    });

    it('is safe to call with unknown botId', async () => {
      await expect(manager.disconnectBot('nonexistent')).resolves.toBeUndefined();
    });

    it('logs the disconnect action', async () => {
      const { bot, emit } = createMockBot();
      mockedCreateBot.mockReturnValue(bot);

      const logs: BotActionLogEntry[] = [];
      manager.onActionLog = (e) => logs.push(e);

      const promise = manager.connectBot(LOCAL_PROFILE, 'builder');
      emit('spawn');
      const instance = await promise;

      await manager.disconnectBot(instance.id);

      expect(logs.some((l) => l.action === 'disconnect' && l.success)).toBe(true);
    });
  });

  // ---- getBotStatus -------------------------------------------------------

  describe('getBotStatus', () => {
    it('returns status for a connected bot', async () => {
      const { bot, emit } = createMockBot();
      mockedCreateBot.mockReturnValue(bot);

      const promise = manager.connectBot(LOCAL_PROFILE, 'builder');
      emit('spawn');
      const instance = await promise;

      const status = manager.getBotStatus(instance.id);
      expect(status).toBeDefined();
      expect(status!.botId).toBe(instance.id);
      expect(status!.connectionStatus).toBe('connected');
      expect(status!.health).toBe(20);
    });

    it('returns undefined for unknown bot', () => {
      expect(manager.getBotStatus('nonexistent')).toBeUndefined();
    });

    it('reflects updated position and health', async () => {
      const { bot, emit } = createMockBot();
      mockedCreateBot.mockReturnValue(bot);

      const promise = manager.connectBot(LOCAL_PROFILE, 'builder');
      emit('spawn');
      const instance = await promise;

      manager.updatePosition(instance.id, { x: 10, y: 64, z: -5 });
      manager.updateHealth(instance.id, 15);

      const status = manager.getBotStatus(instance.id);
      expect(status!.position).toEqual({ x: 10, y: 64, z: -5 });
      expect(status!.health).toBe(15);
    });
  });

  // ---- Rate limiting ------------------------------------------------------

  describe('checkRateLimit', () => {
    it('allows actions within rate limit', async () => {
      const { bot, emit } = createMockBot();
      mockedCreateBot.mockReturnValue(bot);

      const promise = manager.connectBot(LOCAL_PROFILE, 'builder');
      emit('spawn');
      const instance = await promise;

      // Default: 10 tokens
      for (let i = 0; i < 10; i++) {
        expect(manager.checkRateLimit(instance.id)).toBe(true);
      }
    });

    it('blocks actions exceeding rate limit', async () => {
      const { bot, emit } = createMockBot();
      mockedCreateBot.mockReturnValue(bot);

      const promise = manager.connectBot(LOCAL_PROFILE, 'builder');
      emit('spawn');
      const instance = await promise;

      for (let i = 0; i < 10; i++) manager.checkRateLimit(instance.id);
      expect(manager.checkRateLimit(instance.id)).toBe(false);
    });
  });

  // ---- Reconnection with exponential backoff (req 2.5) --------------------

  describe('reconnection', () => {
    it('sets status to reconnecting on disconnect', async () => {
      const { bot, emit } = createMockBot();
      mockedCreateBot.mockReturnValue(bot);

      const promise = manager.connectBot(LOCAL_PROFILE, 'builder');
      emit('spawn');
      const instance = await promise;

      // Simulate disconnect
      emit('end', 'server closed');

      const status = manager.getBotStatus(instance.id);
      expect(status?.connectionStatus).toBe('reconnecting');
    });

    it('attempts reconnection after initial delay', async () => {
      const { bot: bot1, emit: emit1 } = createMockBot();
      mockedCreateBot.mockReturnValue(bot1);

      manager = new BotManager({
        serverConnector: connector,
        reconnectionConfig: {
          initialDelayMs: 1000,
          maxDelayMs: 30000,
          multiplier: 2,
          maxAttempts: 5,
        },
      });

      const promise = manager.connectBot(LOCAL_PROFILE, 'builder');
      emit1('spawn');
      const instance = await promise;

      // Prepare a new bot for reconnection — auto-spawn on creation
      const { bot: bot2 } = createMockBot();
      mockedCreateBot.mockImplementation((() => {
        // Schedule spawn on next microtask so the promise resolves
        setTimeout(() => (bot2 as any).emit('spawn'), 0);
        return bot2;
      }) as any);

      // Simulate disconnect
      emit1('end', 'server closed');

      // Advance past initial delay (1000ms) + the inner setTimeout(0)
      await vi.advanceTimersByTimeAsync(1100);
      await vi.advanceTimersByTimeAsync(10);

      const status = manager.getBotStatus(instance.id);
      expect(status?.connectionStatus).toBe('connected');
    });

    it('uses exponential backoff on repeated failures', async () => {
      const { bot: bot1, emit: emit1 } = createMockBot();
      mockedCreateBot.mockReturnValue(bot1);

      manager = new BotManager({
        serverConnector: connector,
        reconnectionConfig: {
          initialDelayMs: 1000,
          maxDelayMs: 30000,
          multiplier: 2,
          maxAttempts: 5,
        },
      });

      const logs: BotActionLogEntry[] = [];
      manager.onActionLog = (e) => logs.push(e);

      const promise = manager.connectBot(LOCAL_PROFILE, 'builder');
      emit1('spawn');
      await promise;

      // Make reconnection fail
      mockedCreateBot.mockImplementation(() => {
        throw new Error('connect ECONNREFUSED');
      });

      // Simulate disconnect
      emit1('end', 'server closed');

      // Attempt 1: delay 1000ms
      await vi.advanceTimersByTimeAsync(1100);
      // Attempt 2: delay 2000ms
      await vi.advanceTimersByTimeAsync(2100);
      // Attempt 3: delay 4000ms
      await vi.advanceTimersByTimeAsync(4100);

      const reconnectLogs = logs.filter((l) => l.action === 'reconnect');
      expect(reconnectLogs.length).toBeGreaterThanOrEqual(3);
      expect(reconnectLogs.every((l) => !l.success)).toBe(true);
    });

    it('gives up after maxAttempts', async () => {
      const { bot: bot1, emit: emit1 } = createMockBot();
      mockedCreateBot.mockReturnValue(bot1);

      manager = new BotManager({
        serverConnector: connector,
        reconnectionConfig: {
          initialDelayMs: 100,
          maxDelayMs: 1000,
          multiplier: 2,
          maxAttempts: 3,
        },
      });

      const promise = manager.connectBot(LOCAL_PROFILE, 'builder');
      emit1('spawn');
      const instance = await promise;

      // Make reconnection fail
      mockedCreateBot.mockImplementation(() => {
        throw new Error('connect ECONNREFUSED');
      });

      emit1('end', 'server closed');

      // Exhaust all attempts: 100ms, 200ms, 400ms
      await vi.advanceTimersByTimeAsync(150);
      await vi.advanceTimersByTimeAsync(250);
      await vi.advanceTimersByTimeAsync(450);

      const status = manager.getBotStatus(instance.id);
      expect(status?.connectionStatus).toBe('disconnected');
    });

    it('caps delay at maxDelayMs', async () => {
      const { bot: bot1, emit: emit1 } = createMockBot();
      mockedCreateBot.mockReturnValue(bot1);

      manager = new BotManager({
        serverConnector: connector,
        reconnectionConfig: {
          initialDelayMs: 1000,
          maxDelayMs: 5000,
          multiplier: 10,
          maxAttempts: 3,
        },
      });

      const logs: BotActionLogEntry[] = [];
      manager.onActionLog = (e) => logs.push(e);

      const promise = manager.connectBot(LOCAL_PROFILE, 'builder');
      emit1('spawn');
      await promise;

      mockedCreateBot.mockImplementation(() => {
        throw new Error('connect ECONNREFUSED');
      });

      emit1('end', 'server closed');

      // Attempt 1: delay = min(1000 * 10^0, 5000) = 1000ms
      await vi.advanceTimersByTimeAsync(1100);
      // Attempt 2: delay = min(1000 * 10^1, 5000) = 5000ms (capped)
      await vi.advanceTimersByTimeAsync(5100);

      const reconnectFails = logs.filter((l) => l.action === 'reconnect' && !l.success);
      expect(reconnectFails.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ---- getBot / listBots --------------------------------------------------

  describe('getBot', () => {
    it('returns the bot instance by id', async () => {
      const { bot, emit } = createMockBot();
      mockedCreateBot.mockReturnValue(bot);

      const promise = manager.connectBot(LOCAL_PROFILE, 'farmer');
      emit('spawn');
      const instance = await promise;

      expect(manager.getBot(instance.id)).toBeDefined();
      expect(manager.getBot(instance.id)!.role).toBe('farmer');
    });

    it('returns undefined for unknown id', () => {
      expect(manager.getBot('nope')).toBeUndefined();
    });
  });

  // ---- shutdown -----------------------------------------------------------

  describe('shutdown', () => {
    it('disconnects all bots', async () => {
      const { bot: b1, emit: e1 } = createMockBot();
      const { bot: b2, emit: e2 } = createMockBot();
      mockedCreateBot.mockReturnValueOnce(b1).mockReturnValueOnce(b2);

      const p1 = manager.connectBot(LOCAL_PROFILE, 'builder');
      e1('spawn');
      await p1;

      const p2 = manager.connectBot(LOCAL_PROFILE, 'quarry');
      e2('spawn');
      await p2;

      expect(manager.listBots()).toHaveLength(2);

      await manager.shutdown();

      const bots = manager.listBots();
      expect(bots.every((b) => b.status === 'disconnected')).toBe(true);
    });
  });
});
