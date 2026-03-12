import { Command } from 'commander';
import type { ApiClient } from '../api-client.js';
import { formatOutput, type OutputFormat } from '../formatter.js';

export function registerSystemCommands(
  program: Command,
  getClient: () => ApiClient,
): void {
  const system = program
    .command('system')
    .description('Control the PYRAMID OS system lifecycle');

  system
    .command('start')
    .description('Start the PYRAMID OS system')
    .action(async () => {
      const format = program.opts()['format'] as OutputFormat;
      const result = await getClient().post('/system/start');
      console.log(formatOutput(result, format));
    });

  system
    .command('stop')
    .description('Stop the PYRAMID OS system gracefully')
    .action(async () => {
      const format = program.opts()['format'] as OutputFormat;
      const result = await getClient().post('/system/stop');
      console.log(formatOutput(result, format));
    });

  system
    .command('restart')
    .description('Restart the PYRAMID OS system')
    .action(async () => {
      const format = program.opts()['format'] as OutputFormat;
      const result = await getClient().post('/system/restart');
      console.log(formatOutput(result, format));
    });

  system
    .command('status')
    .description('Show current system status')
    .action(async () => {
      const format = program.opts()['format'] as OutputFormat;
      const result = await getClient().get('/system/status');
      console.log(formatOutput(result, format));
    });

  system
    .command('recover')
    .description('Recover system state from the most recent valid snapshot')
    .action(async () => {
      const format = program.opts()['format'] as OutputFormat;
      const result = await getClient().post('/system/recover');
      console.log(formatOutput(result, format));
    });
}
