import { describe, it, expect, beforeEach } from 'vitest';
import { MockDatabase, MockRepository } from '../__mocks__/mock-database.js';

interface TestRecord {
  id: string;
  name: string;
  value: number;
  [key: string]: unknown;
}

describe('MockRepository', () => {
  let repo: MockRepository<TestRecord>;

  beforeEach(() => {
    repo = new MockRepository<TestRecord>('id');
  });

  it('creates and retrieves a record', () => {
    const record = repo.create({ id: '1', name: 'test', value: 42 });
    expect(record.id).toBe('1');
    const found = repo.getById('1');
    expect(found).toEqual({ id: '1', name: 'test', value: 42 });
  });

  it('throws on duplicate id', () => {
    repo.create({ id: '1', name: 'a', value: 1 });
    expect(() => repo.create({ id: '1', name: 'b', value: 2 })).toThrow('already exists');
  });

  it('throws on missing id field', () => {
    expect(() => repo.create({ id: '', name: 'a', value: 1 })).toThrow('missing required');
  });

  it('returns undefined for unknown id', () => {
    expect(repo.getById('nonexistent')).toBeUndefined();
  });

  it('lists all records', () => {
    repo.create({ id: '1', name: 'a', value: 1 });
    repo.create({ id: '2', name: 'b', value: 2 });
    expect(repo.list()).toHaveLength(2);
  });

  it('filters records', () => {
    repo.create({ id: '1', name: 'a', value: 1 });
    repo.create({ id: '2', name: 'b', value: 2 });
    repo.create({ id: '3', name: 'a', value: 3 });
    const filtered = repo.list({ name: 'a' } as Partial<TestRecord>);
    expect(filtered).toHaveLength(2);
    expect(filtered.every((r) => r.name === 'a')).toBe(true);
  });

  it('updates a record', () => {
    repo.create({ id: '1', name: 'old', value: 1 });
    const updated = repo.update('1', { name: 'new' });
    expect(updated?.name).toBe('new');
    expect(updated?.value).toBe(1);
    expect(repo.getById('1')?.name).toBe('new');
  });

  it('returns undefined when updating nonexistent record', () => {
    expect(repo.update('nonexistent', { name: 'x' })).toBeUndefined();
  });

  it('deletes a record', () => {
    repo.create({ id: '1', name: 'a', value: 1 });
    expect(repo.delete('1')).toBe(true);
    expect(repo.getById('1')).toBeUndefined();
    expect(repo.count()).toBe(0);
  });

  it('returns false when deleting nonexistent record', () => {
    expect(repo.delete('nonexistent')).toBe(false);
  });

  it('counts records', () => {
    expect(repo.count()).toBe(0);
    repo.create({ id: '1', name: 'a', value: 1 });
    expect(repo.count()).toBe(1);
  });

  it('clears all records', () => {
    repo.create({ id: '1', name: 'a', value: 1 });
    repo.create({ id: '2', name: 'b', value: 2 });
    repo.clear();
    expect(repo.count()).toBe(0);
  });

  it('returns copies, not references', () => {
    const original = repo.create({ id: '1', name: 'a', value: 1 });
    original.name = 'mutated';
    expect(repo.getById('1')?.name).toBe('a');
  });
});

describe('MockDatabase', () => {
  let db: MockDatabase;

  beforeEach(() => {
    db = new MockDatabase();
  });

  it('initialize is a no-op', () => {
    expect(() => db.initialize('/fake/path.db')).not.toThrow();
    expect(db.isInitialized()).toBe(true);
  });

  it('migrate is a no-op', () => {
    expect(() => db.migrate()).not.toThrow();
  });

  it('close is a no-op', () => {
    db.initialize();
    expect(() => db.close()).not.toThrow();
    expect(db.isInitialized()).toBe(false);
  });

  it('backup is a no-op', () => {
    expect(() => db.backup('/fake/backup.db')).not.toThrow();
  });

  it('verifyIntegrity returns ok', () => {
    const report = db.verifyIntegrity();
    expect(report.ok).toBe(true);
    expect(report.messages).toContain('ok');
  });

  it('getDb throws', () => {
    expect(() => db.getDb()).toThrow('MockDatabase');
  });

  it('getRepository returns a MockRepository', () => {
    const repo = db.getRepository<TestRecord>('agents');
    expect(repo).toBeInstanceOf(MockRepository);
  });

  it('getRepository returns same instance for same name', () => {
    const r1 = db.getRepository('agents');
    const r2 = db.getRepository('agents');
    expect(r1).toBe(r2);
  });

  it('repositories support full CRUD', () => {
    const repo = db.getRepository<TestRecord>('test');
    repo.create({ id: '1', name: 'a', value: 1 });
    expect(repo.getById('1')).toBeDefined();
    repo.update('1', { value: 99 });
    expect(repo.getById('1')?.value).toBe(99);
    repo.delete('1');
    expect(repo.getById('1')).toBeUndefined();
  });

  it('reset clears all repositories', () => {
    const repo = db.getRepository<TestRecord>('test');
    repo.create({ id: '1', name: 'a', value: 1 });
    db.reset();
    // After reset, getting the same repo name creates a fresh one
    const repo2 = db.getRepository<TestRecord>('test');
    expect(repo2.count()).toBe(0);
  });
});
