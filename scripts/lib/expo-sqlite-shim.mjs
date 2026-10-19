// Sustituto mínimo de expo-sqlite sobre node:sqlite, SOLO para probar en PC el
// código real de src/services (migrations.js, db.js). Implementa únicamente la
// parte de la API que ese código usa. No se empaqueta en la app.
import { DatabaseSync } from 'node:sqlite';

const normalizeParams = (params) => {
    if (params.length === 1 && Array.isArray(params[0])) return params[0];
    if (params.length === 1 && params[0] && typeof params[0] === 'object') return [params[0]];
    return params;
};
const plain = (row) => (row ? Object.fromEntries(Object.entries(row)) : null);

// Ruta del archivo que abrirá openDatabaseAsync (la fija cada prueba).
let currentPath = ':memory:';
export const __setDatabasePath = (path) => { currentPath = path; };

class ShimDatabase {
    constructor(path) {
        this.databasePath = path;
        // expo-sqlite no activa foreign keys por defecto; node:sqlite sí. Igualamos a expo.
        this._db = new DatabaseSync(path, { enableForeignKeyConstraints: false });
    }
    async execAsync(sql) { this._db.exec(sql); }
    async runAsync(sql, ...params) {
        const r = this._db.prepare(sql).run(...normalizeParams(params));
        return { lastInsertRowId: Number(r.lastInsertRowid), changes: Number(r.changes) };
    }
    async getFirstAsync(sql, ...params) {
        return plain(this._db.prepare(sql).get(...normalizeParams(params)));
    }
    async getAllAsync(sql, ...params) {
        return this._db.prepare(sql).all(...normalizeParams(params)).map(plain);
    }
    async withTransactionAsync(task) {
        this._db.exec('BEGIN');
        try {
            await task();
            this._db.exec('COMMIT');
        } catch (error) {
            this._db.exec('ROLLBACK');
            throw error;
        }
    }
    async withExclusiveTransactionAsync(task) {
        this._db.exec('BEGIN EXCLUSIVE');
        try {
            await task(this);
            this._db.exec('COMMIT');
        } catch (error) {
            this._db.exec('ROLLBACK');
            throw error;
        }
    }
    async closeAsync() { this._db.close(); }
}

export const openDatabaseAsync = async () => new ShimDatabase(currentPath);
