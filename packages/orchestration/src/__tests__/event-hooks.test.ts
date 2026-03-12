/**
 * Unit tests for EventHookManager
 *
 * Validates: Requirements 26.5, 26.6
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventHookManager } from '../event-hooks.js';
import type { EventHandler, SystemEventPayload } from '@pyramid-os/shared-types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createHandler(fn?: (e: SystemEventPayload) => void | Promise<void>): EventHandler {
  return { handle: fn ?? vi.fn() };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('EventHookManager', () => {
  let manager: EventHookManager;

  beforeEach(() => {
    manager = new EventHookManager();
  });

  // -----------------------------------------------------------------------
  // on / handlerCount
  // -----------------------------------------------------------------------
  describe('on', () => {
    it('registers a handler for an event type', () => {
      const handler = createHandler();
      manager.on('task:completed', handler);
      expect(manager.handlerCount('task:completed')).toBe(1);
    });

    it('registers multiple handlers for the same event', () => {
      manager.on('task:completed', createHandler());
      manager.on('task:completed', createHandler());
      expect(manager.handlerCount('task:completed')).toBe(2);
    });

    it('registers handlers for different events independently', () => {
      manager.on('task:completed', createHandler());
      manager.on('task:failed', createHandler());
      expect(manager.handlerCount('task:completed')).toBe(1);
      expect(manager.handlerCount('task:failed')).toBe(1);
    });

    it('accepts an optional pluginId', () => {
      manager.on('agent:created', createHandler(), 'my-plugin');
      expect(manager.handlerCount('agent:created')).toBe(1);
    });
  });

  // -----------------------------------------------------------------------
  // off
  // -----------------------------------------------------------------------
  describe('off', () => {
    it('removes a specific handler by reference', () => {
      const handler = createHandler();
      manager.on('task:completed', handler);
      manager.off('task:completed', handler);
      expect(manager.handlerCount('task:completed')).toBe(0);
    });

    it('does nothing when removing a handler that was never registered', () => {
      const handler = createHandler();
      manager.off('task:completed', handler);
      expect(manager.handlerCount('task:completed')).toBe(0);
    });

    it('only removes the exact handler reference, not others', () => {
      const h1 = createHandler();
      const h2 = createHandler();
      manager.on('task:completed', h1);
      manager.on('task:completed', h2);

      manager.off('task:completed', h1);
      expect(manager.handlerCount('task:completed')).toBe(1);
    });

    it('does nothing for an event with no handlers', () => {
      manager.off('resource:low', createHandler());
      expect(manager.handlerCount('resource:low')).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // removeAllForPlugin
  // -----------------------------------------------------------------------
  describe('removeAllForPlugin', () => {
    it('removes all handlers associated with a plugin', () => {
      manager.on('task:completed', createHandler(), 'plugin-a');
      manager.on('task:failed', createHandler(), 'plugin-a');
      manager.on('agent:created', createHandler(), 'plugin-b');

      manager.removeAllForPlugin('plugin-a');

      expect(manager.handlerCount('task:completed')).toBe(0);
      expect(manager.handlerCount('task:failed')).toBe(0);
      expect(manager.handlerCount('agent:created')).toBe(1);
    });

    it('does not remove handlers without a pluginId', () => {
      manager.on('task:completed', createHandler());
      manager.on('task:completed', createHandler(), 'plugin-a');

      manager.removeAllForPlugin('plugin-a');

      expect(manager.handlerCount('task:completed')).toBe(1);
    });

    it('is a no-op when the plugin has no handlers', () => {
      manager.on('task:completed', createHandler(), 'plugin-a');
      manager.removeAllForPlugin('nonexistent');
      expect(manager.handlerCount('task:completed')).toBe(1);
    });
  });

  // -----------------------------------------------------------------------
  // emit
  // -----------------------------------------------------------------------
  describe('emit', () => {
    it('invokes all registered handlers for the event', async () => {
      const calls: string[] = [];
      const h1 = createHandler(() => { calls.push('h1'); });
      const h2 = createHandler(() => { calls.push('h2'); });

      manager.on('task:completed', h1);
      manager.on('task:completed', h2);

      await manager.emit('task:completed', { taskId: '123' });

      expect(calls).toEqual(['h1', 'h2']);
    });

    it('passes a correctly shaped SystemEventPayload', async () => {
      let received: SystemEventPayload | undefined;
      const handler = createHandler((e) => { received = e; });

      manager.on('mode:changed', handler);
      await manager.emit('mode:changed', { newMode: 'free_thinking' });

      expect(received).toBeDefined();
      expect(received!.type).toBe('mode:changed');
      expect(received!.data).toEqual({ newMode: 'free_thinking' });
      expect(typeof received!.timestamp).toBe('string');
      // Verify it's a valid ISO timestamp
      expect(new Date(received!.timestamp).toISOString()).toBe(received!.timestamp);
    });

    it('does nothing when no handlers are registered for the event', async () => {
      // Should not throw
      await manager.emit('system:shutdown', {});
    });

    it('awaits async handlers', async () => {
      const order: number[] = [];
      const h1 = createHandler(async () => {
        await new Promise((r) => setTimeout(r, 10));
        order.push(1);
      });
      const h2 = createHandler(() => { order.push(2); });

      manager.on('task:completed', h1);
      manager.on('task:completed', h2);

      await manager.emit('task:completed', {});

      // h1 completes before h2 starts (sequential execution)
      expect(order).toEqual([1, 2]);
    });

    it('catches handler errors without stopping other handlers', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const calls: string[] = [];

      const failing = createHandler(() => { throw new Error('boom'); });
      const passing = createHandler(() => { calls.push('ok'); });

      manager.on('task:failed', failing);
      manager.on('task:failed', passing);

      await manager.emit('task:failed', { reason: 'test' });

      expect(calls).toEqual(['ok']);
      expect(consoleSpy).toHaveBeenCalledOnce();
      consoleSpy.mockRestore();
    });

    it('catches async handler errors without stopping other handlers', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const calls: string[] = [];

      const failing = createHandler(async () => { throw new Error('async boom'); });
      const passing = createHandler(() => { calls.push('ok'); });

      manager.on('resource:low', failing);
      manager.on('resource:low', passing);

      await manager.emit('resource:low', {});

      expect(calls).toEqual(['ok']);
      expect(consoleSpy).toHaveBeenCalledOnce();
      consoleSpy.mockRestore();
    });

    it('does not invoke handlers for other event types', async () => {
      const fn = vi.fn();
      manager.on('task:completed', createHandler(fn));

      await manager.emit('task:failed', {});

      expect(fn).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // totalHandlerCount
  // -----------------------------------------------------------------------
  describe('totalHandlerCount', () => {
    it('returns 0 when empty', () => {
      expect(manager.totalHandlerCount()).toBe(0);
    });

    it('returns the sum of all handlers across events', () => {
      manager.on('task:completed', createHandler());
      manager.on('task:completed', createHandler());
      manager.on('task:failed', createHandler());

      expect(manager.totalHandlerCount()).toBe(3);
    });
  });
});
