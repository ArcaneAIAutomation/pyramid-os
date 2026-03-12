/**
 * Property-based tests for config round-trip serialization.
 *
 * **Validates: Requirements 15.1, 15.9**
 *
 * Property: Config serialized to JSON and re-parsed via loadConfig produces
 * an equivalent PyramidConfig object.
 */

import { writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it } from 'vitest';
import * as fc from 'fast-check';
import { loadConfig } from '../config-loader.js';
import type { PyramidConfig } from '../config.js';

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** Non-empty string that won't contain ${...} env-var syntax */
const safeString = fc.stringMatching(/^[a-zA-Z0-9 ._/-]{1,40}$/);

const ollamaArb = fc.record({
  host: safeString,
  port: fc.integer({ min: 1, max: 65535 }),
  timeout: fc.integer({ min: 1, max: 300_000 }),
  maxConcurrentRequests: fc.integer({ min: 1, max: 100 }),
});

const connectionProfileArb = fc.record({
  name: safeString,
  host: safeString,
  port: fc.integer({ min: 1, max: 65535 }),
  authMethod: fc.constantFrom('none' as const, 'credentials' as const, 'microsoft' as const),
  credentials: fc.option(
    fc.record({ username: safeString, password: safeString }),
    { nil: undefined },
  ),
  msToken: fc.option(safeString, { nil: undefined }),
  version: fc.option(safeString, { nil: undefined }),
});

const safetyArb = fc.record({
  prohibitedBlocks: fc.array(safeString, { minLength: 1, maxLength: 5 }),
  prohibitedCommands: fc.array(safeString, { minLength: 1, maxLength: 5 }),
  maxDecisionTimeMs: fc.integer({ min: 1, max: 60_000 }),
  maxActionsPerSecond: fc.integer({ min: 1, max: 100 }),
  maxReasoningLoops: fc.integer({ min: 1, max: 200 }),
});

const resourceThresholdArb = fc.record({
  resourceType: safeString,
  minimum: fc.integer({ min: 0, max: 10_000 }),
  critical: fc.integer({ min: 0, max: 10_000 }),
});

const pyramidConfigArb: fc.Arbitrary<PyramidConfig> = fc.record({
  ollama: ollamaArb,
  connections: fc.array(connectionProfileArb, { maxLength: 3 }),
  safety: safetyArb,
  controlCentre: fc.record({
    port: fc.integer({ min: 1, max: 65535 }),
    theme: safeString,
    refreshRateMs: fc.integer({ min: 1, max: 10_000 }),
  }),
  logging: fc.record({
    level: fc.constantFrom('debug' as const, 'info' as const, 'warn' as const, 'error' as const),
    outputPath: safeString,
    maxFileSizeMb: fc.integer({ min: 1, max: 1000 }),
  }),
  api: fc.record({
    port: fc.integer({ min: 1, max: 65535 }),
    apiKey: safeString,
    rateLimitPerMin: fc.integer({ min: 1, max: 10_000 }),
  }),
  database: fc.record({
    path: safeString,
    poolSize: fc.integer({ min: 1, max: 100 }),
  }),
  workspace: fc.record({
    dataDir: safeString,
    snapshotsDir: safeString,
    logsDir: safeString,
  }),
  resourceThresholds: fc.option(
    fc.array(resourceThresholdArb, { maxLength: 5 }),
    { nil: undefined },
  ),
});

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function withTempFile(config: PyramidConfig, fn: (path: string) => void): void {
  const path = join(tmpdir(), `pyramid-config-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  try {
    writeFileSync(path, JSON.stringify(config), 'utf-8');
    fn(path);
  } finally {
    try { unlinkSync(path); } catch { /* ignore cleanup errors */ }
  }
}

// ---------------------------------------------------------------------------
// Property test
// ---------------------------------------------------------------------------

describe('config round-trip property', () => {
  it('serializing to JSON and re-parsing via loadConfig produces an equivalent config', () => {
    fc.assert(
      fc.property(pyramidConfigArb, (original) => {
        withTempFile(original, (tempPath) => {
          const reparsed = loadConfig(tempPath);

          // Strip undefined optional fields from original for deep comparison
          const normalised = JSON.parse(JSON.stringify(original)) as PyramidConfig;

          // Deep equality check
          const reparsedJson = JSON.stringify(reparsed);
          const normalisedJson = JSON.stringify(normalised);

          if (reparsedJson !== normalisedJson) {
            throw new Error(
              `Round-trip mismatch.\nOriginal: ${normalisedJson}\nReparsed: ${reparsedJson}`,
            );
          }
        });
      }),
      { numRuns: 100 },
    );
  });
});
