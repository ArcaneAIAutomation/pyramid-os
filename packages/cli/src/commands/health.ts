import { Command } from 'commander';
import type { ApiClient } from '../api-client.js';
import { formatOutput, type OutputFormat } from '../formatter.js';

export function registerHealthCommands(
  program: Command,
  getClient: () => ApiClient,
): void {
  const health = program
    .command('health')
    .description('Run health checks and diagnostics');

  health
    .command('check')
    .description('Run a full health check on all PYRAMID OS components')
    .action(async () => {
      const format = program.opts()['format'] as OutputFormat;
      const result = await getClient().get('/health');
      console.log(formatOutput(result, format));
    });
}
