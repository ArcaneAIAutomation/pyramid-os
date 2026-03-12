import { Command } from 'commander';
import type { ApiClient } from '../api-client.js';
import { formatOutput, type OutputFormat } from '../formatter.js';

export function registerConfigCommands(
  program: Command,
  getClient: () => ApiClient,
): void {
  const config = program
    .command('config')
    .description('Validate and test PYRAMID OS configuration');

  config
    .command('validate')
    .description('Validate the configuration file syntax and semantics')
    .option('--file <path>', 'Path to config file', 'config/default.yaml')
    .action(async (opts: { file: string }) => {
      const format = program.opts()['format'] as OutputFormat;
      const result = await getClient().post('/config/validate', { file: opts.file });
      console.log(formatOutput(result, format));
    });

  config
    .command('test')
    .description('Test configuration by verifying connectivity to all services')
    .action(async () => {
      const format = program.opts()['format'] as OutputFormat;
      const result = await getClient().post('/config/test');
      console.log(formatOutput(result, format));
    });
}
