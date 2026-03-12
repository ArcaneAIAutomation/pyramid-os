/**
 * ZoneManager — spatial zone management for PYRAMID OS.
 *
 * Manages zone definitions, agent-to-zone assignments, and bounding-box
 * position checks. Persists changes via an optional callback.
 *
 * Requirements: 3.4, 3.5, 23.8
 */

import type { Vec3 } from '@pyramid-os/shared-types';
import type { Logger } from '@pyramid-os/logger';

/** Zone types supported by the society engine. */
export type ZoneType =
  | 'construction'
  | 'quarry'
  | 'farm'
  | 'temple'
  | 'housing'
  | 'storage'
  | 'patrol';

/** A spatial zone with an axis-aligned bounding box. */
export interface Zone {
  id: string;
  name: string;
  type: ZoneType;
  min: Vec3;
  max: Vec3;
  civilizationId: string;
  assignedAgents: string[];
}

/** Callback invoked to persist zone changes. */
export type ZonePersistCallback = (zone: Zone) => void;

/** Callback invoked when a zone is deleted. */
export type ZoneDeleteCallback = (zoneId: string) => void;

export interface ZoneManagerOptions {
  logger: Logger;
  onZonePersist?: ZonePersistCallback;
  onZoneDelete?: ZoneDeleteCallback;
}

export class ZoneManager {
  private readonly zones = new Map<string, Zone>();
  private readonly logger: Logger;
  private readonly onZonePersist: ZonePersistCallback | undefined;
  private readonly onZoneDelete: ZoneDeleteCallback | undefined;

  constructor(options: ZoneManagerOptions) {
    this.logger = options.logger;
    this.onZonePersist = options.onZonePersist;
    this.onZoneDelete = options.onZoneDelete;
  }

  /** Register a new zone. Requirement 3.4 */
  defineZone(zone: Zone): void {
    this.zones.set(zone.id, { ...zone, assignedAgents: [...zone.assignedAgents] });
    this.logger.info('Zone defined', {
      zoneId: zone.id,
      name: zone.name,
      type: zone.type,
    } as Record<string, unknown>);
    this.persistZone(zone.id);
  }

  /** Retrieve a zone by ID. */
  getZone(zoneId: string): Zone | undefined {
    const zone = this.zones.get(zoneId);
    return zone ? this.cloneZone(zone) : undefined;
  }

  /** List all registered zones. */
  listZones(): Zone[] {
    return [...this.zones.values()].map((z) => this.cloneZone(z));
  }

  /** Assign an agent to a zone. Requirement 3.5 */
  assignAgentToZone(agentId: string, zoneId: string): void {
    const zone = this.zones.get(zoneId);
    if (!zone) {
      this.logger.warn('Cannot assign agent to unknown zone', {
        agentId,
        zoneId,
      } as Record<string, unknown>);
      return;
    }

    if (zone.assignedAgents.includes(agentId)) {
      return; // already assigned
    }

    zone.assignedAgents.push(agentId);
    this.logger.info('Agent assigned to zone', {
      agentId,
      zoneId: zone.id,
      zoneName: zone.name,
    } as Record<string, unknown>);
    this.persistZone(zoneId);
  }

  /** Remove an agent from a zone. */
  unassignAgent(agentId: string, zoneId: string): void {
    const zone = this.zones.get(zoneId);
    if (!zone) {
      return;
    }

    const idx = zone.assignedAgents.indexOf(agentId);
    if (idx === -1) {
      return;
    }

    zone.assignedAgents.splice(idx, 1);
    this.logger.info('Agent unassigned from zone', {
      agentId,
      zoneId: zone.id,
    } as Record<string, unknown>);
    this.persistZone(zoneId);
  }

  /** Check if a position is within a zone's bounding box. Requirement 23.8 */
  isInBounds(position: Vec3, zoneId: string): boolean {
    const zone = this.zones.get(zoneId);
    if (!zone) {
      return false;
    }

    return (
      position.x >= zone.min.x &&
      position.x <= zone.max.x &&
      position.y >= zone.min.y &&
      position.y <= zone.max.y &&
      position.z >= zone.min.z &&
      position.z <= zone.max.z
    );
  }

  /** Return all zones an agent is assigned to. */
  getZonesForAgent(agentId: string): Zone[] {
    const result: Zone[] = [];
    for (const zone of this.zones.values()) {
      if (zone.assignedAgents.includes(agentId)) {
        result.push(this.cloneZone(zone));
      }
    }
    return result;
  }

  /** Delete a zone by ID. */
  deleteZone(zoneId: string): void {
    const zone = this.zones.get(zoneId);
    if (!zone) {
      return;
    }

    this.zones.delete(zoneId);
    this.logger.info('Zone deleted', {
      zoneId,
      name: zone.name,
    } as Record<string, unknown>);

    if (this.onZoneDelete) {
      this.onZoneDelete(zoneId);
    }
  }

  // ── internal helpers ──────────────────────────────────────────────

  private persistZone(zoneId: string): void {
    const zone = this.zones.get(zoneId);
    if (zone && this.onZonePersist) {
      this.onZonePersist(this.cloneZone(zone));
    }
  }

  private cloneZone(zone: Zone): Zone {
    return { ...zone, min: { ...zone.min }, max: { ...zone.max }, assignedAgents: [...zone.assignedAgents] };
  }
}
