import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebSocketClient } from '../websocket-client.js';
import type { ConnectionStatus } from '../websocket-client.js';
import type { WebSocketEvent } from '@pyramid-os/shared-types';

/**
 * Minimal mock WebSocket that simulates the native WebSocket API.
 * We store instances so tests can drive open/close/message events.
 */
let mockInstances: MockWebSocket[] = [];

class MockWebSocket {
  static readonly OPEN = 1;
  static readonly CLOSED = 3;

  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;

  readyState = MockWebSocket.OPEN;
  url: string;
  sentMessages: string[] = [];
  closeCalled = false;
  closeCode: number | undefined = undefined;
  closeReason: string | undefined = undefined;

  constructor(url: string) {
    this.url = url;
    mockInstances.push(this);
  }

  send(data: string) {
    this.sentMessages.push(data);
  }

  close(code?: number, reason?: string) {
    this.closeCalled = true;
    this.closeCode = code;
    this.closeReason = reason;
    this.readyState = MockWebSocket.CLOSED;
  }

  // Test helpers
  simulateOpen() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }

  simulateMessage(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }

  simulateClose() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }

  simulateError() {
    this.onerror?.();
  }
}

// Replace global WebSocket with mock
const originalWebSocket = globalThis.WebSocket;

beforeEach(() => {
  mockInstances = [];
  vi.useFakeTimers();
  (globalThis as any).WebSocket = MockWebSocket as any;
});

afterEach(() => {
  vi.useRealTimers();
  (globalThis as any).WebSocket = originalWebSocket;
});

function createClient(overrides?: Partial<Parameters<typeof WebSocketClient['prototype']['connect']> extends [] ? Record<string, unknown> : never>) {
  return new WebSocketClient({
    url: 'ws://localhost:3000/ws',
    apiKey: 'test-key',
    initialReconnectDelayMs: 1000,
    maxReconnectDelayMs: 30000,
    ...overrides,
  });
}

function lastMock(): MockWebSocket {
  const mock = mockInstances[mockInstances.length - 1];
  if (!mock) throw new Error('No mock WebSocket instances');
  return mock;
}

