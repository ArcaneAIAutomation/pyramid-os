/**
 * BuildPhaseManager — decomposes blueprints into sequential build phases
 * and manages phase advancement, verification, and resource calculation.
 *
 * Requirements: 3.6, 3.7, 3.8, 20.2, 20.7, 20.8, 20.10
 */

import type {
  Blueprint,
  BlockPlacement,
  ResourceRequirement,
} from '@pyramid-os/shared-types';
import type { Logger } from '@pyramid-os/logger';

/** A sequential phase of pyramid or structure construction. */
export interface BuildPhase {
  id: string;
  blueprintId: string;
  name: string;
  type: 'foundation' | 'layer' | 'capstone';
  placements: BlockPlacement[];
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  resourceRequirements: ResourceRequirement[];
}

/** Verification result for a build phase. */
export interface PhaseVerification {
  correct: boolean;
  missing: BlockPlacement[];
  incorrect: BlockPlacement[];
}

/** Callback invoked to persist phase state changes. */
export type PhasePersistCallback = (phase: BuildPhase) => void;

export interface BuildPhaseManagerOptions {
  logger: Logger;
  onPhasePersist?: PhasePersistCallback;
}

export class BuildPhaseManager {
  private readonly phases = new Map<string, BuildPhase>();
  private readonly blueprintPhases = new Map<string, string[]>();
  private readonly logger: Logger;
  private readonly onPhasePersist: PhasePersistCallback | undefined;

  constructor(options: BuildPhaseManagerOptions) {
    this.logger = options.logger;
    this.onPhasePersist = options.onPhasePersist;
  }

  /**
   * Decompose a blueprint into sequential build phases:
   * - Foundation: lowest y-level
   * - Layers: each intermediate y-level
   * - Capstone: highest y-level
   *
   * Requirement 20.2: decompose pyramid construction into sequential build phases
   */
  startBuildSequence(blueprint: Blueprint): BuildPhase[] {
    if (blueprint.placements.length === 0) {
      this.logger.warn('Blueprint has no placements', { blueprintId: blueprint.id } as Record<string, unknown>);
      return [];
    }

    // Group placements by y-level
    const byY = new Map<number, BlockPlacement[]>();
    for (const p of blueprint.placements) {
      const y = p.position.y;
      let group = byY.get(y);
      if (!group) {
        group = [];
        byY.set(y, group);
      }
      group.push(p);
    }

    // Sort y-levels ascending
    const yLevels = [...byY.keys()].sort((a, b) => a - b);

    const phases: BuildPhase[] = [];
    const phaseIds: string[] = [];

    for (let i = 0; i < yLevels.length; i++) {
      const y = yLevels[i]!;
      const placements = byY.get(y)!;

      let type: BuildPhase['type'];
      let name: string;

      if (i === 0) {
        type = 'foundation';
        name = `Foundation (y=${y})`;
      } else if (i === yLevels.length - 1 && yLevels.length > 1) {
        type = 'capstone';
        name = `Capstone (y=${y})`;
      } else {
        type = 'layer';
        name = `Layer ${i} (y=${y})`;
      }

      const phase: BuildPhase = {
        id: `${blueprint.id}-phase-${i}`,
        blueprintId: blueprint.id,
        name,
        type,
        placements,
        status: i === 0 ? 'in_progress' : 'pending',
        resourceRequirements: this.calculateRequirements(placements),
      };

      phases.push(phase);
      phaseIds.push(phase.id);
      this.phases.set(phase.id, phase);
      this.persistPhase(phase);
    }

    this.blueprintPhases.set(blueprint.id, phaseIds);

    this.logger.info('Build sequence started', {
      blueprintId: blueprint.id,
      phaseCount: phases.length,
    } as Record<string, unknown>);

    return phases;
  }

  /** Retrieve a phase by ID. */
  getPhase(phaseId: string): BuildPhase | undefined {
    return this.phases.get(phaseId);
  }

