/** Output format options for CLI commands */
export type OutputFormat = 'json' | 'table' | 'text';

/**
 * TableFormatter — formats data as an aligned ASCII table with headers.
 */
export class TableFormatter {
  /**
   * Format an array of rows as an aligned table.
   * @param rows - Array of record objects
   * @param columns - Column keys to display (defaults to keys of first row)
   */
  formatTable(rows: Record<string, unknown>[], columns?: string[]): string {
    if (rows.length === 0) return '(empty)';

    const keys = columns ?? Object.keys(rows[0]!);
    if (keys.length === 0) return '(empty)';

    const widths = keys.map((k) => {
      const maxVal = rows.reduce(
        (max, row) => Math.max(max, String(row[k] ?? '').length),
        0,
      );
      return Math.max(k.length, maxVal);
    });

    const header = keys.map((k, i) => k.padEnd(widths[i]!)).join('  ');
    const separator = widths.map((w) => '-'.repeat(w)).join('  ');
    const body = rows
      .map((row) =>
        keys.map((k, i) => String(row[k] ?? '').padEnd(widths[i]!)).join('  '),
      )
      .join('\n');

    return `${header}\n${separator}\n${body}`;
  }
}

/**
 * JsonFormatter — pretty-prints data as JSON with 2-space indentation.
 */
export class JsonFormatter {
  /**
   * Format data as pretty-printed JSON.
   */
  formatJson(data: unknown): string {
    return JSON.stringify(data, null, 2);
  }
}


/**
 * TextFormatter — minimal key=value output for scripting.
 */
export class TextFormatter {
  /**
   * Format data as plain text.
   * If a template is provided, replaces `{{key}}` placeholders with values.
   * Otherwise outputs `key=value` pairs, one per line.
   * For arrays, each item is formatted on its own line(s).
   */
  formatText(data: Record<string, unknown>, template?: string): string {
    if (template) {
      return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) =>
        String(data[key] ?? ''),
      );
    }
    return Object.entries(data)
      .map(([k, v]) => `${k}=${String(v)}`)
      .join('\n');
  }
}

/** Singleton instances for convenience */
const tableFormatter = new TableFormatter();
const jsonFormatter = new JsonFormatter();
const textFormatter = new TextFormatter();

/**
 * Select the appropriate formatter instance by format name.
 */
export function selectFormatter(
  format: OutputFormat,
): TableFormatter | JsonFormatter | TextFormatter {
  switch (format) {
    case 'table':
      return tableFormatter;
    case 'json':
      return jsonFormatter;
    case 'text':
      return textFormatter;
  }
}

/**
 * Convenience function: format data for CLI output based on the selected format.
 * Maintains backward compatibility with existing command usage.
 */
export function formatOutput(
  data: unknown,
  format: OutputFormat,
  columns?: string[],
): string {
  switch (format) {
    case 'json':
      return jsonFormatter.formatJson(data);
    case 'table':
      return formatAsTable(data, columns);
    case 'text':
      return formatAsText(data);
  }
}

// ── Internal helpers ──

function formatAsTable(data: unknown, columns?: string[]): string {
  if (Array.isArray(data) && data.length > 0) {
    return tableFormatter.formatTable(
      data as Record<string, unknown>[],
      columns,
    );
  }
  if (Array.isArray(data)) {
    return '(empty)';
  }
  if (typeof data === 'object' && data !== null) {
    return formatObjectAsTable(data as Record<string, unknown>);
  }
  return String(data);
}

function formatObjectAsTable(obj: Record<string, unknown>): string {
  const entries = Object.entries(obj);
  if (entries.length === 0) return '(empty)';

  const keyWidth = entries.reduce((max, [k]) => Math.max(max, k.length), 0);
  return entries
    .map(([k, v]) => `${k.padEnd(keyWidth)}  ${String(v)}`)
    .join('\n');
}

function formatAsText(data: unknown): string {
  if (typeof data === 'string') return data;
  if (Array.isArray(data)) {
    return data
      .map((item) =>
        typeof item === 'object' && item !== null
          ? textFormatter.formatText(item as Record<string, unknown>)
          : String(item),
      )
      .join('\n');
  }
  if (typeof data === 'object' && data !== null) {
    return textFormatter.formatText(data as Record<string, unknown>);
  }
  return String(data);
}