describe('WebSocketClient', () => {
  describe('connection', () => {
    it('should start in disconnected status', () => {
      const client = createClient();
      expect(client.status).toBe('disconnected');
    });

    it('should connect and transition to connected status on open', () => {
      const client = createClient();
      client.connect();
      expect(client.status).toBe('disconnected'); // not yet open
      lastMock().simulateOpen();
      expect(client.status).toBe('connected');
    });

    it('should include API key in connection URL', () => {
      const client = createClient();
      client.connect();
      expect(lastMock().url).toBe('ws://localhost:3000/ws?x-api-key=test-key');
    });

    it('should append API key with & if URL already has query params', () => {
      const client = new WebSocketClient({
        url: 'ws://localhost:3000/ws?foo=bar',
        apiKey: 'test-key',
      });
      client.connect();
      expect(lastMock().url).toBe('ws://localhost:3000/ws?foo=bar&x-api-key=test-key');
    });

    it('should disconnect and close the WebSocket', () => {
      const client = createClient();
      client.connect();
      lastMock().simulateOpen();
      client.disconnect();
      expect(client.status).toBe('disconnected');
      expect(lastMock().closeCalled).toBe(true);
      expect(lastMock().closeCode).toBe(1000);
    });

    it('should not reconnect after explicit disconnect', () => {
      const client = createClient();
      client.connect();
      lastMock().simulateOpen();
      client.disconnect();

      vi.advanceTimersByTime(60000);
      // No new connections should be created
      expect(mockInstances).toHaveLength(1);
    });

    it('should be a no-op to connect when already connected', () => {
      const client = createClient();
      client.connect();
      lastMock().simulateOpen();
      client.connect(); // no-op
      expect(mockInstances).toHaveLength(1);
    });
  });

  describe('reconnection with exponential backoff', () => {
    it('should transition to reconnecting on unexpected close', () => {
      const client = createClient();
      client.connect();
      lastMock().simulateOpen();
      lastMock().simulateClose();
      expect(client.status).toBe('reconnecting');
    });

    it('should reconnect after initial delay (1s)', () => {
      const client = createClient();
      client.connect();
      lastMock().simulateOpen();
      lastMock().simulateClose();

      expect(mockInstances).toHaveLength(1);
      vi.advanceTimersByTime(1000);
      expect(mockInstances).toHaveLength(2);
    });

    it('should use exponential backoff: 1s, 2s, 4s, 8s, 16s, 30s (capped)', () => {
      const client = createClient();
      client.connect();
      lastMock().simulateOpen();

      // First disconnect
      lastMock().simulateClose();
      expect(client.getReconnectDelay()).toBe(1000); // 1000 * 2^0

      vi.advanceTimersByTime(1000);
      // Second disconnect (attempt 1 now)
      lastMock().simulateClose();
      expect(client.getReconnectDelay()).toBe(2000); // 1000 * 2^1

      vi.advanceTimersByTime(2000);
      lastMock().simulateClose();
      expect(client.getReconnectDelay()).toBe(4000); // 1000 * 2^2

      vi.advanceTimersByTime(4000);
      lastMock().simulateClose();
      expect(client.getReconnectDelay()).toBe(8000); // 1000 * 2^3

      vi.advanceTimersByTime(8000);
      lastMock().simulateClose();
      expect(client.getReconnectDelay()).toBe(16000); // 1000 * 2^4

      vi.advanceTimersByTime(16000);
      lastMock().simulateClose();
      expect(client.getReconnectDelay()).toBe(30000); // capped at 30s
    });

    it('should reset reconnect attempts on successful connection', () => {
      const client = createClient();
      client.connect();
      lastMock().simulateOpen();
      lastMock().simulateClose();

      vi.advanceTimersByTime(1000);
      lastMock().simulateOpen(); // successful reconnect
      expect(client.currentReconnectAttempts).toBe(0);
    });

    it('should stop reconnecting after maxReconnectAttempts', () => {
      const client = new WebSocketClient({
        url: 'ws://localhost:3000/ws',
        apiKey: 'test-key',
        initialReconnectDelayMs: 100,
        maxReconnectAttempts: 2,
      });
      client.connect();
      lastMock().simulateOpen();

      // First disconnect → reconnect attempt 1
      lastMock().simulateClose();
      vi.advanceTimersByTime(100);
      expect(mockInstances).toHaveLength(2);

      // Second disconnect → reconnect attempt 2
      lastMock().simulateClose();
      vi.advanceTimersByTime(200);
      expect(mockInstances).toHaveLength(3);

      // Third disconnect → should NOT reconnect (max 2 attempts reached)
      lastMock().simulateClose();
      vi.advanceTimersByTime(10000);
      expect(mockInstances).toHaveLength(3);
      expect(client.status).toBe('disconnected');
    });
  });

  describe('event handling', () => {
    it('should dispatch agent:state events and update state', () => {
      const client = createClient();
      client.connect();
      lastMock().simulateOpen();

      const handler = vi.fn();
      client.on('agent:state', handler);

      const event: WebSocketEvent = { type: 'agent:state', agentId: 'agent-1', state: 'active' };
      lastMock().simulateMessage([event]); // server sends batched

      expect(handler).toHaveBeenCalledWith(event);
      expect(client.state.agents.get('agent-1')).toBe('active');
    });

    it('should dispatch task:complete events and update state', () => {
      const client = createClient();
      client.connect();
      lastMock().simulateOpen();

      const handler = vi.fn();
      client.on('task:complete', handler);

      const result = { taskId: 't-1', success: true, outcome: 'done', completedAt: '2024-01-01' };
      const event: WebSocketEvent = { type: 'task:complete', taskId: 't-1', result };
      lastMock().simulateMessage([event]);

      expect(handler).toHaveBeenCalledWith(event);
      expect(client.state.completedTasks).toHaveLength(1);
      expect(client.state.completedTasks[0]).toEqual(result);
    });

    it('should dispatch resource:update events and update state', () => {
      const client = createClient();
      client.connect();
      lastMock().simulateOpen();

      const event: WebSocketEvent = { type: 'resource:update', resourceType: 'sandstone', level: 500 };
      lastMock().simulateMessage([event]);

      expect(client.state.resources.get('sandstone')).toBe(500);
    });

    it('should dispatch bot:connect events and update state', () => {
      const client = createClient();
      client.connect();
      lastMock().simulateOpen();

      const event: WebSocketEvent = { type: 'bot:connect', botId: 'bot-1', server: 'mc.local' };
      lastMock().simulateMessage([event]);

      expect(client.state.bots.get('bot-1')).toEqual({ connected: true, server: 'mc.local' });
    });

    it('should dispatch bot:disconnect events and update state', () => {
      const client = createClient();
      client.connect();
      lastMock().simulateOpen();

      const connectEvent: WebSocketEvent = { type: 'bot:connect', botId: 'bot-1', server: 'mc.local' };
      const disconnectEvent: WebSocketEvent = { type: 'bot:disconnect', botId: 'bot-1', reason: 'timeout' };
      lastMock().simulateMessage([connectEvent, disconnectEvent]);

      expect(client.state.bots.get('bot-1')).toEqual({ connected: false, reason: 'timeout' });
    });

    it('should dispatch build:progress events and update state', () => {
      const client = createClient();
      client.connect();
      lastMock().simulateOpen();

      const event: WebSocketEvent = { type: 'build:progress', buildId: 'build-1', percent: 42 };
      lastMock().simulateMessage([event]);

      expect(client.state.builds.get('build-1')).toBe(42);
    });

    it('should dispatch alert events and update state', () => {
      const client = createClient();
      client.connect();
      lastMock().simulateOpen();

      const event: WebSocketEvent = { type: 'alert', severity: 'warning', message: 'Low sandstone' };
      lastMock().simulateMessage([event]);

      expect(client.state.alerts).toHaveLength(1);
      expect(client.state.alerts[0]!.severity).toBe('warning');
      expect(client.state.alerts[0]!.message).toBe('Low sandstone');
    });

    it('should dispatch ceremony:start events and update state', () => {
      const client = createClient();
      client.connect();
      lastMock().simulateOpen();

      const event: WebSocketEvent = { type: 'ceremony:start', ceremonyId: 'cer-1' };
      lastMock().simulateMessage([event]);

      expect(client.state.ceremonies.has('cer-1')).toBe(true);
    });

    it('should dispatch health:update events and update state', () => {
      const client = createClient();
      client.connect();
      lastMock().simulateOpen();

      const event: WebSocketEvent = { type: 'health:update', component: 'ollama', status: 'healthy' };
      lastMock().simulateMessage([event]);

      expect(client.state.health.get('ollama')).toBe('healthy');
    });

    it('should handle non-batched single events', () => {
      const client = createClient();
      client.connect();
      lastMock().simulateOpen();

      const event: WebSocketEvent = { type: 'agent:state', agentId: 'a-1', state: 'idle' };
      // Send as single object, not array
      lastMock().simulateMessage(event);

      expect(client.state.agents.get('a-1')).toBe('idle');
    });

    it('should ignore malformed messages', () => {
      const client = createClient();
      client.connect();
      lastMock().simulateOpen();

      // Simulate raw invalid JSON
      const mock = lastMock();
      if (mock.onmessage) mock.onmessage({ data: 'not-json{{{' });
      // Should not throw, state unchanged
      expect(client.state.agents.size).toBe(0);
    });

    it('should ignore events without a type field', () => {
      const client = createClient();
      client.connect();
      lastMock().simulateOpen();

      lastMock().simulateMessage([{ noType: true }]);
      expect(client.state.agents.size).toBe(0);
    });
  });

  describe('event handler management', () => {
    it('should support unsubscribing from events', () => {
      const client = createClient();
      client.connect();
      lastMock().simulateOpen();

      const handler = vi.fn();
      const unsub = client.on('agent:state', handler);

      const event: WebSocketEvent = { type: 'agent:state', agentId: 'a-1', state: 'active' };
      lastMock().simulateMessage([event]);
      expect(handler).toHaveBeenCalledTimes(1);

      unsub();
      lastMock().simulateMessage([event]);
      expect(handler).toHaveBeenCalledTimes(1); // not called again
    });

    it('should support multiple handlers for the same event type', () => {
      const client = createClient();
      client.connect();
      lastMock().simulateOpen();

      const handler1 = vi.fn();
      const handler2 = vi.fn();
      client.on('alert', handler1);
      client.on('alert', handler2);

      const event: WebSocketEvent = { type: 'alert', severity: 'info', message: 'test' };
      lastMock().simulateMessage([event]);

      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).toHaveBeenCalledTimes(1);
    });

    it('should not break if a handler throws', () => {
      const client = createClient();
      client.connect();
      lastMock().simulateOpen();

      const badHandler = vi.fn(() => { throw new Error('oops'); });
      const goodHandler = vi.fn();
      client.on('alert', badHandler);
      client.on('alert', goodHandler);

      const event: WebSocketEvent = { type: 'alert', severity: 'error', message: 'test' };
      lastMock().simulateMessage([event]);

      expect(badHandler).toHaveBeenCalled();
      expect(goodHandler).toHaveBeenCalled();
    });
  });

  describe('status change listeners', () => {
    it('should notify listeners on status changes', () => {
      const client = createClient();
      const statuses: ConnectionStatus[] = [];
      client.onStatusChange((s) => statuses.push(s));

      client.connect();
      lastMock().simulateOpen();
      expect(statuses).toEqual(['connected']);

      lastMock().simulateClose();
      expect(statuses).toEqual(['connected', 'reconnecting']);

      client.disconnect();
      expect(statuses).toEqual(['connected', 'reconnecting', 'disconnected']);
    });

    it('should support unsubscribing from status changes', () => {
      const client = createClient();
      const listener = vi.fn();
      const unsub = client.onStatusChange(listener);

      client.connect();
      lastMock().simulateOpen();
      expect(listener).toHaveBeenCalledTimes(1);

      unsub();
      client.disconnect();
      expect(listener).toHaveBeenCalledTimes(1); // not called again
    });

    it('should not break if a status listener throws', () => {
      const client = createClient();
      const badListener = vi.fn(() => { throw new Error('oops'); });
      const goodListener = vi.fn();
      client.onStatusChange(badListener);
      client.onStatusChange(goodListener);

      client.connect();
      lastMock().simulateOpen();

      expect(badListener).toHaveBeenCalled();
      expect(goodListener).toHaveBeenCalled();
    });
  });
});
