import { Command } from 'commander';
import type { ApiClient } from '../api-client.js';
import { formatOutput, type OutputFormat } from '../formatter.js';

export function registerTaskCommands(
  program: Command,
  getClient: () => ApiClient,
): void {
  const task = program
    .command('task')
    .description('Manage tasks in the civilization task queue');

  task
    .command('list')
    .description('List all tasks')
    .option('--status <status>', 'Filter by status (pending, assigned, in_progress, completed, failed, blocked)')
    .option('--agent <agentId>', 'Filter by assigned agent ID')
    .option('--priority <priority>', 'Filter by priority (critical, high, normal, low)')
    .action(async (opts: { status?: string; agent?: string; priority?: string }) => {
      const format = program.opts()['format'] as OutputFormat;
      const params: string[] = [];
      if (opts.status) params.push(`status=${opts.status}`);
      if (opts.agent) params.push(`agent=${opts.agent}`);
      if (opts.priority) params.push(`priority=${opts.priority}`);
      const path = params.length > 0 ? `/tasks?${params.join('&')}` : '/tasks';
      const result = await getClient().get(path);
      console.log(formatOutput(result, format));
    });

  task
    .command('create')
    .description('Create a new task')
    .requiredOption('--type <type>', 'Task type (build, mine, haul, patrol, farm, ceremony)')
    .requiredOption('--description <desc>', 'Task description')
    .option('--priority <priority>', 'Task priority', 'normal')
    .action(async (opts: { type: string; description: string; priority: string }) => {
      const format = program.opts()['format'] as OutputFormat;
      const result = await getClient().post('/tasks', {
        type: opts.type,
        description: opts.description,
        priority: opts.priority,
      });
      console.log(formatOutput(result, format));
    });

  task
    .command('cancel')
    .description('Cancel a task by ID')
    .argument('<id>', 'Task ID')
    .action(async (id: string) => {
      const format = program.opts()['format'] as OutputFormat;
      const result = await getClient().post(`/tasks/${id}/cancel`);
      console.log(formatOutput(result, format));
    });

  task
    .command('retry')
    .description('Retry a failed task by ID')
    .argument('<id>', 'Task ID')
    .action(async (id: string) => {
      const format = program.opts()['format'] as OutputFormat;
      const result = await getClient().post(`/tasks/${id}/retry`);
      console.log(formatOutput(result, format));
    });
}
