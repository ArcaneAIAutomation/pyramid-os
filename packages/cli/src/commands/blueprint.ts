import { Command } from 'commander';
import type { ApiClient } from '../api-client.js';
import { formatOutput, type OutputFormat } from '../formatter.js';

export function registerBlueprintCommands(
  program: Command,
  getClient: () => ApiClient,
): void {
  const blueprint = program
    .command('blueprint')
    .description('Generate, validate, and manage construction blueprints');

  blueprint
    .command('generate')
    .description('Generate a new blueprint')
    .requiredOption('--type <type>', 'Structure type (pyramid, housing, farm, temple)')
    .option('--base-size <n>', 'Base size for pyramids', '21')
    .option('--height <n>', 'Height for pyramids', '11')
    .option('--material <block>', 'Primary material', 'minecraft:sandstone')
    .action(async (opts: { type: string; baseSize: string; height: string; material: string }) => {
      const format = program.opts()['format'] as OutputFormat;
      const result = await getClient().post('/blueprints/generate', {
        type: opts.type,
        baseSize: parseInt(opts.baseSize, 10),
        height: parseInt(opts.height, 10),
        material: opts.material,
      });
      console.log(formatOutput(result, format));
    });

  blueprint
    .command('validate')
    .description('Validate a blueprint file')
    .argument('<file>', 'Path to blueprint JSON file')
    .action(async (file: string) => {
      const format = program.opts()['format'] as OutputFormat;
      const result = await getClient().post('/blueprints/validate', { file });
      console.log(formatOutput(result, format));
    });

  blueprint
    .command('export')
    .description('Export a blueprint to a JSON file')
    .argument('<file>', 'Output file path')
    .option('--id <id>', 'Blueprint ID to export')
    .action(async (file: string, opts: { id?: string }) => {
      const format = program.opts()['format'] as OutputFormat;
      const path = opts.id ? `/blueprints/${opts.id}/export` : '/blueprints/export';
      const result = await getClient().get(path);
      console.log(formatOutput({ ...result as object, exportPath: file }, format));
    });

  blueprint
    .command('import')
    .description('Import a blueprint from a JSON file')
    .argument('<file>', 'Path to blueprint JSON file')
    .action(async (file: string) => {
      const format = program.opts()['format'] as OutputFormat;
      const result = await getClient().post('/blueprints/import', { file });
      console.log(formatOutput(result, format));
    });
}
