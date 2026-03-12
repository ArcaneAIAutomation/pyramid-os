import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { WebSocketEvent } from '@pyramid-os/shared-types';
import WebSocket from 'ws';
import { createServer } from '../server.js';
import { WebSocketServer } from '../websocket.js';

const API_KEY = 'ws-test-key-123';

/**
 * Minimal WebSocket-like stub for unit testing the WebSocketServer
 * without needing a real HTTP connection.
 */
class FakeSocket {
  readyState = 1; // OPEN
  sent: string[] = [];
  closed = false;
  closeCode: number | undefined = undefined;
  closeReason: string | undefined = undefined;
  private listeners = new Map<string, ((...args: any[]) => void)[]>();

  send(data: string): void {
    if (this.readyState !== 1) throw new Error('Socket not open');
    this.sent.push(data);
  }

  close(code?: number, reason?: string): void {
    this.closed = true;
    this.closeCode = code;
    this.closeReason = reason;
    this.readyState = 3; // CLOSED
    this.emit('close');
  }

  on(event: string, fn: (...args: any[]) => void): void {
    const list = this.listeners.get(event) ?? [];
    list.push(fn);
    this.listeners.set(event, list);
  }

  emit(event: string, ...args: any[]): void {
    for (const fn of this.listeners.get(event) ?? []) {
      fn(...args);
    }
  }
}

/**
 * Helper to access private members for testing.
 * We cast to `any` to reach internal state.
 */
function getInternals(ws: WebSocketServer) {
  return ws as any;
}

