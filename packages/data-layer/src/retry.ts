/**
 * Retry helper with exponential backoff for SQLite write failures.
 * Requirements: 10.7
 */

/**
 * Executes `fn` and retries up to `maxAttempts` times on SQLITE_BUSY or SQLITE_LOCKED errors.
 * Waits 2^attempt * 100ms between retries using a synchronous sleep.
 */
export function withRetry<T>(fn: () => T, maxAttempts = 3): T {
  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return fn();
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === 'SQLITE_BUSY' || code === 'SQLITE_LOCKED') {
        lastError = err;
        const delayMs = Math.pow(2, attempt) * 100;
        // Synchronous sleep using Atomics.wait
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs);
      } else {
        throw err;
      }
    }
  }

  throw lastError;
}
