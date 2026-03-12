import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ActionResult, BotAction } from '@pyramid-os/shared-types';
import type { ActionExecutor } from '../action-executor.js';
import type { Pathfinder } from '../pathfinder.js';
import { BuilderWorker } from '../workers/builder-worker.js';
import { BaseWorker, type WorkerTickResult } from '../workers/base-worker.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function successResult(action: string): ActionResult {
  return { success: true, action, botId: 'bot-1', outcome: 'ok', timestamp: new Date().toISOString() };
}

function failResult(action: string, error: string): ActionResult {
  return { success: false, action, botId: 'bot-1', outcome: 'failed', timestamp: new Date().toISOString(), error };
}

function createMockActionExecutor(impl?: (botId: string, action: BotAction) => Promise<ActionResult>): ActionExecutor {
  return {
    executeAction: vi.fn().mockImplementation(impl ?? ((_botId: string, action: BotAction) => Promise.resolve(successResult(action.type)))),
  } as unknown as ActionExecutor;
}

function createMockPathfinder(): Pathfinder {
  return {} as unknown as Pathfinder;
}

function createMockProgressTracker(placements: Array<{ index: number; position: { x: number; y: number; z: number }; blockType: string; placed: boolean }>) {
  let idx = 0;
  return {
    getNextPlacement: vi.fn().mockImplementation(() => {
      while (idx < placements.length && placements[idx]!.placed) {
        idx++;
      }
      return idx < placements.length ? placements[idx] : undefined;
    }),
    markPlaced: vi.fn().mockImplementation((index: number) => {
      const p = placements.find(pl => pl.index === index);
      if (p) p.placed = true;
      idx = 0; // reset scan
    }),
    getProgress: vi.fn().mockReturnValue({ totalBlocks: placements.length, placedBlocks: 0, percentComplete: 0, currentPhase: 'foundation' }),
  };
}

// ---------------------------------------------------------------------------
// BaseWorker tests
// ---------------------------------------------------------------------------

