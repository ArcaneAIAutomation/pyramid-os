/**
 * Circuit Breaker pattern for external dependencies.
 *
 * Tracks consecutive failures and transitions through three states:
 * - closed: normal operation, requests pass through
 * - open: failing, all requests rejected immediately
 * - half-open: testing recovery, limited requests allowed
 *
 * Validates: Requirements 13.8
 */

/** Possible circuit breaker states */
export type CircuitState = 'closed' | 'open' | 'half-open';

/** Configuration for a circuit breaker instance */
export interface CircuitBreakerConfig {
  /** Number of consecutive failures before opening */
  failureThreshold: number;
  /** Milliseconds to wait before probing in half-open state */
  cooldownMs: number;
  /** Number of successful probes to close the circuit */
  successThreshold: number;
  /** Timeout for individual operations (ms) */
  operationTimeoutMs: number;
}

/** Error thrown when the circuit is open and rejecting calls */
export class CircuitOpenError extends Error {
  constructor(public readonly dependency: string) {
    super(`Circuit breaker is open for dependency: ${dependency}`);
    this.name = 'CircuitOpenError';
  }
}

/** State change callback type */
export type StateChangeCallback = (from: CircuitState, to: CircuitState) => void;

/** Default thresholds per dependency */
export const CIRCUIT_BREAKER_DEFAULTS: Record<string, CircuitBreakerConfig> = {
  ollama: {
    failureThreshold: 3,
    cooldownMs: 30_000,
    successThreshold: 2,
    operationTimeoutMs: 30_000,
  },
  minecraft: {
    failureThreshold: 5,
    cooldownMs: 10_000,
    successThreshold: 1,
    operationTimeoutMs: 15_000,
  },
  sqlite: {
    failureThreshold: 3,
    cooldownMs: 5_000,
    successThreshold: 1,
    operationTimeoutMs: 5_000,
  },
};


/**
 * Generic circuit breaker implementation.
 *
 * Wraps calls to external dependencies and tracks failures.
 * Opens the circuit after `failureThreshold` consecutive failures,
 * waits `cooldownMs` before transitioning to half-open, and
 * closes after `successThreshold` consecutive successes in half-open.
 */
export class CircuitBreakerImpl<T> {
  private state: CircuitState = 'closed';
  private consecutiveFailures = 0;
  private consecutiveSuccesses = 0;
  private lastFailureTime: number | null = null;
  private readonly listeners: StateChangeCallback[] = [];
  private readonly config: CircuitBreakerConfig;
  private readonly name: string;

  /** Injectable clock for testing — returns current time in ms */
  private readonly now: () => number;

  constructor(
    name: string,
    config: CircuitBreakerConfig,
    clock?: () => number,
  ) {
    this.name = name;
    this.config = { ...config };
    this.now = clock ?? (() => Date.now());
  }

  /** Execute an operation through the breaker */
  async execute(operation: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      // Check if cooldown has elapsed → transition to half-open
      if (this.hasCooldownElapsed()) {
        this.transitionTo('half-open');
      } else {
        throw new CircuitOpenError(this.name);
      }
    }

    try {
      const result = await this.executeWithTimeout(operation);
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  /** Get current circuit state */
  getState(): CircuitState {
    // Check for automatic open → half-open transition on read
    if (this.state === 'open' && this.hasCooldownElapsed()) {
      this.transitionTo('half-open');
    }
    return this.state;
  }

  /** Get current consecutive failure count */
  getFailureCount(): number {
    return this.consecutiveFailures;
  }

  /** Manually reset the breaker to closed */
  reset(): void {
    const prev = this.state;
    this.state = 'closed';
    this.consecutiveFailures = 0;
    this.consecutiveSuccesses = 0;
    this.lastFailureTime = null;
    if (prev !== 'closed') {
      this.notifyListeners(prev, 'closed');
    }
  }

  /** Register a listener for state transitions */
  onStateChange(callback: StateChangeCallback): void {
    this.listeners.push(callback);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private onSuccess(): void {
    if (this.state === 'half-open') {
      this.consecutiveSuccesses++;
      if (this.consecutiveSuccesses >= this.config.successThreshold) {
        this.transitionTo('closed');
      }
    } else {
      // In closed state, reset failure count on success
      this.consecutiveFailures = 0;
    }
  }

  private onFailure(): void {
    if (this.state === 'half-open') {
      // Any failure in half-open → back to open
      this.lastFailureTime = this.now();
      this.transitionTo('open');
    } else if (this.state === 'closed') {
      this.consecutiveFailures++;
      if (this.consecutiveFailures >= this.config.failureThreshold) {
        this.lastFailureTime = this.now();
        this.transitionTo('open');
      }
    }
    // If already open, nothing changes
  }

  private hasCooldownElapsed(): boolean {
    if (this.lastFailureTime === null) return false;
    return this.now() - this.lastFailureTime >= this.config.cooldownMs;
  }

  private transitionTo(newState: CircuitState): void {
    const prev = this.state;
    if (prev === newState) return;

    this.state = newState;

    // Reset counters on transition
    if (newState === 'half-open') {
      this.consecutiveSuccesses = 0;
    } else if (newState === 'closed') {
      this.consecutiveFailures = 0;
      this.consecutiveSuccesses = 0;
      this.lastFailureTime = null;
    }

    this.notifyListeners(prev, newState);
  }

  private notifyListeners(from: CircuitState, to: CircuitState): void {
    for (const cb of this.listeners) {
      try {
        cb(from, to);
      } catch {
        // Swallow listener errors to avoid breaking the breaker
      }
    }
  }

  private async executeWithTimeout(operation: () => Promise<T>): Promise<T> {
    const { operationTimeoutMs } = this.config;
    if (operationTimeoutMs <= 0) {
      return operation();
    }

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Operation timed out after ${operationTimeoutMs}ms`));
      }, operationTimeoutMs);

      operation().then(
        (result) => {
          clearTimeout(timer);
          resolve(result);
        },
        (error) => {
          clearTimeout(timer);
          reject(error);
        },
      );
    });
  }
}
