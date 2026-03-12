import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * AsyncLocalStorage for propagating correlation IDs across async boundaries.
 * Each async context can carry a unique correlation ID for request tracing.
 */
export const correlationStorage = new AsyncLocalStorage<string>();

/**
 * Run a function within a correlation ID context.
 * All async operations within `fn` will have access to the given ID.
 */
export function runWithCorrelationId<T>(id: string, fn: () => T): T {
  return correlationStorage.run(id, fn);
}

/**
 * Get the current correlation ID from the async context, if any.
 */
export function getCorrelationId(): string | undefined {
  return correlationStorage.getStore();
}
