import { describe, it, expect, vi } from 'vitest';
import type { Logger } from '@pyramid-os/logger';
import {
  CeremonyManager,
  CEREMONY_DEFINITIONS,
  type Ceremony,
  type CeremonyPersistCallback,
  type ApprovalRequestCallback,
  type CeremonyManagerOptions,
} from '../ceremony-manager.js';

// ── helpers ─────────────────────────────────────────────────────────

function createMockLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function createCeremony(overrides: Partial<Ceremony> = {}): Ceremony {
  return {
    id: 'cer-1',
    type: 'harvest_festival',
    name: 'Autumn Harvest Festival',
    scheduledAt: '2025-09-21T12:00:00Z',
    status: 'scheduled',
    civilizationId: 'civ-1',
    templeZoneId: 'zone-temple-1',
    assignedPriests: [],
    requiresApproval: false,
    effects: [],
    ...overrides,
  };
}

function createManager(
  overrides: Partial<CeremonyManagerOptions> = {},
) {
  const logger = createMockLogger();
  const manager = new CeremonyManager({
    logger,
    ...overrides,
  });
  return { manager, logger };
}

// ── tests ───────────────────────────────────────────────────────────

describe('CeremonyManager', () => {
  // ── scheduleCeremony ──────────────────────────────────────────────

  describe('scheduleCeremony', () => {
    it('auto-approves a ceremony that does not require approval', () => {
      const { manager } = createManager();
      const cer = createCeremony({ requiresApproval: false });

      manager.scheduleCeremony(cer);

      const stored = manager.getCeremony('cer-1');
      expect(stored).toBeDefined();
      expect(stored!.status).toBe('approved');
    });

    it('keeps ceremony in scheduled status when approval is required', () => {
      const { manager } = createManager();
      const cer = createCeremony({
        id: 'cer-2',
        type: 'coronation',
        requiresApproval: true,
      });

      manager.scheduleCeremony(cer);

      const stored = manager.getCeremony('cer-2');
      expect(stored).toBeDefined();
      expect(stored!.status).toBe('scheduled');
    });

    it('fires approval request callback for ceremonies requiring approval', () => {
      const onApprovalRequest = vi.fn();
      const { manager } = createManager({ onApprovalRequest });
      const cer = createCeremony({
        type: 'pyramid_dedication',
        requiresApproval: true,
      });

      manager.scheduleCeremony(cer);

      expect(onApprovalRequest).toHaveBeenCalledTimes(1);
      expect(onApprovalRequest).toHaveBeenCalledWith(expect.objectContaining({ id: 'cer-1' }));
    });

    it('does not fire approval request callback for auto-approved ceremonies', () => {
      const onApprovalRequest = vi.fn();
      const { manager } = createManager({ onApprovalRequest });
      const cer = createCeremony({ requiresApproval: false });

      manager.scheduleCeremony(cer);

      expect(onApprovalRequest).not.toHaveBeenCalled();
    });

    it('applies default effects from ceremony type definitions when none provided', () => {
      const { manager } = createManager();
      const cer = createCeremony({ effects: [] });

      manager.scheduleCeremony(cer);

      const stored = manager.getCeremony('cer-1');
      expect(stored!.effects).toEqual(CEREMONY_DEFINITIONS.harvest_festival.defaultEffects);
    });

    it('preserves custom effects when provided', () => {
      const { manager } = createManager();
      const customEffects = [{ type: 'morale_boost' as const, value: 99, durationMinutes: 999 }];
      const cer = createCeremony({ effects: customEffects });

      manager.scheduleCeremony(cer);

      const stored = manager.getCeremony('cer-1');
      expect(stored!.effects).toEqual(customEffects);
    });

    it('persists the ceremony via callback', () => {
      const onCeremonyPersist = vi.fn();
      const { manager } = createManager({ onCeremonyPersist });

      manager.scheduleCeremony(createCeremony());

      expect(onCeremonyPersist).toHaveBeenCalledTimes(1);
    });
  });

  // ── approveCeremony ───────────────────────────────────────────────

  describe('approveCeremony', () => {
    it('approves a scheduled ceremony', () => {
      const { manager } = createManager();
      const cer = createCeremony({ type: 'coronation', requiresApproval: true });
      manager.scheduleCeremony(cer);

      manager.approveCeremony('cer-1');

      expect(manager.getCeremony('cer-1')!.status).toBe('approved');
    });

    it('does nothing for a non-existent ceremony', () => {
      const { manager, logger } = createManager();

      manager.approveCeremony('nonexistent');

      expect(logger.warn).toHaveBeenCalled();
    });

    it('does not approve an already approved ceremony', () => {
      const { manager, logger } = createManager();
      const cer = createCeremony({ requiresApproval: false }); // auto-approved
      manager.scheduleCeremony(cer);

      manager.approveCeremony('cer-1');

      expect(logger.warn).toHaveBeenCalledWith(
        'Cannot approve — ceremony is not in scheduled status',
        expect.any(Object),
      );
    });
  });

  // ── startCeremony ─────────────────────────────────────────────────

  describe('startCeremony', () => {
    it('starts an approved ceremony', () => {
      const { manager } = createManager();
      const cer = createCeremony({ requiresApproval: false });
      manager.scheduleCeremony(cer);

      manager.startCeremony('cer-1');

      expect(manager.getCeremony('cer-1')!.status).toBe('in_progress');
    });

    it('does not start a scheduled (unapproved) ceremony', () => {
      const { manager, logger } = createManager();
      const cer = createCeremony({ type: 'coronation', requiresApproval: true });
      manager.scheduleCeremony(cer);

      manager.startCeremony('cer-1');

      expect(manager.getCeremony('cer-1')!.status).toBe('scheduled');
      expect(logger.warn).toHaveBeenCalled();
    });

    it('does nothing for a non-existent ceremony', () => {
      const { manager, logger } = createManager();

      manager.startCeremony('nonexistent');

      expect(logger.warn).toHaveBeenCalled();
    });
  });

  // ── completeCeremony ──────────────────────────────────────────────

  describe('completeCeremony', () => {
    it('completes an in-progress ceremony and returns effects', () => {
      const { manager } = createManager();
      const cer = createCeremony({ requiresApproval: false });
      manager.scheduleCeremony(cer);
      manager.startCeremony('cer-1');

      const effects = manager.completeCeremony('cer-1');

      expect(manager.getCeremony('cer-1')!.status).toBe('completed');
      expect(effects).toEqual(CEREMONY_DEFINITIONS.harvest_festival.defaultEffects);
    });

    it('returns empty array for non-existent ceremony', () => {
      const { manager } = createManager();

      const effects = manager.completeCeremony('nonexistent');

      expect(effects).toEqual([]);
    });

    it('returns empty array if ceremony is not in progress', () => {
      const { manager } = createManager();
      const cer = createCeremony({ requiresApproval: false });
      manager.scheduleCeremony(cer);

      const effects = manager.completeCeremony('cer-1');

      expect(effects).toEqual([]);
      expect(manager.getCeremony('cer-1')!.status).toBe('approved');
    });

    it('persists the completed ceremony', () => {
      const onCeremonyPersist = vi.fn();
      const { manager } = createManager({ onCeremonyPersist });
      const cer = createCeremony({ requiresApproval: false });
      manager.scheduleCeremony(cer);
      manager.startCeremony('cer-1');
      onCeremonyPersist.mockClear();

      manager.completeCeremony('cer-1');

      expect(onCeremonyPersist).toHaveBeenCalledTimes(1);
      expect(onCeremonyPersist).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'completed' }),
      );
    });
  });

  // ── cancelCeremony ────────────────────────────────────────────────

  describe('cancelCeremony', () => {
    it('cancels a scheduled ceremony', () => {
      const { manager } = createManager();
      const cer = createCeremony({ type: 'coronation', requiresApproval: true });
      manager.scheduleCeremony(cer);

      manager.cancelCeremony('cer-1');

      expect(manager.getCeremony('cer-1')!.status).toBe('cancelled');
    });

    it('cancels an approved ceremony', () => {
      const { manager } = createManager();
      const cer = createCeremony({ requiresApproval: false });
      manager.scheduleCeremony(cer);

      manager.cancelCeremony('cer-1');

      expect(manager.getCeremony('cer-1')!.status).toBe('cancelled');
    });

    it('cancels an in-progress ceremony', () => {
      const { manager } = createManager();
      const cer = createCeremony({ requiresApproval: false });
      manager.scheduleCeremony(cer);
      manager.startCeremony('cer-1');

      manager.cancelCeremony('cer-1');

      expect(manager.getCeremony('cer-1')!.status).toBe('cancelled');
    });

    it('does not cancel an already completed ceremony', () => {
      const { manager, logger } = createManager();
      const cer = createCeremony({ requiresApproval: false });
      manager.scheduleCeremony(cer);
      manager.startCeremony('cer-1');
      manager.completeCeremony('cer-1');

      manager.cancelCeremony('cer-1');

      expect(manager.getCeremony('cer-1')!.status).toBe('completed');
      expect(logger.warn).toHaveBeenCalledWith(
        'Cannot cancel — ceremony already finalized',
        expect.any(Object),
      );
    });

    it('does not cancel an already cancelled ceremony', () => {
      const { manager } = createManager();
      const cer = createCeremony({ type: 'coronation', requiresApproval: true });
      manager.scheduleCeremony(cer);
      manager.cancelCeremony('cer-1');

      // Second cancel should warn
      manager.cancelCeremony('cer-1');

      expect(manager.getCeremony('cer-1')!.status).toBe('cancelled');
    });

    it('does nothing for a non-existent ceremony', () => {
      const { manager, logger } = createManager();

      manager.cancelCeremony('nonexistent');

      expect(logger.warn).toHaveBeenCalled();
    });
  });

  // ── getCeremony ───────────────────────────────────────────────────

  describe('getCeremony', () => {
    it('returns a ceremony by ID', () => {
      const { manager } = createManager();
      manager.scheduleCeremony(createCeremony());

      const found = manager.getCeremony('cer-1');
      expect(found).toBeDefined();
      expect(found!.name).toBe('Autumn Harvest Festival');
    });

    it('returns undefined for unknown ID', () => {
      const { manager } = createManager();
      expect(manager.getCeremony('nonexistent')).toBeUndefined();
    });
  });

  // ── listUpcoming ──────────────────────────────────────────────────

  describe('listUpcoming', () => {
    it('returns scheduled and approved ceremonies sorted by scheduledAt', () => {
      const { manager } = createManager();

      manager.scheduleCeremony(createCeremony({
        id: 'cer-late',
        scheduledAt: '2025-12-01T00:00:00Z',
        requiresApproval: false,
      }));
      manager.scheduleCeremony(createCeremony({
        id: 'cer-early',
        scheduledAt: '2025-06-01T00:00:00Z',
        requiresApproval: false,
      }));
      manager.scheduleCeremony(createCeremony({
        id: 'cer-mid',
        scheduledAt: '2025-09-01T00:00:00Z',
        type: 'coronation',
        requiresApproval: true,
      }));

      const upcoming = manager.listUpcoming();

      expect(upcoming).toHaveLength(3);
      expect(upcoming[0]!.id).toBe('cer-early');
      expect(upcoming[1]!.id).toBe('cer-mid');
      expect(upcoming[2]!.id).toBe('cer-late');
    });

    it('excludes completed and cancelled ceremonies', () => {
      const { manager } = createManager();

      manager.scheduleCeremony(createCeremony({ id: 'cer-a', requiresApproval: false }));
      manager.scheduleCeremony(createCeremony({ id: 'cer-b', requiresApproval: false }));
      manager.scheduleCeremony(createCeremony({ id: 'cer-c', requiresApproval: false }));

      manager.startCeremony('cer-a');
      manager.completeCeremony('cer-a');
      manager.cancelCeremony('cer-b');

      const upcoming = manager.listUpcoming();
      expect(upcoming).toHaveLength(1);
      expect(upcoming[0]!.id).toBe('cer-c');
    });

    it('includes in_progress ceremonies are excluded', () => {
      const { manager } = createManager();
      manager.scheduleCeremony(createCeremony({ id: 'cer-ip', requiresApproval: false }));
      manager.startCeremony('cer-ip');

      const upcoming = manager.listUpcoming();
      expect(upcoming).toHaveLength(0);
    });

    it('returns empty array when no ceremonies exist', () => {
      const { manager } = createManager();
      expect(manager.listUpcoming()).toEqual([]);
    });
  });

  // ── assignPriest ──────────────────────────────────────────────────

  describe('assignPriest', () => {
    it('assigns a priest to a ceremony', () => {
      const { manager } = createManager();
      manager.scheduleCeremony(createCeremony());

      manager.assignPriest('cer-1', 'priest-1');

      const cer = manager.getCeremony('cer-1');
      expect(cer!.assignedPriests).toContain('priest-1');
    });

    it('assigns multiple priests to a ceremony', () => {
      const { manager } = createManager();
      manager.scheduleCeremony(createCeremony());

      manager.assignPriest('cer-1', 'priest-1');
      manager.assignPriest('cer-1', 'priest-2');

      const cer = manager.getCeremony('cer-1');
      expect(cer!.assignedPriests).toEqual(['priest-1', 'priest-2']);
    });

    it('does not duplicate a priest assignment', () => {
      const { manager, logger } = createManager();
      manager.scheduleCeremony(createCeremony());

      manager.assignPriest('cer-1', 'priest-1');
      manager.assignPriest('cer-1', 'priest-1');

      const cer = manager.getCeremony('cer-1');
      expect(cer!.assignedPriests).toEqual(['priest-1']);
      expect(logger.warn).toHaveBeenCalledWith(
        'Priest already assigned to ceremony',
        expect.any(Object),
      );
    });

    it('does nothing for a non-existent ceremony', () => {
      const { manager, logger } = createManager();

      manager.assignPriest('nonexistent', 'priest-1');

      expect(logger.warn).toHaveBeenCalled();
    });

    it('persists after assigning a priest', () => {
      const onCeremonyPersist = vi.fn();
      const { manager } = createManager({ onCeremonyPersist });
      manager.scheduleCeremony(createCeremony());
      onCeremonyPersist.mockClear();

      manager.assignPriest('cer-1', 'priest-1');

      expect(onCeremonyPersist).toHaveBeenCalledTimes(1);
    });
  });

  // ── full lifecycle ────────────────────────────────────────────────

  describe('full lifecycle', () => {
    it('handles the complete ceremony lifecycle: schedule → approve → start → complete', () => {
      const { manager } = createManager();
      const cer = createCeremony({
        type: 'coronation',
        requiresApproval: true,
      });

      manager.scheduleCeremony(cer);
      expect(manager.getCeremony('cer-1')!.status).toBe('scheduled');

      manager.approveCeremony('cer-1');
      expect(manager.getCeremony('cer-1')!.status).toBe('approved');

      manager.assignPriest('cer-1', 'priest-1');
      manager.assignPriest('cer-1', 'priest-2');

      manager.startCeremony('cer-1');
      expect(manager.getCeremony('cer-1')!.status).toBe('in_progress');

      const effects = manager.completeCeremony('cer-1');
      expect(manager.getCeremony('cer-1')!.status).toBe('completed');
      expect(effects.length).toBeGreaterThan(0);
    });
  });

  // ── CEREMONY_DEFINITIONS ──────────────────────────────────────────

  describe('CEREMONY_DEFINITIONS', () => {
    it('defines harvest_festival as not requiring approval', () => {
      expect(CEREMONY_DEFINITIONS.harvest_festival.requiresApproval).toBe(false);
    });

    it('defines pyramid_dedication as requiring approval', () => {
      expect(CEREMONY_DEFINITIONS.pyramid_dedication.requiresApproval).toBe(true);
    });

    it('defines coronation as requiring approval', () => {
      expect(CEREMONY_DEFINITIONS.coronation.requiresApproval).toBe(true);
    });

    it('all ceremony types have at least one default effect', () => {
      for (const [, def] of Object.entries(CEREMONY_DEFINITIONS)) {
        expect(def.defaultEffects.length).toBeGreaterThan(0);
      }
    });
  });
});
