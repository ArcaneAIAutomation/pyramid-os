import type { LogLevel, LogEntry } from './logger.js';

export interface LogFilter {
  level?: LogLevel;
  agentId?: string;
  since?: Date;
  until?: Date;
}

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * Returns true if the log entry matches all provided filter criteria.
 */
export function matchesFilter(entry: LogEntry, filter: LogFilter): boolean {
  if (filter.level !== undefined) {
    if (LEVEL_ORDER[entry.level] < LEVEL_ORDER[filter.level]) {
      return false;
    }
  }

  if (filter.agentId !== undefined) {
    if (entry['agentId'] !== filter.agentId) {
      return false;
    }
  }

  if (filter.since !== undefined) {
    const entryTime = new Date(entry.timestamp);
    if (entryTime < filter.since) {
      return false;
    }
  }

  if (filter.until !== undefined) {
    const entryTime = new Date(entry.timestamp);
    if (entryTime > filter.until) {
      return false;
    }
  }

  return true;
}

/**
 * Filter an array of log entries by the given criteria.
 */
export function filterEntries(entries: LogEntry[], filter: LogFilter): LogEntry[] {
  return entries.filter((e) => matchesFilter(e, filter));
}
