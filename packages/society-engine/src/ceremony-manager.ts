/**
 * CeremonyManager — schedules and manages cultural ceremonies
 * (harvest festivals, pyramid dedications, coronations).
 *
 * Requirements: 28.1, 28.2, 28.3, 28.4, 28.6, 28.7, 28.8, 28.9, 28.10
 */

import type { Logger } from '@pyramid-os/logger';

// ── Types ───────────────────────────────────────────────────────────

export type CeremonyType = 'harvest_festival' | 'pyramid_dedication' | 'coronation';

export type CeremonyStatus = 'scheduled' | 'approved' | 'in_progress' | 'completed' | 'cancelled';

export interface CeremonyEffect {
  type: 'morale_boost' | 'resource_blessing' | 'production_bonus';
  value: number;
  durationMinutes: number;
}

export interface Ceremony {
  id: string;
  type: CeremonyType;
  name: string;
  scheduledAt: string; // ISO timestamp
  status: CeremonyStatus;
  civilizationId: string;
  templeZoneId: string;
  assignedPriests: string[];
  requiresApproval: boolean;
  effects: CeremonyEffect[];
}

/** Callback invoked to persist ceremony state changes. */
export type CeremonyPersistCallback = (ceremony: Ceremony) => void;

/** Callback invoked when a ceremony requires Pharaoh approval. */
export type ApprovalRequestCallback = (ceremony: Ceremony) => void;

export interface CeremonyManagerOptions {
  logger: Logger;
  onCeremonyPersist?: CeremonyPersistCallback;
  onApprovalRequest?: ApprovalRequestCallback;
}

/**
 * Ceremony type definitions with default effects.
 * Requirement 28.2: define ceremony types
 */
export const CEREMONY_DEFINITIONS: Record<CeremonyType, { requiresApproval: boolean; defaultEffects: CeremonyEffect[] }> = {
  harvest_festival: {
    requiresApproval: false,
    defaultEffects: [
      { type: 'morale_boost', value: 10, durationMinutes: 60 },
      { type: 'resource_blessing', value: 15, durationMinutes: 30 },
    ],
  },
  pyramid_dedication: {
    requiresApproval: true,
    defaultEffects: [
      { type: 'morale_boost', value: 25, durationMinutes: 120 },
      { type: 'production_bonus', value: 10, durationMinutes: 90 },
    ],
  },
  coronation: {
    requiresApproval: true,
    defaultEffects: [
      { type: 'morale_boost', value: 50, durationMinutes: 180 },
      { type: 'resource_blessing', value: 20, durationMinutes: 120 },
      { type: 'production_bonus', value: 15, durationMinutes: 120 },
    ],
  },
};

export class CeremonyManager {
  private readonly ceremonies = new Map<string, Ceremony>();
  private readonly logger: Logger;
  private readonly onCeremonyPersist: CeremonyPersistCallback | undefined;
  private readonly onApprovalRequest: ApprovalRequestCallback | undefined;

  constructor(options: CeremonyManagerOptions) {
    this.logger = options.logger;
    this.onCeremonyPersist = options.onCeremonyPersist;
    this.onApprovalRequest = options.onApprovalRequest;
  }

  /**
   * Schedule a ceremony. If the ceremony requires Pharaoh approval,
   * it stays in 'scheduled' status and an approval request is emitted.
   * Otherwise it is immediately marked 'approved'.
   *
   * Requirement 28.1: perform ceremonies at temples on scheduled intervals
   * Requirement 28.6: Pharaoh approval for major ceremonies
   */
  scheduleCeremony(ceremony: Ceremony): void {
    // Apply default effects from ceremony type definitions if none provided
    if (ceremony.effects.length === 0) {
      const def = CEREMONY_DEFINITIONS[ceremony.type];
      if (def) {
        ceremony.effects = [...def.defaultEffects];
      }
    }

    // Determine approval requirement from type definition if not explicitly set
    const def = CEREMONY_DEFINITIONS[ceremony.type];
    if (def && ceremony.requiresApproval === undefined) {
      ceremony.requiresApproval = def.requiresApproval;
    }

    if (ceremony.requiresApproval) {
      ceremony.status = 'scheduled';
      this.logger.info('Ceremony scheduled — awaiting Pharaoh approval', {
        ceremonyId: ceremony.id,
        type: ceremony.type,
      } as Record<string, unknown>);

      this.ceremonies.set(ceremony.id, ceremony);
      this.persist(ceremony);

      if (this.onApprovalRequest) {
        this.onApprovalRequest(ceremony);
      }
    } else {
      ceremony.status = 'approved';
      this.logger.info('Ceremony scheduled and auto-approved', {
        ceremonyId: ceremony.id,
        type: ceremony.type,
      } as Record<string, unknown>);

      this.ceremonies.set(ceremony.id, ceremony);
      this.persist(ceremony);
    }
  }

