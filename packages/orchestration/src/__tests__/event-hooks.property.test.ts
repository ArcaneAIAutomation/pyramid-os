/**
 * Property-based test for event hook dispatch.
 *
 * **Property 11: Event hooks fire for all subscribers**
 * For any system event with N registered handlers, emitting that event should
 * invoke all N handlers exactly once each.
 *
 * **Validates: Requirements 26.5**
 */

import { describe, it, expect, vi } from 'vitest';
import * as fc from 'fast-check';
import { EventHookManager } from '../event-hooks.js';
import type { SystemEvent, EventHandler, SystemEventPayload } from '@pyramid-os/shared-types';

// ─── Constants ───────────────────────────────────────────────────────────────

const ALL_EVENTS: SystemEvent[] = [
  'agent:created',
  'agent:destroyed',
  'task:completed',
  'task:failed',
  'resource:low',
  'build:phase-complete',
  'ceremony:started',
  'ceremony:completed',
  'mode:changed',
  'system:shutdown',
];

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/** Pick a random system event */
const eventArb = fc.constantFrom(...ALL_EVENTS);

/** Generate a subscription: which event and a handler index (to track identity) */
interface Subscription {
  event: SystemEvent;
  handlerIndex: number;
}

const subscriptionArb = fc.record({
  event: eventArb,
  handlerIndex: fc.nat({ max: 999 }),
});

/** Generate a list of subscriptions (1–30 handlers across various events) */
const subscriptionsArb = fc.array(subscriptionArb, { minLength: 1, maxLength: 30 });

/** Generate a list of events to emit (1–10 emissions) */
const emissionsArb = fc.array(eventArb, { minLength: 1, maxLength: 10 });

// ─── Property tests ──────────────────────────────────────────────────────────

describe('Event hooks fire for all subscribers (property)', () => {
  it('all handlers subscribed to an emitted event are invoked exactly once, others are not invoked', async () => {
    await fc.assert(
      fc.asyncProperty(subscriptionsArb, emissionsArb, async (subscriptions, emissions) => {
        const manager = new EventHookManager();

        // Track invocation counts per handler
        const invocationCounts = new Map<number, number>();
        // Map handler index → the event it's subscribed to
        const handlerEventMap = new Map<number, SystemEvent>();
        // Map handler index → EventHandler reference
        const handlers = new Map<number, EventHandler>();

        // Use a unique index for each subscription to avoid collisions
        subscriptions.forEach((sub, i) => {
          const uniqueIndex = i;
          invocationCounts.set(uniqueIndex, 0);
          handlerEventMap.set(uniqueIndex, sub.event);

          const handler: EventHandler = {
            handle: () => {
              invocationCounts.set(uniqueIndex, (invocationCounts.get(uniqueIndex) ?? 0) + 1);
            },
          };
          handlers.set(uniqueIndex, handler);
          manager.on(sub.event, handler);
        });

        // Emit all events
        for (const event of emissions) {
          await manager.emit(event, { test: true });
        }

        // Count how many times each event was emitted
        const emissionCounts = new Map<SystemEvent, number>();
        for (const event of emissions) {
          emissionCounts.set(event, (emissionCounts.get(event) ?? 0) + 1);
        }

        // Verify: each handler was invoked exactly once per emission of its event
        for (const [handlerIdx, subscribedEvent] of handlerEventMap) {
          const expectedInvocations = emissionCounts.get(subscribedEvent) ?? 0;
          const actualInvocations = invocationCounts.get(handlerIdx) ?? 0;

          expect(actualInvocations).toBe(expectedInvocations);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('handlers for unrelated events are never invoked', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Pick two distinct events
        eventArb,
        eventArb.filter((e) => e !== ALL_EVENTS[0]),
        fc.integer({ min: 1, max: 10 }),
        async (subscribedEvent, emittedEvent, handlerCount) => {
          // Ensure the events are different
          fc.pre(subscribedEvent !== emittedEvent);

          const manager = new EventHookManager();
          const invocations: number[] = [];

          // Register N handlers on subscribedEvent
          for (let i = 0; i < handlerCount; i++) {
            const idx = i;
            manager.on(subscribedEvent, {
              handle: () => { invocations.push(idx); },
            });
          }

          // Emit a different event
          await manager.emit(emittedEvent, {});

          // None of the handlers should have been called
          expect(invocations).toHaveLength(0);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('handler count matches the number of registered handlers per event', () => {
    fc.assert(
      fc.property(subscriptionsArb, (subscriptions) => {
        const manager = new EventHookManager();

        // Expected count per event
        const expectedCounts = new Map<SystemEvent, number>();

        for (const sub of subscriptions) {
          expectedCounts.set(sub.event, (expectedCounts.get(sub.event) ?? 0) + 1);
          manager.on(sub.event, { handle: () => {} });
        }

        // Verify handlerCount for each event
        for (const [event, expected] of expectedCounts) {
          expect(manager.handlerCount(event)).toBe(expected);
        }

        // Verify totalHandlerCount
        expect(manager.totalHandlerCount()).toBe(subscriptions.length);

        // Events with no subscriptions should have 0 handlers
        for (const event of ALL_EVENTS) {
          if (!expectedCounts.has(event)) {
            expect(manager.handlerCount(event)).toBe(0);
          }
        }
      }),
      { numRuns: 200 },
    );
  });
});
