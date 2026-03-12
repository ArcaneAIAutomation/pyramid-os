import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { RotatingFileStream } from './rotation.js';

describe('RotatingFileStream', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rotation-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should create the log file on construction', () => {
    const logPath = path.join(tmpDir, 'app.log');
    const stream = new RotatingFileStream(logPath, 1024 * 1024);
    stream.close();
    expect(fs.existsSync(logPath)).toBe(true);
  });

  it('should create nested directories if they do not exist', () => {
    const logPath = path.join(tmpDir, 'nested', 'logs', 'app.log');
    const stream = new RotatingFileStream(logPath, 1024 * 1024);
    stream.close();
    expect(fs.existsSync(logPath)).toBe(true);
  });

  it('should write data to the file', () => {
    const logPath = path.join(tmpDir, 'app.log');
    const stream = new RotatingFileStream(logPath, 1024 * 1024);
    stream.write('hello\n');
    stream.write('world\n');
    stream.close();

    const content = fs.readFileSync(logPath, 'utf8');
    expect(content).toBe('hello\nworld\n');
  });

  it('should rotate when the file exceeds maxSizeBytes', () => {
    const logPath = path.join(tmpDir, 'app.log');
    // Very small limit: 10 bytes
    const stream = new RotatingFileStream(logPath, 10);

    stream.write('12345678901'); // 11 bytes — triggers rotation on next write
    stream.write('new content\n');
    stream.close();

    // The current file should have the new content
    const content = fs.readFileSync(logPath, 'utf8');
    expect(content).toBe('new content\n');

    // A rotated file should exist (either .log or .log.gz)
    const files = fs.readdirSync(tmpDir);
    const rotated = files.filter((f) => f !== 'app.log');
    expect(rotated.length).toBeGreaterThan(0);
  });

  it('should append to existing file on re-open', () => {
    const logPath = path.join(tmpDir, 'app.log');
    const stream1 = new RotatingFileStream(logPath, 1024 * 1024);
    stream1.write('line1\n');
    stream1.close();

    const stream2 = new RotatingFileStream(logPath, 1024 * 1024);
    stream2.write('line2\n');
    stream2.close();

    const content = fs.readFileSync(logPath, 'utf8');
    expect(content).toBe('line1\nline2\n');
  });
});
