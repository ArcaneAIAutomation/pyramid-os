/**
 * Property-based test for CLI output format validity.
 *
 * **Property 12: CLI output format validity**
 * For any command result formatted as JSON, the output should be valid parseable JSON.
 * For any command result formatted as table, the output should contain aligned column
 * headers matching the data keys. For text format, output should be a non-empty string
 * for non-empty input.
 *
 * **Validates: Requirements 27.10**
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  formatOutput,
  JsonFormatter,
  TableFormatter,
  TextFormatter,
} from '../formatter.js';

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/** Generate a JSON-safe primitive value (excluding -0 which JSON serializes as 0) */
const primitiveArb: fc.Arbitrary<unknown> = fc.oneof(
  fc.string(),
  fc.integer().map((n) => (Object.is(n, -0) ? 0 : n)),
  fc.double({ noNaN: true, noDefaultInfinity: true }).map((n) => (Object.is(n, -0) ? 0 : n)),
  fc.boolean(),
  fc.constant(null),
);

/** Generate a flat record with string keys and primitive values */
const flatRecordArb: fc.Arbitrary<Record<string, unknown>> = fc.dictionary(
  fc.string({ minLength: 1, maxLength: 10 }).filter((s) => /^\w+$/.test(s)),
  primitiveArb,
  { minKeys: 1, maxKeys: 6 },
);

/** Generate an array of records sharing the same keys */
const recordArrayArb: fc.Arbitrary<Record<string, unknown>[]> = flatRecordArb.chain(
  (template) => {
    const keys = Object.keys(template);
    if (keys.length === 0) return fc.constant([template]);
    const rowArb = fc.record(
      Object.fromEntries(keys.map((k) => [k, primitiveArb])) as Record<
        string,
        fc.Arbitrary<unknown>
      >,
    );
    return fc.array(rowArb, { minLength: 1, maxLength: 10 });
  },
);

/** Generate arbitrary JSON-serializable data (objects, arrays, primitives) */
const jsonDataArb: fc.Arbitrary<unknown> = fc.oneof(
  primitiveArb,
  fc.array(primitiveArb, { minLength: 0, maxLength: 5 }),
  flatRecordArb,
  recordArrayArb,
);

// ─── Property tests ──────────────────────────────────────────────────────────

describe('CLI output format validity (property)', () => {
  describe('JSON format', () => {
    it('output is always valid parseable JSON for any data', () => {
      const jsonFmt = new JsonFormatter();

      fc.assert(
        fc.property(jsonDataArb, (data) => {
          const output = jsonFmt.formatJson(data);
          // Must not throw — output is valid JSON
          const parsed = JSON.parse(output);
          // Round-trip: parsed value should deep-equal the original
          expect(parsed).toEqual(data);
        }),
        { numRuns: 200 },
      );
    });

    it('formatOutput with json format produces parseable JSON for any data', () => {
      fc.assert(
        fc.property(jsonDataArb, (data) => {
          const output = formatOutput(data, 'json');
          const parsed = JSON.parse(output);
          expect(parsed).toEqual(data);
        }),
        { numRuns: 200 },
      );
    });
  });

  describe('Table format', () => {
    it('output has header line containing all column names and a dash separator', () => {
      const tableFmt = new TableFormatter();

      fc.assert(
        fc.property(recordArrayArb, (rows) => {
          const output = tableFmt.formatTable(rows);
          const lines = output.split('\n');

          // Must have at least 3 lines: header, separator, data row(s)
          expect(lines.length).toBeGreaterThanOrEqual(3);

          const headerLine = lines[0]!;
          const separatorLine = lines[1]!;

          // Header should contain all column keys from the first row
          const keys = Object.keys(rows[0]!);
          for (const key of keys) {
            expect(headerLine).toContain(key);
          }

          // Separator line should consist only of dashes and spaces
          expect(separatorLine).toMatch(/^[-\s]+$/);

          // Header and separator should have the same length (aligned)
          expect(headerLine.length).toBe(separatorLine.length);
        }),
        { numRuns: 200 },
      );
    });

    it('formatOutput with table format has aligned headers for array data', () => {
      fc.assert(
        fc.property(recordArrayArb, (rows) => {
          const output = formatOutput(rows, 'table');
          const lines = output.split('\n');

          expect(lines.length).toBeGreaterThanOrEqual(3);

          const headerLine = lines[0]!;
          const separatorLine = lines[1]!;

          // All keys present in header
          const keys = Object.keys(rows[0]!);
          for (const key of keys) {
            expect(headerLine).toContain(key);
          }

          // Separator is dashes and spaces only
          expect(separatorLine).toMatch(/^[-\s]+$/);

          // Aligned: same length
          expect(headerLine.length).toBe(separatorLine.length);
        }),
        { numRuns: 200 },
      );
    });
  });

  describe('Text format', () => {
    it('output is a non-empty string for non-empty record input', () => {
      const textFmt = new TextFormatter();

      fc.assert(
        fc.property(flatRecordArb, (data) => {
          const output = textFmt.formatText(data);
          expect(output.length).toBeGreaterThan(0);
          expect(typeof output).toBe('string');
        }),
        { numRuns: 200 },
      );
    });

    it('formatOutput with text format produces non-empty string for non-empty objects', () => {
      fc.assert(
        fc.property(flatRecordArb, (data) => {
          const output = formatOutput(data, 'text');
          expect(output.length).toBeGreaterThan(0);
          expect(typeof output).toBe('string');
        }),
        { numRuns: 200 },
      );
    });
  });
});
