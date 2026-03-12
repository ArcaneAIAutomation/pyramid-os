/**
 * Unit tests for PluginSandboxImpl
 *
 * Validates: Requirements 26.8, 26.9
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PluginSandboxImpl, PLUGIN_FAILURE_THRESHOLD } from '../plugin-sandbox.js';
import type { PluginLoaderImpl } from '../plugin-loader.js';
import type { PluginLogger } from '@pyramid-os/shared-types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockLoader(): PluginLoaderImpl {
  return {
    unloadPlugin: vi.fn(async () => {}),
  } as unknown as PluginLoaderImpl;
}

function createMockLogger(): PluginLogger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PluginSandboxImpl', () => {
  let loader: ReturnType<typeof createMockLoader>;
  let logger: ReturnType<typeof createMockLogger>;
  let sandbox: PluginSandboxImpl;

  beforeEach(() => {
    loader = createMockLoader();
    logger = createMockLogger();
    sandbox = new PluginSandboxImpl(loader, logger);
  });

  describe('PLUGIN_FAILURE_THRESHOLD', () => {
    it('should equal 3', () => {
      expect(PLUGIN_FAILURE_THRESHOLD).toBe(3);
    });
  });

  describe('execute', () => {
    it('returns the result of a successful synchronous function', async () => {
      const result = await sandbox.execute('p1', () => 42);
      expect(result).toBe(42);
    });

    it('returns the result of a successful async function', async () => {
      const result = await sandbox.execute('p1', async () => 'hello');
      expect(result).toBe('hello');
    });

    it('resets failure count on success', async () => {
      // Cause one failure first
      await expect(sandbox.execute('p1', () => { throw new Error('boom'); })).rejects.toThrow('boom');
      expect(sandbox.getFailureCount('p1')).toBe(1);

      // Successful execution resets
      await sandbox.execute('p1', () => 'ok');
      expect(sandbox.getFailureCount('p1')).toBe(0);
    });

    it('rethrows the error on failure', async () => {
      const err = new Error('plugin broke');
      await expect(sandbox.execute('p1', () => { throw err; })).rejects.toThrow('plugin broke');
    });

    it('increments consecutive failure count on each failure', async () => {
      const fail = () => sandbox.execute('p1', () => { throw new Error('fail'); });

      await expect(fail()).rejects.toThrow();
      expect(sandbox.getFailureCount('p1')).toBe(1);

      await expect(fail()).rejects.toThrow();
      expect(sandbox.getFailureCount('p1')).toBe(2);
    });

    it('logs errors with plugin ID and error details', async () => {
      await expect(
        sandbox.execute('my-plugin', () => { throw new Error('details here'); }),
      ).rejects.toThrow();

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('my-plugin'),
        expect.any(Error),
        expect.objectContaining({
          pluginId: 'my-plugin',
          consecutiveFailures: 1,
        }),
      );
    });

    it('auto-unloads plugin after reaching failure threshold', async () => {
      const fail = () => sandbox.execute('p1', () => { throw new Error('fail'); });

      for (let i = 0; i < PLUGIN_FAILURE_THRESHOLD; i++) {
        await expect(fail()).rejects.toThrow();
      }

      expect(loader.unloadPlugin).toHaveBeenCalledWith('p1');
      expect(loader.unloadPlugin).toHaveBeenCalledTimes(1);
    });

    it('does not auto-unload before reaching threshold', async () => {
      const fail = () => sandbox.execute('p1', () => { throw new Error('fail'); });

      for (let i = 0; i < PLUGIN_FAILURE_THRESHOLD - 1; i++) {
        await expect(fail()).rejects.toThrow();
      }

      expect(loader.unloadPlugin).not.toHaveBeenCalled();
    });

    it('logs a warning when auto-unloading', async () => {
      const fail = () => sandbox.execute('p1', () => { throw new Error('fail'); });

      for (let i = 0; i < PLUGIN_FAILURE_THRESHOLD; i++) {
        await expect(fail()).rejects.toThrow();
      }

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('auto-unloading'),
        expect.objectContaining({ pluginId: 'p1' }),
      );
    });

    it('handles unload errors gracefully', async () => {
      (loader.unloadPlugin as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('unload failed'));

      const fail = () => sandbox.execute('p1', () => { throw new Error('fail'); });

      for (let i = 0; i < PLUGIN_FAILURE_THRESHOLD; i++) {
        await expect(fail()).rejects.toThrow('fail');
      }

      // Should log the unload error but not throw it
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to auto-unload'),
        expect.any(Error),
        expect.objectContaining({ pluginId: 'p1' }),
      );
    });

    it('tracks failure counts independently per plugin', async () => {
      await expect(sandbox.execute('p1', () => { throw new Error('a'); })).rejects.toThrow();
      await expect(sandbox.execute('p2', () => { throw new Error('b'); })).rejects.toThrow();
      await expect(sandbox.execute('p1', () => { throw new Error('c'); })).rejects.toThrow();

      expect(sandbox.getFailureCount('p1')).toBe(2);
      expect(sandbox.getFailureCount('p2')).toBe(1);
    });

    it('handles async function failures', async () => {
      await expect(
        sandbox.execute('p1', async () => { throw new Error('async fail'); }),
      ).rejects.toThrow('async fail');
      expect(sandbox.getFailureCount('p1')).toBe(1);
    });
  });

  describe('getFailureCount', () => {
    it('returns 0 for unknown plugins', () => {
      expect(sandbox.getFailureCount('unknown')).toBe(0);
    });
  });

  describe('resetFailureCount', () => {
    it('resets the count to 0', async () => {
      await expect(sandbox.execute('p1', () => { throw new Error('x'); })).rejects.toThrow();
      expect(sandbox.getFailureCount('p1')).toBe(1);

      sandbox.resetFailureCount('p1');
      expect(sandbox.getFailureCount('p1')).toBe(0);
    });

    it('is safe to call on unknown plugins', () => {
      expect(() => sandbox.resetFailureCount('nope')).not.toThrow();
    });
  });

  describe('constructor without logger', () => {
    it('works without a logger (uses noop)', async () => {
      const sandboxNoLog = new PluginSandboxImpl(loader);
      const result = await sandboxNoLog.execute('p1', () => 99);
      expect(result).toBe(99);
    });
  });
});
