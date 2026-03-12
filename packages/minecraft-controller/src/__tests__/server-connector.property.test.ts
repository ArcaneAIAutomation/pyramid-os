/**
 * Property-based test for connection error classification.
 *
 * Property 16: Connection error classification
 * For any connection failure, the error category should correctly distinguish
 * between network errors (PYRAMID_CONNECTION_NETWORK), authentication errors
 * (PYRAMID_CONNECTION_AUTH), and server errors (PYRAMID_CONNECTION_SERVER).
 *
 * **Validates: Requirements 38.5**
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import {
  ServerConnector,
  ConnectionNetworkError,
  ConnectionAuthError,
  ConnectionServerError,
} from '../server-connector.js';

// ---------------------------------------------------------------------------
// Mock mineflayer
// ---------------------------------------------------------------------------

function createMockBot() {
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
  };
  return { bot, emit: (e: string, ...a: any[]) => bot.emit(e, ...a) };
}

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
const mockedCreateBot = vi.mocked(createBot);

// ---------------------------------------------------------------------------
// Keyword sets matching the classifyError implementation
// ---------------------------------------------------------------------------

const NETWORK_KEYWORDS = [
  'econnrefused',
  'enotfound',
  'etimedout',
  'enetunreach',
  'ehostunreach',
  'econnreset',
  'socket',
] as const;

const AUTH_KEYWORDS = [
  'auth',
  'login',
  'credentials',
  'token',
  'invalid session',
  'password',
] as const;

const SERVER_KEYWORDS = [
  'version',
  'outdated',
  'incompatible',
  'kicked',
  'banned',
  'whitelist',
] as const;

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** Random filler text that does NOT contain any classification keyword. */
const neutralFillerArb = fc.stringOf(
  fc.constantFrom(...'abcdfghjlmnopqruvwxyz0123456789 _-'.split('')),
  { minLength: 0, maxLength: 30 },
);

/** Build an error message embedding a keyword from the given set. */
function errorMessageWithKeyword(keywords: readonly string[]): fc.Arbitrary<string> {
  return fc
    .tuple(
      neutralFillerArb,
      fc.constantFrom(...keywords),
      neutralFillerArb,
    )
    .map(([prefix, keyword, suffix]) => `${prefix} ${keyword} ${suffix}`.trim());
}

const networkErrorMsgArb = errorMessageWithKeyword(NETWORK_KEYWORDS);
const authErrorMsgArb = errorMessageWithKeyword(AUTH_KEYWORDS);
const serverErrorMsgArb = errorMessageWithKeyword(SERVER_KEYWORDS);

const hostArb = fc.constantFrom('localhost', '192.168.1.1', 'mc.example.com');
const portArb = fc.integer({ min: 1024, max: 65535 });

// ---------------------------------------------------------------------------
// Property tests
// ---------------------------------------------------------------------------

describe('Connection error classification property', () => {
  let connector: ServerConnector;

  beforeEach(() => {
    vi.useFakeTimers();
    connector = new ServerConnector([]);
  });

  afterEach(async () => {
    await connector.disconnectAll();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('classifies errors with network keywords as ConnectionNetworkError', async () => {
    await fc.assert(
      fc.asyncProperty(
        networkErrorMsgArb,
        hostArb,
        portArb,
        async (errorMsg, host, port) => {
          const { bot, emit } = createMockBot();
          mockedCreateBot.mockReturnValue(bot);

          const promise = connector.connectLocal(host, port);
          emit('error', new Error(errorMsg));

          const err = await promise.catch((e: unknown) => e);
          expect(err).toBeInstanceOf(ConnectionNetworkError);
          expect((err as ConnectionNetworkError).code).toBe('NETWORK_ERROR');
          expect((err as ConnectionNetworkError).pyramidError?.code).toBe(
            'PYRAMID_CONNECTION_NETWORK',
          );
        },
      ),
      { numRuns: 100 },
    );
  });

  it('classifies errors with auth keywords as ConnectionAuthError', async () => {
    await fc.assert(
      fc.asyncProperty(
        authErrorMsgArb,
        hostArb,
        portArb,
        async (errorMsg, host, port) => {
          const { bot, emit } = createMockBot();
          mockedCreateBot.mockReturnValue(bot);

          const promise = connector.connectLocal(host, port);
          emit('error', new Error(errorMsg));

          const err = await promise.catch((e: unknown) => e);
          expect(err).toBeInstanceOf(ConnectionAuthError);
          expect((err as ConnectionAuthError).code).toBe('AUTH_ERROR');
          expect((err as ConnectionAuthError).pyramidError?.code).toBe(
            'PYRAMID_CONNECTION_AUTH',
          );
        },
      ),
      { numRuns: 100 },
    );
  });

  it('classifies errors with server keywords as ConnectionServerError', async () => {
    await fc.assert(
      fc.asyncProperty(
        serverErrorMsgArb,
        hostArb,
        portArb,
        async (errorMsg, host, port) => {
          const { bot, emit } = createMockBot();
          mockedCreateBot.mockReturnValue(bot);

          const promise = connector.connectLocal(host, port);
          emit('error', new Error(errorMsg));

          const err = await promise.catch((e: unknown) => e);
          expect(err).toBeInstanceOf(ConnectionServerError);
          expect((err as ConnectionServerError).code).toBe('SERVER_ERROR');
          expect((err as ConnectionServerError).pyramidError?.code).toBe(
            'PYRAMID_CONNECTION_SERVER',
          );
        },
      ),
      { numRuns: 100 },
    );
  });
});
