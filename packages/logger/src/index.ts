export type { LogLevel, LogContext, Logger, LoggerOptions, LogEntry } from './logger.js';
export { createLogger } from './logger.js';

export { correlationStorage, runWithCorrelationId, getCorrelationId } from './correlation.js';

export { RotatingFileStream } from './rotation.js';

export type { LogFilter } from './filter.js';
export { matchesFilter, filterEntries } from './filter.js';

export type { AggregatedError, ErrorAggregatorConfig, AggregatedErrorEntry } from './error-aggregator.js';
export { ErrorAggregator, DEFAULT_AGGREGATOR_CONFIG } from './error-aggregator.js';
