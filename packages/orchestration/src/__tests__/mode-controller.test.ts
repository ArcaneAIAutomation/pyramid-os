/**
 * Unit tests for ModeControllerImpl
 *
 * Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5, 8.8, 8.9, 8.10
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ModeControllerImpl } from '../mode-controller.js';
import type { ModeChangeListener, ModePersister } from '../mode-controller.js';
import type { OperatingMode, AgentTier } from '@pyramid-os/shared-types';
import type { Logger } from '@pyramid-os/logger';

function createMockLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

describe('ModeControllerImpl', () => {
  let logger: Logger;
  let controller: ModeControllerImpl;

  beforeEach(() => {
    logger = createMockLogger();
    controller = new ModeControllerImpl(logger);
  });

  // -----------------------------------------------------------------------
  // Initialization
  // -----------------------------------------------------------------------
  describe('initialization', () => {
    it('defaults to structured mode', () => {
      expect(controller.getCurrentMode()).toBe('structured');
    });

    it('accepts a custom initial mode', () => {
      const ctrl = new ModeControllerImpl(logger, undefined, 'free_thinking');
      expect(ctrl.getCurrentMode()).toBe('free_thinking');
    });

    it('logs initialization', () => {
      expect(logger.info).toHaveBeenCalledWith(
        'ModeController initialized',
        expect.objectContaining({ mode: 'structured' }),
      );
    });
  });

  // -----------------------------------------------------------------------
  // setOperatingMode (Req 8.8, 8.9, 8.10)
  // -----------------------------------------------------------------------
  describe('setOperatingMode', () => {
    it('transitions to a new mode', async () => {
      await controller.setOperatingMode('guided_autonomy');
      expect(controller.getCurrentMode()).toBe('guided_autonomy');
    });

    it('transitions through all modes', async () => {
      await controller.setOperatingMode('guided_autonomy');
      expect(controller.getCurrentMode()).toBe('guided_autonomy');

      await controller.setOperatingMode('free_thinking');
      expect(controller.getCurrentMode()).toBe('free_thinking');

      await controller.setOperatingMode('structured');
      expect(controller.getCurrentMode()).toBe('structured');
    });

    it('is a no-op when setting the same mode', async () => {
      const listener = vi.fn();
      controller.onModeChange(listener);

      await controller.setOperatingMode('structured');
      expect(listener).not.toHaveBeenCalled();
    });

    it('throws on invalid mode', async () => {
      await expect(controller.setOperatingMode('invalid' as OperatingMode)).rejects.toThrow(
        'Invalid operating mode',
      );
    });

    it('logs mode changes for audit (Req 8.10)', async () => {
      await controller.setOperatingMode('guided_autonomy');
      expect(logger.info).toHaveBeenCalledWith(
        'Operating mode changed: structured → guided_autonomy',
        expect.objectContaining({ oldMode: 'structured', newMode: 'guided_autonomy' }),
      );
    });

    it('calls persister before notifying listeners', async () => {
      const callOrder: string[] = [];
      const persister: ModePersister = vi.fn(async () => {
        callOrder.push('persist');
      });
      const listener: ModeChangeListener = vi.fn(() => {
        callOrder.push('listener');
      });

      const ctrl = new ModeControllerImpl(logger, persister);
      ctrl.onModeChange(listener);
      await ctrl.setOperatingMode('free_thinking');

      expect(callOrder).toEqual(['persist', 'listener']);
    });

    it('notifies all registered listeners (Req 8.9)', async () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();
      controller.onModeChange(listener1);
      controller.onModeChange(listener2);

      await controller.setOperatingMode('free_thinking');

      expect(listener1).toHaveBeenCalledWith('structured', 'free_thinking');
      expect(listener2).toHaveBeenCalledWith('structured', 'free_thinking');
    });

    it('continues notifying listeners even if one throws', async () => {
      const listener1 = vi.fn(() => {
        throw new Error('listener error');
      });
      const listener2 = vi.fn();
      controller.onModeChange(listener1);
      controller.onModeChange(listener2);

      await controller.setOperatingMode('guided_autonomy');

      expect(listener1).toHaveBeenCalled();
      expect(listener2).toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledWith(
        'Error in mode change listener',
        expect.any(Error),
      );
    });
  });

  // -----------------------------------------------------------------------
  // isAllowed — Structured mode (Req 8.1, 8.2)
  // -----------------------------------------------------------------------
  describe('isAllowed — structured mode', () => {
    it('allows execute_task for all tiers', () => {
      expect(controller.isAllowed('execute_task', 'planner')).toBe(true);
      expect(controller.isAllowed('execute_task', 'operational')).toBe(true);
      expect(controller.isAllowed('execute_task', 'worker')).toBe(true);
    });

    it('allows report_status for all tiers', () => {
      expect(controller.isAllowed('report_status', 'planner')).toBe(true);
      expect(controller.isAllowed('report_status', 'operational')).toBe(true);
      expect(controller.isAllowed('report_status', 'worker')).toBe(true);
    });

    it('allows request_resources for all tiers', () => {
      expect(controller.isAllowed('request_resources', 'planner')).toBe(true);
      expect(controller.isAllowed('request_resources', 'operational')).toBe(true);
      expect(controller.isAllowed('request_resources', 'worker')).toBe(true);
    });

    it('denies create_task for all tiers in structured mode', () => {
      expect(controller.isAllowed('create_task', 'planner')).toBe(false);
      expect(controller.isAllowed('create_task', 'operational')).toBe(false);
      expect(controller.isAllowed('create_task', 'worker')).toBe(false);
    });

    it('denies propose_goal for all tiers in structured mode', () => {
      expect(controller.isAllowed('propose_goal', 'planner')).toBe(false);
      expect(controller.isAllowed('propose_goal', 'operational')).toBe(false);
      expect(controller.isAllowed('propose_goal', 'worker')).toBe(false);
    });

    it('denies unknown actions', () => {
      expect(controller.isAllowed('fly_to_moon', 'planner')).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // isAllowed — Guided autonomy mode (Req 8.3)
  // -----------------------------------------------------------------------
  describe('isAllowed — guided_autonomy mode', () => {
    beforeEach(async () => {
      await controller.setOperatingMode('guided_autonomy');
    });

    it('still allows structured actions for all tiers', () => {
      expect(controller.isAllowed('execute_task', 'planner')).toBe(true);
      expect(controller.isAllowed('report_status', 'worker')).toBe(true);
      expect(controller.isAllowed('request_resources', 'operational')).toBe(true);
    });

    it('allows create_task for planner', () => {
      expect(controller.isAllowed('create_task', 'planner')).toBe(true);
    });

    it('allows assign_task for operational', () => {
      expect(controller.isAllowed('assign_task', 'operational')).toBe(true);
    });

    it('allows modify_plan for planner', () => {
      expect(controller.isAllowed('modify_plan', 'planner')).toBe(true);
    });

    it('allows suggest_improvement for worker', () => {
      expect(controller.isAllowed('suggest_improvement', 'worker')).toBe(true);
    });

    it('denies create_task for worker', () => {
      expect(controller.isAllowed('create_task', 'worker')).toBe(false);
    });

    it('denies propose_goal for all tiers in guided mode', () => {
      expect(controller.isAllowed('propose_goal', 'planner')).toBe(false);
      expect(controller.isAllowed('propose_goal', 'operational')).toBe(false);
      expect(controller.isAllowed('propose_goal', 'worker')).toBe(false);
    });

    it('denies reorganize for all tiers in guided mode', () => {
      expect(controller.isAllowed('reorganize', 'planner')).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // isAllowed — Free thinking mode (Req 8.4, 8.5)
  // -----------------------------------------------------------------------
  describe('isAllowed — free_thinking mode', () => {
    beforeEach(async () => {
      await controller.setOperatingMode('free_thinking');
    });

    it('still allows structured actions for all tiers', () => {
      expect(controller.isAllowed('execute_task', 'planner')).toBe(true);
      expect(controller.isAllowed('report_status', 'worker')).toBe(true);
    });

    it('still allows guided actions for appropriate tiers', () => {
      expect(controller.isAllowed('create_task', 'planner')).toBe(true);
      expect(controller.isAllowed('assign_task', 'operational')).toBe(true);
      expect(controller.isAllowed('suggest_improvement', 'worker')).toBe(true);
    });

    it('allows propose_goal for planner', () => {
      expect(controller.isAllowed('propose_goal', 'planner')).toBe(true);
    });

    it('allows reorganize for planner', () => {
      expect(controller.isAllowed('reorganize', 'planner')).toBe(true);
    });

    it('allows self_assign for planner', () => {
      expect(controller.isAllowed('self_assign', 'planner')).toBe(true);
    });

    it('allows propose_goal for operational', () => {
      expect(controller.isAllowed('propose_goal', 'operational')).toBe(true);
    });

    it('denies reorganize for operational', () => {
      expect(controller.isAllowed('reorganize', 'operational')).toBe(false);
    });

    it('allows self_assign for worker', () => {
      expect(controller.isAllowed('self_assign', 'worker')).toBe(true);
    });

    it('denies propose_goal for worker', () => {
      expect(controller.isAllowed('propose_goal', 'worker')).toBe(false);
    });

    it('denies reorganize for worker', () => {
      expect(controller.isAllowed('reorganize', 'worker')).toBe(false);
    });

    it('denies unknown actions even in free_thinking', () => {
      expect(controller.isAllowed('destroy_world', 'planner')).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // onModeChange listener registration
  // -----------------------------------------------------------------------
  describe('onModeChange', () => {
    it('registers a listener that receives old and new mode', async () => {
      const listener = vi.fn();
      controller.onModeChange(listener);

      await controller.setOperatingMode('guided_autonomy');
      expect(listener).toHaveBeenCalledWith('structured', 'guided_autonomy');

      await controller.setOperatingMode('free_thinking');
      expect(listener).toHaveBeenCalledWith('guided_autonomy', 'free_thinking');
    });

    it('supports multiple listeners', async () => {
      const listeners = [vi.fn(), vi.fn(), vi.fn()];
      listeners.forEach((l) => controller.onModeChange(l));

      await controller.setOperatingMode('free_thinking');
      listeners.forEach((l) => {
        expect(l).toHaveBeenCalledOnce();
        expect(l).toHaveBeenCalledWith('structured', 'free_thinking');
      });
    });
  });
});
