import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HotReloadWatcher } from '../hot-reload.js';
import * as fs from 'node:fs';

vi.mock('node:fs', () => {
  const watchers: Array<{ callback: fs.WatchListener<string>; close: ReturnType<typeof vi.fn> }> = [];
  return {
    watch: vi.fn((_path: string, _opts: object, cb: fs.WatchListener<string>) => {
      const watcher = { callback: cb, close: vi.fn() };
      watchers.push(watcher);
      return { close: watcher.close } as unknown as fs.FSWatcher;
    }),
    __watchers: watchers,
  };
});

function getLastWatcher() {
  const watchers = (fs as unknown as { __watchers: Array<{ callback: fs.WatchListener<string>; close: ReturnType<typeof vi.fn> }> }).__watchers;
  return watchers[watchers.length - 1];
}

function triggerChange() {
  const w = getLastWatcher();
  if (!w) throw new Error('No watcher found');
  w.callback('change', 'some-file.ts');
}

describe('HotReloadWatcher', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    (fs as unknown as { __watchers: unknown[] }).__watchers.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should not be running initially', () => {
    const watcher = new HotReloadWatcher({ watchDir: '/tmp/src' });
    expect(watcher.running).toBe(false);
  });

  it('should start watching and set running to true', () => {
    const watcher = new HotReloadWatcher({ watchDir: '/tmp/src' });
    watcher.start();
    expect(watcher.running).toBe(true);
    expect(fs.watch).toHaveBeenCalledWith(
      expect.any(String),
      { recursive: true },
      expect.any(Function),
    );
    watcher.stop();
  });

  it('should not create multiple watchers on repeated start calls', () => {
    const watcher = new HotReloadWatcher({ watchDir: '/tmp/src' });
    watcher.start();
    watcher.start();
    expect(fs.watch).toHaveBeenCalledTimes(1);
    watcher.stop();
  });

  it('should stop watching and set running to false', () => {
    const watcher = new HotReloadWatcher({ watchDir: '/tmp/src' });
    watcher.start();
    const w = getLastWatcher();
    if (!w) throw new Error('No watcher found');
    watcher.stop();
    expect(watcher.running).toBe(false);
    expect(w.close).toHaveBeenCalled();
  });

  it('should debounce rapid file changes with 300ms default', async () => {
    const onReload = vi.fn();
    const watcher = new HotReloadWatcher({ watchDir: '/tmp/src', onReload });
    watcher.start();

    // Trigger 3 rapid changes
    triggerChange();
    triggerChange();
    triggerChange();

    // Not called yet (debounce pending)
    expect(onReload).not.toHaveBeenCalled();

    // Advance past debounce
    await vi.advanceTimersByTimeAsync(300);

    expect(onReload).toHaveBeenCalledTimes(1);
    watcher.stop();
  });

  it('should use custom debounce interval', async () => {
    const onReload = vi.fn();
    const watcher = new HotReloadWatcher({ watchDir: '/tmp/src', debounceMs: 500, onReload });
    watcher.start();

    triggerChange();

    // At 300ms, should not have fired yet
    await vi.advanceTimersByTimeAsync(300);
    expect(onReload).not.toHaveBeenCalled();

    // At 500ms, should fire
    await vi.advanceTimersByTimeAsync(200);
    expect(onReload).toHaveBeenCalledTimes(1);
    watcher.stop();
  });

  it('should call notifyClients after onReload', async () => {
    const callOrder: string[] = [];
    const onReload = vi.fn(() => { callOrder.push('reload'); });
    const notifyClients = vi.fn(() => { callOrder.push('notify'); });

    const watcher = new HotReloadWatcher({ watchDir: '/tmp/src', onReload, notifyClients });
    watcher.start();

    triggerChange();
    await vi.advanceTimersByTimeAsync(300);

    expect(onReload).toHaveBeenCalledTimes(1);
    expect(notifyClients).toHaveBeenCalledTimes(1);
    expect(callOrder).toEqual(['reload', 'notify']);
    watcher.stop();
  });

  it('should work without callbacks', async () => {
    const watcher = new HotReloadWatcher({ watchDir: '/tmp/src' });
    watcher.start();

    triggerChange();
    // Should not throw
    await vi.advanceTimersByTimeAsync(300);

    watcher.stop();
  });

  it('should cancel pending debounce on stop', async () => {
    const onReload = vi.fn();
    const watcher = new HotReloadWatcher({ watchDir: '/tmp/src', onReload });
    watcher.start();

    triggerChange();
    watcher.stop();

    await vi.advanceTimersByTimeAsync(300);
    expect(onReload).not.toHaveBeenCalled();
  });

  it('stop on non-running watcher is a no-op', () => {
    const watcher = new HotReloadWatcher({ watchDir: '/tmp/src' });
    // Should not throw
    watcher.stop();
    expect(watcher.running).toBe(false);
  });

  it('should reset debounce timer on new changes within window', async () => {
    const onReload = vi.fn();
    const watcher = new HotReloadWatcher({ watchDir: '/tmp/src', debounceMs: 300, onReload });
    watcher.start();

    triggerChange();
    await vi.advanceTimersByTimeAsync(200);
    // Another change resets the timer
    triggerChange();
    await vi.advanceTimersByTimeAsync(200);
    // Only 200ms since last change, should not have fired
    expect(onReload).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(100);
    expect(onReload).toHaveBeenCalledTimes(1);
    watcher.stop();
  });
});
