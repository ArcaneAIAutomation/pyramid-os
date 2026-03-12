import { describe, it, expect } from 'vitest';
import { matchesFilter, filterEntries } from './filter.js';
import type { LogEntry } from './logger.js';

function makeEntry(overrides: Partial<LogEntry> = {}): LogEntry {
  return {
    timestamp: new Date().toISOString(),
    level: 'info',
    message: 'test',
    ...overrides,
  };
}

describe('matchesFilter', () => {
  it('should match when no filter criteria are set', () => {
    expect(matchesFilter(makeEntry(), {})).toBe(true);
  });

  it('should filter by minimum log level', () => {
    expect(matchesFilter(makeEntry({ level: 'debug' }), { level: 'info' })).toBe(false);
    expect(matchesFilter(makeEntry({ level: 'info' }), { level: 'info' })).toBe(true);
    expect(matchesFilter(makeEntry({ level: 'warn' }), { level: 'info' })).toBe(true);
    expect(matchesFilter(makeEntry({ level: 'error' }), { level: 'warn' })).toBe(true);
  });

  it('should filter by agentId', () => {
    const entry = makeEntry({ agentId: 'agent-1' });
    expect(matchesFilter(entry, { agentId: 'agent-1' })).toBe(true);
    expect(matchesFilter(entry, { agentId: 'agent-2' })).toBe(false);
  });

  it('should filter by since (inclusive)', () => {
    const now = new Date();
    const past = new Date(now.getTime() - 10000);
    const future = new Date(now.getTime() + 10000);

    const entry = makeEntry({ timestamp: now.toISOString() });
    expect(matchesFilter(entry, { since: past })).toBe(true);
    expect(matchesFilter(entry, { since: future })).toBe(false);
  });

  it('should filter by until (inclusive)', () => {
    const now = new Date();
    const past = new Date(now.getTime() - 10000);
    const future = new Date(now.getTime() + 10000);

    const entry = makeEntry({ timestamp: now.toISOString() });
    expect(matchesFilter(entry, { until: future })).toBe(true);
    expect(matchesFilter(entry, { until: past })).toBe(false);
  });

  it('should apply multiple criteria together', () => {
    const entry = makeEntry({ level: 'warn', agentId: 'agent-1' });
    expect(matchesFilter(entry, { level: 'warn', agentId: 'agent-1' })).toBe(true);
    expect(matchesFilter(entry, { level: 'error', agentId: 'agent-1' })).toBe(false);
    expect(matchesFilter(entry, { level: 'warn', agentId: 'agent-2' })).toBe(false);
  });
});

describe('filterEntries', () => {
  it('should return only matching entries', () => {
    const entries: LogEntry[] = [
      makeEntry({ level: 'debug', agentId: 'a1' }),
      makeEntry({ level: 'info', agentId: 'a1' }),
      makeEntry({ level: 'warn', agentId: 'a2' }),
      makeEntry({ level: 'error', agentId: 'a1' }),
    ];

    const result = filterEntries(entries, { level: 'info', agentId: 'a1' });
    expect(result).toHaveLength(2);
    expect(result.every((e) => e.agentId === 'a1')).toBe(true);
    expect(result.every((e) => ['info', 'warn', 'error'].includes(e.level))).toBe(true);
  });
});
