import { createWriteStream } from 'node:fs';
import { RotatingFileStream } from './rotation.js';
import { getCorrelationId } from './correlation.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogContext {
  agentId?: string;
  correlationId?: string;
  [key: string]: unknown;
}

export interface Logger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, error?: Error, context?: LogContext): void;
}

export interface LoggerOptions {
  level: LogLevel;
  outputPath?: string;
  maxFileSizeMb?: number;
  agentId?: string;
}

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  agentId?: string;
  correlationId?: string;
  error?: { message: string; stack?: string; name: string };
  [key: string]: unknown;
}

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export function createLogger(options: LoggerOptions): Logger {
  const { level, outputPath, maxFileSizeMb = 10, agentId } = options;
  const minLevel = LEVEL_ORDER[level];

  let fileStream: RotatingFileStream | undefined;
  if (outputPath) {
    fileStream = new RotatingFileStream(outputPath, maxFileSizeMb * 1024 * 1024);
  }

  function shouldLog(entryLevel: LogLevel): boolean {
    return LEVEL_ORDER[entryLevel] >= minLevel;
  }

  function buildEntry(
    entryLevel: LogLevel,
    message: string,
    context?: LogContext,
    error?: Error,
  ): LogEntry {
    const correlationId = context?.correlationId ?? getCorrelationId();
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: entryLevel,
      message,
    };

    if (agentId !== undefined) entry['agentId'] = agentId;
    if (context?.agentId !== undefined) entry['agentId'] = context.agentId;
    if (correlationId !== undefined) entry['correlationId'] = correlationId;

    // Spread remaining context fields (excluding agentId/correlationId already handled)
    if (context) {
      for (const [key, value] of Object.entries(context)) {
        if (key !== 'agentId' && key !== 'correlationId') {
          entry[key] = value;
        }
      }
    }

    if (error) {
      const errorEntry: { name: string; message: string; stack?: string } = {
        name: error.name,
        message: error.message,
      };
      if (error.stack !== undefined) {
        errorEntry.stack = error.stack;
      }
      entry['error'] = errorEntry;
    }

    return entry;
  }

  function writeEntry(entryLevel: LogLevel, entry: LogEntry): void {
    const line = JSON.stringify(entry) + '\n';

    // Console output: stderr for warn/error, stdout for debug/info
    if (entryLevel === 'warn' || entryLevel === 'error') {
      process.stderr.write(line);
    } else {
      process.stdout.write(line);
    }

    // File output
    if (fileStream) {
      fileStream.write(line);
    }
  }

  return {
    debug(message: string, context?: LogContext): void {
      if (!shouldLog('debug')) return;
      writeEntry('debug', buildEntry('debug', message, context));
    },

    info(message: string, context?: LogContext): void {
      if (!shouldLog('info')) return;
      writeEntry('info', buildEntry('info', message, context));
    },

    warn(message: string, context?: LogContext): void {
      if (!shouldLog('warn')) return;
      writeEntry('warn', buildEntry('warn', message, context));
    },

    error(message: string, error?: Error, context?: LogContext): void {
      if (!shouldLog('error')) return;
      writeEntry('error', buildEntry('error', message, context, error));
    },
  };
}
