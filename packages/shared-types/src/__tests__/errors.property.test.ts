/**
 * Property-based tests for error structure completeness.
 *
 * **Validates: Requirements 38.1, 38.6, 38.7**
 *
 * Property 14: Error structure completeness
 * For any error produced by the system, it should have a non-empty error code
 * matching the `PYRAMID_{CATEGORY}_{SPECIFIC}` pattern, a valid severity level,
 * and a non-empty human-readable message.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  ERROR_REGISTRY,
  ErrorCategory,
  createPyramidError,
  PyramidError,
} from '../errors.js';
import type { ErrorSeverity } from '../errors.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VALID_SEVERITIES: ErrorSeverity[] = ['critical', 'error', 'warning', 'info'];
const VALID_CATEGORIES = Object.values(ErrorCategory);
const ERROR_CODE_PATTERN = /^PYRAMID_[A-Z]+_[A-Z_]+$/;
const ALL_REGISTRY_CODES = Object.keys(ERROR_REGISTRY);

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** Pick a registered error code */
const registryCodeArb = fc.constantFrom(...ALL_REGISTRY_CODES);

/** Random context object */
const contextArb = fc.dictionary(
  fc.string({ minLength: 1, maxLength: 10 }).filter((s) => /^[a-zA-Z]/.test(s)),
  fc.oneof(fc.string(), fc.integer(), fc.boolean()),
  { minKeys: 0, maxKeys: 5 },
);

// ---------------------------------------------------------------------------
// Property tests
// ---------------------------------------------------------------------------

describe('Error structure completeness (Property 14)', () => {
  it('every registered error code matches PYRAMID_{CATEGORY}_{SPECIFIC} pattern, has valid severity, category, message, and remediation', () => {
    fc.assert(
      fc.property(registryCodeArb, (code) => {
        const entry = ERROR_REGISTRY[code];

        // Code matches pattern
        expect(code).toMatch(ERROR_CODE_PATTERN);

        // Category is a valid ErrorCategory enum value
        expect(VALID_CATEGORIES).toContain(entry.category);

        // Severity is one of the four valid levels
        expect(VALID_SEVERITIES).toContain(entry.severity);

        // Message is non-empty
        expect(entry.message.length).toBeGreaterThan(0);

        // Remediation is a non-empty array of non-empty strings
        expect(Array.isArray(entry.remediation)).toBe(true);
        expect(entry.remediation.length).toBeGreaterThan(0);
        for (const step of entry.remediation) {
          expect(typeof step).toBe('string');
          expect(step.length).toBeGreaterThan(0);
        }
      }),
      { numRuns: ALL_REGISTRY_CODES.length * 10 },
    );
  });

  it('createPyramidError with random contexts produces a valid PyramidError for every registry code', () => {
    fc.assert(
      fc.property(registryCodeArb, contextArb, (code, ctx) => {
        const error = createPyramidError(code, ctx);

        // Must be a PyramidError instance
        expect(error).toBeInstanceOf(PyramidError);

        // Code matches pattern
        expect(error.code).toMatch(ERROR_CODE_PATTERN);
        expect(error.code).toBe(code);

        // Category is valid
        expect(VALID_CATEGORIES).toContain(error.category);

        // Severity is valid
        expect(VALID_SEVERITIES).toContain(error.severity);

        // Message is non-empty
        expect(error.message.length).toBeGreaterThan(0);

        // Remediation is present and non-empty
        expect(Array.isArray(error.remediation)).toBe(true);
        expect(error.remediation!.length).toBeGreaterThan(0);

        // Context is set
        expect(error.context).toEqual(ctx);

        // Timestamp is a Date
        expect(error.timestamp).toBeInstanceOf(Date);
      }),
      { numRuns: 200 },
    );
  });

  it('createPyramidError with a cause wraps the original error', () => {
    fc.assert(
      fc.property(
        registryCodeArb,
        fc.string({ minLength: 1, maxLength: 50 }),
        (code, causeMsg) => {
          const cause = new Error(causeMsg);
          const error = createPyramidError(code, undefined, cause);

          expect(error.cause).toBe(cause);
          expect(error.code).toBe(code);
          expect(VALID_SEVERITIES).toContain(error.severity);
        },
      ),
      { numRuns: 100 },
    );
  });
});
