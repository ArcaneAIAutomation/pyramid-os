/**
 * Graceful Degradation Manager for PYRAMID OS.
 *
 * Tracks per-component health, activates/deactivates fallback behaviors,
 * and computes an overall system degradation level.
 *
 * Validates: Requirements 40.1, 40.2, 40.3, 40.10
 */

/** Overall system degradation level. */
export type DegradationLevel = 'full' | 'degraded' | 'critical' | 'minimal';

/** Health state of an individual component. */
export type ComponentState = 'healthy' | 'degraded' | 'failed';

/** Fallback specification registered per component. */
export interface FallbackSpec {
  /** Priority during degraded operation (lower number = higher priority). */
  priority: number;
  /** Called when the component fails. */
  activate(): void | Promise<void>;
  /** Called when the component recovers. */
  deactivate(): void | Promise<void>;
}

/** Callback invoked when the overall degradation level changes. */
export type LevelChangeCallback = (from: DegradationLevel, to: DegradationLevel) => void;

interface ComponentEntry {
  state: ComponentState;
  fallback: FallbackSpec;
  fallbackActive: boolean;
}

/**
 * Manages graceful degradation across system components.
 *
 * Register components with fallback specs, then call `notifyFailure` /
 * `notifyRecovery` as health changes. The manager activates fallbacks
 * and recomputes the overall degradation level automatically.
 */
export class DegradationManager {
  private readonly components = new Map<string, ComponentEntry>();
  private readonly listeners: LevelChangeCallback[] = [];
  private currentLevel: DegradationLevel = 'full';

  /** Return the health state of every registered component. */
  getComponentStates(): Map<string, ComponentState> {
    const result = new Map<string, ComponentState>();
    for (const [name, entry] of this.components) {
      result.set(name, entry.state);
    }
    return result;
  }

  /**
   * Compute the overall degradation level from component states.
   *
   * - All healthy → `full`
   * - Any failed but not all → `degraded`
   * - More than half of components failed → `critical`
   * - All components failed → `minimal`
   */
  getOverallLevel(): DegradationLevel {
    return this.currentLevel;
  }

  /** Register a component with its fallback behaviour. */
  registerComponent(component: string, fallback: FallbackSpec): void {
    this.components.set(component, {
      state: 'healthy',
      fallback,
      fallbackActive: false,
    });
  }

  /** Mark a component as failed, activate its fallback, and recompute level. */
  async notifyFailure(component: string): Promise<void> {
    const entry = this.components.get(component);
    if (!entry) return;

    entry.state = 'failed';

    if (!entry.fallbackActive) {
      entry.fallbackActive = true;
      await entry.fallback.activate();
    }

    this.recomputeLevel();
  }

  /** Mark a component as healthy, deactivate its fallback, and recompute level. */
  async notifyRecovery(component: string): Promise<void> {
    const entry = this.components.get(component);
    if (!entry) return;

    entry.state = 'healthy';

    if (entry.fallbackActive) {
      entry.fallbackActive = false;
      await entry.fallback.deactivate();
    }

    this.recomputeLevel();
  }

  /** Register a listener for overall degradation level transitions. */
  onLevelChange(callback: LevelChangeCallback): void {
    this.listeners.push(callback);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private recomputeLevel(): void {
    const total = this.components.size;
    if (total === 0) {
      this.setLevel('full');
      return;
    }

    let failedCount = 0;
    for (const entry of this.components.values()) {
      if (entry.state === 'failed') failedCount++;
    }

    let newLevel: DegradationLevel;
    if (failedCount === 0) {
      newLevel = 'full';
    } else if (failedCount === total) {
      newLevel = 'minimal';
    } else if (failedCount > total / 2) {
      newLevel = 'critical';
    } else {
      newLevel = 'degraded';
    }

    this.setLevel(newLevel);
  }

  private setLevel(level: DegradationLevel): void {
    const prev = this.currentLevel;
    if (prev === level) return;
    this.currentLevel = level;
    for (const cb of this.listeners) {
      try {
        cb(prev, level);
      } catch {
        // Swallow listener errors to avoid breaking the manager
      }
    }
  }
}