  /**
   * Approve a ceremony that requires Pharaoh approval.
   * Requirement 28.6: Pharaoh approval for major ceremonies
   */
  approveCeremony(ceremonyId: string): void {
    const ceremony = this.ceremonies.get(ceremonyId);
    if (!ceremony) {
      this.logger.warn('Cannot approve — ceremony not found', { ceremonyId } as Record<string, unknown>);
      return;
    }
    if (ceremony.status !== 'scheduled') {
      this.logger.warn('Cannot approve — ceremony is not in scheduled status', {
        ceremonyId,
        currentStatus: ceremony.status,
      } as Record<string, unknown>);
      return;
    }

    ceremony.status = 'approved';
    this.persist(ceremony);
    this.logger.info('Ceremony approved by Pharaoh', {
      ceremonyId,
      type: ceremony.type,
    } as Record<string, unknown>);
  }

  /**
   * Start a ceremony — marks it as in_progress.
   * Only approved ceremonies can be started.
   *
   * Requirement 28.8: coordinate bot participation in ceremonies
   */
  startCeremony(ceremonyId: string): void {
    const ceremony = this.ceremonies.get(ceremonyId);
    if (!ceremony) {
      this.logger.warn('Cannot start — ceremony not found', { ceremonyId } as Record<string, unknown>);
      return;
    }
    if (ceremony.status !== 'approved') {
      this.logger.warn('Cannot start — ceremony is not approved', {
        ceremonyId,
        currentStatus: ceremony.status,
      } as Record<string, unknown>);
      return;
    }

    ceremony.status = 'in_progress';
    this.persist(ceremony);
    this.logger.info('Ceremony started', {
      ceremonyId,
      type: ceremony.type,
      assignedPriests: ceremony.assignedPriests,
    } as Record<string, unknown>);
  }

  /**
   * Complete a ceremony and return its effects to be applied.
   *
   * Requirement 28.7: record ceremony completions
   * Requirement 28.9: apply ceremony effects on completion
   */
  completeCeremony(ceremonyId: string): CeremonyEffect[] {
    const ceremony = this.ceremonies.get(ceremonyId);
    if (!ceremony) {
      this.logger.warn('Cannot complete — ceremony not found', { ceremonyId } as Record<string, unknown>);
      return [];
    }
    if (ceremony.status !== 'in_progress') {
      this.logger.warn('Cannot complete — ceremony is not in progress', {
        ceremonyId,
        currentStatus: ceremony.status,
      } as Record<string, unknown>);
      return [];
    }

    ceremony.status = 'completed';
    this.persist(ceremony);
    this.logger.info('Ceremony completed — effects applied', {
      ceremonyId,
      type: ceremony.type,
      effectCount: ceremony.effects.length,
    } as Record<string, unknown>);

    return [...ceremony.effects];
  }

  /** Cancel a ceremony. */
  cancelCeremony(ceremonyId: string): void {
    const ceremony = this.ceremonies.get(ceremonyId);
    if (!ceremony) {
      this.logger.warn('Cannot cancel — ceremony not found', { ceremonyId } as Record<string, unknown>);
      return;
    }
    if (ceremony.status === 'completed' || ceremony.status === 'cancelled') {
      this.logger.warn('Cannot cancel — ceremony already finalized', {
        ceremonyId,
        currentStatus: ceremony.status,
      } as Record<string, unknown>);
      return;
    }

    ceremony.status = 'cancelled';
    this.persist(ceremony);
    this.logger.info('Ceremony cancelled', { ceremonyId, type: ceremony.type } as Record<string, unknown>);
  }

  /** Retrieve a ceremony by ID. */
  getCeremony(ceremonyId: string): Ceremony | undefined {
    return this.ceremonies.get(ceremonyId);
  }

  /**
   * List upcoming ceremonies (scheduled or approved), sorted by scheduledAt ascending.
   */
  listUpcoming(): Ceremony[] {
    return [...this.ceremonies.values()]
      .filter((c) => c.status === 'scheduled' || c.status === 'approved')
      .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
  }

  /**
   * Assign a Priest worker to a ceremony.
   *
   * Requirement 28.3: assign Priest Worker_Agent instances to ceremony tasks
   */
  assignPriest(ceremonyId: string, priestId: string): void {
    const ceremony = this.ceremonies.get(ceremonyId);
    if (!ceremony) {
      this.logger.warn('Cannot assign priest — ceremony not found', { ceremonyId } as Record<string, unknown>);
      return;
    }
    if (ceremony.assignedPriests.includes(priestId)) {
      this.logger.warn('Priest already assigned to ceremony', {
        ceremonyId,
        priestId,
      } as Record<string, unknown>);
      return;
    }

    ceremony.assignedPriests.push(priestId);
    this.persist(ceremony);
    this.logger.info('Priest assigned to ceremony', {
      ceremonyId,
      priestId,
      totalPriests: ceremony.assignedPriests.length,
    } as Record<string, unknown>);
  }

  // ── internal helpers ──────────────────────────────────────────────

  private persist(ceremony: Ceremony): void {
    if (this.onCeremonyPersist) {
      this.onCeremonyPersist(ceremony);
    }
  }
}
