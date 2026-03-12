import { Command } from 'commander';
import type { ApiClient } from '../api-client.js';
import { formatOutput, type OutputFormat } from '../formatter.js';

export function registerSnapshotCommands(
  program: Command,
  getClient: () => ApiClient,
): void {
  const snapshot = program
    .command('snapshot')
    .description('Create, restore, and list civilization snapshots');

  snapshot
    .command('create')
    .description('Create a snapshot of the current civilization state')
    .option('--name <name>', 'Snapshot name')
    .action(async (opts: { name?: string }) => {
      const format = program.opts()['format'] as OutputFormat;
      const result = await getClient().post('/snapshots/export', { name: opts.name });
      console.log(formatOutput(result, format));
    });

  snapshot
    .command('restore')
    .description('Restore civilization state from a snapshot')
    .argument('<file>', 'Snapshot file path')
    .action(async (file: string) => {
      const format = program.opts()['format'] as OutputFormat;
      const result = await getClient().post('/snapshots/import', { file });
      console.log(formatOutput(result, format));
    });

  snapshot
    .command('list')
    .description('List available snapshots')
    .action(async () => {
      const format = program.opts()['format'] as OutputFormat;
      const result = await getClient().get('/snapshots');
      console.log(formatOutput(result, format));
    });
}
