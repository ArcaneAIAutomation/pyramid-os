import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createLogger } from './logger.js';
import { runWithCorrelationId } from './correlation.js';
import * as os from 'node:os';
import * as fs from 'node:fs';
import * as path from 'node:path';

// Capture console output
function captureOutput(fn: () => void): { stdout: string; stderr: string } {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];

  const origStdout = process.stdout.write.bind(process.stdout);
  const origStderr = process.stderr.write.bind(process.stderr);

  process.stdout.write = (chunk: string | Uint8Array) => {
    stdoutChunks.push(chunk.toString());
    return true;
  };
  process.stderr.write = (chunk: string | Uint8Array) => {
    stderrChunks.push(chunk.toString());
    return true;
  };

  try {
    fn();
  } finally {
    process.stdout.write = origStdout;
    process.stderr.write = origStderr;
  }

  return { stdout: stdoutChunks.join(''), stderr: stderrChunks.join('') };
}

describe('createLogger', () => {
  describe('log level filtering', () => {
    it('should not log entries below the configured level', () => {
      const logger = createLogger({ level: 'warn' });
      const { stdout, stderr } = captureOutput(() => {
        logger.debug('debug msg');
        logger.info('info msg');
      });
      expect(stdout).toBe('');
      expect(stderr).toBe('');
    });

    it('should log entries at or above the configured level', () => {
      const logger = createLogger({ level: 'warn' });
      const { stderr } = captureOutput(() => {
        logger.warn('warn msg');
        logger.error('error msg');
      });
      const lines = stderr.trim().split('\n');
      expect(lines).toHaveLength(2);
    });

    it('should log all levels when level is debug', () => {
      const logger = createLogger({ level: 'debug' });
      const { stdout, stderr } = captureOutput(() => {
        logger.debug('d');
        logger.info('i');
        logger.warn('w');
        logger.error('e');
      });
      expect(stdout.trim().split('\n')).toHaveLength(2); // debug + info
      expect(stderr.trim().split('\n')).toHaveLength(2); // warn + error
    });
  });

  describe('JSON structured output', () => {
    it('should output valid JSON with required fields', () => {
      const logger = createLogger({ level: 'debug' });
      const { stdout } = captureOutput(() => {
        logger.info('hello world');
      });
      const entry = JSON.parse(stdout.trim());
      expect(entry.level).toBe('info');
      expect(entry.message).toBe('hello world');
      expect(typeof entry.timestamp).toBe('string');
      // ISO timestamp
      expect(() => new Date(entry.timestamp)).not.toThrow();
    });

    it('should include agentId from options', () => {
      const logger = createLogger({ level: 'debug', agentId: 'agent-42' });
      const { stdout } = captureOutput(() => {
        logger.info('msg');
      });
      const entry = JSON.parse(stdout.trim());
      expect(entry.agentId).toBe('agent-42');
    });

    it('should include agentId from context, overriding options', () => {
      const logger = createLogger({ level: 'debug', agentId: 'agent-1' });
      const { stdout } = captureOutput(() => {
        logger.info('msg', { agentId: 'agent-2' });
      });
      const entry = JSON.parse(stdout.trim());
      expect(entry.agentId).toBe('agent-2');
    });

    it('should include extra context fields in the entry', () => {
      const logger = createLogger({ level: 'debug' });
      const { stdout } = captureOutput(() => {
        logger.info('msg', { taskId: 'task-99', component: 'builder' });
      });
      const entry = JSON.parse(stdout.trim());
      expect(entry.taskId).toBe('task-99');
      expect(entry.component).toBe('builder');
    });

    it('should include error details when provided', () => {
      const logger = createLogger({ level: 'debug' });
      const err = new Error('something broke');
      const { stderr } = captureOutput(() => {
        logger.error('oops', err);
      });
      const entry = JSON.parse(stderr.trim());
      expect(entry.error.message).toBe('something broke');
      expect(entry.error.name).toBe('Error');
    });
  });

  describe('console routing', () => {
    it('should write debug and info to stdout', () => {
      const logger = createLogger({ level: 'debug' });
      const { stdout, stderr } = captureOutput(() => {
        logger.debug('d');
        logger.info('i');
      });
      expect(stdout).toContain('debug');
      expect(stdout).toContain('info');
      expect(stderr).toBe('');
    });

    it('should write warn and error to stderr', () => {
      const logger = createLogger({ level: 'debug' });
      const { stdout, stderr } = captureOutput(() => {
        logger.warn('w');
        logger.error('e');
      });
      expect(stderr).toContain('warn');
      expect(stderr).toContain('error');
      expect(stdout).toBe('');
    });
  });

  describe('correlation ID', () => {
    it('should pick up correlation ID from AsyncLocalStorage', () => {
      const logger = createLogger({ level: 'debug' });
      let output = '';
      runWithCorrelationId('corr-123', () => {
        const { stdout } = captureOutput(() => {
          logger.info('traced');
        });
        output = stdout;
      });
      const entry = JSON.parse(output.trim());
      expect(entry.correlationId).toBe('corr-123');
    });

    it('should prefer correlationId from context over AsyncLocalStorage', () => {
      const logger = createLogger({ level: 'debug' });
      let output = '';
      runWithCorrelationId('from-storage', () => {
        const { stdout } = captureOutput(() => {
          logger.info('msg', { correlationId: 'from-context' });
        });
        output = stdout;
      });
      const entry = JSON.parse(output.trim());
      expect(entry.correlationId).toBe('from-context');
    });

    it('should not include correlationId when not set', () => {
      const logger = createLogger({ level: 'debug' });
      const { stdout } = captureOutput(() => {
        logger.info('no corr');
      });
      const entry = JSON.parse(stdout.trim());
      expect(entry.correlationId).toBeUndefined();
    });
  });

  describe('file output', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'logger-test-'));
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('should write log entries to the output file', () => {
      const logPath = path.join(tmpDir, 'test.log');
      const logger = createLogger({ level: 'debug', outputPath: logPath });

      captureOutput(() => {
        logger.info('file entry');
      });

      const content = fs.readFileSync(logPath, 'utf8');
      const entry = JSON.parse(content.trim());
      expect(entry.message).toBe('file entry');
    });

    it('should create the output directory if it does not exist', () => {
      const logPath = path.join(tmpDir, 'nested', 'dir', 'app.log');
      const logger = createLogger({ level: 'debug', outputPath: logPath });

      captureOutput(() => {
        logger.info('nested');
      });

      expect(fs.existsSync(logPath)).toBe(true);
    });
  });
});
