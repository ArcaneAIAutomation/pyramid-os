/**
 * Event Hook Manager for PYRAMID OS
 *
 * Manages registration and dispatch of event handlers, with optional
 * plugin association for bulk cleanup on plugin unload.
 *
 * @see Requirement 26.5, 26.6
 */

import type {
  SystemEvent,
  SystemEventPayload,
  EventHandler,
} from '@pyramid-os/shared-types';

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

/** A registered handler entry, optionally associated with a plugin. */
interface HandlerEntry {
  handler: EventHandler;
  pluginId?: string;
}

// ---------------------------------------------------------------------------
// EventHookManager
// ---------------------------------------------------------------------------

export class EventHookManager {
  /** Map from event type → ordered list of handler entries. */
  private readonly handlers = new Map<SystemEvent, HandlerEntry[]>();

  /**
   * Register a handler for a specific event type.
   * If `pluginId` is provided the handler is associated with that plugin
   * so it can be bulk-removed via {@link removeAllForPlugin}.
   */
  on(event: SystemEvent, handler: EventHandler, pluginId?: string): void {
    let entries = this.handlers.get(event);
    if (!entries) {
      entries = [];
      this.handlers.set(event, entries);
    }
    entries.push(pluginId !== undefined ? { handler, pluginId } : { handler });
  }

  /**
   * Remove a specific handler for an event type.
   * Uses reference equality to identify the handler.
   */
  off(event: SystemEvent, handler: EventHandler): void {
    const entries = this.handlers.get(event);
    if (!entries) return;

    const idx = entries.findIndex((e) => e.handler === handler);
    if (idx !== -1) {
      entries.splice(idx, 1);
    }

    // Clean up empty lists
    if (entries.length === 0) {
      this.handlers.delete(event);
    }
  }

  /**
   * Remove all handlers registered by a specific plugin.
   * Typically called during plugin unload.
   */
  removeAllForPlugin(pluginId: string): void {
    for (const [event, entries] of this.handlers) {
      const filtered = entries.filter((e) => e.pluginId !== pluginId);
      if (filtered.length === 0) {
        this.handlers.delete(event);
      } else {
        this.handlers.set(event, filtered);
      }
    }
  }

  /**
   * Emit an event, invoking all registered handlers.
   * Constructs a {@link SystemEventPayload} and calls each handler.
   * Errors thrown by individual handlers are caught and logged
   * so that one failing handler does not prevent others from running.
   */
  async emit(event: SystemEvent, data: Record<string, unknown>): Promise<void> {
    const entries = this.handlers.get(event);
    if (!entries || entries.length === 0) return;

    const payload: SystemEventPayload = {
      type: event,
      timestamp: new Date().toISOString(),
      data,
    };

    for (const entry of entries) {
      try {
        await entry.handler.handle(payload);
      } catch (err) {
        // Log but do not propagate — other handlers must still run.
        // In production this would go through the structured logger.
        console.error(
          `[EventHookManager] Handler error for event "${event}"` +
            (entry.pluginId ? ` (plugin: ${entry.pluginId})` : '') +
            ':',
          err,
        );
      }
    }
  }

  // -----------------------------------------------------------------------
  // Introspection helpers (useful for testing / diagnostics)
  // -----------------------------------------------------------------------

  /** Return the number of handlers registered for a given event. */
  handlerCount(event: SystemEvent): number {
    return this.handlers.get(event)?.length ?? 0;
  }

  /** Return the total number of handlers across all events. */
  totalHandlerCount(): number {
    let count = 0;
    for (const entries of this.handlers.values()) {
      count += entries.length;
    }
    return count;
  }
}
