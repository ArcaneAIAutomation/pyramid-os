"use strict";
/**
 * MockDatabase — In-memory mock database for development and testing.
 * Uses Maps to simulate the same CRUD interface as real repositories.
 * No real SQLite dependency required.
 *
 * Requirements: 44.1, 44.4
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MockDatabase = exports.MockRepository = void 0;
/**
 * Generic in-memory repository providing CRUD operations
 * matching the interface pattern of real data-layer repositories.
 */
class MockRepository {
    store = new Map();
    idField;
    constructor(idField = 'id') {
        this.idField = idField;
    }
    create(record) {
        const id = record[this.idField];
        if (!id) {
            throw new Error(`Record missing required field "${this.idField}"`);
        }
        if (this.store.has(id)) {
            throw new Error(`Record with ${this.idField}="${id}" already exists`);
        }
        this.store.set(id, { ...record });
        return { ...record };
    }
    getById(id) {
        const record = this.store.get(id);
        return record ? { ...record } : undefined;
    }
    list(filter) {
        let results = Array.from(this.store.values()).map((r) => ({ ...r }));
        if (filter) {
            results = results.filter((record) => Object.entries(filter).every(([key, value]) => value === undefined || record[key] === value));
        }
        return results;
    }
    update(id, updates) {
        const existing = this.store.get(id);
        if (!existing)
            return undefined;
        const updated = { ...existing, ...updates };
        this.store.set(id, updated);
        return { ...updated };
    }
    delete(id) {
        return this.store.delete(id);
    }
    count() {
        return this.store.size;
    }
    clear() {
        this.store.clear();
    }
}
exports.MockRepository = MockRepository;
/**
 * MockDatabase — Simulates DatabaseManager with in-memory storage.
 * `getDb()` throws since there is no real SQLite connection.
 * `initialize()`, `close()`, and `migrate()` are no-ops.
 */
class MockDatabase {
    initialized = false;
    repositories = new Map();
    /** No-op initialization (no real SQLite) */
    initialize(_dbPath, _poolSize) {
        this.initialized = true;
    }
    /** No-op migration */
    migrate() {
        // No-op: no real schema to migrate
    }
    /** No-op close */
    close() {
        this.initialized = false;
    }
    /** No-op backup */
    backup(_backupPath) {
        // No-op: no real file to copy
    }
    /** Always returns ok for mock */
    verifyIntegrity() {
        return { ok: true, messages: ['ok'] };
    }
    /**
     * Throws — no real SQLite connection available.
     * Use getRepository() for in-memory CRUD instead.
     */
    getDb() {
        throw new Error('MockDatabase: getDb() is not available. ' +
            'Use getRepository() for in-memory CRUD operations.');
    }
    /** Get or create a named in-memory repository */
    getRepository(name, idField = 'id') {
        if (!this.repositories.has(name)) {
            this.repositories.set(name, new MockRepository(idField));
        }
        return this.repositories.get(name);
    }
    /** Check if initialized */
    isInitialized() {
        return this.initialized;
    }
    /** Reset all repositories */
    reset() {
        this.repositories.forEach((repo) => repo.clear());
        this.repositories.clear();
    }
}
exports.MockDatabase = MockDatabase;
//# sourceMappingURL=mock-database.js.map