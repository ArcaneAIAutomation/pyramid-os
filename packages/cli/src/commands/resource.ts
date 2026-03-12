import { Command } from 'commander';
import type { ApiClient } from '../api-client.js';
import { formatOutput, type OutputFormat } from '../formatter.js';

export function registerResourceCommands(
  program: Command,
  getClient: () => ApiClient,
): void {
  const resource = program
    .command('resource')
    .description('Query resource inventory and thresholds');

  resource
    .command('inventory')
    .description('Show current resource inventory')
    .option('--type <type>', 'Filter by resource type')
    .action(async (opts: { type?: string }) => {
      const format = program.opts()['format'] as OutputFormat;
      const path = opts.type ? `/resources?type=${opts.type}` : '/resources';
      const result = await getClient().get(path);
      console.log(formatOutput(result, format));
    });

  resource
    .command('thresholds')
    .description('Show resource threshold configuration')
    .action(async () => {
      const format = program.opts()['format'] as OutputFormat;
      const result = await getClient().get('/resources/thresholds');
      console.log(formatOutput(result, format));
    });

  resource
    .command('consumption')
    .description('Show resource consumption rates')
    .option('--since <time>', 'Time range start (ISO 8601 or relative like "1h")')
    .action(async (opts: { since?: string }) => {
      const format = program.opts()['format'] as OutputFormat;
      const path = opts.since
        ? `/resources/consumption?since=${opts.since}`
        : '/resources/consumption';
      const result = await getClient().get(path);
      console.log(formatOutput(result, format));
    });
}
