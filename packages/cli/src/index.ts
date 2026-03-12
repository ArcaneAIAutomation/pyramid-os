#!/usr/bin/env node
import { Command } from 'commander';
import { ApiClient, type ApiClientOptions } from './api-client.js';
import {
  registerSystemCommands,
  registerAgentCommands,
  registerTaskCommands,
  registerResourceCommands,
  registerBlueprintCommands,
  registerSnapshotCommands,
  registerConfigCommands,
  registerLogCommands,
  registerHealthCommands,
  registerCivilizationCommands,
  registerSeedCommands,
} from './commands/index.js';

export function createProgram(): Command {
  const program = new Command();

  program
    .name('pyramid-os')
    .description('PYRAMID OS — Minecraft Egyptian Civilization Multi-Agent Automation System')
    .version('0.1.0')
    .option(
      '--format <format>',
      'Output format: json, table, or text',
      'text',
    )
    .option(
      '--api-url <url>',
      'PYRAMID OS API base URL',
      'http://127.0.0.1:8080',
    )
    .option('--api-key <key>', 'API key for authentication');

  const getClient = (): ApiClient => {
    const opts = program.opts() as { apiUrl: string; apiKey?: string };
    const clientOpts: ApiClientOptions = { baseUrl: opts.apiUrl };
    if (opts.apiKey !== undefined) {
      clientOpts.apiKey = opts.apiKey;
    }
    return new ApiClient(clientOpts);
  };

  registerSystemCommands(program, getClient);
  registerAgentCommands(program, getClient);
  registerTaskCommands(program, getClient);
  registerResourceCommands(program, getClient);
  registerBlueprintCommands(program, getClient);
  registerSnapshotCommands(program, getClient);
  registerConfigCommands(program, getClient);
  registerLogCommands(program, getClient);
  registerHealthCommands(program, getClient);
  registerCivilizationCommands(program, getClient);
  registerSeedCommands(program);

  return program;
}

/* istanbul ignore next -- entry point guard */
const isDirectRun =
  typeof process !== 'undefined' &&
  process.argv[1] &&
  (process.argv[1].endsWith('/index.js') ||
    process.argv[1].endsWith('\\index.js') ||
    process.argv[1].endsWith('/pyramid-os') ||
    process.argv[1].endsWith('\\pyramid-os'));

if (isDirectRun) {
  const program = createProgram();
  program.parseAsync(process.argv).catch((err: unknown) => {
    console.error('Error:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
