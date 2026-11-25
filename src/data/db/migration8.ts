import { nowIso } from '../clock';
import { maybeFail } from '../../services/devFlags';
import { DOMAIN_TABLES } from './migration3';

// Migración 8 (Fase 7.5b1): etiquetas de Pendiente (O11).
//   - SOLO aditiva: CREATE TABLE backlog_tags (catálogo, vacío) con sus índices y ALTER TABLE
//     backlog ADD COLUMN tags TEXT (NULL: JSON array de nombres; ver src/entertainment/tags.ts);
//   - con copia física previa (requiresBackup → registro_pre-migracion-v8_<sello>.db);
//   - no borra datos, no renombra ni recrea el .db, sin VACUUM; no rellena valores (los títulos de
//     antes quedan sin etiquetas; franchise queda como columna heredada) y no encola nada;
//   - verifica que la tabla, su UNIQUE, sus índices y la columna existen, que backlog_tags quedó
//     vacía y que los conteos de todas las tablas no cambian.
// backlog_tags tiene la forma de finance_categories para la clave natural: UNIQUE(user_id, section,
// name_key) local, igual que en el servidor (la fusión por clave natural del motor de sync).
// Par en Supabase: supabase/migrations/20261124000100_etiquetas.sql (se aplica ANTES de instalar
// el APK). Corre dentro de UNA withExclusiveTransactionAsync: si algo falla, queda en v7.

type Db = {
    execAsync(sql: string): Promise<void>;
    runAsync(sql: string, params?: any[]): Promise<{ changes: number; lastInsertRowId: number }>;
    getAllAsync<T = any>(sql: string, params?: any[]): Promise<T[]>;
    getFirstAsync<T = any>(sql: string, params?: any[]): Promise<T | null>;
};

// Tablas de dominio sincronizadas desde la migración 8 (DOMAIN_TABLES queda fija en las 15 de la
// migración 2 porque las migraciones 3–7 la usan con esquemas viejos). La usa linkAccount.ts.
export const SYNCED_DOMAIN_TABLES = [...DOMAIN_TABLES, 'backlog_tags'];

const KEPT_TABLES = [...DOMAIN_TABLES, 'users', 'outbox', 'sync_meta', 'sync_state', '_id_map', '_migration_log'];
const INDEXES = ['idx_backlog_tags_user', 'idx_backlog_tags_updated'];

const countOf = async (txn: Db, table: string) =>
    (await txn.getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`))!.n;
const hasTable = async (txn: Db, name: string) =>
    !!(await txn.getFirstAsync<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", [name]));
const hasColumn = async (txn: Db, table: string, column: string) =>
    (await txn.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`)).some((c) => c.name === column);
const hasIndex = async (txn: Db, name: string) =>
    !!(await txn.getFirstAsync<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?", [name]));
// UNIQUE (user_id, section, name_key): índice automático con origen 'u' y esas columnas en orden.
const hasNaturalKey = async (txn: Db) => {
    for (const ix of await txn.getAllAsync<{ name: string; unique: number; origin: string }>('PRAGMA index_list(backlog_tags)')) {
        if (!ix.unique || ix.origin !== 'u') continue;
        const cols = (await txn.getAllAsync<{ name: string }>(`PRAGMA index_info("${ix.name}")`)).map((c) => c.name);
        if (cols.join(',') === 'user_id,section,name_key') return true;
    }
    return false;
};

export async function migration8(txn: Db, log: string[]) {
    const fail = (msg: string): never => { throw new Error(msg); };
    const startedAt = nowIso();
    const before: Record<string, number> = {};
    for (const t of KEPT_TABLES) before[t] = await countOf(txn, t);
    if (await hasTable(txn, 'backlog_tags')) fail('La tabla backlog_tags ya existe.');
    if (await hasColumn(txn, 'backlog', 'tags')) fail('La columna backlog.tags ya existe.');
    log.push('chequeos previos OK');

    await txn.execAsync(`CREATE TABLE backlog_tags (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
        section TEXT NOT NULL, -- 'movie', 'series', 'anime', 'reading' (validado en el repositorio)
        name TEXT NOT NULL, -- normalizado, de 1 a 30 caracteres
        name_key TEXT NOT NULL, -- name en minúsculas (lo calcula la app)
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        deleted_at TEXT,
        UNIQUE(user_id, section, name_key)
    )`);
    await txn.execAsync('CREATE INDEX idx_backlog_tags_user ON backlog_tags(user_id, deleted_at)');
    await txn.execAsync('CREATE INDEX idx_backlog_tags_updated ON backlog_tags(updated_at)');
    await txn.execAsync('ALTER TABLE backlog ADD COLUMN tags TEXT');
    log.push('tabla backlog_tags (con UNIQUE e índices) y columna backlog.tags agregadas');
    maybeFail('DEV_FAIL_MIGRATION', 'migración 8, tras crear la tabla y la columna y antes de verificar');

    if (!(await hasTable(txn, 'backlog_tags'))) fail('Verificación: la tabla backlog_tags no quedó creada.');
    if (!(await hasNaturalKey(txn))) fail('Verificación: falta la UNIQUE (user_id, section, name_key) de backlog_tags.');
    for (const ix of INDEXES) if (!(await hasIndex(txn, ix))) fail(`Verificación: el índice ${ix} no quedó creado.`);
    if (!(await hasColumn(txn, 'backlog', 'tags'))) fail('Verificación: la columna backlog.tags no quedó creada.');
    if ((await countOf(txn, 'backlog_tags')) !== 0) fail('Verificación: backlog_tags debería estar vacía.');
    const after: Record<string, number> = {};
    for (const t of KEPT_TABLES) {
        after[t] = await countOf(txn, t);
        if (after[t] !== before[t]) fail(`Verificación: ${t} tenía ${before[t]} filas y ahora ${after[t]}.`);
    }
    after.backlog_tags = 0;
    log.push('verificaciones OK');

    await txn.runAsync(
        'INSERT INTO _migration_log (version, created_at, kind, payload) VALUES (?, ?, ?, ?)',
        [8, nowIso(), 'summary', JSON.stringify({ version: 8, startedAt, finishedAt: nowIso(), added: ['table backlog_tags', 'backlog.tags'], before, after })]
    );
    log.push('resumen guardado en _migration_log');
}
