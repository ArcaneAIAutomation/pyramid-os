/**
 * CLI command: pyramid-os seed load <scenario-name>
 * Loads seed data into a MockDatabase for development.
 *
 * Requirements: 44.2, 44.5
 */

import { Command } from 'commander';
import { formatOutput, type OutputFormat } from '../formatter.js';

/**
 * Dynamically imports the data-layer seed functions.
 * This avoids a hard compile-time dependency on @pyramid-os/data-layer
 * which may not be built yet when the CLI package is compiled.
 */
async function getSeedModule() {
  const mod = await import('@pyramid-os/data-layer');
  return {
    getScenario: mod.getScenario as (name: string) => import('@pyramid-os/data-layer').SeedScenario | undefined,
    listScenarios: mod.listScenarios as () => string[],
    loadSeed: mod.loadSeed as (scenario: import('@pyramid-os/data-layer').SeedScenario, db: unknown) => void,
  };
}

/** Create an in-memory mock database for seed loading */
function createMockDb() {
  const store = new Map<string, Map<string, unknown>>();
  return {
    initialize() { /* no-op */ },
    getRepository(name: string) {
      if (!store.has(name)) store.set(name, new Map());
      const repo = store.get(name)!;
      return {
        create(record: { id: string }) { repo.set(record.id, record); return record; },
        getById(id: string) { return repo.get(id); },
        list() { return Array.from(repo.values()); },
        update(record: { id: string }) { repo.set(record.id, record); return record; },
        delete(id: string) { return repo.delete(id); },
      };
    },
  };
}

export function registerSeedCommands(program: Command): void {
  const seed = program
    .command('seed')
    .description('Manage seed data for development');

  seed
    .command('list')
    .description('List available seed scenarios')
    .action(async () => {
      const format = program.opts()['format'] as OutputFormat;
      const { listScenarios, getScenario } = await getSeedModule();
      const names = listScenarios();
      const rows = names.map((name) => {
        const s = getScenario(name);
        return { name, description: s?.description ?? '' };
      });
      console.log(formatOutput(rows, format));
    });

  seed
    .command('load')
    .description('Load a seed scenario into the database')
    .argument('<scenario>', 'Scenario name (e.g. basic, mid-build)')
    .action(async (scenarioName: string) => {
      const format = program.opts()['format'] as OutputFormat;
      const { getScenario, loadSeed } = await getSeedModule();

      const scenario = getScenario(scenarioName);
      if (!scenario) {
        const { listScenarios } = await getSeedModule();
        const available = listScenarios().join(', ');
        console.error(`Unknown scenario "${scenarioName}". Available: ${available}`);
        process.exitCode = 1;
        return;
      }

      // For CLI usage, use an in-memory mock database by default.
      // A real DB path could be added as an option in the future.
      const db = createMockDb();
      db.initialize();

      loadSeed(scenario, db as unknown as Parameters<typeof loadSeed>[1]);

      const result = {
        status: 'loaded',
        scenario: scenario.name,
        civilization: scenario.civilization.name,
        agents: scenario.agents.length,
        resources: scenario.resources.length,
        zones: scenario.zones.length,
        tasks: scenario.tasks.length,
        blueprints: scenario.blueprints.length,
      };
      console.log(formatOutput(result, format));
    });
}
