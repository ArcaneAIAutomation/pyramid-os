// TaskThrottle — backpressure and rate limiting for task assignments
// Requirements: 25.4, 25.10

export interface ThrottleConfig {
  /** Max task assignments per second */
  maxAssignmentsPerSecond: number;
  /** Queue depth at which backpressure begins */
  queueDepthThreshold: number;
  /** Max pending assignments before hard rejection */
  maxPendingAssignments: number;
}

export interface ThrottleMetrics {
  currentRate: number;
  pendingAssignments: number;
  queueDepth: number;
  backpressure: boolean;
}

export interface CanAssignResult {
  allowed: boolean;
  reason?: string;
}

export const DEFAULT_THROTTLE_CONFIG: ThrottleConfig = {
  maxAssignmentsPerSecond: 50,
  queueDepthThreshold: 200,
  maxPendingAssignments: 500,
};

export class TaskThrottle {
  private readonly config: ThrottleConfig;
  /** Sliding window of assignment timestamps (ms) */
  private readonly window: number[] = [];
  private pendingCount = 0;
  private currentQueueDepth = 0;
  /** 1-second sliding window in ms */
  private readonly windowMs = 1000;

  constructor(config: Partial<ThrottleConfig> = {}) {
    this.config = { ...DEFAULT_THROTTLE_CONFIG, ...config };
  }

  /**
   * Check if a new task assignment is allowed.
   * Checks rate limit, queue depth backpressure, and max pending.
   */
  canAssign(): CanAssignResult {
    // Hard rejection: max pending assignments reached
    if (this.pendingCount >= this.config.maxPendingAssignments) {
      return {
        allowed: false,
        reason: `Max pending assignments reached (${this.pendingCount}/${this.config.maxPendingAssignments})`,
      };
    }

    // Backpressure: queue depth exceeds threshold
    if (this.currentQueueDepth > this.config.queueDepthThreshold) {
      return {
        allowed: false,
        reason: `Queue depth ${this.currentQueueDepth} exceeds threshold ${this.config.queueDepthThreshold}`,
      };
    }

    // Rate limit: sliding window check
    this.pruneWindow();
    if (this.window.length >= this.config.maxAssignmentsPerSecond) {
      return {
        allowed: false,
        reason: `Rate limit exceeded (${this.window.length}/${this.config.maxAssignmentsPerSecond} per second)`,
      };
    }

    return { allowed: true };
  }

  /**
   * Record a new task assignment. Adds timestamp to sliding window
   * and increments pending count.
   */
  recordAssignment(): void {
    this.window.push(Date.now());
    this.pendingCount++;
  }

  /**
   * Record a task completion. Decrements pending count.
   */
  recordCompletion(): void {
    if (this.pendingCount > 0) {
      this.pendingCount--;
    }
  }

  /**
   * Set the current queue depth (reported externally by the task queue).
   */
  setQueueDepth(depth: number): void {
    this.currentQueueDepth = Math.max(0, depth);
  }

  /**
   * Get current throttle load metrics.
   */
  getLoad(): ThrottleMetrics {
    this.pruneWindow();
    return {
      currentRate: this.window.length,
      pendingAssignments: this.pendingCount,
      queueDepth: this.currentQueueDepth,
      backpressure:
        this.currentQueueDepth > this.config.queueDepthThreshold ||
        this.window.length >= this.config.maxAssignmentsPerSecond ||
        this.pendingCount >= this.config.maxPendingAssignments,
    };
  }

  /** Remove timestamps older than the sliding window */
  private pruneWindow(): void {
    const cutoff = Date.now() - this.windowMs;
    while (this.window.length > 0 && this.window[0]! <= cutoff) {
      this.window.shift();
    }
  }
}
