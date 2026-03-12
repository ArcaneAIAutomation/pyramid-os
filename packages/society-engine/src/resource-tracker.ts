/**
 * ResourceTracker — monitors resource inventory with threshold alerting.
 *
 * Tracks resource levels in-memory, persists changes via callbacks,
 * checks thresholds, and fires alerts when resources drop below minimums.
 *
 * Requirements: 3.2, 3.3, 21.1, 21.2, 21.3, 21.9, 21.11, 12.4
 */

import type {
  ResourceType,
  ResourceThreshold,
  ResourceAlert,
  ResourceTransaction,
} from '@pyramid-os/shared-types';
import type { Logger } from '@pyramid-os/logger';

/** Callback invoked to persist resource level changes. */
export type ResourcePersistCallback = (
  resourceType: string,
  level: number,
) => void;

/** Callback invoked to persist a resource transaction record. */
export type TransactionPersistCallback = (
  transaction: ResourceTransaction,
) => void;

/** Callback invoked when a resource drops below its threshold. */
export type AlertCallback = (alert: ResourceAlert) => void;

export interface ResourceTrackerOptions {
  logger: Logger;
  thresholds: ResourceThreshold[];
  onResourcePersist?: ResourcePersistCallback;
  onTransactionPersist?: TransactionPersistCallback;
  onAlert?: AlertCallback;
}

export class ResourceTracker {
  private readonly levels = new Map<string, number>();
  private readonly thresholdMap = new Map<string, ResourceThreshold>();
  private readonly logger: Logger;
  private readonly onResourcePersist: ResourcePersistCallback | undefined;
  private readonly onTransactionPersist: TransactionPersistCallback | undefined;
  private readonly onAlert: AlertCallback | undefined;

  constructor(options: ResourceTrackerOptions) {
    this.logger = options.logger;
    this.onResourcePersist = options.onResourcePersist;
    this.onTransactionPersist = options.onTransactionPersist;
    this.onAlert = options.onAlert;

    for (const t of options.thresholds) {
      this.thresholdMap.set(t.resourceType, t);
    }
  }

  /** Get current inventory level for a resource type. Returns 0 if not tracked. */
  getLevel(resourceType: string): number {
    return this.levels.get(resourceType) ?? 0;
  }

  /** Set an absolute level for a resource type. */
  setLevel(resourceType: string, level: number): void {
    this.levels.set(resourceType, level);
    this.persistResource(resourceType, level);
    this.logger.info('Resource level set', { resourceType, level } as Record<string, unknown>);
  }

  /**
   * Adjust a resource level by `delta` (positive = add, negative = consume).
   * Logs the transaction with before/after values, persists both the resource
   * and the transaction, and checks thresholds to fire alerts.
   */
  update(resourceType: string, delta: number, reason: string): void {
    const before = this.getLevel(resourceType);
    const after = before + delta;
    this.levels.set(resourceType, after);

    const transaction: ResourceTransaction = {
      id: `txn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      resourceType: resourceType as ResourceType,
      delta,
      beforeQuantity: before,
      afterQuantity: after,
      reason,
      civilizationId: '',
      timestamp: new Date().toISOString(),
    };

    // Requirement 12.4 — log all resource changes with before/after values
    this.logger.info('Resource updated', {
      resourceType,
      delta,
      before,
      after,
      reason,
    } as Record<string, unknown>);

    this.persistResource(resourceType, after);
    this.persistTransaction(transaction);
    this.checkThresholds(resourceType);
  }

  /** Check if a resource is below its minimum threshold. */
  isBelowThreshold(resourceType: string): boolean {
    const threshold = this.thresholdMap.get(resourceType);
    if (!threshold) return false;
    return this.getLevel(resourceType) < threshold.minimum;
  }

  /** Return alerts for all resources currently below their thresholds. */
  getLowResources(): ResourceAlert[] {
    const alerts: ResourceAlert[] = [];

    for (const [type, threshold] of this.thresholdMap) {
      const level = this.getLevel(type);
      if (level < threshold.critical) {
        alerts.push({
          resourceType: type as ResourceType,
          currentLevel: level,
          threshold: threshold.critical,
          severity: 'critical',
        });
      } else if (level < threshold.minimum) {
        alerts.push({
          resourceType: type as ResourceType,
          currentLevel: level,
          threshold: threshold.minimum,
          severity: 'warning',
        });
      }
    }

    return alerts;
  }

  /**
   * Predict total resource needs across a set of build phases.
   * Each phase contains an array of resource requirements.
   * Returns a Map of resourceType → total count needed.
   */
  predictNeeds(
    phases: Array<{ resources: Array<{ type: string; count: number }> }>,
  ): Map<string, number> {
    const needs = new Map<string, number>();

    for (const phase of phases) {
      for (const req of phase.resources) {
        needs.set(req.type, (needs.get(req.type) ?? 0) + req.count);
      }
    }

    return needs;
  }

  // ── internal helpers ──────────────────────────────────────────────

  private checkThresholds(resourceType: string): void {
    const threshold = this.thresholdMap.get(resourceType);
    if (!threshold) return;

    const level = this.getLevel(resourceType);

    if (level < threshold.critical) {
      const alert: ResourceAlert = {
        resourceType: resourceType as ResourceType,
        currentLevel: level,
        threshold: threshold.critical,
        severity: 'critical',
      };
      this.logger.warn('Resource critically low', {
        resourceType,
        level,
        critical: threshold.critical,
      } as Record<string, unknown>);
      this.fireAlert(alert);
    } else if (level < threshold.minimum) {
      const alert: ResourceAlert = {
        resourceType: resourceType as ResourceType,
        currentLevel: level,
        threshold: threshold.minimum,
        severity: 'warning',
      };
      this.logger.warn('Resource below minimum', {
        resourceType,
        level,
        minimum: threshold.minimum,
      } as Record<string, unknown>);
      this.fireAlert(alert);
    }
  }

  private fireAlert(alert: ResourceAlert): void {
    if (this.onAlert) {
      this.onAlert(alert);
    }
  }

  private persistResource(resourceType: string, level: number): void {
    if (this.onResourcePersist) {
      this.onResourcePersist(resourceType, level);
    }
  }

  private persistTransaction(transaction: ResourceTransaction): void {
    if (this.onTransactionPersist) {
      this.onTransactionPersist(transaction);
    }
  }
}
