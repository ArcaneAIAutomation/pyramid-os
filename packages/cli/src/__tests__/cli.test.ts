import { describe, it, expect } from 'vitest';
import { createProgram } from '../index.js';

describe('CLI command registration', () => {
  const program = createProgram();
  const commandNames = program.commands.map((c) => c.name());

  it('registers all top-level command groups', () => {
    const expected = [
      'system',
      'agent',
      'task',
      'resource',
      'blueprint',
      'snapshot',
      'config',
      'log',
      'health',
      'civilization',
    ];
    for (const name of expected) {
      expect(commandNames).toContain(name);
    }
  });

  it('has --format global option', () => {
    const formatOpt = program.options.find((o) => o.long === '--format');
    expect(formatOpt).toBeDefined();
  });

  it('has --api-url global option', () => {
    const opt = program.options.find((o) => o.long === '--api-url');
    expect(opt).toBeDefined();
  });

  it('has --api-key global option', () => {
    const opt = program.options.find((o) => o.long === '--api-key');
    expect(opt).toBeDefined();
  });

  describe('system subcommands', () => {
    const system = program.commands.find((c) => c.name() === 'system')!;
    const subs = system.commands.map((c) => c.name());

    it('has start, stop, restart, status, recover', () => {
      expect(subs).toEqual(expect.arrayContaining(['start', 'stop', 'restart', 'status', 'recover']));
    });
  });

  describe('agent subcommands', () => {
    const agent = program.commands.find((c) => c.name() === 'agent')!;
    const subs = agent.commands.map((c) => c.name());

    it('has list, spawn, terminate, inspect', () => {
      expect(subs).toEqual(expect.arrayContaining(['list', 'spawn', 'terminate', 'inspect']));
    });
  });

  describe('task subcommands', () => {
    const task = program.commands.find((c) => c.name() === 'task')!;
    const subs = task.commands.map((c) => c.name());

    it('has list, create, cancel, retry', () => {
      expect(subs).toEqual(expect.arrayContaining(['list', 'create', 'cancel', 'retry']));
    });
  });

  describe('resource subcommands', () => {
    const resource = program.commands.find((c) => c.name() === 'resource')!;
    const subs = resource.commands.map((c) => c.name());

    it('has inventory, thresholds, consumption', () => {
      expect(subs).toEqual(expect.arrayContaining(['inventory', 'thresholds', 'consumption']));
    });
  });

  describe('blueprint subcommands', () => {
    const bp = program.commands.find((c) => c.name() === 'blueprint')!;
    const subs = bp.commands.map((c) => c.name());

    it('has generate, validate, export, import', () => {
      expect(subs).toEqual(expect.arrayContaining(['generate', 'validate', 'export', 'import']));
    });
  });

  describe('snapshot subcommands', () => {
    const snap = program.commands.find((c) => c.name() === 'snapshot')!;
    const subs = snap.commands.map((c) => c.name());

    it('has create, restore, list', () => {
      expect(subs).toEqual(expect.arrayContaining(['create', 'restore', 'list']));
    });
  });

  describe('config subcommands', () => {
    const cfg = program.commands.find((c) => c.name() === 'config')!;
    const subs = cfg.commands.map((c) => c.name());

    it('has validate, test', () => {
      expect(subs).toEqual(expect.arrayContaining(['validate', 'test']));
    });
  });

  describe('log subcommands', () => {
    const log = program.commands.find((c) => c.name() === 'log')!;
    const subs = log.commands.map((c) => c.name());

    it('has query', () => {
      expect(subs).toContain('query');
    });

    it('query has --level, --agent, --since options', () => {
      const query = log.commands.find((c) => c.name() === 'query')!;
      const optNames = query.options.map((o) => o.long);
      expect(optNames).toEqual(expect.arrayContaining(['--level', '--agent', '--since']));
    });
  });

  describe('health subcommands', () => {
    const health = program.commands.find((c) => c.name() === 'health')!;
    const subs = health.commands.map((c) => c.name());

    it('has check', () => {
      expect(subs).toContain('check');
    });
  });

  describe('civilization subcommands', () => {
    const civ = program.commands.find((c) => c.name() === 'civilization')!;
    const subs = civ.commands.map((c) => c.name());

    it('has create, list, delete, switch', () => {
      expect(subs).toEqual(expect.arrayContaining(['create', 'list', 'delete', 'switch']));
    });

    it('has civ alias', () => {
      expect(civ.aliases()).toContain('civ');
    });
  });
});

describe('CLI help text', () => {
  it('includes program description', () => {
    const program = createProgram();
    const help = program.helpInformation();
    expect(help).toContain('PYRAMID OS');
  });

  it('lists all command groups in help', () => {
    const program = createProgram();
    const help = program.helpInformation();
    expect(help).toContain('system');
    expect(help).toContain('agent');
    expect(help).toContain('task');
    expect(help).toContain('resource');
    expect(help).toContain('blueprint');
    expect(help).toContain('snapshot');
    expect(help).toContain('config');
    expect(help).toContain('log');
    expect(help).toContain('health');
    expect(help).toContain('civilization');
  });
});
