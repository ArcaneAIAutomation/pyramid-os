/**
 * Error aggregation to prevent log spam when the same error occurs repeatedly.
 *
 * Errors are keyed by `code + hash(context)`. Within a configurable time window,
 * identical errors are counted rather than logged individually. When the window
 * expires (or the max tracked unique errors is reached), a single log entry is
 * emitted per unique error with its occurrence count.
 */

import type { PyramidError } from '@pyramid-os/shared-types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AggregatedError {
  error: PyramidError;
  count: number;
  firstSeen: Date;
  lastSeen: Date;
}

export interface ErrorAggregatorConfig {
  /** Time window for aggregation (ms) */
  windowMs: number;
  /** Max unique errors to track before auto-flushing */
  maxTracked: number;
}

export const DEFAULT_AGGREGATOR_CONFIG: ErrorAggregatorConfig = {
  windowMs: 10_000,
  maxTracked: 100,
};

export type AggregatedErrorEntry = {
  code: string;
  message: string;
  count: number;
  firstSeen: Date;
  lastSeen: Date;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Produce a stable string hash of a context object.
 * Uses sorted JSON serialisation so key order doesn't matter.
 */
function hashContext(context: Record<string, unknown>): string {
  const keys = Object.keys(context).sort();
  const parts: string[] = [];
  for (const k of keys) {
    parts.push(`${k}:${JSON.stringify(context[k])}`);
  }
  return parts.join('|');
}

function makeKey(error: PyramidError): string {
  return `${error.code}#${hashContext(error.context)}`;
}

// ---------------------------------------------------------------------------
// ErrorAggregator
// ---------------------------------------------------------------------------

export class ErrorAggregator {
  private readonly config: ErrorAggregatorConfig;
  private readonly emit: (entry: AggregatedErrorEntry) => void;
  private readonly tracked = new Map<string, AggregatedError>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private windowStart: number | null = null;

  constructor(
    emit: (entry: AggregatedErrorEntry) => void,
    config: Partial<ErrorAggregatorConfig> = {},
  ) {
    this.config = { ...DEFAULT_AGGREGATOR_CONFIG, ...config };
    this.emit = emit;
  }

  /** Report an error. Identical errors within the window are aggregated. */
  report(error: PyramidError): void {
    const key = makeKey(error);
    const now = new Date();

    const existing = this.tracked.get(key);
    if (existing) {
      existing.count += 1;
      existing.lastSeen = now;
    } else {
      this.tracked.set(key, {
        error,
        count: 1,
        firstSeen: now,
        lastSeen: now,
      });
    }

    // Start the window timer on first report
    if (this.timer === null) {
      this.windowStart = Date.now();
      this.timer = setTimeout(() => this.flush(), this.config.windowMs);
    }

    // Auto-flush when max tracked unique errors is reached
    if (this.tracked.size >= this.config.maxTracked) {
      this.flush();
    }
  }

  /** Flush all aggregated errors, emitting one entry per unique error. */
  flush(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.windowStart = null;

    for (const agg of this.tracked.values()) {
      this.emit({
        code: agg.error.code,
        message: agg.error.message,
        count: agg.count,
        firstSeen: agg.firstSeen,
        lastSeen: agg.lastSeen,
      });
    }

    this.tracked.clear();
  }

  /** Dispose of the aggregator, flushing any remaining errors. */
  dispose(): void {
    this.flush();
  }

  /** Number of unique errors currently tracked. */
  get size(): number {
    return this.tracked.size;
  }
}
