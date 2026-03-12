import { Command } from 'commander';
import type { ApiClient } from '../api-client.js';
import { formatOutput, type OutputFormat } from '../formatter.js';

export function registerAgentCommands(
  program: Command,
  getClient: () => ApiClient,
): void {
  const agent = program
    .command('agent')
    .description('Manage agents in the PYRAMID OS civilization');

  agent
    .command('list')
    .description('List all agents')
    .option('--tier <tier>', 'Filter by tier (planner, operational, worker)')
    .option('--role <role>', 'Filter by role')
    .action(async (opts: { tier?: string; role?: string }) => {
      const format = program.opts()['format'] as OutputFormat;
      let path = '/agents';
      const params: string[] = [];
      if (opts.tier) params.push(`tier=${opts.tier}`);
      if (opts.role) params.push(`role=${opts.role}`);
      if (params.length > 0) path += `?${params.join('&')}`;
      const result = await getClient().get(path);
      console.log(formatOutput(result, format));
    });

  agent
    .command('spawn')
    .description('Spawn a new agent with the given role')
    .argument('<role>', 'Agent role (e.g. builder, pharaoh, scribe)')
    .action(async (role: string) => {
      const format = program.opts()['format'] as OutputFormat;
      const result = await getClient().post('/agents', { role });
      console.log(formatOutput(result, format));
    });

  agent
    .command('terminate')
    .description('Terminate an agent by ID')
    .argument('<id>', 'Agent ID')
    .action(async (id: string) => {
      const format = program.opts()['format'] as OutputFormat;
      const result = await getClient().del(`/agents/${id}`);
      console.log(formatOutput(result, format));
    });

  agent
    .command('inspect')
    .description('Inspect detailed agent state')
    .argument('<id>', 'Agent ID')
    .action(async (id: string) => {
      const format = program.opts()['format'] as OutputFormat;
      const result = await getClient().get(`/agents/${id}`);
      console.log(formatOutput(result, format));
    });
}
