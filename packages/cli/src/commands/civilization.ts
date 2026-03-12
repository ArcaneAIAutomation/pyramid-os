import { Command } from 'commander';
import type { ApiClient } from '../api-client.js';
import { formatOutput, type OutputFormat } from '../formatter.js';

export function registerCivilizationCommands(
  program: Command,
  getClient: () => ApiClient,
): void {
  const civ = program
    .command('civilization')
    .alias('civ')
    .description('Manage civilizations (multi-world support)');

  civ
    .command('create')
    .description('Create a new civilization')
    .argument('<name>', 'Civilization name')
    .option('--server <profile>', 'Server connection profile', 'local')
    .action(async (name: string, opts: { server: string }) => {
      const format = program.opts()['format'] as OutputFormat;
      const result = await getClient().post('/civilizations', {
        name,
        serverProfile: opts.server,
      });
      console.log(formatOutput(result, format));
    });

  civ
    .command('list')
    .description('List all civilizations')
    .action(async () => {
      const format = program.opts()['format'] as OutputFormat;
      const result = await getClient().get('/civilizations');
      console.log(formatOutput(result, format));
    });

  civ
    .command('delete')
    .description('Delete a civilization by name')
    .argument('<name>', 'Civilization name')
    .action(async (name: string) => {
      const format = program.opts()['format'] as OutputFormat;
      const result = await getClient().del(`/civilizations/${name}`);
      console.log(formatOutput(result, format));
    });

  civ
    .command('switch')
    .description('Switch the active civilization')
    .argument('<name>', 'Civilization name to activate')
    .action(async (name: string) => {
      const format = program.opts()['format'] as OutputFormat;
      const result = await getClient().post(`/civilizations/${name}/activate`);
      console.log(formatOutput(result, format));
    });
}
