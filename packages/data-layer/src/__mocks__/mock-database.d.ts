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
export declare class MockRepository<T extends MockRecord> {
    private store;
    private readonly idField;
    constructor(idField?: string);
    create(record: T): T;
    getById(id: string): T | undefined;
    list(filter?: Partial<T>): T[];
    update(id: string, updates: Partial<T>): T | undefined;
    delete(id: string): boolean;
    count(): number;
    clear(): void;
}
/**
 * MockDatabase — Simulates DatabaseManager with in-memory storage.
 * `getDb()` throws since there is no real SQLite connection.
 * `initialize()`, `close()`, and `migrate()` are no-ops.
 */
export declare class MockDatabase {
    private initialized;
    private readonly repositories;
    /** No-op initialization (no real SQLite) */
    initialize(_dbPath?: string, _poolSize?: number): void;
    /** No-op migration */
    migrate(): void;
    /** No-op close */
    close(): void;
    /** No-op backup */
    backup(_backupPath: string): void;
    /** Always returns ok for mock */
    verifyIntegrity(): {
        ok: boolean;
        messages: string[];
    };
    /**
     * Throws — no real SQLite connection available.
     * Use getRepository() for in-memory CRUD instead.
     */
    getDb(): never;
    /** Get or create a named in-memory repository */
    getRepository<T extends MockRecord>(name: string, idField?: string): MockRepository<T>;
    /** Check if initialized */
    isInitialized(): boolean;
    /** Reset all repositories */
    reset(): void;
}
//# sourceMappingURL=mock-database.d.ts.map