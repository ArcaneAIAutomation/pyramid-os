/**
 * MockDatabase — In-memory mock database for development and testing.
 * Uses Maps to simulate the same CRUD interface as real repositories.
 * No real SQLite dependency required.
 *
 * Requirements: 44.1, 44.4
 */

export interface MockRecord {
  [key: string]: unknown;
}

/**
 * Generic in-memory repository providing CRUD operations
 * matching the interface pattern of real data-layer repositories.
 */
export class MockRepository<T extends MockRecord> {
  private store = new Map<string, T>();
  private readonly idField: string;

  constructor(idField = 'id') {
    this.idField = idField;
  }

  create(record: T): T {
    const id = record[this.idField] as string;
    if (!id) {
      throw new Error(`Record missing required field "${this.idField}"`);
    }
    if (this.store.has(id)) {
      throw new Error(`Record with ${this.idField}="${id}" already exists`);
    }
    this.store.set(id, { ...record });
    return { ...record };
  }

  getById(id: string): T | undefined {
    const record = this.store.get(id);
    return record ? { ...record } : undefined;
  }

  list(filter?: Partial<T>): T[] {
    let results = Array.from(this.store.values()).map((r) => ({ ...r }));
    if (filter) {
      results = results.filter((record) =>
        Object.entries(filter).every(
          ([key, value]) => value === undefined || record[key] === value,
        ),
      );
    }
    return results;
  }

  update(id: string, updates: Partial<T>): T | undefined {
    const existing = this.store.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...updates };
    this.store.set(id, updated);
    return { ...updated };
  }

  delete(id: string): boolean {
    return this.store.delete(id);
  }

  count(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }
}

/**
 * MockDatabase — Simulates DatabaseManager with in-memory storage.
 * `getDb()` throws since there is no real SQLite connection.
 * `initialize()`, `close()`, and `migrate()` are no-ops.
 */
export class MockDatabase {
  private initialized = false;
  private readonly repositories = new Map<string, MockRepository<MockRecord>>();

  /** No-op initialization (no real SQLite) */
  initialize(_dbPath?: string, _poolSize?: number): void {
    this.initialized = true;
  }

  /** No-op migration */
  migrate(): void {
    // No-op: no real schema to migrate
  }

  /** No-op close */
  close(): void {
    this.initialized = false;
  }

  /** No-op backup */
  backup(_backupPath: string): void {
    // No-op: no real file to copy
  }

  /** Always returns ok for mock */
  verifyIntegrity(): { ok: boolean; messages: string[] } {
    return { ok: true, messages: ['ok'] };
  }

  /**
   * Throws — no real SQLite connection available.
   * Use getRepository() for in-memory CRUD instead.
   */
  getDb(): never {
    throw new Error(
      'MockDatabase: getDb() is not available. ' +
      'Use getRepository() for in-memory CRUD operations.',
    );
  }

  /** Get or create a named in-memory repository */
  getRepository<T extends MockRecord>(name: string, idField = 'id'): MockRepository<T> {
    if (!this.repositories.has(name)) {
      this.repositories.set(name, new MockRepository<MockRecord>(idField));
    }
    return this.repositories.get(name)! as unknown as MockRepository<T>;
  }

  /** Check if initialized */
  isInitialized(): boolean {
    return this.initialized;
  }

  /** Reset all repositories */
  reset(): void {
    this.repositories.forEach((repo) => repo.clear());
    this.repositories.clear();
  }
}
