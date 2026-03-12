import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { CrossPlatformPathResolver } from '../paths.js';

describe('CrossPlatformPathResolver', () => {
  const root = path.resolve('/workspace/pyramid-os');
  const resolver = new CrossPlatformPathResolver(root);

  describe('resolve()', () => {
    it('resolves a single segment relative to workspace root', () => {
      const result = resolver.resolve('data');
      expect(result).toBe(path.resolve(root, 'data'));
    });

    it('resolves multiple segments relative to workspace root', () => {
      const result = resolver.resolve('data', 'snapshots', 'snap1.json');
      expect(result).toBe(path.resolve(root, 'data', 'snapshots', 'snap1.json'));
    });

    it('returns an absolute path', () => {
      const result = resolver.resolve('some', 'nested', 'dir');
      expect(path.isAbsolute(result)).toBe(true);
    });

    it('resolves with no segments to workspace root', () => {
      const result = resolver.resolve();
      expect(result).toBe(root);
    });

    it('handles relative segments with ..', () => {
      const result = resolver.resolve('data', '..', 'logs');
      expect(result).toBe(path.resolve(root, 'logs'));
    });
  });

  describe('convenience directories', () => {
    it('dataDir() returns workspace/data', () => {
      expect(resolver.dataDir()).toBe(path.join(root, 'data'));
    });

    it('snapshotsDir() returns workspace/data/snapshots', () => {
      expect(resolver.snapshotsDir()).toBe(path.join(root, 'data', 'snapshots'));
    });

    it('logsDir() returns workspace/logs', () => {
      expect(resolver.logsDir()).toBe(path.join(root, 'logs'));
    });

    it('databasePath() returns workspace/data/pyramid.db', () => {
      expect(resolver.databasePath()).toBe(path.join(root, 'data', 'pyramid.db'));
    });
  });

  describe('normalize()', () => {
    it('normalizes a path with mixed separators', () => {
      const result = resolver.normalize('data/snapshots\\file.json');
      expect(result).toBe(path.normalize('data/snapshots\\file.json'));
    });

    it('resolves relative segments', () => {
      const result = resolver.normalize('data/../logs/app.log');
      expect(result).toBe(path.normalize('data/../logs/app.log'));
    });

    it('handles redundant separators', () => {
      const result = resolver.normalize('data//snapshots///file.json');
      expect(result).toBe(path.normalize('data//snapshots///file.json'));
    });

    it('handles dot segments', () => {
      const result = resolver.normalize('./data/./snapshots');
      expect(result).toBe(path.normalize('./data/./snapshots'));
    });

    it('returns a string without redundant separators', () => {
      const result = resolver.normalize('a//b///c');
      // Should not contain consecutive separators
      expect(result).not.toMatch(/[/\\]{2,}/);
    });
  });

  describe('different workspace roots', () => {
    it('works with a different workspace root', () => {
      const customRoot = path.resolve('/custom/root');
      const customResolver = new CrossPlatformPathResolver(customRoot);
      expect(customResolver.dataDir()).toBe(path.join(customRoot, 'data'));
      expect(customResolver.logsDir()).toBe(path.join(customRoot, 'logs'));
      expect(customResolver.databasePath()).toBe(path.join(customRoot, 'data', 'pyramid.db'));
    });

    it('all convenience paths are under the workspace root', () => {
      const dirs = [
        resolver.dataDir(),
        resolver.snapshotsDir(),
        resolver.logsDir(),
        resolver.databasePath(),
      ];
      for (const dir of dirs) {
        expect(dir.startsWith(root)).toBe(true);
      }
    });
  });
});
