/**
 * Property-based test for cross-platform path normalization.
 *
 * **Validates: Requirements 42.3, 42.4**
 *
 * Property 20: Cross-platform path normalization
 * For any file path containing mixed separators (forward slashes, backslashes)
 * or drive letter prefixes, `normalize()` should produce a valid
 * platform-appropriate path, and `resolve()` should produce an absolute path.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import path from 'node:path';
import { CrossPlatformPathResolver } from '../paths.js';

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** Generate a path segment (no separators) */
const segmentArb = fc
  .stringOf(
    fc.constantFrom(
      ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-'.split(''),
    ),
    { minLength: 1, maxLength: 12 },
  );

/** Generate a separator (forward or back slash) */
const separatorArb = fc.constantFrom('/', '\\');

/** Generate a relative segment (`.` or `..`) */
const relativeSegmentArb = fc.constantFrom('.', '..');

/** Generate a drive letter prefix like `C:` */
const driveLetterArb = fc
  .constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''))
  .map((letter) => `${letter}:`);

/**
 * Generate a path with mixed separators and optional relative segments.
 * Produces strings like: `foo/bar\baz/../qux`
 */
const mixedPathArb = fc
  .tuple(
    fc.array(
      fc.oneof(
        { weight: 5, arbitrary: segmentArb },
        { weight: 2, arbitrary: relativeSegmentArb },
      ),
      { minLength: 1, maxLength: 6 },
    ),
    fc.array(separatorArb, { minLength: 1, maxLength: 6 }),
  )
  .map(([segments, seps]) => {
    // Interleave segments with random separators
    return segments
      .map((seg, i) => seg + (i < segments.length - 1 ? seps[i % seps.length] : ''))
      .join('');
  });

/**
 * Generate a path that may optionally start with a drive letter.
 */
const pathWithOptionalDriveArb = fc
  .tuple(fc.boolean(), driveLetterArb, separatorArb, mixedPathArb)
  .map(([hasDrive, drive, sep, rest]) => (hasDrive ? `${drive}${sep}${rest}` : rest));

/** Generate a workspace root (absolute-looking path) */
const workspaceRootArb = fc
  .tuple(driveLetterArb, segmentArb, segmentArb)
  .map(([drive, a, b]) => path.resolve(`${drive}${path.sep}${a}${path.sep}${b}`));

// ---------------------------------------------------------------------------
// Property tests
// ---------------------------------------------------------------------------

describe('Cross-platform path normalization (Property 20)', () => {
  it('normalize() produces paths without redundant separators', () => {
    fc.assert(
      fc.property(workspaceRootArb, mixedPathArb, (root, userPath) => {
        const resolver = new CrossPlatformPathResolver(root);
        const normalized = resolver.normalize(userPath);

        // No double forward slashes
        expect(normalized).not.toMatch(/\/{2,}/);

        // No double backslashes (except UNC paths which start with \\)
        // For non-UNC paths, no consecutive backslashes in the middle
        const withoutUncPrefix = normalized.startsWith('\\\\')
          ? normalized.slice(2)
          : normalized;
        expect(withoutUncPrefix).not.toMatch(/\\{2,}/);

        // No mixed separators — normalized path should use only the platform separator
        const platformSep = path.sep;
        const otherSep = platformSep === '/' ? '\\' : '/';
        expect(normalized).not.toContain(otherSep);
      }),
      { numRuns: 300 },
    );
  });

  it('resolve() always produces absolute paths', () => {
    fc.assert(
      fc.property(
        workspaceRootArb,
        fc.array(segmentArb, { minLength: 0, maxLength: 4 }),
        (root, segments) => {
          const resolver = new CrossPlatformPathResolver(root);
          const resolved = resolver.resolve(...segments);

          // Must be an absolute path
          expect(path.isAbsolute(resolved)).toBe(true);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('resolve() with mixed-separator segments still produces absolute paths', () => {
    fc.assert(
      fc.property(workspaceRootArb, mixedPathArb, (root, mixedSegment) => {
        const resolver = new CrossPlatformPathResolver(root);
        const resolved = resolver.resolve(mixedSegment);

        expect(path.isAbsolute(resolved)).toBe(true);
      }),
      { numRuns: 300 },
    );
  });

  it('convenience methods return paths under the workspace root', () => {
    fc.assert(
      fc.property(workspaceRootArb, (root) => {
        const resolver = new CrossPlatformPathResolver(root);
        const normalizedRoot = path.normalize(root);

        const dataDir = resolver.dataDir();
        const snapshotsDir = resolver.snapshotsDir();
        const logsDir = resolver.logsDir();
        const dbPath = resolver.databasePath();

        // All convenience paths must start with the workspace root
        expect(path.normalize(dataDir).startsWith(normalizedRoot)).toBe(true);
        expect(path.normalize(snapshotsDir).startsWith(normalizedRoot)).toBe(true);
        expect(path.normalize(logsDir).startsWith(normalizedRoot)).toBe(true);
        expect(path.normalize(dbPath).startsWith(normalizedRoot)).toBe(true);

        // snapshotsDir should be under dataDir
        expect(path.normalize(snapshotsDir).startsWith(path.normalize(dataDir))).toBe(true);

        // databasePath should be under dataDir
        expect(path.normalize(dbPath).startsWith(path.normalize(dataDir))).toBe(true);
      }),
      { numRuns: 300 },
    );
  });

  it('normalize() with drive letters produces valid paths', () => {
    fc.assert(
      fc.property(workspaceRootArb, pathWithOptionalDriveArb, (root, userPath) => {
        const resolver = new CrossPlatformPathResolver(root);
        const normalized = resolver.normalize(userPath);

        // Result should be a non-empty string
        expect(normalized.length).toBeGreaterThan(0);

        // Should use only the platform separator
        const platformSep = path.sep;
        const otherSep = platformSep === '/' ? '\\' : '/';
        expect(normalized).not.toContain(otherSep);
      }),
      { numRuns: 300 },
    );
  });
});