describe('WebSocketServer', () => {
  let wsServer: WebSocketServer;

  beforeEach(() => {
    vi.useFakeTimers();
    wsServer = new WebSocketServer(API_KEY);
  });

  afterEach(() => {
    wsServer.close();
    vi.useRealTimers();
  });

  // ── Client management ─────────────────────────────────────────────

  describe('client management', () => {
    it('starts with zero clients', () => {
      expect(wsServer.getClientCount()).toBe(0);
      expect(wsServer.getClientIds()).toEqual([]);
    });

    it('tracks added clients', () => {
      const socket = new FakeSocket();
      const id = getInternals(wsServer).addClient(socket);

      expect(wsServer.getClientCount()).toBe(1);
      expect(wsServer.getClientIds()).toContain(id);
    });

    it('supports multiple concurrent clients', () => {
      const s1 = new FakeSocket();
      const s2 = new FakeSocket();
      const s3 = new FakeSocket();

      getInternals(wsServer).addClient(s1);
      getInternals(wsServer).addClient(s2);
      getInternals(wsServer).addClient(s3);

      expect(wsServer.getClientCount()).toBe(3);
    });

    it('removes clients on close', () => {
      const socket = new FakeSocket();
      const id = getInternals(wsServer).addClient(socket);

      getInternals(wsServer).removeClient(id);
      expect(wsServer.getClientCount()).toBe(0);
    });
  });

  // ── Broadcasting ──────────────────────────────────────────────────

  describe('broadcast', () => {
    it('buffers events for all connected clients', () => {
      const s1 = new FakeSocket();
      const s2 = new FakeSocket();
      getInternals(wsServer).addClient(s1);
      getInternals(wsServer).addClient(s2);

      const event: WebSocketEvent = {
        type: 'agent:state',
        agentId: 'pharaoh-1',
        state: 'active',
      };

      wsServer.broadcast(event);

      // Events are buffered, not sent immediately
      expect(s1.sent).toHaveLength(0);
      expect(s2.sent).toHaveLength(0);
    });

    it('delivers broadcast events to all clients after flush', () => {
      const s1 = new FakeSocket();
      const s2 = new FakeSocket();
      getInternals(wsServer).addClient(s1);
      getInternals(wsServer).addClient(s2);

      const event: WebSocketEvent = {
        type: 'task:complete',
        taskId: 'task-42',
        result: { taskId: 'task-42', success: true, outcome: 'completed', completedAt: new Date().toISOString() },
      };

      wsServer.broadcast(event);
      getInternals(wsServer).flushAll();

      expect(s1.sent).toHaveLength(1);
      expect(s2.sent).toHaveLength(1);

      const batch1 = JSON.parse(s1.sent[0]!);
      const batch2 = JSON.parse(s2.sent[0]!);
      expect(batch1).toEqual([event]);
      expect(batch2).toEqual([event]);
    });

    it('handles all WebSocketEvent types', () => {
      const socket = new FakeSocket();
      getInternals(wsServer).addClient(socket);

      const events: WebSocketEvent[] = [
        { type: 'agent:state', agentId: 'a1', state: 'active' },
        { type: 'task:complete', taskId: 't1', result: { taskId: 't1', success: true, outcome: 'done', completedAt: '' } },
        { type: 'resource:update', resourceType: 'sandstone', level: 500 },
        { type: 'bot:connect', botId: 'b1', server: 'localhost' },
        { type: 'bot:disconnect', botId: 'b1', reason: 'timeout' },
        { type: 'build:progress', buildId: 'bp1', percent: 42 },
        { type: 'alert', severity: 'warning', message: 'Low resources' },
        { type: 'ceremony:start', ceremonyId: 'c1' },
        { type: 'health:update', component: 'ollama', status: 'healthy' },
      ];

      for (const e of events) {
        wsServer.broadcast(e);
      }

      getInternals(wsServer).flushAll();

      expect(socket.sent).toHaveLength(1);
      const batch = JSON.parse(socket.sent[0]!);
      expect(batch).toHaveLength(9);
      expect(batch).toEqual(events);
    });
  });

  // ── Targeted send ─────────────────────────────────────────────────

  describe('send', () => {
    it('buffers event only for the targeted client', () => {
      const s1 = new FakeSocket();
      const s2 = new FakeSocket();
      const id1 = getInternals(wsServer).addClient(s1);
      getInternals(wsServer).addClient(s2);

      const event: WebSocketEvent = {
        type: 'resource:update',
        resourceType: 'gold_block',
        level: 100,
      };

      wsServer.send(id1, event);
      getInternals(wsServer).flushAll();

      expect(s1.sent).toHaveLength(1);
      expect(s2.sent).toHaveLength(0);

      const batch = JSON.parse(s1.sent[0]!);
      expect(batch).toEqual([event]);
    });

    it('silently ignores sends to unknown client IDs', () => {
      wsServer.send('nonexistent-client', {
        type: 'alert',
        severity: 'info',
        message: 'test',
      });

      // No error thrown
      expect(wsServer.getClientCount()).toBe(0);
    });
  });

  // ── Event batching ────────────────────────────────────────────────

  describe('event batching', () => {
    it('batches multiple events into a single message per 100ms window', () => {
      const socket = new FakeSocket();
      getInternals(wsServer).addClient(socket);
      getInternals(wsServer).startBatchTimer();

      wsServer.broadcast({ type: 'agent:state', agentId: 'a1', state: 'active' });
      wsServer.broadcast({ type: 'agent:state', agentId: 'a2', state: 'idle' });
      wsServer.broadcast({ type: 'resource:update', resourceType: 'stone', level: 200 });

      // Nothing sent yet
      expect(socket.sent).toHaveLength(0);

      // Advance timer by 100ms to trigger flush
      vi.advanceTimersByTime(100);

      expect(socket.sent).toHaveLength(1);
      const batch = JSON.parse(socket.sent[0]!);
      expect(batch).toHaveLength(3);
    });

    it('sends nothing when buffer is empty', () => {
      const socket = new FakeSocket();
      getInternals(wsServer).addClient(socket);
      getInternals(wsServer).startBatchTimer();

      vi.advanceTimersByTime(100);

      expect(socket.sent).toHaveLength(0);
    });

    it('sends separate batches for each 100ms window', () => {
      const socket = new FakeSocket();
      getInternals(wsServer).addClient(socket);
      getInternals(wsServer).startBatchTimer();

      wsServer.broadcast({ type: 'agent:state', agentId: 'a1', state: 'active' });
      vi.advanceTimersByTime(100);

      wsServer.broadcast({ type: 'agent:state', agentId: 'a2', state: 'idle' });
      vi.advanceTimersByTime(100);

      expect(socket.sent).toHaveLength(2);
      expect(JSON.parse(socket.sent[0]!)).toHaveLength(1);
      expect(JSON.parse(socket.sent[1]!)).toHaveLength(1);
    });
  });

  // ── Closed / errored sockets ──────────────────────────────────────

  describe('error handling', () => {
    it('skips sending to sockets that are not OPEN', () => {
      const socket = new FakeSocket();
      getInternals(wsServer).addClient(socket);

      socket.readyState = 3; // CLOSED

      wsServer.broadcast({ type: 'alert', severity: 'error', message: 'test' });
      getInternals(wsServer).flushAll();

      expect(socket.sent).toHaveLength(0);
    });

    it('does not throw when send() fails on a socket', () => {
      const socket = new FakeSocket();
      socket.send = () => {
        throw new Error('broken pipe');
      };
      getInternals(wsServer).addClient(socket);

      wsServer.broadcast({ type: 'alert', severity: 'info', message: 'test' });

      // Should not throw
      expect(() => getInternals(wsServer).flushAll()).not.toThrow();
    });
  });

  // ── close() ───────────────────────────────────────────────────────

  describe('close', () => {
    it('closes all client sockets and clears the client map', () => {
      const s1 = new FakeSocket();
      const s2 = new FakeSocket();
      getInternals(wsServer).addClient(s1);
      getInternals(wsServer).addClient(s2);

      wsServer.close();

      expect(wsServer.getClientCount()).toBe(0);
      expect(s1.closed).toBe(true);
      expect(s2.closed).toBe(true);
    });
  });

  // ── Fastify integration ───────────────────────────────────────────

  describe('registerWithFastify', () => {
    let server: FastifyInstance;

    beforeEach(async () => {
      vi.useRealTimers();
      server = await createServer({ port: 0, apiKey: API_KEY });
    });

    afterEach(async () => {
      wsServer.close();
      await server.close();
    });

    it('registers the /ws route on the Fastify instance', async () => {
      await wsServer.registerWithFastify(server);
      await server.ready();

      const routes = server.printRoutes();
      expect(routes).toContain('ws');
    });

    it('rejects WebSocket connections without valid API key', async () => {
      await wsServer.registerWithFastify(server);
      await server.listen({ port: 0 });
      const port = (server.server.address() as any).port;

      const ws = new WebSocket(
        `ws://127.0.0.1:${port}/ws?x-api-key=wrong-key`,
      );

      const closePromise = new Promise<{ code: number; reason: string }>((resolve) => {
        ws.on('close', (code: number, reason: Buffer) => {
          resolve({ code, reason: reason.toString() });
        });
        ws.on('error', () => {
          // Swallow connection errors — we listen for close
        });
      });

      const result = await closePromise;
      expect(result.code).toBe(4401);
      expect(result.reason).toBe('Unauthorized');
    });

    it('accepts WebSocket connections with valid API key and broadcasts events', async () => {
      await wsServer.registerWithFastify(server);
      await server.listen({ port: 0 });
      const port = (server.server.address() as any).port;

      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?x-api-key=${API_KEY}`);

      // Wait for connection to open
      await new Promise<void>((resolve) => ws.on('open', resolve));

      expect(wsServer.getClientCount()).toBe(1);

      // Broadcast an event
      const event: WebSocketEvent = {
        type: 'build:progress',
        buildId: 'pyramid-1',
        percent: 75,
      };
      wsServer.broadcast(event);

      // Wait for the batch interval to flush
      const messagePromise = new Promise<any>((resolve) => {
        ws.on('message', (data: Buffer) => {
          resolve(JSON.parse(data.toString()));
        });
      });

      // The batch timer is running with real timers, wait for flush
      const batch = await messagePromise;
      expect(batch).toEqual([event]);

      ws.close();
      // Give time for close event to propagate
      await new Promise((r) => setTimeout(r, 50));
    });

    it('supports multiple concurrent connections', async () => {
      await wsServer.registerWithFastify(server);
      await server.listen({ port: 0 });
      const port = (server.server.address() as any).port;

      const ws1 = new WebSocket(`ws://127.0.0.1:${port}/ws?x-api-key=${API_KEY}`);
      const ws2 = new WebSocket(`ws://127.0.0.1:${port}/ws?x-api-key=${API_KEY}`);

      await Promise.all([
        new Promise<void>((resolve) => ws1.on('open', resolve)),
        new Promise<void>((resolve) => ws2.on('open', resolve)),
      ]);

      expect(wsServer.getClientCount()).toBe(2);

      ws1.close();
      ws2.close();
      await new Promise((r) => setTimeout(r, 50));
    });
  });
});
