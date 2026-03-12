import { describe, it, expect } from 'vitest';
import {
  formatOutput,
  selectFormatter,
  TableFormatter,
  JsonFormatter,
  TextFormatter,
} from '../formatter.js';

describe('TableFormatter', () => {
  const fmt = new TableFormatter();

  it('formats rows with aligned columns', () => {
    const rows = [
      { id: '1', name: 'alpha', status: 'active' },
      { id: '2', name: 'beta', status: 'idle' },
    ];
    const result = fmt.formatTable(rows);
    const lines = result.split('\n');
    expect(lines.length).toBe(4); // header + separator + 2 rows
    expect(lines[0]).toContain('id');
    expect(lines[0]).toContain('name');
    expect(lines[0]).toContain('status');
    expect(lines[1]).toMatch(/^-+\s+-+\s+-+$/);
    expect(lines[2]).toContain('alpha');
    expect(lines[3]).toContain('beta');
  });

  it('respects explicit column selection', () => {
    const rows = [
      { id: '1', name: 'alpha', status: 'active' },
      { id: '2', name: 'beta', status: 'idle' },
    ];
    const result = fmt.formatTable(rows, ['id', 'name']);
    expect(result).not.toContain('status');
    expect(result).toContain('id');
    expect(result).toContain('name');
  });

  it('returns (empty) for empty array', () => {
    expect(fmt.formatTable([])).toBe('(empty)');
  });

  it('pads columns to the widest value', () => {
    const rows = [
      { key: 'a', value: 'short' },
      { key: 'b', value: 'a much longer value' },
    ];
    const result = fmt.formatTable(rows);
    const lines = result.split('\n');
    // The separator dashes should span the full width of each column
    const sepParts = lines[1]!.split('  ');
    // 'value' header is 5 chars but longest value is 19, so separator should be 19 dashes
    expect(sepParts[1]!.length).toBe('a much longer value'.length);
  });
});


describe('JsonFormatter', () => {
  const fmt = new JsonFormatter();

  it('pretty-prints objects with 2-space indentation', () => {
    const result = fmt.formatJson({ name: 'test', value: 42 });
    expect(JSON.parse(result)).toEqual({ name: 'test', value: 42 });
    // Verify 2-space indentation
    expect(result).toContain('  "name"');
  });

  it('pretty-prints arrays', () => {
    const result = fmt.formatJson([1, 2, 3]);
    expect(JSON.parse(result)).toEqual([1, 2, 3]);
  });

  it('handles strings', () => {
    const result = fmt.formatJson('hello');
    expect(JSON.parse(result)).toBe('hello');
  });

  it('handles null', () => {
    const result = fmt.formatJson(null);
    expect(JSON.parse(result)).toBeNull();
  });
});

describe('TextFormatter', () => {
  const fmt = new TextFormatter();

  it('formats object as key=value pairs', () => {
    const result = fmt.formatText({ host: '127.0.0.1', port: 8080 });
    expect(result).toBe('host=127.0.0.1\nport=8080');
  });

  it('applies template with {{key}} placeholders', () => {
    const result = fmt.formatText(
      { name: 'alpha', status: 'active' },
      'Agent {{name}} is {{status}}',
    );
    expect(result).toBe('Agent alpha is active');
  });

  it('replaces missing keys with empty string in template', () => {
    const result = fmt.formatText({ name: 'alpha' }, '{{name}}: {{missing}}');
    expect(result).toBe('alpha: ');
  });
});

describe('selectFormatter', () => {
  it('returns TableFormatter for table', () => {
    expect(selectFormatter('table')).toBeInstanceOf(TableFormatter);
  });

  it('returns JsonFormatter for json', () => {
    expect(selectFormatter('json')).toBeInstanceOf(JsonFormatter);
  });

  it('returns TextFormatter for text', () => {
    expect(selectFormatter('text')).toBeInstanceOf(TextFormatter);
  });
});

describe('formatOutput (convenience)', () => {
  describe('json format', () => {
    it('formats objects as pretty JSON', () => {
      const result = formatOutput({ name: 'test', value: 42 }, 'json');
      expect(JSON.parse(result)).toEqual({ name: 'test', value: 42 });
    });

    it('formats arrays as pretty JSON', () => {
      const result = formatOutput([1, 2, 3], 'json');
      expect(JSON.parse(result)).toEqual([1, 2, 3]);
    });

    it('formats strings as JSON', () => {
      const result = formatOutput('hello', 'json');
      expect(JSON.parse(result)).toBe('hello');
    });
  });

  describe('table format', () => {
    it('formats array of objects as table', () => {
      const data = [
        { id: '1', name: 'alpha', status: 'active' },
        { id: '2', name: 'beta', status: 'idle' },
      ];
      const result = formatOutput(data, 'table');
      expect(result).toContain('id');
      expect(result).toContain('name');
      expect(result).toContain('status');
      expect(result).toContain('alpha');
      expect(result).toContain('beta');
      expect(result).toContain('--');
    });

    it('formats single object as key-value table', () => {
      const data = { host: '127.0.0.1', port: 8080 };
      const result = formatOutput(data, 'table');
      expect(result).toContain('host');
      expect(result).toContain('127.0.0.1');
      expect(result).toContain('port');
      expect(result).toContain('8080');
    });

    it('handles empty array', () => {
      expect(formatOutput([], 'table')).toBe('(empty)');
    });

    it('handles scalar values', () => {
      expect(formatOutput(42, 'table')).toBe('42');
    });

    it('supports explicit columns parameter', () => {
      const data = [
        { id: '1', name: 'alpha', status: 'active' },
      ];
      const result = formatOutput(data, 'table', ['id', 'name']);
      expect(result).toContain('id');
      expect(result).toContain('name');
      expect(result).not.toContain('status');
    });
  });

  describe('text format', () => {
    it('formats string as-is', () => {
      expect(formatOutput('hello world', 'text')).toBe('hello world');
    });

    it('formats object as key=value pairs', () => {
      const result = formatOutput({ a: 1, b: 2 }, 'text');
      expect(result).toContain('a=1');
      expect(result).toContain('b=2');
    });

    it('formats array of objects as lines', () => {
      const data = [
        { id: '1', name: 'alpha' },
        { id: '2', name: 'beta' },
      ];
      const result = formatOutput(data, 'text');
      expect(result).toContain('id=1');
      expect(result).toContain('name=alpha');
      expect(result).toContain('id=2');
      expect(result).toContain('name=beta');
    });

    it('formats scalar values', () => {
      expect(formatOutput(42, 'text')).toBe('42');
    });
  });
});
