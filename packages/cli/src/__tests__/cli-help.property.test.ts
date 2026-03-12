/**
 * Property-based test for CLI help text completeness.
 *
 * **Property 13: CLI help text completeness**
 * For any registered CLI command, requesting help should produce non-empty text
 * containing the command name and description.
 *
 * **Validates: Requirements 27.11**
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { Command } from 'commander';
import { createProgram } from '../index.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface CommandInfo {
  /** Display path, e.g. "system" or "system > start" */
  path: string;
  /** The Commander Command instance */
  cmd: Command;
}

/**
 * Recursively collect all commands (groups + subcommands) from a Commander program.
 */
function collectCommands(parent: Command, parentPath = ''): CommandInfo[] {
  const result: CommandInfo[] = [];
  for (const cmd of parent.commands) {
    const path = parentPath ? `${parentPath} > ${cmd.name()}` : cmd.name();
    result.push({ path, cmd });
    // Recurse into subcommands
    result.push(...collectCommands(cmd, path));
  }
  return result;
}

// ─── Property test ───────────────────────────────────────────────────────────

describe('CLI help text completeness (property)', () => {
  const program = createProgram();
  const allCommands = collectCommands(program);

  // Sanity: we should have found commands
  it('discovers at least 10 registered commands', () => {
    expect(allCommands.length).toBeGreaterThanOrEqual(10);
  });

  it('every registered command has a non-empty name and description, and help text contains both', () => {
    // Build an fc.Arbitrary that samples from the collected command list
    const commandArb = fc.constantFrom(...allCommands);

    fc.assert(
      fc.property(commandArb, ({ path, cmd }) => {
        const name = cmd.name();
        const description = cmd.description();

        // Name must be non-empty
        expect(name).toBeTruthy();
        expect(name.length).toBeGreaterThan(0);

        // Description must be non-empty
        expect(description).toBeTruthy();
        expect(description.length).toBeGreaterThan(0);

        // Help text must be non-empty and contain both name and description
        const helpText = cmd.helpInformation();
        expect(helpText.length).toBeGreaterThan(0);
        expect(helpText).toContain(name);
        expect(helpText).toContain(description);
      }),
      { numRuns: Math.max(allCommands.length * 3, 100) },
    );
  });
});
