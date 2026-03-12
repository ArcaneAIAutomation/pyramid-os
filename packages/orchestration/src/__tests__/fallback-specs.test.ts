/**
 * Unit tests for FallbackRegistry, CriticalOperationManager, and OperationPriority.
 *
 * Validates: Requirements 40.3, 40.4, 40.5, 40.6, 40.7, 40.8, 40.9
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  FallbackRegistry,
  CriticalOperationManager,
  OperationPriority,
  COMPONENT_NAMES,
} from '../fallback-specs.js';
import type { FallbackDeps } from '../fallback-specs.js';
import { DegradationManager } from '../degradation.js';

// ---------------------------------------------------------------------------
// FallbackRegistry
// ---------------------------------------------------------------------------
describe('FallbackRegistry', () => {
  let deps: Required<FallbackDeps>;
  let registry: FallbackRegistry;

  beforeEach(() => {
    deps = {
      pauseLLMRequests: vi.fn(),
      resumeLLMRequests: vi.fn(),
      enableMemoryCache: vi.fn(),
      disableMemoryCache: vi.fn(),
      pauseBotActions: vi.fn(),
      resumeBotActions: vi.fn(),
      onPlannerUnavailable: vi.fn(),
      onPlannerRecovered: vi.fn(),
      redistributeOperationalAgent: vi.fn(),
      restoreOperationalAgent: vi.fn(),
      reassignWorkerTasks: vi.fn(),
      restoreWorkerAgent: vi.fn(),
      bufferControlCentreEvents: vi.fn(),
      flushControlCentreEvents: vi.fn(),
    };
    registry = new FallbackRegistry(deps);
  });

  it('creates all 7 component fallback specs', () => {
    const all = registry.getAll();
    expect(all.size).toBe(7);
    expect([...all.keys()].sort()).toEqual([
      'control-centre',
      'minecraft',
      'ollama',
      'operational-agent',
      'planner-agent',
      'sqlite',
      'worker-agent',
    ]);
  });

  it('returns undefined for unknown component', () => {
    expect(registry.get('unknown')).toBeUndefined();
  });

  // -- Priority assignments --
  describe('priority assignments', () => {
    it('SQLite has priority 1 (critical)', () => {
      expect(registry.get(COMPONENT_NAMES.SQLITE)!.priority).toBe(1);
    });

    it('Ollama has priority 2', () => {
      expect(registry.get(COMPONENT_NAMES.OLLAMA)!.priority).toBe(2);
    });

    it('Minecraft has priority 3', () => {
      expect(registry.get(COMPONENT_NAMES.MINECRAFT)!.priority).toBe(3);
    });

    it('Operational agent has priority 3', () => {
      expect(registry.get(COMPONENT_NAMES.OPERATIONAL_AGENT)!.priority).toBe(3);
    });

    it('Planner agent has priority 4', () => {
      expect(registry.get(COMPONENT_NAMES.PLANNER_AGENT)!.priority).toBe(4);
    });

    it('Worker agent has priority 5', () => {
      expect(registry.get(COMPONENT_NAMES.WORKER_AGENT)!.priority).toBe(5);
    });

    it('Control Centre has priority 6 (lowest)', () => {
      expect(registry.get(COMPONENT_NAMES.CONTROL_CENTRE)!.priority).toBe(6);
    });
  });

  // -- Activate / deactivate callbacks --
  describe('Ollama fallback (Req 40.3)', () => {
    it('calls pauseLLMRequests on activate', () => {
      registry.get(COMPONENT_NAMES.OLLAMA)!.activate();
      expect(deps.pauseLLMRequests).toHaveBeenCalledTimes(1);
    });

    it('calls resumeLLMRequests on deactivate', () => {
      registry.get(COMPONENT_NAMES.OLLAMA)!.deactivate();
      expect(deps.resumeLLMRequests).toHaveBeenCalledTimes(1);
    });
  });

  describe('SQLite fallback (Req 40.6)', () => {
    it('calls enableMemoryCache on activate', () => {
      registry.get(COMPONENT_NAMES.SQLITE)!.activate();
      expect(deps.enableMemoryCache).toHaveBeenCalledTimes(1);
    });

    it('calls disableMemoryCache on deactivate', () => {
      registry.get(COMPONENT_NAMES.SQLITE)!.deactivate();
      expect(deps.disableMemoryCache).toHaveBeenCalledTimes(1);
    });
  });

  describe('Minecraft fallback (Req 40.7)', () => {
    it('calls pauseBotActions on activate', () => {
      registry.get(COMPONENT_NAMES.MINECRAFT)!.activate();
      expect(deps.pauseBotActions).toHaveBeenCalledTimes(1);
    });

    it('calls resumeBotActions on deactivate', () => {
      registry.get(COMPONENT_NAMES.MINECRAFT)!.deactivate();
      expect(deps.resumeBotActions).toHaveBeenCalledTimes(1);
    });
  });

  describe('Planner agent fallback (Req 40.3)', () => {
    it('calls onPlannerUnavailable on activate', () => {
      registry.get(COMPONENT_NAMES.PLANNER_AGENT)!.activate();
      expect(deps.onPlannerUnavailable).toHaveBeenCalledTimes(1);
    });

    it('calls onPlannerRecovered on deactivate', () => {
      registry.get(COMPONENT_NAMES.PLANNER_AGENT)!.deactivate();
      expect(deps.onPlannerRecovered).toHaveBeenCalledTimes(1);
    });
  });

  describe('Operational agent fallback (Req 40.4)', () => {
    it('calls redistributeOperationalAgent on activate', () => {
      registry.get(COMPONENT_NAMES.OPERATIONAL_AGENT)!.activate();
      expect(deps.redistributeOperationalAgent).toHaveBeenCalledTimes(1);
    });

    it('calls restoreOperationalAgent on deactivate', () => {
      registry.get(COMPONENT_NAMES.OPERATIONAL_AGENT)!.deactivate();
      expect(deps.restoreOperationalAgent).toHaveBeenCalledTimes(1);
    });
  });

  describe('Worker agent fallback (Req 40.5)', () => {
    it('calls reassignWorkerTasks on activate', () => {
      registry.get(COMPONENT_NAMES.WORKER_AGENT)!.activate();
      expect(deps.reassignWorkerTasks).toHaveBeenCalledTimes(1);
    });

    it('calls restoreWorkerAgent on deactivate', () => {
      registry.get(COMPONENT_NAMES.WORKER_AGENT)!.deactivate();
      expect(deps.restoreWorkerAgent).toHaveBeenCalledTimes(1);
    });
  });

  describe('Control Centre fallback (Req 40.8)', () => {
    it('calls bufferControlCentreEvents on activate', () => {
      registry.get(COMPONENT_NAMES.CONTROL_CENTRE)!.activate();
      expect(deps.bufferControlCentreEvents).toHaveBeenCalledTimes(1);
    });

    it('calls flushControlCentreEvents on deactivate', () => {
      registry.get(COMPONENT_NAMES.CONTROL_CENTRE)!.deactivate();
      expect(deps.flushControlCentreEvents).toHaveBeenCalledTimes(1);
    });
  });

  // -- Works with no deps (graceful no-op) --
  it('works with empty deps — activate/deactivate are no-ops', () => {
    const emptyRegistry = new FallbackRegistry();
    const spec = emptyRegistry.get(COMPONENT_NAMES.OLLAMA)!;
    expect(() => spec.activate()).not.toThrow();
    expect(() => spec.deactivate()).not.toThrow();
  });

  // -- Integration with DegradationManager --
  describe('integration with DegradationManager', () => {
    it('registers all fallbacks and activates on failure', async () => {
      const manager = new DegradationManager();
      for (const [name, spec] of registry.getAll()) {
        manager.registerComponent(name, spec);
      }

      await manager.notifyFailure(COMPONENT_NAMES.OLLAMA);
      expect(deps.pauseLLMRequests).toHaveBeenCalledTimes(1);
      expect(manager.getComponentStates().get(COMPONENT_NAMES.OLLAMA)).toBe('failed');

      await manager.notifyRecovery(COMPONENT_NAMES.OLLAMA);
      expect(deps.resumeLLMRequests).toHaveBeenCalledTimes(1);
      expect(manager.getComponentStates().get(COMPONENT_NAMES.OLLAMA)).toBe('healthy');
    });
  });
});

// ---------------------------------------------------------------------------
// OperationPriority
// ---------------------------------------------------------------------------
describe('OperationPriority', () => {
  it('defines 6 priority levels', () => {
    expect(Object.keys(OperationPriority)).toHaveLength(6);
  });

  it('safety enforcement is highest priority (1)', () => {
    expect(OperationPriority.SAFETY_ENFORCEMENT).toBe(1);
  });

  it('UI updates is lowest priority (6)', () => {
    expect(OperationPriority.UI_UPDATES).toBe(6);
  });

  it('priorities are in correct order', () => {
    expect(OperationPriority.SAFETY_ENFORCEMENT).toBeLessThan(OperationPriority.DATA_PERSISTENCE);
    expect(OperationPriority.DATA_PERSISTENCE).toBeLessThan(OperationPriority.HEALTH_MONITORING);
    expect(OperationPriority.HEALTH_MONITORING).toBeLessThan(OperationPriority.ACTIVE_TASK_COMPLETION);
    expect(OperationPriority.ACTIVE_TASK_COMPLETION).toBeLessThan(OperationPriority.NEW_TASK_ASSIGNMENT);
    expect(OperationPriority.NEW_TASK_ASSIGNMENT).toBeLessThan(OperationPriority.UI_UPDATES);
  });
});

// ---------------------------------------------------------------------------
// CriticalOperationManager (Req 40.9)
// ---------------------------------------------------------------------------
describe('CriticalOperationManager', () => {
  let manager: CriticalOperationManager;

  beforeEach(() => {
    manager = new CriticalOperationManager();
  });

  it('all operations are enabled by default', () => {
    const ops = manager.getOperations();
    expect(ops).toHaveLength(6);
    expect(ops.every((op) => op.enabled)).toBe(true);
  });

  it('returns operations sorted by priority', () => {
    const ops = manager.getOperations();
    for (let i = 1; i < ops.length; i++) {
      expect(ops[i]!.priority).toBeGreaterThanOrEqual(ops[i - 1]!.priority);
    }
  });

  it('isEnabled returns true for all operations initially', () => {
    expect(manager.isEnabled('safety-enforcement')).toBe(true);
    expect(manager.isEnabled('ui-updates')).toBe(true);
  });

  it('isEnabled returns false for unknown operations', () => {
    expect(manager.isEnabled('nonexistent')).toBe(false);
  });

  describe('applyCutoff()', () => {
    it('disables operations below the cutoff priority', () => {
      manager.applyCutoff(OperationPriority.HEALTH_MONITORING);

      expect(manager.isEnabled('safety-enforcement')).toBe(true);
      expect(manager.isEnabled('data-persistence')).toBe(true);
      expect(manager.isEnabled('health-monitoring')).toBe(true);
      expect(manager.isEnabled('active-task-completion')).toBe(false);
      expect(manager.isEnabled('new-task-assignment')).toBe(false);
      expect(manager.isEnabled('ui-updates')).toBe(false);
    });

    it('safety enforcement is always enabled even with cutoff at 0', () => {
      // Apply a cutoff that would exclude everything except priority 1
      manager.applyCutoff(1 as typeof OperationPriority.SAFETY_ENFORCEMENT);

      expect(manager.isEnabled('safety-enforcement')).toBe(true);
      expect(manager.isEnabled('data-persistence')).toBe(false);
    });

    it('getEnabledOperations returns only enabled ops after cutoff', () => {
      manager.applyCutoff(OperationPriority.DATA_PERSISTENCE);

      const enabled = manager.getEnabledOperations();
      expect(enabled).toHaveLength(2);
      expect(enabled[0]!.name).toBe('safety-enforcement');
      expect(enabled[1]!.name).toBe('data-persistence');
    });
  });

  describe('restoreAll()', () => {
    it('re-enables all operations after a cutoff', () => {
      manager.applyCutoff(OperationPriority.SAFETY_ENFORCEMENT);
      expect(manager.getEnabledOperations()).toHaveLength(1);

      manager.restoreAll();
      expect(manager.getEnabledOperations()).toHaveLength(6);
    });
  });
});

// ---------------------------------------------------------------------------
// COMPONENT_NAMES
// ---------------------------------------------------------------------------
describe('COMPONENT_NAMES', () => {
  it('defines all 7 component names', () => {
    expect(Object.keys(COMPONENT_NAMES)).toHaveLength(7);
  });

  it('has expected values', () => {
    expect(COMPONENT_NAMES.OLLAMA).toBe('ollama');
    expect(COMPONENT_NAMES.SQLITE).toBe('sqlite');
    expect(COMPONENT_NAMES.MINECRAFT).toBe('minecraft');
    expect(COMPONENT_NAMES.PLANNER_AGENT).toBe('planner-agent');
    expect(COMPONENT_NAMES.OPERATIONAL_AGENT).toBe('operational-agent');
    expect(COMPONENT_NAMES.WORKER_AGENT).toBe('worker-agent');
    expect(COMPONENT_NAMES.CONTROL_CENTRE).toBe('control-centre');
  });
});