describe('BaseWorker', () => {
  it('exposes botId and role', () => {
    class TestWorker extends BaseWorker {
      async tick(): Promise<WorkerTickResult> {
        return { action: 'test', success: true, details: 'ok' };
      }
    }

    const worker = new TestWorker({
      botId: 'bot-42',
      role: 'builder',
      actionExecutor: createMockActionExecutor(),
      pathfinder: createMockPathfinder(),
    });

    expect(worker.botId).toBe('bot-42');
    expect(worker.role).toBe('builder');
  });

  it('reportCompletion calls the completionReporter callback', () => {
    const reporter = vi.fn();

    class TestWorker extends BaseWorker {
      async tick(): Promise<WorkerTickResult> {
        return { action: 'test', success: true, details: 'ok' };
      }
    }

    const worker = new TestWorker({
      botId: 'bot-1',
      role: 'hauler',
      actionExecutor: createMockActionExecutor(),
      pathfinder: createMockPathfinder(),
      completionReporter: reporter,
    });

    worker.reportCompletion('task-123', 'done');
    expect(reporter).toHaveBeenCalledWith('task-123', 'done');
  });

  it('reportCompletion is a no-op when no reporter is set', () => {
    class TestWorker extends BaseWorker {
      async tick(): Promise<WorkerTickResult> {
        return { action: 'test', success: true, details: 'ok' };
      }
    }

    const worker = new TestWorker({
      botId: 'bot-1',
      role: 'guard',
      actionExecutor: createMockActionExecutor(),
      pathfinder: createMockPathfinder(),
    });

    // Should not throw
    expect(() => worker.reportCompletion('task-1', 'ok')).not.toThrow();
  });

  it('tick() is abstract and must be implemented', async () => {
    class IdleWorker extends BaseWorker {
      async tick(): Promise<WorkerTickResult> {
        return { action: 'idle', success: true, details: 'nothing to do' };
      }
    }

    const worker = new IdleWorker({
      botId: 'bot-1',
      role: 'priest',
      actionExecutor: createMockActionExecutor(),
      pathfinder: createMockPathfinder(),
    });

    const result = await worker.tick();
    expect(result.action).toBe('idle');
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// BuilderWorker tests
// ---------------------------------------------------------------------------

describe('BuilderWorker', () => {
  let executor: ActionExecutor;
  let pathfinder: Pathfinder;

  beforeEach(() => {
    executor = createMockActionExecutor();
    pathfinder = createMockPathfinder();
  });

  it('places the next block from ProgressTracker', async () => {
    const placements = [
      { index: 0, position: { x: 0, y: 0, z: 0 }, blockType: 'minecraft:sandstone', placed: false },
      { index: 1, position: { x: 1, y: 0, z: 0 }, blockType: 'minecraft:sandstone', placed: false },
    ];
    const tracker = createMockProgressTracker(placements);

    const worker = new BuilderWorker({
      botId: 'bot-1',
      actionExecutor: executor,
      pathfinder,
      progressTracker: tracker as any,
    });

    const result = await worker.tick();

    expect(result.action).toBe('place_block');
    expect(result.success).toBe(true);
    expect(result.details).toContain('index 0');
    expect(tracker.markPlaced).toHaveBeenCalledWith(0);
  });

  it('returns idle when all blocks are placed', async () => {
    const placements = [
      { index: 0, position: { x: 0, y: 0, z: 0 }, blockType: 'minecraft:sandstone', placed: true },
    ];
    const tracker = createMockProgressTracker(placements);

    const worker = new BuilderWorker({
      botId: 'bot-1',
      actionExecutor: executor,
      pathfinder,
      progressTracker: tracker as any,
    });

    const result = await worker.tick();

    expect(result.action).toBe('idle');
    expect(result.success).toBe(true);
    expect(result.details).toContain('No more blocks');
  });

  it('reports completion when all blocks are placed and taskId is set', async () => {
    const reporter = vi.fn();
    const placements = [
      { index: 0, position: { x: 0, y: 0, z: 0 }, blockType: 'minecraft:sandstone', placed: true },
    ];
    const tracker = createMockProgressTracker(placements);

    const worker = new BuilderWorker({
      botId: 'bot-1',
      actionExecutor: executor,
      pathfinder,
      progressTracker: tracker as any,
      taskId: 'build-task-1',
      completionReporter: reporter,
    });

    await worker.tick();

    expect(reporter).toHaveBeenCalledWith('build-task-1', 'All blocks placed');
  });

  it('returns failure when navigation fails', async () => {
    const failExecutor = createMockActionExecutor(async (_botId, action) => {
      if (action.type === 'move_to') return failResult('move_to', 'Path blocked');
      return successResult(action.type);
    });

    const placements = [
      { index: 0, position: { x: 10, y: 64, z: 10 }, blockType: 'minecraft:sandstone', placed: false },
    ];
    const tracker = createMockProgressTracker(placements);

    const worker = new BuilderWorker({
      botId: 'bot-1',
      actionExecutor: failExecutor,
      pathfinder,
      progressTracker: tracker as any,
    });

    const result = await worker.tick();

    expect(result.action).toBe('navigate');
    expect(result.success).toBe(false);
    expect(tracker.markPlaced).not.toHaveBeenCalled();
  });

  it('returns failure when block placement fails', async () => {
    const failExecutor = createMockActionExecutor(async (_botId, action) => {
      if (action.type === 'place_block') return failResult('place_block', 'Missing block');
      return successResult(action.type);
    });

    const placements = [
      { index: 0, position: { x: 0, y: 0, z: 0 }, blockType: 'minecraft:gold_block', placed: false },
    ];
    const tracker = createMockProgressTracker(placements);

    const worker = new BuilderWorker({
      botId: 'bot-1',
      actionExecutor: failExecutor,
      pathfinder,
      progressTracker: tracker as any,
    });

    const result = await worker.tick();

    expect(result.action).toBe('place_block');
    expect(result.success).toBe(false);
    expect(tracker.markPlaced).not.toHaveBeenCalled();
  });

  it('places blocks in sequential order across multiple ticks', async () => {
    const placements = [
      { index: 0, position: { x: 0, y: 0, z: 0 }, blockType: 'minecraft:sandstone', placed: false },
      { index: 1, position: { x: 1, y: 0, z: 0 }, blockType: 'minecraft:sandstone', placed: false },
      { index: 2, position: { x: 2, y: 0, z: 0 }, blockType: 'minecraft:gold_block', placed: false },
    ];
    const tracker = createMockProgressTracker(placements);

    const worker = new BuilderWorker({
      botId: 'bot-1',
      actionExecutor: executor,
      pathfinder,
      progressTracker: tracker as any,
    });

    const r1 = await worker.tick();
    expect(r1.details).toContain('index 0');

    const r2 = await worker.tick();
    expect(r2.details).toContain('index 1');

    const r3 = await worker.tick();
    expect(r3.details).toContain('index 2');

    const r4 = await worker.tick();
    expect(r4.action).toBe('idle');
  });

  it('setTaskId updates the task ID for completion reporting', async () => {
    const reporter = vi.fn();
    const placements = [
      { index: 0, position: { x: 0, y: 0, z: 0 }, blockType: 'minecraft:sandstone', placed: true },
    ];
    const tracker = createMockProgressTracker(placements);

    const worker = new BuilderWorker({
      botId: 'bot-1',
      actionExecutor: executor,
      pathfinder,
      progressTracker: tracker as any,
      completionReporter: reporter,
    });

    worker.setTaskId('new-task-99');
    await worker.tick();

    expect(reporter).toHaveBeenCalledWith('new-task-99', 'All blocks placed');
  });
});
