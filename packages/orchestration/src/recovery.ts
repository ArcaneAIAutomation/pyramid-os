/**
 * Recovery Manager for PYRAMID OS.
 * Validates: Requirements 13.1, 13.2, 13.9, 13.10
 */

export type SystemHealthState = 'healthy' | 'degraded' | 'recovering' | 'critical' | 'shutdown';

export interface ComponentFailure {
  component: string;
  error: Error;
  timestamp: Date;
  retryCount: number;
}

export interface RecoveryStrategy {
  maxRetries: number;
  backoffBaseMs: number;
  recover(failure: ComponentFailure): Promise<boolean>;
}

export interface ShutdownDeps {
  pauseAgents: () => Promise<void>;
  disconnectBots: () => Promise<void>;
  persistState: () => Promise<void>;
  createSnapshot: () => Promise<void>;
  closeDatabase: () => Promise<void>;
}

export type HealthStateChangeCallback = (from: SystemHealthState, to: SystemHealthState) => void;

interface ComponentHealth {
  consecutiveFailures: number;
  lastFailure: ComponentFailure | null;
  recovering: boolean;
}

export interface RecoveryManagerConfig {
  degradedThreshold: number;
  criticalThreshold: number;
}

const DEFAULT_CONFIG: RecoveryManagerConfig = { degradedThreshold: 2, criticalThreshold: 5 };

export class RecoveryManagerImpl {
  private state: SystemHealthState = 'healthy';
  private readonly components = new Map<string, ComponentHealth>();
  private readonly strategies = new Map<string, RecoveryStrategy>();
  private readonly listeners: HealthStateChangeCallback[] = [];
  private readonly config: RecoveryManagerConfig;
  private readonly shutdownDeps: ShutdownDeps;

  constructor(shutdownDeps: ShutdownDeps, config?: Partial<RecoveryManagerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.shutdownDeps = shutdownDeps;
  }

  getState(): SystemHealthState { return this.state; }

  onStateChange(callback: HealthStateChangeCallback): void { this.listeners.push(callback); }

  registerStrategy(component: string, strategy: RecoveryStrategy): void {
    this.strategies.set(component, strategy);
    if (!this.components.has(component)) {
      this.components.set(component, { consecutiveFailures: 0, lastFailure: null, recovering: false });
    }
  }

  reportFailure(component: string, error: Error): void {
    if (this.state === 'shutdown') return;
    let health = this.components.get(component);
    if (!health) {
      health = { consecutiveFailures: 0, lastFailure: null, recovering: false };
      this.components.set(component, health);
    }
    health.consecutiveFailures++;
    health.lastFailure = { component, error, timestamp: new Date(), retryCount: health.consecutiveFailures };
    this.recomputeState();
  }

  reportRecovery(component: string): void {
    if (this.state === 'shutdown') return;
    const health = this.components.get(component);
    if (health) {
      health.consecutiveFailures = 0;
      health.lastFailure = null;
      health.recovering = false;
    }
    this.recomputeState();
  }

  async attemptRecovery(component: string): Promise<boolean> {
    if (this.state === 'shutdown') return false;
    const strategy = this.strategies.get(component);
    if (!strategy) return false;
    const health = this.components.get(component);
    if (!health || !health.lastFailure) return false;
    health.recovering = true;
    this.recomputeState();
    const failure = health.lastFailure;
    for (let attempt = 0; attempt < strategy.maxRetries; attempt++) {
      if (attempt > 0) {
        const delay = strategy.backoffBaseMs * Math.pow(2, attempt - 1);
        await this.sleep(delay);
      }
      try {
        const success = await strategy.recover({ ...failure, retryCount: attempt + 1 });
        if (success) {
          health.consecutiveFailures = 0;
          health.lastFailure = null;
          health.recovering = false;
          this.recomputeState();
          return true;
        }
      } catch {
        // Recovery threw, continue to next attempt
      }
    }
    health.recovering = false;
    this.recomputeState();
    return false;
  }

  getActiveFailures(): ComponentFailure[] {
    const failures: ComponentFailure[] = [];
    for (const h of this.components.values()) {
      if (h.lastFailure && h.consecutiveFailures > 0) failures.push(h.lastFailure);
    }
    return failures;
  }

  getComponentFailureCount(component: string): number {
    return this.components.get(component)?.consecutiveFailures ?? 0;
  }

  async initiateShutdown(): Promise<void> {
    if (this.state === 'shutdown') return;
    this.transitionTo('shutdown');
    await this.shutdownDeps.pauseAgents();
    await this.shutdownDeps.disconnectBots();
    await this.shutdownDeps.persistState();
    await this.shutdownDeps.createSnapshot();
    await this.shutdownDeps.closeDatabase();
  }

  private recomputeState(): void {
    if (this.state === 'shutdown') return;
    let maxFailures = 0;
    let anyRecovering = false;
    for (const h of this.components.values()) {
      if (h.consecutiveFailures > maxFailures) maxFailures = h.consecutiveFailures;
      if (h.recovering) anyRecovering = true;
    }
    let newState: SystemHealthState;
    if (maxFailures >= this.config.criticalThreshold) newState = 'critical';
    else if (anyRecovering) newState = 'recovering';
    else if (maxFailures >= this.config.degradedThreshold) newState = 'degraded';
    else newState = 'healthy';
    if (newState !== this.state) this.transitionTo(newState);
  }

  private transitionTo(newState: SystemHealthState): void {
    const prev = this.state;
    if (prev === newState) return;
    this.state = newState;
    for (const cb of this.listeners) {
      try { cb(prev, newState); } catch { /* swallow listener errors */ }
    }
  }

  protected sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
