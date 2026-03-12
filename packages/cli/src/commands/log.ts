import { Command } from 'commander';
import type { ApiClient } from '../api-client.js';
import { formatOutput, type OutputFormat } from '../formatter.js';

export function registerLogCommands(
  program: Command,
  getClient: () => ApiClient,
): void {
  const log = program
    .command('log')
    .description('Query and filter PYRAMID OS logs');

  log
    .command('query')
    .description('Query logs with optional filters')
    .option('--level <level>', 'Filter by log level (debug, info, warn, error)')
    .option('--agent <agentId>', 'Filter by agent ID')
    .option('--since <time>', 'Show logs since time (ISO 8601 or relative like "1h")')
    .option('--limit <n>', 'Maximum number of log entries', '50')
    .action(async (opts: { level?: string; agent?: string; since?: string; limit: string }) => {
      const format = program.opts()['format'] as OutputFormat;
      const params: string[] = [];
      if (opts.level) params.push(`level=${opts.level}`);
      if (opts.agent) params.push(`agent=${opts.agent}`);
      if (opts.since) params.push(`since=${opts.since}`);
      params.push(`limit=${opts.limit}`);
      const path = `/logs?${params.join('&')}`;
      const result = await getClient().get(path);
      console.log(formatOutput(result, format));
    });
}
