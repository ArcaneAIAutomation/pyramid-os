/**
 * Unit tests for SafetyEnforcerImpl
 *
 * Validates: Requirements 8.6, 8.7, 31.1, 31.2, 31.3, 31.4, 31.5, 31.6, 31.7, 31.11
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  SafetyEnforcerImpl,
  DEFAULT_PROHIBITED_BLOCKS,
  DEFAULT_PROHIBITED_COMMANDS,
  DEFAULT_MAX_DECISION_TIME_MS,
} from '../safety-enforcer.js';
import type { AgentAction } from '@pyramid-os/shared-types';
import type { Logger } from '@pyramid-os/logger';

function createMockLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

describe('SafetyEnforcerImpl', () => {
  let logger: Logger;
  let enforcer: SafetyEnforcerImpl;
  let incidentSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    logger = createMockLogger();
    incidentSpy = vi.fn();
    enforcer = new SafetyEnforcerImpl({}, logger, incidentSpy);
  });

  // -----------------------------------------------------------------------
  // isProhibitedBlock
  // -----------------------------------------------------------------------
  describe('isProhibitedBlock', () => {
    it('returns true for all default prohibited blocks', () => {
      for (const block of DEFAULT_PROHIBITED_BLOCKS) {
        expect(enforcer.isProhibitedBlock(block)).toBe(true);
      }
    });

    it('returns false for a safe block', () => {
      expect(enforcer.isProhibitedBlock('minecraft:stone')).toBe(false);
      expect(enforcer.isProhibitedBlock('minecraft:sandstone')).toBe(false);
    });

    it('respects custom prohibited blocks from config', () => {
      const custom = new SafetyEnforcerImpl(
        { prohibitedBlocks: ['minecraft:bedrock'] },
        logger,
      );
      expect(custom.isProhibitedBlock('minecraft:bedrock')).toBe(true);
      expect(custom.isProhibitedBlock('minecraft:tnt')).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // isProhibitedCommand
  // -----------------------------------------------------------------------
  describe('isProhibitedCommand', () => {
    it('returns true for exact prohibited commands', () => {
      for (const cmd of DEFAULT_PROHIBITED_COMMANDS) {
        expect(enforcer.isProhibitedCommand(cmd)).toBe(true);
      }
    });

    it('returns true when command has arguments after the prohibited prefix', () => {
      expect(enforcer.isProhibitedCommand('/op player1')).toBe(true);
      expect(enforcer.isProhibitedCommand('/gamemode creative')).toBe(true);
      expect(enforcer.isProhibitedCommand('/ban badplayer reason')).toBe(true);
    });

    it('returns false for safe commands', () => {
      expect(enforcer.isProhibitedCommand('/say hello')).toBe(false);
      expect(enforcer.isProhibitedCommand('/tp player1')).toBe(false);
    });

    it('does not match partial prefixes', () => {
      // "/operator" should NOT match "/op"
      expect(enforcer.isProhibitedCommand('/operator')).toBe(false);
      expect(enforcer.isProhibitedCommand('/giving')).toBe(false);
    });

    it('handles leading whitespace', () => {
      expect(enforcer.isProhibitedCommand('  /op player1')).toBe(true);
    });

    it('respects custom prohibited commands from config', () => {
      const custom = new SafetyEnforcerImpl(
        { prohibitedCommands: ['/kill'] },
        logger,
      );
      expect(custom.isProhibitedCommand('/kill')).toBe(true);
      expect(custom.isProhibitedCommand('/op')).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // validate — place_block
  // -----------------------------------------------------------------------
  describe('validate — place_block', () => {
    it('rejects placing a prohibited block', () => {
      const action: AgentAction = {
        type: 'place_block',
        payload: { blockType: 'minecraft:tnt' },
      };
      const result = enforcer.validate('agent-1', action);
      expect(result.allowed).toBe(false);
      expect(result.violationType).toBe('prohibited-block');
      expect(result.reason).toContain('minecraft:tnt');
    });

    it('allows placing a safe block', () => {
      const action: AgentAction = {
        type: 'place_block',
        payload: { blockType: 'minecraft:sandstone' },
      };
      const result = enforcer.validate('agent-1', action);
      expect(result.allowed).toBe(true);
    });

    it('allows place_block when no blockType in payload', () => {
      const action: AgentAction = { type: 'place_block', payload: {} };
      const result = enforcer.validate('agent-1', action);
      expect(result.allowed).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // validate — execute_command
  // -----------------------------------------------------------------------
  describe('validate — execute_command', () => {
    it('rejects a prohibited command', () => {
      const action: AgentAction = {
        type: 'execute_command',
        payload: { command: '/op player1' },
      };
      const result = enforcer.validate('agent-1', action);
      expect(result.allowed).toBe(false);
      expect(result.violationType).toBe('prohibited-command');
      expect(result.reason).toContain('/op player1');
    });

    it('allows a safe command', () => {
      const action: AgentAction = {
        type: 'execute_command',
        payload: { command: '/say hello world' },
      };
      const result = enforcer.validate('agent-1', action);
      expect(result.allowed).toBe(true);
    });

    it('allows execute_command when no command in payload', () => {
      const action: AgentAction = { type: 'execute_command', payload: {} };
      const result = enforcer.validate('agent-1', action);
      expect(result.allowed).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // validate — other action types
  // -----------------------------------------------------------------------
  describe('validate — other action types', () => {
    it('allows unrelated action types', () => {
      const action: AgentAction = { type: 'move', payload: { x: 10, y: 64, z: 20 } };
      const result = enforcer.validate('agent-1', action);
      expect(result.allowed).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // enforceTimeout
  // -----------------------------------------------------------------------
  describe('enforceTimeout', () => {
    it('does not throw when operation is within the limit', () => {
      expect(() => enforcer.enforceTimeout('agent-1', 1000)).not.toThrow();
      expect(() => enforcer.enforceTimeout('agent-1', DEFAULT_MAX_DECISION_TIME_MS)).not.toThrow();
    });

    it('throws when operation exceeds the limit', () => {
      expect(() =>
        enforcer.enforceTimeout('agent-1', DEFAULT_MAX_DECISION_TIME_MS + 1),
      ).toThrow(/exceeded max decision time/);
    });

    it('includes agent ID and timing in the error message', () => {
      expect(() => enforcer.enforceTimeout('bot-7', 50000)).toThrow('bot-7');
    });

    it('respects custom maxDecisionTimeMs', () => {
      const custom = new SafetyEnforcerImpl({ maxDecisionTimeMs: 5000 }, logger);
      expect(() => custom.enforceTimeout('agent-1', 5001)).toThrow();
      expect(() => custom.enforceTimeout('agent-1', 5000)).not.toThrow();
    });

    it('logs the timeout violation', () => {
      try {
        enforcer.enforceTimeout('agent-1', DEFAULT_MAX_DECISION_TIME_MS + 1);
      } catch {
        // expected
      }
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // emergencyStop
  // -----------------------------------------------------------------------
  describe('emergencyStop', () => {
    it('causes all subsequent validate calls to return allowed=false', async () => {
      const safeAction: AgentAction = { type: 'move', payload: { x: 0 } };
      expect(enforcer.validate('agent-1', safeAction).allowed).toBe(true);

      await enforcer.emergencyStop();

      const result = enforcer.validate('agent-1', safeAction);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Emergency stop');
    });

    it('sets the isEmergencyStopped flag', async () => {
      expect(enforcer.isEmergencyStopped).toBe(false);
      await enforcer.emergencyStop();
      expect(enforcer.isEmergencyStopped).toBe(true);
    });

    it('logs a warning when activated', async () => {
      await enforcer.emergencyStop();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('EMERGENCY STOP'),
      );
    });

    it('can be reset for recovery', async () => {
      await enforcer.emergencyStop();
      enforcer.reset();
      expect(enforcer.isEmergencyStopped).toBe(false);

      const action: AgentAction = { type: 'move', payload: {} };
      expect(enforcer.validate('agent-1', action).allowed).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Violation logging / incident callback
  // -----------------------------------------------------------------------
  describe('violation logging', () => {
    it('calls the incident logger on prohibited block violation', () => {
      const action: AgentAction = {
        type: 'place_block',
        payload: { blockType: 'minecraft:tnt' },
      };
      enforcer.validate('agent-42', action);

      expect(incidentSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: 'agent-42',
          violationType: 'prohibited-block',
        }),
      );
    });

    it('calls the incident logger on prohibited command violation', () => {
      const action: AgentAction = {
        type: 'execute_command',
        payload: { command: '/op hacker' },
      };
      enforcer.validate('agent-7', action);

      expect(incidentSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: 'agent-7',
          violationType: 'prohibited-command',
        }),
      );
    });

    it('calls the incident logger on timeout violation', () => {
      try {
        enforcer.enforceTimeout('agent-3', 999999);
      } catch {
        // expected
      }

      expect(incidentSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: 'agent-3',
          violationType: 'timeout',
        }),
      );
    });

    it('calls the incident logger on emergency-stop denial', async () => {
      await enforcer.emergencyStop();
      enforcer.validate('agent-1', { type: 'move', payload: {} });

      expect(incidentSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: 'agent-1',
          violationType: 'emergency-stop',
        }),
      );
    });

    it('does not call incident logger for allowed actions', () => {
      const action: AgentAction = {
        type: 'place_block',
        payload: { blockType: 'minecraft:stone' },
      };
      enforcer.validate('agent-1', action);
      expect(incidentSpy).not.toHaveBeenCalled();
    });
  });
});
