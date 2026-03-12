import * as fs from 'node:fs';
import * as path from 'node:path';

export interface HotReloadOptions {
  /** Directory to watch for changes */
  watchDir: string;
  /** Debounce interval in milliseconds (default: 300) */
  debounceMs?: number;
  /** Callback triggered on file change (e.g., run tsc build) */
  onReload?: () => void | Promise<void>;
  /** Callback to notify connected WebSocket clients of reload */
  notifyClients?: () => void | Promise<void>;
}

export class HotReloadWatcher {
  private readonly watchDir: string;
  private readonly debounceMs: number;
  private readonly onReload: (() => void | Promise<void>) | undefined;
  private readonly notifyClients: (() => void | Promise<void>) | undefined;

  private watcher: fs.FSWatcher | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private _running = false;

  constructor(options: HotReloadOptions) {
    this.watchDir = path.resolve(options.watchDir);
    this.debounceMs = options.debounceMs ?? 300;
    this.onReload = options.onReload;
    this.notifyClients = options.notifyClients;
  }

  /** Whether the watcher is currently active */
  get running(): boolean {
    return this._running;
  }

  /** Start watching for file changes */
  start(): void {
    if (this._running) return;

    this.watcher = fs.watch(this.watchDir, { recursive: true }, (_event, _filename) => {
      this.scheduleReload();
    });

    this._running = true;
  }

  /** Stop watching and clean up */
  stop(): void {
    if (!this._running) return;

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }

    this._running = false;
  }

  private scheduleReload(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(async () => {
      this.debounceTimer = null;
      await this.onReload?.();
      await this.notifyClients?.();
    }, this.debounceMs);
  }
}
