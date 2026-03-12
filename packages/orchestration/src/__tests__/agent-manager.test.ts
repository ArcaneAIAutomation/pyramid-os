/**
 * Unit tests for AgentManagerImpl
 *
 * Validates: Requirements 1.5, 1.6, 13.1, 40.3, 40.4, 40.5
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentManagerImpl, DEFAULT_ROLE_TIER_MAP } from '../agent-manager.js';
import type { AgentRole, AgentTier } from '@pyramid-os/shared-types';
import type { Logger } from '@pyramid-os/logger';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function createMockRepository() {
  return {
    findById: vi.fn(),
    findAll: vi.fn(),
    upsert: vi.fn(),
    delete: vi.fn(),
    updateStatus: vi.fn(),
    updateWorkspaceState: vi.fn(),
    getWorkspaceState: vi.fn().mockReturnValue(undefined),
  };
}

// ---------------------------------------------------------------------------
// DEFAULT_ROLE_TIER_MAP
// ---------------------------------------------------------------------------

describe('DEFAULT_ROLE_TIER_MAP', () => {
  it('maps planner roles correctly', () => {
    expect(DEFAULT_ROLE_TIER_MAP.pharaoh).toBe('planner');
    expect(DEFAULT_ROLE_TIER_MAP.vizier).toBe('planner');
    expect(DEFAULT_ROLE_TIER_MAP.architect).toBe('planner');
  });

  it('maps operational roles correctly', () => {
    expect(DEFAULT_ROLE_TIER_MAP.scribe).toBe('operational');
    expect(DEFAULT_ROLE_TIER_MAP['bot-foreman']).toBe('operational');
    expect(DEFAULT_ROLE_TIER_MAP.defense).toBe('operational');
    expect(DEFAULT_ROLE_TIER_MAP.ops).toBe('operational');
    expect(DEFAULT_ROLE_TIER_MAP['ui-master']).toBe('operational');
  });

  it('maps worker roles correctly', () => {
    expect(DEFAULT_ROLE_TIER_MAP.builder).toBe('worker');
    expect(DEFAULT_ROLE_TIER_MAP.quarry).toBe('worker');
    expect(DEFAULT_ROLE_TIER_MAP.hauler).toBe('worker');
    expect(DEFAULT_ROLE_TIER_MAP.guard).toBe('worker');
    expect(DEFAULT_ROLE_TIER_MAP.farmer).toBe('worker');
    expect(DEFAULT_ROLE_TIER_MAP.priest).toBe('worker');
  });

  it('covers all 14 roles', () => {
    expect(Object.keys(DEFAULT_ROLE_TIER_MAP)).toHaveLength(14);
  });
});

// ---------------------------------------------------------------------------
// AgentManagerImpl
// ---------------------------------------------------------------------------

describe('AgentManagerImpl', () => {
  let logger: Logger;
  let repo: ReturnType<typeof createMockRepository>;
  let manager: AgentManagerImpl;

  beforeEach(() => {
    logger = createMockLogger();
    repo = createMockRepository();
    manager = new AgentManagerImpl(logger, repo as any);
  });

  // -----------------------------------------------------------------------
  // create
  // -----------------------------------------------------------------------

  describe('create', () => {
    it('returns a UUID string', async () => {
      const id = await manager.create('pharaoh');
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    });

    it('assigns the correct tier based on role', async () => {
      const id = await manager.create('builder');
      const managed = manager.get(id);
      expect(managed?.instance.tier).toBe('worker');
    });

    it('sets status to active', async () => {
      const id = await manager.create('vizier');
      const managed = manager.get(id);
      expect(managed?.instance.status).toBe('active');
    });

    it('uses civilizationId from config when provided', async () => {
      const id = await manager.create('scribe', { civilizationId: 'civ-42' });
      const managed = manager.get(id);
      expect(managed?.instance.civilizationId).toBe('civ-42');
    });

    it('defaults civilizationId to "default"', async () => {
      const id = await manager.create('guard');
      const managed = manager.get(id);
      expect(managed?.instance.civilizationId).toBe('default');
    });

    it('persists agent to repository', async () => {
      const id = await manager.create('farmer');
      expect(repo.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ id, role: 'farmer', tier: 'worker' }),
      );
    });

    it('creates a workspace with the correct tier', async () => {
      const id = await manager.create('architect');
      const managed = manager.get(id);
      expect(managed?.workspace.tier).toBe('planner');
      expect(managed?.workspace.agentId).toBe(id);
    });

    it('logs agent creation', async () => {
      await manager.create('ops');
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Agent created'),
        expect.objectContaining({ agentId: expect.any(String) }),
      );
    });

    it('works without a repository', async () => {
      const noRepoManager = new AgentManagerImpl(logger);
      const id = await noRepoManager.create('hauler');
      expect(id).toBeTruthy();
      expect(noRepoManager.get(id)?.instance.role).toBe('hauler');
    });
  });

  // -----------------------------------------------------------------------
  // restart
  // -----------------------------------------------------------------------

  describe('restart', () => {
    it('throws for unknown agentId', async () => {
      await expect(manager.restart('nonexistent')).rejects.toThrow(
        'Agent not found',
      );
    });

    it('restores agent to active status', async () => {
      const id = await manager.create('builder');
      // Simulate failure
      const managed = manager.get(id)!;
      managed.instance.status = 'error';

      await manager.restart(id);
      expect(managed.instance.status).toBe('active');
    });

    it('re-creates the workspace', async () => {
      const id = await manager.create('quarry');
      const originalWorkspace = manager.get(id)!.workspace;

      await manager.restart(id);
      const newWorkspace = manager.get(id)!.workspace;

      // New workspace object, same agentId
      expect(newWorkspace).not.toBe(originalWorkspace);
      expect(newWorkspace.agentId).toBe(id);
    });

    it('persists updated instance to repository', async () => {
      const id = await manager.create('guard');
      repo.upsert.mockClear();

      await manager.restart(id);
      expect(repo.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ id, status: 'active' }),
      );
    });

    it('logs restart', async () => {
      const id = await manager.create('priest');
      await manager.restart(id);
      expect(logger.info).toHaveBeenCalledWith(
        'Restarting agent',
        expect.objectContaining({ agentId: id }),
      );
      expect(logger.info).toHaveBeenCalledWith(
        'Agent restarted successfully',
        expect.objectContaining({ agentId: id }),
      );
    });
  });

  // -----------------------------------------------------------------------
  // healthCheck
  // -----------------------------------------------------------------------

  describe('healthCheck', () => {
    it('returns empty array when no agents exist', async () => {
      const reports = await manager.healthCheck();
      expect(reports).toEqual([]);
    });

    it('returns a report for each managed agent', async () => {
      await manager.create('pharaoh');
      await manager.create('builder');
      const reports = await manager.healthCheck();
      expect(reports).toHaveLength(2);
    });

    it('marks active agents as healthy', async () => {
      const id = await manager.create('vizier');
      const reports = await manager.healthCheck();
      const report = reports.find(r => r.agentId === id);
      expect(report?.healthy).toBe(true);
      expect(report?.issues).toEqual([]);
    });

    it('marks error agents as unhealthy', async () => {
      const id = await manager.create('scribe');
      manager.get(id)!.instance.status = 'error';

      const reports = await manager.healthCheck();
      const report = reports.find(r => r.agentId === id);
      expect(report?.healthy).toBe(false);
      expect(report?.issues).toContain('Agent is in error state');
    });

    it('marks stopped agents as unhealthy', async () => {
      const id = await manager.create('defense');
      manager.get(id)!.instance.status = 'stopped';

      const reports = await manager.healthCheck();
      const report = reports.find(r => r.agentId === id);
      expect(report?.healthy).toBe(false);
      expect(report?.issues).toContain('Agent is stopped');
    });

    it('flags stale agents', async () => {
      const id = await manager.create('ops');
      // Set lastActiveAt to 10 minutes ago
      const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      manager.get(id)!.instance.lastActiveAt = tenMinAgo;

      const reports = await manager.healthCheck();
      const report = reports.find(r => r.agentId === id);
      expect(report?.healthy).toBe(false);
      expect(report?.issues).toContain('Agent has not been active recently');
    });

    it('includes correct role and status in report', async () => {
      const id = await manager.create('architect');
      const reports = await manager.healthCheck();
      const report = reports.find(r => r.agentId === id);
      expect(report?.role).toBe('architect');
      expect(report?.status).toBe('active');
    });
  });

  // -----------------------------------------------------------------------
  // persistState
  // -----------------------------------------------------------------------

  describe('persistState', () => {
    it('throws for unknown agentId', async () => {
      await expect(manager.persistState('nonexistent')).rejects.toThrow(
        'Agent not found',
      );
    });

    it('calls workspace.save()', async () => {
      const id = await manager.create('builder');
      const managed = manager.get(id)!;
      const saveSpy = vi.spyOn(managed.workspace, 'save');

      await manager.persistState(id);
      expect(saveSpy).toHaveBeenCalled();
    });

    it('upserts the agent instance to repository', async () => {
      const id = await manager.create('farmer');
      repo.upsert.mockClear();

      await manager.persistState(id);
      expect(repo.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ id }),
      );
    });

    it('logs persistence', async () => {
      const id = await manager.create('hauler');
      await manager.persistState(id);
      expect(logger.info).toHaveBeenCalledWith(
        'Agent state persisted',
        expect.objectContaining({ agentId: id }),
      );
    });
  });

  // -----------------------------------------------------------------------
  // restoreState
  // -----------------------------------------------------------------------

  describe('restoreState', () => {
    it('throws for unknown agentId', async () => {
      await expect(manager.restoreState('nonexistent')).rejects.toThrow(
        'Agent not found',
      );
    });

    it('calls workspace.load()', async () => {
      const id = await manager.create('guard');
      const managed = manager.get(id)!;
      const loadSpy = vi.spyOn(managed.workspace, 'load');

      await manager.restoreState(id);
      expect(loadSpy).toHaveBeenCalled();
    });

    it('updates in-memory instance from repository if persisted data exists', async () => {
      const id = await manager.create('priest');
      repo.findById.mockReturnValue({
        id,
        role: 'priest',
        tier: 'worker',
        status: 'idle',
        civilizationId: 'default',
        createdAt: '2024-01-01T00:00:00.000Z',
        lastActiveAt: '2024-06-01T12:00:00.000Z',
      });

      await manager.restoreState(id);
      const managed = manager.get(id)!;
      expect(managed.instance.status).toBe('idle');
      expect(managed.instance.lastActiveAt).toBe('2024-06-01T12:00:00.000Z');
    });

    it('keeps in-memory state when repository has no persisted data', async () => {
      const id = await manager.create('quarry');
      repo.findById.mockReturnValue(undefined);

      const statusBefore = manager.get(id)!.instance.status;
      await manager.restoreState(id);
      expect(manager.get(id)!.instance.status).toBe(statusBefore);
    });

    it('logs restoration', async () => {
      const id = await manager.create('builder');
      await manager.restoreState(id);
      expect(logger.info).toHaveBeenCalledWith(
        'Agent state restored',
        expect.objectContaining({ agentId: id }),
      );
    });
  });

  // -----------------------------------------------------------------------
  // Custom role-tier map
  // -----------------------------------------------------------------------

  describe('custom roleTierMap', () => {
    it('uses a custom mapping when provided', async () => {
      const customMap = { ...DEFAULT_ROLE_TIER_MAP, builder: 'planner' as AgentTier };
      const customManager = new AgentManagerImpl(logger, repo as any, customMap);

      const id = await customManager.create('builder');
      const managed = customManager.get(id);
      expect(managed?.instance.tier).toBe('planner');
    });
  });
});
