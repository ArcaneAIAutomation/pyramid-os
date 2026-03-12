import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ErrorAggregator, DEFAULT_AGGREGATOR_CONFIG } from './error-aggregator.js';
import type { AggregatedErrorEntry } from './error-aggregator.js';
import { PyramidError, ErrorCategory } from '@pyramid-os/shared-types';

function makePyramidError(
  code: string,
  context: Record<string, unknown> = {},
): PyramidError {
  return new PyramidError({
    code,
    category: ErrorCategory.SYSTEM,
    severity: 'error',
    message: `Error: ${code}`,
    context,
  });
}

describe('DEFAULT_AGGREGATOR_CONFIG', () => {
  it('should have a 10-second window', () => {
    expect(DEFAULT_AGGREGATOR_CONFIG.windowMs).toBe(10_000);
  });

  it('should track up to 100 unique errors', () => {
    expect(DEFAULT_AGGREGATOR_CONFIG.maxTracked).toBe(100);
  });
});

describe('ErrorAggregator', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should aggregate identical errors by code + context hash', () => {
    const emitted: AggregatedErrorEntry[] = [];
    const agg = new ErrorAggregator((e) => emitted.push(e));

    const err = makePyramidError('PYRAMID_OLLAMA_UNAVAILABLE', { host: 'localhost' });
    agg.report(err);
    agg.report(err);
    agg.report(err);

    agg.flush();

    expect(emitted).toHaveLength(1);
    expect(emitted[0]!.code).toBe('PYRAMID_OLLAMA_UNAVAILABLE');
    expect(emitted[0]!.count).toBe(3);
  });

  it('should treat errors with different codes as distinct', () => {
    const emitted: AggregatedErrorEntry[] = [];
    const agg = new ErrorAggregator((e) => emitted.push(e));

    agg.report(makePyramidError('CODE_A'));
    agg.report(makePyramidError('CODE_B'));
    agg.report(makePyramidError('CODE_A'));

    agg.flush();

    expect(emitted).toHaveLength(2);
    const codeA = emitted.find((e) => e.code === 'CODE_A')!;
    const codeB = emitted.find((e) => e.code === 'CODE_B')!;
    expect(codeA.count).toBe(2);
    expect(codeB.count).toBe(1);
  });

  it('should treat same code with different context as distinct', () => {
    const emitted: AggregatedErrorEntry[] = [];
    const agg = new ErrorAggregator((e) => emitted.push(e));

    agg.report(makePyramidError('CODE_A', { field: 'x' }));
    agg.report(makePyramidError('CODE_A', { field: 'y' }));

    agg.flush();

    expect(emitted).toHaveLength(2);
    expect(emitted.every((e) => e.count === 1)).toBe(true);
  });

  it('should track firstSeen and lastSeen timestamps', () => {
    const emitted: AggregatedErrorEntry[] = [];
    const agg = new ErrorAggregator((e) => emitted.push(e));

    const t0 = new Date('2024-01-01T00:00:00Z');
    vi.setSystemTime(t0);
    agg.report(makePyramidError('CODE_A'));

    const t1 = new Date('2024-01-01T00:00:05Z');
    vi.setSystemTime(t1);
    agg.report(makePyramidError('CODE_A'));

    agg.flush();

    expect(emitted).toHaveLength(1);
    expect(emitted[0]!.firstSeen).toEqual(t0);
    expect(emitted[0]!.lastSeen).toEqual(t1);
  });

  it('should auto-flush when the window timer expires', () => {
    const emitted: AggregatedErrorEntry[] = [];
    const agg = new ErrorAggregator((e) => emitted.push(e), { windowMs: 500 });

    agg.report(makePyramidError('CODE_A'));
    agg.report(makePyramidError('CODE_A'));

    expect(emitted).toHaveLength(0);

    vi.advanceTimersByTime(500);

    expect(emitted).toHaveLength(1);
    expect(emitted[0]!.count).toBe(2);
  });

  it('should auto-flush when maxTracked unique errors is reached', () => {
    const emitted: AggregatedErrorEntry[] = [];
    const agg = new ErrorAggregator((e) => emitted.push(e), { maxTracked: 3 });

    agg.report(makePyramidError('CODE_1'));
    agg.report(makePyramidError('CODE_2'));
    expect(emitted).toHaveLength(0);

    // Third unique error triggers flush
    agg.report(makePyramidError('CODE_3'));
    expect(emitted).toHaveLength(3);
  });

  it('should clear tracked errors after flush', () => {
    const emitted: AggregatedErrorEntry[] = [];
    const agg = new ErrorAggregator((e) => emitted.push(e));

    agg.report(makePyramidError('CODE_A'));
    agg.flush();

    expect(agg.size).toBe(0);

    // Flushing again should emit nothing new
    agg.flush();
    expect(emitted).toHaveLength(1);
  });

  it('should cancel the timer on manual flush', () => {
    const emitted: AggregatedErrorEntry[] = [];
    const agg = new ErrorAggregator((e) => emitted.push(e), { windowMs: 1000 });

    agg.report(makePyramidError('CODE_A'));
    agg.flush();

    expect(emitted).toHaveLength(1);

    // Advancing time should not cause a second flush
    vi.advanceTimersByTime(1000);
    expect(emitted).toHaveLength(1);
  });

  it('should emit message from the original error', () => {
    const emitted: AggregatedErrorEntry[] = [];
    const agg = new ErrorAggregator((e) => emitted.push(e));

    agg.report(makePyramidError('CODE_A'));
    agg.flush();

    expect(emitted[0]!.message).toBe('Error: CODE_A');
  });

  it('should use default config when none provided', () => {
    const emitted: AggregatedErrorEntry[] = [];
    const agg = new ErrorAggregator((e) => emitted.push(e));

    agg.report(makePyramidError('CODE_A'));

    // Window should be 10 seconds
    vi.advanceTimersByTime(9_999);
    expect(emitted).toHaveLength(0);

    vi.advanceTimersByTime(1);
    expect(emitted).toHaveLength(1);
  });

  it('dispose() should flush remaining errors', () => {
    const emitted: AggregatedErrorEntry[] = [];
    const agg = new ErrorAggregator((e) => emitted.push(e));

    agg.report(makePyramidError('CODE_A'));
    agg.report(makePyramidError('CODE_B'));

    agg.dispose();

    expect(emitted).toHaveLength(2);
    expect(agg.size).toBe(0);
  });

  it('should handle context key ordering consistently', () => {
    const emitted: AggregatedErrorEntry[] = [];
    const agg = new ErrorAggregator((e) => emitted.push(e));

    // Same keys, different insertion order — should aggregate together
    agg.report(makePyramidError('CODE_A', { a: 1, b: 2 }));
    agg.report(makePyramidError('CODE_A', { b: 2, a: 1 }));

    agg.flush();

    expect(emitted).toHaveLength(1);
    expect(emitted[0]!.count).toBe(2);
  });

  it('should start a new window after flush', () => {
    const emitted: AggregatedErrorEntry[] = [];
    const agg = new ErrorAggregator((e) => emitted.push(e), { windowMs: 500 });

    agg.report(makePyramidError('CODE_A'));
    vi.advanceTimersByTime(500);
    expect(emitted).toHaveLength(1);

    // New report should start a fresh window
    agg.report(makePyramidError('CODE_B'));
    vi.advanceTimersByTime(500);
    expect(emitted).toHaveLength(2);
    expect(emitted[1]!.code).toBe('CODE_B');
  });
});
