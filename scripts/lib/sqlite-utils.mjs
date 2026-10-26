// Utilidades compartidas por los scripts de Node (no se empaquetan en la app).
// Usan node:sqlite (incluido en Node 22.5+), sin dependencias externas.
// Nunca imprimen filas: solo conteos, esquemas y huellas.
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';

export const PASSWORD_PLACEHOLDER = '[OCULTO]';

export const openReadOnly = (path) => new DatabaseSync(path, { readOnly: true });

export const listTables = (db) =>
    db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
        .all().map((r) => r.name);

export const getUserVersion = (db) => db.prepare('PRAGMA user_version').get().user_version;

export const getSchema = (db) =>
    db.prepare(`SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name`).all();

export const countRows = (db, table) => db.prepare(`SELECT COUNT(*) AS c FROM "${table}"`).get().c;

export const countAll = (db) => Object.fromEntries(listTables(db).map((t) => [t, countRows(db, t)]));

// node:sqlite devuelve objetos con prototipo nulo; se normalizan a objetos planos.
const plain = (row) => Object.fromEntries(Object.entries(row));

// Orden estable: por id (numérico o UUID) y, si no hay id, por el contenido completo.
const rowKey = (r) => (r.id !== undefined && r.id !== null ? `${typeof r.id === 'number' ? String(r.id).padStart(20, '0') : r.id}` : JSON.stringify(r));

// Huella SHA-256 del contenido de una lista de filas, ordenadas por id.
// Si maskPassword, users.password se reemplaza por el marcador (como en el JSON).
export const hashRows = (rows, { maskPassword = false } = {}) => {
    const sorted = rows.map(plain).sort((a, b) => (rowKey(a) < rowKey(b) ? -1 : rowKey(a) > rowKey(b) ? 1 : 0));
    const normalized = maskPassword ? sorted.map((r) => ({ ...r, password: PASSWORD_PLACEHOLDER })) : sorted;
    return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
};

export const hashTable = (db, table) =>
    hashRows(db.prepare(`SELECT * FROM "${table}"`).all(), { maskPassword: table === 'users' });

export const hashAll = (db) => Object.fromEntries(listTables(db).map((t) => [t, hashTable(db, t)]));
