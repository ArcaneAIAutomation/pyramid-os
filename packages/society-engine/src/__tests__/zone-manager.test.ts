import { describe, it, expect, vi } from 'vitest';
import type { Logger } from '@pyramid-os/logger';
import {
  ZoneManager,
  type Zone,
  type ZonePersistCallback,
  type ZoneDeleteCallback,
} from '../zone-manager.js';

// ── helpers ─────────────────────────────────────────────────────────

function createMockLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function makeZone(overrides: Partial<Zone> = {}): Zone {
  return {
    id: 'zone-1',
    name: 'Main Quarry',
    type: 'quarry',
    min: { x: 0, y: 0, z: 0 },
    max: { x: 100, y: 64, z: 100 },
    civilizationId: 'civ-1',
    assignedAgents: [],
    ...overrides,
  };
}

function createManager(overrides: {
  onZonePersist?: ZonePersistCallback;
  onZoneDelete?: ZoneDeleteCallback;
} = {}) {
  const logger = createMockLogger();
  const manager = new ZoneManager({
    logger,
    ...overrides,
  });
  return { manager, logger };
}

// ── tests ───────────────────────────────────────────────────────────

describe('ZoneManager', () => {
  // ── defineZone ──────────────────────────────────────────────────

  describe('defineZone', () => {
    it('registers a zone that can be retrieved', () => {
      const { manager } = createManager();
      const zone = makeZone();
      manager.defineZone(zone);
      expect(manager.getZone('zone-1')).toEqual(zone);
    });

    it('persists the zone via callback', () => {
      const onZonePersist = vi.fn();
      const { manager } = createManager({ onZonePersist });
      const zone = makeZone();

      manager.defineZone(zone);

      expect(onZonePersist).toHaveBeenCalledTimes(1);
      expect(onZonePersist).toHaveBeenCalledWith(expect.objectContaining({ id: 'zone-1' }));
    });

    it('logs the zone definition', () => {
      const { manager, logger } = createManager();
      manager.defineZone(makeZone({ name: 'Temple District' }));

      expect(logger.info).toHaveBeenCalledWith(
        'Zone defined',
        expect.objectContaining({ name: 'Temple District' }),
      );
    });

    it('stores a defensive copy (mutations do not affect stored zone)', () => {
      const { manager } = createManager();
      const zone = makeZone();
      manager.defineZone(zone);

      zone.name = 'MUTATED';
      zone.assignedAgents.push('rogue-agent');

      const stored = manager.getZone('zone-1')!;
      expect(stored.name).toBe('Main Quarry');
      expect(stored.assignedAgents).toEqual([]);
    });
  });

  // ── getZone ─────────────────────────────────────────────────────

  describe('getZone', () => {
    it('returns undefined for unknown zone', () => {
      const { manager } = createManager();
      expect(manager.getZone('nonexistent')).toBeUndefined();
    });

    it('returns a clone (mutations do not affect internal state)', () => {
      const { manager } = createManager();
      manager.defineZone(makeZone());

      const retrieved = manager.getZone('zone-1')!;
      retrieved.name = 'MUTATED';
      retrieved.assignedAgents.push('rogue');

      expect(manager.getZone('zone-1')!.name).toBe('Main Quarry');
      expect(manager.getZone('zone-1')!.assignedAgents).toEqual([]);
    });
  });

  // ── listZones ───────────────────────────────────────────────────

  describe('listZones', () => {
    it('returns empty array when no zones defined', () => {
      const { manager } = createManager();
      expect(manager.listZones()).toEqual([]);
    });

    it('returns all defined zones', () => {
      const { manager } = createManager();
      manager.defineZone(makeZone({ id: 'z1', name: 'Quarry' }));
      manager.defineZone(makeZone({ id: 'z2', name: 'Farm', type: 'farm' }));

      const zones = manager.listZones();
      expect(zones).toHaveLength(2);
      expect(zones.map((z) => z.id).sort()).toEqual(['z1', 'z2']);
    });
  });

  // ── assignAgentToZone ───────────────────────────────────────────

  describe('assignAgentToZone', () => {
    it('adds agent to zone assignedAgents', () => {
      const { manager } = createManager();
      manager.defineZone(makeZone());

      manager.assignAgentToZone('agent-1', 'zone-1');

      expect(manager.getZone('zone-1')!.assignedAgents).toEqual(['agent-1']);
    });

    it('does not duplicate an already-assigned agent', () => {
      const { manager } = createManager();
      manager.defineZone(makeZone());

      manager.assignAgentToZone('agent-1', 'zone-1');
      manager.assignAgentToZone('agent-1', 'zone-1');

      expect(manager.getZone('zone-1')!.assignedAgents).toEqual(['agent-1']);
    });

    it('supports multiple agents in the same zone', () => {
      const { manager } = createManager();
      manager.defineZone(makeZone());

      manager.assignAgentToZone('agent-1', 'zone-1');
      manager.assignAgentToZone('agent-2', 'zone-1');

      expect(manager.getZone('zone-1')!.assignedAgents).toEqual(['agent-1', 'agent-2']);
    });

    it('persists after assignment', () => {
      const onZonePersist = vi.fn();
      const { manager } = createManager({ onZonePersist });
      manager.defineZone(makeZone());
      onZonePersist.mockClear();

      manager.assignAgentToZone('agent-1', 'zone-1');

      expect(onZonePersist).toHaveBeenCalledTimes(1);
      const persisted = onZonePersist.mock.calls[0]![0] as Zone;
      expect(persisted.assignedAgents).toContain('agent-1');
    });

    it('warns and does nothing for unknown zone', () => {
      const { manager, logger } = createManager();

      manager.assignAgentToZone('agent-1', 'nonexistent');

      expect(logger.warn).toHaveBeenCalledWith(
        'Cannot assign agent to unknown zone',
        expect.objectContaining({ agentId: 'agent-1', zoneId: 'nonexistent' }),
      );
    });

    it('logs the assignment', () => {
      const { manager, logger } = createManager();
      manager.defineZone(makeZone());

      manager.assignAgentToZone('agent-1', 'zone-1');

      expect(logger.info).toHaveBeenCalledWith(
        'Agent assigned to zone',
        expect.objectContaining({ agentId: 'agent-1', zoneId: 'zone-1' }),
      );
    });
  });

  // ── unassignAgent ───────────────────────────────────────────────

  describe('unassignAgent', () => {
    it('removes agent from zone', () => {
      const { manager } = createManager();
      manager.defineZone(makeZone());
      manager.assignAgentToZone('agent-1', 'zone-1');

      manager.unassignAgent('agent-1', 'zone-1');

      expect(manager.getZone('zone-1')!.assignedAgents).toEqual([]);
    });

    it('does nothing for agent not in zone', () => {
      const onZonePersist = vi.fn();
      const { manager } = createManager({ onZonePersist });
      manager.defineZone(makeZone());
      onZonePersist.mockClear();

      manager.unassignAgent('agent-99', 'zone-1');

      expect(onZonePersist).not.toHaveBeenCalled();
    });

    it('does nothing for unknown zone', () => {
      const { manager } = createManager();
      // should not throw
      manager.unassignAgent('agent-1', 'nonexistent');
    });

    it('persists after unassignment', () => {
      const onZonePersist = vi.fn();
      const { manager } = createManager({ onZonePersist });
      manager.defineZone(makeZone());
      manager.assignAgentToZone('agent-1', 'zone-1');
      onZonePersist.mockClear();

      manager.unassignAgent('agent-1', 'zone-1');

      expect(onZonePersist).toHaveBeenCalledTimes(1);
      const persisted = onZonePersist.mock.calls[0]![0] as Zone;
      expect(persisted.assignedAgents).not.toContain('agent-1');
    });
  });

  // ── isInBounds ──────────────────────────────────────────────────

  describe('isInBounds', () => {
    it('returns true for position inside the bounding box', () => {
      const { manager } = createManager();
      manager.defineZone(makeZone({ min: { x: 0, y: 0, z: 0 }, max: { x: 100, y: 64, z: 100 } }));

      expect(manager.isInBounds({ x: 50, y: 32, z: 50 }, 'zone-1')).toBe(true);
    });

    it('returns true for position on the boundary (inclusive)', () => {
      const { manager } = createManager();
      manager.defineZone(makeZone({ min: { x: 0, y: 0, z: 0 }, max: { x: 100, y: 64, z: 100 } }));

      expect(manager.isInBounds({ x: 0, y: 0, z: 0 }, 'zone-1')).toBe(true);
      expect(manager.isInBounds({ x: 100, y: 64, z: 100 }, 'zone-1')).toBe(true);
    });

    it('returns false for position outside the bounding box', () => {
      const { manager } = createManager();
      manager.defineZone(makeZone({ min: { x: 0, y: 0, z: 0 }, max: { x: 100, y: 64, z: 100 } }));

      expect(manager.isInBounds({ x: 101, y: 32, z: 50 }, 'zone-1')).toBe(false);
      expect(manager.isInBounds({ x: -1, y: 32, z: 50 }, 'zone-1')).toBe(false);
      expect(manager.isInBounds({ x: 50, y: 65, z: 50 }, 'zone-1')).toBe(false);
      expect(manager.isInBounds({ x: 50, y: 32, z: -1 }, 'zone-1')).toBe(false);
    });

    it('returns false for unknown zone', () => {
      const { manager } = createManager();
      expect(manager.isInBounds({ x: 50, y: 32, z: 50 }, 'nonexistent')).toBe(false);
    });
  });

  // ── getZonesForAgent ────────────────────────────────────────────

  describe('getZonesForAgent', () => {
    it('returns empty array when agent has no zones', () => {
      const { manager } = createManager();
      manager.defineZone(makeZone());
      expect(manager.getZonesForAgent('agent-99')).toEqual([]);
    });

    it('returns all zones the agent is assigned to', () => {
      const { manager } = createManager();
      manager.defineZone(makeZone({ id: 'z1', name: 'Quarry' }));
      manager.defineZone(makeZone({ id: 'z2', name: 'Farm', type: 'farm' }));
      manager.defineZone(makeZone({ id: 'z3', name: 'Temple', type: 'temple' }));

      manager.assignAgentToZone('agent-1', 'z1');
      manager.assignAgentToZone('agent-1', 'z3');

      const zones = manager.getZonesForAgent('agent-1');
      expect(zones).toHaveLength(2);
      expect(zones.map((z) => z.id).sort()).toEqual(['z1', 'z3']);
    });
  });

  // ── deleteZone ──────────────────────────────────────────────────

  describe('deleteZone', () => {
    it('removes the zone', () => {
      const { manager } = createManager();
      manager.defineZone(makeZone());

      manager.deleteZone('zone-1');

      expect(manager.getZone('zone-1')).toBeUndefined();
      expect(manager.listZones()).toEqual([]);
    });

    it('invokes the delete callback', () => {
      const onZoneDelete = vi.fn();
      const { manager } = createManager({ onZoneDelete });
      manager.defineZone(makeZone());

      manager.deleteZone('zone-1');

      expect(onZoneDelete).toHaveBeenCalledWith('zone-1');
    });

    it('does nothing for unknown zone', () => {
      const onZoneDelete = vi.fn();
      const { manager } = createManager({ onZoneDelete });

      manager.deleteZone('nonexistent');

      expect(onZoneDelete).not.toHaveBeenCalled();
    });

    it('logs the deletion', () => {
      const { manager, logger } = createManager();
      manager.defineZone(makeZone({ name: 'Old Quarry' }));

      manager.deleteZone('zone-1');

      expect(logger.info).toHaveBeenCalledWith(
        'Zone deleted',
        expect.objectContaining({ zoneId: 'zone-1', name: 'Old Quarry' }),
      );
    });
  });
});