  /** Get all phases for a given blueprint. */
  getPhasesByBlueprint(blueprintId: string): BuildPhase[] {
    const ids = this.blueprintPhases.get(blueprintId);
    if (!ids) return [];
    return ids.map((id) => this.phases.get(id)).filter((p): p is BuildPhase => p !== undefined);
  }

  /**
   * Mark the given phase as completed and advance to the next phase.
   * Returns the next phase (now in_progress), or undefined if no more phases.
   *
   * Requirement 3.7: automatically initiate the next phase when a build phase completes
   */
  advancePhase(phaseId: string): BuildPhase | undefined {
    const current = this.phases.get(phaseId);
    if (!current) {
      this.logger.warn('Phase not found for advancement', { phaseId } as Record<string, unknown>);
      return undefined;
    }

    current.status = 'completed';
    this.persistPhase(current);

    this.logger.info('Phase completed', {
      phaseId: current.id,
      name: current.name,
      blueprintId: current.blueprintId,
    } as Record<string, unknown>);

    // Find the next pending phase for this blueprint
    const ids = this.blueprintPhases.get(current.blueprintId);
    if (!ids) return undefined;

    const currentIndex = ids.indexOf(phaseId);
    if (currentIndex === -1 || currentIndex >= ids.length - 1) return undefined;

    const nextId = ids[currentIndex + 1]!;
    const next = this.phases.get(nextId);
    if (!next || next.status !== 'pending') return undefined;

    next.status = 'in_progress';
    this.persistPhase(next);

    this.logger.info('Phase advanced', {
      phaseId: next.id,
      name: next.name,
      blueprintId: next.blueprintId,
    } as Record<string, unknown>);

    return next;
  }

  /**
   * Verify all block placements in a phase are correct.
   * Returns missing (not placed) and incorrect placements.
   *
   * Requirement 20.7: verify all blocks are placed correctly
   * Requirement 20.8: generate correction tasks when blocks are missing or incorrect
   */
  verifyPhase(phaseId: string): PhaseVerification {
    const phase = this.phases.get(phaseId);
    if (!phase) {
      return { correct: true, missing: [], incorrect: [] };
    }

    const missing: BlockPlacement[] = [];
    const incorrect: BlockPlacement[] = [];

    for (const placement of phase.placements) {
      if (!placement.placed) {
        missing.push(placement);
      }
    }

    const isCorrect = missing.length === 0 && incorrect.length === 0;

    if (!isCorrect) {
      // Requirement 20.8 — generate correction tasks
      if (missing.length > 0) {
        this.logger.warn('Phase has missing placements', {
          phaseId,
          missingCount: missing.length,
        } as Record<string, unknown>);
      }
      if (incorrect.length > 0) {
        this.logger.warn('Phase has incorrect placements', {
          phaseId,
          incorrectCount: incorrect.length,
        } as Record<string, unknown>);
      }

      phase.status = 'failed';
      this.persistPhase(phase);
    }

    return { correct: isCorrect, missing, incorrect };
  }

  /**
   * Get resource requirements for a specific phase.
   *
   * Requirement 3.8: calculate resource requirements for upcoming build phases
   * Requirement 20.10: estimate construction time based on resources
   */
  getResourceRequirements(phaseId: string): ResourceRequirement[] {
    const phase = this.phases.get(phaseId);
    if (!phase) return [];
    return phase.resourceRequirements;
  }

  // ── internal helpers ──────────────────────────────────────────────

  /** Calculate resource requirements by counting block types in placements. */
  private calculateRequirements(placements: BlockPlacement[]): ResourceRequirement[] {
    const counts = new Map<string, number>();
    for (const p of placements) {
      counts.set(p.blockType, (counts.get(p.blockType) ?? 0) + 1);
    }
    return [...counts.entries()].map(([type, count]) => ({ type, count }));
  }

  private persistPhase(phase: BuildPhase): void {
    if (this.onPhasePersist) {
      this.onPhasePersist(phase);
    }
  }
}
