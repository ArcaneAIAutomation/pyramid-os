/**
 * Unit tests for MessageBusImpl
 *
 * Validates: Requirements 1.7, 24.1, 24.2, 24.3, 24.4, 24.5, 24.6, 24.7, 24.8, 24.9, 24.10
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageBusImpl } from '../message-bus.js';
import type { TierResolver } from '../message-bus.js';
import type { AgentTier, AgentMessage } from '@pyramid-os/shared-types';
import type { Logger } from '@pyramid-os/logger';

function createMockLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function makeMessage(overrides: Partial<AgentMessage> = {}): AgentMessage {
  return {
    id: 'msg-1',
    from: 'pharaoh-1',
    to: 'scribe-1',
    content: 'test message',
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

describe('MessageBusImpl', () => {
  let logger: Logger;
  let messageLoggerSpy: ReturnType<typeof vi.fn>;
  let bus: MessageBusImpl;

  // Default tier resolver: known agents
  const tiers: Record<string, AgentTier> = {
    'pharaoh-1': 'planner',
    'vizier-1': 'planner',
    'scribe-1': 'operational',
    'foreman-1': 'operational',
    'builder-1': 'worker',
    'quarry-1': 'worker',
  };
  const resolveTier: TierResolver = (id) => tiers[id];

  beforeEach(() => {
    logger = createMockLogger();
    messageLoggerSpy = vi.fn();
    bus = new MessageBusImpl(resolveTier, logger, messageLoggerSpy);
  });

  // -----------------------------------------------------------------------
  // Hierarchy enforcement (Req 24.4)
  // -----------------------------------------------------------------------
  describe('hierarchy enforcement', () => {
    it('allows Planner → Operational', async () => {
      const handler = vi.fn();
      bus.subscribe('scribe-1', handler);
      await expect(bus.send(makeMessage({ from: 'pharaoh-1', to: 'scribe-1' }))).resolves.toBeUndefined();
      expect(handler).toHaveBeenCalledOnce();
    });

    it('allows Planner → Worker', async () => {
      const handler = vi.fn();
      bus.subscribe('builder-1', handler);
      await expect(bus.send(makeMessage({ from: 'pharaoh-1', to: 'builder-1' }))).resolves.toBeUndefined();
      expect(handler).toHaveBeenCalledOnce();
    });

    it('allows Operational → Worker', async () => {
      const handler = vi.fn();
      bus.subscribe('builder-1', handler);
      await expect(bus.send(makeMessage({ from: 'scribe-1', to: 'builder-1' }))).resolves.toBeUndefined();
      expect(handler).toHaveBeenCalledOnce();
    });

    it('allows Operational → Planner (response)', async () => {
      const handler = vi.fn();
      bus.subscribe('pharaoh-1', handler);
      await expect(bus.send(makeMessage({ from: 'scribe-1', to: 'pharaoh-1' }))).resolves.toBeUndefined();
      expect(handler).toHaveBeenCalledOnce();
    });

    it('allows Worker → Operational (response)', async () => {
      const handler = vi.fn();
      bus.subscribe('scribe-1', handler);
      await expect(bus.send(makeMessage({ from: 'builder-1', to: 'scribe-1' }))).resolves.toBeUndefined();
      expect(handler).toHaveBeenCalledOnce();
    });

    it('rejects Worker → Planner', async () => {
      await expect(
        bus.send(makeMessage({ from: 'builder-1', to: 'pharaoh-1' })),
      ).rejects.toThrow(/Hierarchy violation/);
    });

    it('rejects Worker → Planner even with correlationId', async () => {
      await expect(
        bus.send(makeMessage({ from: 'builder-1', to: 'pharaoh-1', correlationId: 'corr-1' })),
      ).rejects.toThrow(/Hierarchy violation/);
    });

    it('throws for unknown sender', async () => {
      await expect(
        bus.send(makeMessage({ from: 'unknown-agent', to: 'scribe-1' })),
      ).rejects.toThrow(/Unknown sender/);
    });

    it('throws for unknown recipient', async () => {
      await expect(
        bus.send(makeMessage({ from: 'pharaoh-1', to: 'unknown-agent' })),
      ).rejects.toThrow(/Unknown recipient/);
    });
  });

  // -----------------------------------------------------------------------
  // Message queuing (Req 24.6, 24.7)
  // -----------------------------------------------------------------------
  describe('message queuing', () => {
    it('queues messages when recipient is not subscribed', async () => {
      await bus.send(makeMessage({ from: 'pharaoh-1', to: 'scribe-1' }));
      const queued = bus.getQueuedMessages('scribe-1');
      expect(queued).toHaveLength(1);
      expect(queued[0]!.content).toBe('test message');
    });

    it('delivers queued messages when agent subscribes', async () => {
      await bus.send(makeMessage({ id: 'msg-a', from: 'pharaoh-1', to: 'scribe-1', content: 'first' }));
      await bus.send(makeMessage({ id: 'msg-b', from: 'pharaoh-1', to: 'scribe-1', content: 'second' }));

      const handler = vi.fn();
      bus.subscribe('scribe-1', handler);

      expect(handler).toHaveBeenCalledTimes(2);
      expect(handler.mock.calls[0]![0].content).toBe('first');
      expect(handler.mock.calls[1]![0].content).toBe('second');

      // Queue should be empty after delivery
      expect(bus.getQueuedMessages('scribe-1')).toHaveLength(0);
    });

    it('returns empty array for agent with no queued messages', () => {
      expect(bus.getQueuedMessages('pharaoh-1')).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // Subscribe / Unsubscribe
  // -----------------------------------------------------------------------
  describe('subscribe / unsubscribe', () => {
    it('delivers messages to subscribed handler', async () => {
      const handler = vi.fn();
      bus.subscribe('scribe-1', handler);
      await bus.send(makeMessage({ from: 'pharaoh-1', to: 'scribe-1' }));
      expect(handler).toHaveBeenCalledOnce();
    });

    it('stops delivering after unsubscribe', async () => {
      const handler = vi.fn();
      bus.subscribe('scribe-1', handler);
      bus.unsubscribe('scribe-1');
      await bus.send(makeMessage({ from: 'pharaoh-1', to: 'scribe-1' }));
      expect(handler).not.toHaveBeenCalled();
      // Message should be queued instead
      expect(bus.getQueuedMessages('scribe-1')).toHaveLength(1);
    });
  });

  // -----------------------------------------------------------------------
  // Broadcast (Req 24.8)
  // -----------------------------------------------------------------------
  describe('broadcast', () => {
    it('delivers to all subscribed agents except sender', async () => {
      const scribeHandler = vi.fn();
      const builderHandler = vi.fn();
      bus.subscribe('scribe-1', scribeHandler);
      bus.subscribe('builder-1', builderHandler);

      await bus.broadcast('pharaoh-1', {
        id: 'bcast-1',
        from: 'pharaoh-1',
        content: 'attention all',
        timestamp: new Date().toISOString(),
      });

      expect(scribeHandler).toHaveBeenCalledOnce();
      expect(builderHandler).toHaveBeenCalledOnce();
      expect(scribeHandler.mock.calls[0]![0].to).toBe('scribe-1');
      expect(builderHandler.mock.calls[0]![0].to).toBe('builder-1');
    });

    it('does not deliver broadcast to the sender', async () => {
      const pharaohHandler = vi.fn();
      bus.subscribe('pharaoh-1', pharaohHandler);

      await bus.broadcast('pharaoh-1', {
        id: 'bcast-2',
        from: 'pharaoh-1',
        content: 'hello',
        timestamp: new Date().toISOString(),
      });

      expect(pharaohHandler).not.toHaveBeenCalled();
    });

    it('rejects broadcast from non-planner agent', async () => {
      await expect(
        bus.broadcast('scribe-1', {
          id: 'bcast-3',
          from: 'scribe-1',
          content: 'nope',
          timestamp: new Date().toISOString(),
        }),
      ).rejects.toThrow(/Broadcast denied/);
    });

    it('rejects broadcast from worker agent', async () => {
      await expect(
        bus.broadcast('builder-1', {
          id: 'bcast-4',
          from: 'builder-1',
          content: 'nope',
          timestamp: new Date().toISOString(),
        }),
      ).rejects.toThrow(/Broadcast denied/);
    });

    it('rejects broadcast from unknown agent', async () => {
      await expect(
        bus.broadcast('unknown', {
          id: 'bcast-5',
          from: 'unknown',
          content: 'nope',
          timestamp: new Date().toISOString(),
        }),
      ).rejects.toThrow(/Unknown sender/);
    });
  });

  // -----------------------------------------------------------------------
  // Request-response with correlation IDs (Req 24.9)
  // -----------------------------------------------------------------------
  describe('sendAndWait', () => {
    it('resolves when a correlated response arrives', async () => {
      const requestMsg = makeMessage({
        id: 'req-1',
        from: 'pharaoh-1',
        to: 'scribe-1',
        content: 'status?',
        correlationId: 'corr-100',
      });

      // Subscribe scribe to auto-respond
      bus.subscribe('scribe-1', (msg) => {
        const response = makeMessage({
          id: 'resp-1',
          from: 'scribe-1',
          to: 'pharaoh-1',
          content: 'all good',
          correlationId: msg.correlationId!,
        });
        bus.send(response);
      });

      const response = await bus.sendAndWait(requestMsg, 5000);
      expect(response.content).toBe('all good');
      expect(response.correlationId).toBe('corr-100');
    });

    it('rejects on timeout', async () => {
      bus.subscribe('scribe-1', vi.fn()); // subscribe but don't respond

      const requestMsg = makeMessage({
        id: 'req-2',
        from: 'pharaoh-1',
        to: 'scribe-1',
        content: 'hello?',
        correlationId: 'corr-200',
      });

      await expect(bus.sendAndWait(requestMsg, 50)).rejects.toThrow(/timed out/);
    });

    it('throws if no correlationId is provided', async () => {
      const msg = makeMessage({ from: 'pharaoh-1', to: 'scribe-1' });
      delete msg.correlationId;
      await expect(bus.sendAndWait(msg)).rejects.toThrow(/correlationId/);
    });

    it('rejects if hierarchy validation fails', async () => {
      const msg = makeMessage({
        from: 'builder-1',
        to: 'pharaoh-1',
        correlationId: 'corr-300',
      });
      await expect(bus.sendAndWait(msg, 100)).rejects.toThrow(/Hierarchy violation/);
    });
  });

  // -----------------------------------------------------------------------
  // Message logging (Req 24.5)
  // -----------------------------------------------------------------------
  describe('message logging', () => {
    it('logs sent messages to the message logger', async () => {
      bus.subscribe('scribe-1', vi.fn());
      await bus.send(makeMessage({ id: 'log-1', from: 'pharaoh-1', to: 'scribe-1', correlationId: 'c-1' }));

      expect(messageLoggerSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'log-1',
          senderId: 'pharaoh-1',
          receiverId: 'scribe-1',
          messageType: 'directive',
          correlationId: 'c-1',
        }),
      );
    });

    it('logs broadcast messages with null receiverId', async () => {
      await bus.broadcast('pharaoh-1', {
        id: 'bcast-log',
        from: 'pharaoh-1',
        content: 'broadcast content',
        timestamp: new Date().toISOString(),
      });

      expect(messageLoggerSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'bcast-log',
          senderId: 'pharaoh-1',
          receiverId: null,
          messageType: 'broadcast',
        }),
      );
    });

    it('works without a message logger (no crash)', async () => {
      const busNoLogger = new MessageBusImpl(resolveTier, logger);
      busNoLogger.subscribe('scribe-1', vi.fn());
      await expect(
        busNoLogger.send(makeMessage({ from: 'pharaoh-1', to: 'scribe-1' })),
      ).resolves.toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // Error handling in handlers
  // -----------------------------------------------------------------------
  describe('error handling', () => {
    it('logs error when handler throws during send', async () => {
      bus.subscribe('scribe-1', () => {
        throw new Error('handler boom');
      });
      // Should not throw — error is caught and logged
      await expect(bus.send(makeMessage({ from: 'pharaoh-1', to: 'scribe-1' }))).resolves.toBeUndefined();
      expect(logger.error).toHaveBeenCalled();
    });

    it('logs error when handler throws during broadcast', async () => {
      bus.subscribe('scribe-1', () => {
        throw new Error('broadcast boom');
      });
      await expect(
        bus.broadcast('pharaoh-1', {
          id: 'err-bcast',
          from: 'pharaoh-1',
          content: 'test',
          timestamp: new Date().toISOString(),
        }),
      ).resolves.toBeUndefined();
      expect(logger.error).toHaveBeenCalled();
    });

    it('logs error when queued message handler throws during subscribe', () => {
      // Queue a message first
      bus.send(makeMessage({ from: 'pharaoh-1', to: 'scribe-1' }));

      // Subscribe with a throwing handler
      bus.subscribe('scribe-1', () => {
        throw new Error('queued boom');
      });
      expect(logger.error).toHaveBeenCalled();
    });
  });
});
