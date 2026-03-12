import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  ServerConnector,
  ConnectionNetworkError,
  ConnectionAuthError,
  ConnectionServerError,
} from '../server-connector.js';

// ---------------------------------------------------------------------------
// Mock mineflayer
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

vi.mock('mineflayer', () => ({
  createBot: vi.fn(),
}));

// Suppress logger output during tests
vi.mock('@pyramid-os/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { createBot } from 'mineflayer';
const mockedCreateBot = vi.mocked(createBot);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ServerConnector', () => {
  let connector: ServerConnector;

  beforeEach(() => {
    vi.useFakeTimers();
    connector = new ServerConnector([
      { name: 'local', host: 'localhost', port: 25565, authMethod: 'none' },
      {
        name: 'remote',
        host: 'mc.example.com',
        port: 25565,
        authMethod: 'credentials',
        credentials: { username: 'user', password: 'pass' },
      },
    ]);
  });

  afterEach(async () => {
    await connector.disconnectAll();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  // ---- connectLocal -------------------------------------------------------

  describe('connectLocal', () => {
    it('creates a bot with offline auth and returns a Connection', async () => {
      const { bot, emit } = createMockBot();
      mockedCreateBot.mockReturnValue(bot);

      const promise = connector.connectLocal('localhost', 25565);
      // Simulate spawn
      emit('spawn');
      const conn = await promise;

      expect(conn.host).toBe('localhost');
      expect(conn.port).toBe(25565);
      expect(conn.status).toBe('connected');
      expect(conn.id).toBeTruthy();
      expect(mockedCreateBot).toHaveBeenCalledWith(
        expect.objectContaining({
          host: 'localhost',
          port: 25565,
          auth: 'offline',
        }),
      );
    });

    it('generates unique PyramidBot_N usernames', async () => {
      const { bot: bot1, emit: emit1 } = createMockBot();
      const { bot: bot2, emit: emit2 } = createMockBot();
      mockedCreateBot.mockReturnValueOnce(bot1).mockReturnValueOnce(bot2);

      const p1 = connector.connectLocal('localhost', 25565);
      emit1('spawn');
      await p1;

      const p2 = connector.connectLocal('localhost', 25566);
      emit2('spawn');
      await p2;

      const calls = mockedCreateBot.mock.calls;
      const u1 = (calls[0]![0] as any).username;
      const u2 = (calls[1]![0] as any).username;
      expect(u1).toMatch(/^PyramidBot_\d+$/);
      expect(u2).toMatch(/^PyramidBot_\d+$/);
      expect(u1).not.toBe(u2);
    });
  });

  // ---- connectWithCredentials ---------------------------------------------

  describe('connectWithCredentials', () => {
    it('creates a bot with mojang auth', async () => {
      const { bot, emit } = createMockBot();
      mockedCreateBot.mockReturnValue(bot);

      const promise = connector.connectWithCredentials('mc.example.com', 25565, 'user', 'pass');
      emit('spawn');
      const conn = await promise;

      expect(conn.status).toBe('connected');
      expect(mockedCreateBot).toHaveBeenCalledWith(
        expect.objectContaining({
          host: 'mc.example.com',
          port: 25565,
          username: 'user',
          password: 'pass',
          auth: 'mojang',
        }),
      );
    });

    it('rejects with ConnectionAuthError on auth failure', async () => {
      const { bot, emit } = createMockBot();
      mockedCreateBot.mockReturnValue(bot);

      const promise = connector.connectWithCredentials('mc.example.com', 25565, 'bad', 'creds');
      emit('error', new Error('Invalid credentials: authentication failed'));

      await expect(promise).rejects.toThrow(ConnectionAuthError);
    });
  });

  // ---- connectMicrosoft ---------------------------------------------------

  describe('connectMicrosoft', () => {
    it('creates a bot with microsoft auth', async () => {
      const { bot, emit } = createMockBot();
      mockedCreateBot.mockReturnValue(bot);

      const promise = connector.connectMicrosoft('mc.example.com', 25565, 'ms-token-123');
      emit('spawn');
      const conn = await promise;

      expect(conn.status).toBe('connected');
      expect(mockedCreateBot).toHaveBeenCalledWith(
        expect.objectContaining({
          host: 'mc.example.com',
          port: 25565,
          auth: 'microsoft',
        }),
      );
    });
  });

  // ---- Error classification -----------------------------------------------

  describe('error classification', () => {
    it('classifies ECONNREFUSED as ConnectionNetworkError', async () => {
      const { bot, emit } = createMockBot();
      mockedCreateBot.mockReturnValue(bot);

      const promise = connector.connectLocal('localhost', 25565);
      emit('error', new Error('connect ECONNREFUSED 127.0.0.1:25565'));

      await expect(promise).rejects.toThrow(ConnectionNetworkError);
    });

    it('classifies ENOTFOUND as ConnectionNetworkError', async () => {
      const { bot, emit } = createMockBot();
      mockedCreateBot.mockReturnValue(bot);

      const promise = connector.connectLocal('nonexistent.host', 25565);
      emit('error', new Error('getaddrinfo ENOTFOUND nonexistent.host'));

      await expect(promise).rejects.toThrow(ConnectionNetworkError);
    });

    it('classifies auth errors as ConnectionAuthError', async () => {
      const { bot, emit } = createMockBot();
      mockedCreateBot.mockReturnValue(bot);

      const promise = connector.connectWithCredentials('mc.example.com', 25565, 'u', 'p');
      emit('error', new Error('Invalid session token'));

      await expect(promise).rejects.toThrow(ConnectionAuthError);
    });

    it('classifies version errors as ConnectionServerError', async () => {
      const { bot, emit } = createMockBot();
      mockedCreateBot.mockReturnValue(bot);

      const promise = connector.connectLocal('localhost', 25565);
      emit('error', new Error('Outdated server! Running version 1.8'));

      await expect(promise).rejects.toThrow(ConnectionServerError);
    });

    it('classifies kick as ConnectionServerError', async () => {
      const { bot, emit } = createMockBot();
      mockedCreateBot.mockReturnValue(bot);

      const promise = connector.connectLocal('localhost', 25565);
      emit('kicked', 'You are not whitelisted on this server!');

      await expect(promise).rejects.toThrow(ConnectionServerError);
    });

    it('times out after 30 seconds with ConnectionNetworkError', async () => {
      const { bot } = createMockBot();
      mockedCreateBot.mockReturnValue(bot);

      const promise = connector.connectLocal('slow.host', 25565);
      vi.advanceTimersByTime(30_001);

      await expect(promise).rejects.toThrow(ConnectionNetworkError);
      await expect(promise).rejects.toThrow(/timed out/);
    });
  });

  // ---- validateServer -----------------------------------------------------

  describe('validateServer', () => {
    it('returns compatible for supported versions', async () => {
      const { bot, emit } = createMockBot({ game: { version: '1.20.4' } });
      mockedCreateBot.mockReturnValue(bot);

      const p = connector.connectLocal('localhost', 25565);
      emit('spawn');
      const conn = await p;

      const result = await connector.validateServer(conn);
      expect(result.compatible).toBe(true);
      expect(result.serverVersion).toBe('1.20.4');
      expect(result.issues).toHaveLength(0);
    });

    it('returns incompatible for unsupported versions', async () => {
      const { bot, emit } = createMockBot({ game: { version: '1.8.9' } });
      mockedCreateBot.mockReturnValue(bot);

      const p = connector.connectLocal('localhost', 25565);
      emit('spawn');
      const conn = await p;

      const result = await connector.validateServer(conn);
      expect(result.compatible).toBe(false);
      expect(result.issues.length).toBeGreaterThan(0);
      expect(result.issues[0]).toContain('1.8.9');
    });

    it('returns incompatible for unknown connection', async () => {
      const result = await connector.validateServer({
        id: 'nonexistent',
        host: 'x',
        port: 0,
        connectedAt: '',
        status: 'connected',
      });
      expect(result.compatible).toBe(false);
      expect(result.issues).toContain('Connection not found');
    });
  });

  // ---- onDisconnect -------------------------------------------------------

  describe('onDisconnect', () => {
    it('fires callback when bot disconnects', async () => {
      const { bot, emit } = createMockBot();
      mockedCreateBot.mockReturnValue(bot);

      const p = connector.connectLocal('localhost', 25565);
      emit('spawn');
      const conn = await p;

      const cb = vi.fn();
      connector.onDisconnect(conn.id, cb);

      emit('end', 'server closed');
      expect(cb).toHaveBeenCalledWith('server closed');
    });

    it('updates connection status to disconnected', async () => {
      const { bot, emit } = createMockBot();
      mockedCreateBot.mockReturnValue(bot);

      const p = connector.connectLocal('localhost', 25565);
      emit('spawn');
      const conn = await p;

      emit('end', 'timeout');
      expect(conn.status).toBe('disconnected');
    });

    it('throws for unknown connection id', () => {
      expect(() => connector.onDisconnect('bad_id', () => {})).toThrow(ConnectionNetworkError);
    });
  });

  // ---- getHealth ----------------------------------------------------------

  describe('getHealth', () => {
    it('returns health for active connection', async () => {
      const { bot, emit } = createMockBot();
      mockedCreateBot.mockReturnValue(bot);

      const p = connector.connectLocal('localhost', 25565);
      emit('spawn');
      const conn = await p;

      const health = connector.getHealth(conn.id);
      expect(health.connectionId).toBe(conn.id);
      expect(health.stable).toBe(true);
      expect(health.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('returns unstable health for unknown connection', () => {
      const health = connector.getHealth('nonexistent');
      expect(health.stable).toBe(false);
      expect(health.latencyMs).toBe(-1);
      expect(health.packetLoss).toBe(1);
    });
  });

  // ---- getProfiles --------------------------------------------------------

  describe('getProfiles', () => {
    it('returns stored connection profiles', () => {
      const profiles = connector.getProfiles();
      expect(profiles).toHaveLength(2);
      expect(profiles[0]!.name).toBe('local');
      expect(profiles[1]!.name).toBe('remote');
    });

    it('returns a copy (not the internal array)', () => {
      const profiles = connector.getProfiles();
      profiles.pop();
      expect(connector.getProfiles()).toHaveLength(2);
    });
  });

  // ---- disconnect ---------------------------------------------------------

  describe('disconnect', () => {
    it('calls bot.quit and removes the connection', async () => {
      const { bot, emit } = createMockBot();
      mockedCreateBot.mockReturnValue(bot);

      const p = connector.connectLocal('localhost', 25565);
      emit('spawn');
      const conn = await p;

      await connector.disconnect(conn.id);
      expect(bot.quit).toHaveBeenCalled();

      const health = connector.getHealth(conn.id);
      expect(health.stable).toBe(false);
    });

    it('is safe to call with unknown id', async () => {
      await expect(connector.disconnect('nope')).resolves.toBeUndefined();
    });
  });
});
