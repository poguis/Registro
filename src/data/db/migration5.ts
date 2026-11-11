import { nowIso } from '../clock';
import { maybeFail } from '../../services/devFlags';
import { DOMAIN_TABLES } from './migration3';

// Migración 5 (Fase 6.7): elimina las tablas legacy_* (copia de la app anterior, conservada como
// respaldo desde la migración 2). ÚNICA excepción autorizada por el dueño de los datos a "ninguna
// migración borra datos" (DECISIONES.md, 6.7):
//   - solo las 16 tablas de LEGACY_TABLES, por nombre explícito (nunca un patrón);
//   - con copia física previa (requiresBackup → registro_pre-migracion-v5_<sello>.db);
//   - sin renombrar ni recrear el archivo .db, sin VACUUM y sin tocar ninguna otra tabla.
// Orden: de hijos a padres (las FK entre legacy_* siguen activas dentro de la transacción).
// Ninguna tabla actual referencia a legacy_*. La contraseña antigua ya se había sobrescrito en la
// migración 3 (legacy_users.password vacío, PRAGMA secure_delete).
// Corre dentro de UNA withExclusiveTransactionAsync: si algo falla, la BD queda en v4 sin cambios.

type Db = {
    execAsync(sql: string): Promise<void>;
    runAsync(sql: string, params?: any[]): Promise<{ changes: number; lastInsertRowId: number }>;
    getAllAsync<T = any>(sql: string, params?: any[]): Promise<T[]>;
    getFirstAsync<T = any>(sql: string, params?: any[]): Promise<T | null>;
};

export const LEGACY_TABLES = [
    // hijos
    'legacy_finance_transactions',
    'legacy_entertainment_pauses',
    'legacy_entertainment_quotas_history',
    'legacy_seasons',
    'legacy_watch_history',
    'legacy_reading_history',
    'legacy_series',
    'legacy_entertainment_categories',
    'legacy_finance_contacts',
    'legacy_balance_history',
    'legacy_finance_categories',
    'legacy_services',
    'legacy_backlog',
    'legacy_work_people',
    'legacy_cards',
    // padre de todas
    'legacy_users',
] as const;

// Tablas que deben quedar intactas (mismos conteos antes y después).
const KEPT_TABLES = [...DOMAIN_TABLES, 'users', 'outbox', 'sync_meta', 'sync_state', '_id_map', '_migration_log'];

const countOf = async (txn: Db, table: string) =>
    (await txn.getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`))!.n;
const existing = async (txn: Db, table: string) =>
    !!(await txn.getFirstAsync("SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = ?", [table]));

export async function migration5(txn: Db, log: string[]) {
    const fail = (msg: string): never => { throw new Error(msg); };
    const startedAt = nowIso();
    const before: Record<string, number> = {};
    for (const t of KEPT_TABLES) before[t] = await countOf(txn, t);
    const legacyRows: Record<string, number | null> = {};
    for (const t of LEGACY_TABLES) legacyRows[t] = (await existing(txn, t)) ? await countOf(txn, t) : null;
    log.push('chequeos previos OK');

    for (const t of LEGACY_TABLES) await txn.execAsync(`DROP TABLE IF EXISTS ${t}`);
    log.push(`${LEGACY_TABLES.length} tablas legacy_* eliminadas (las que existían)`);
    maybeFail('DEV_FAIL_MIGRATION', 'migración 5, tras eliminar legacy_* y antes de verificar');

    const left = await txn.getAllAsync<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'legacy\\_%' ESCAPE '\\'");
    if (left.length) fail(`Verificación: siguen existiendo tablas legacy_*: ${left.map((r) => r.name).join(', ')}.`);
    const after: Record<string, number> = {};
    for (const t of KEPT_TABLES) {
        after[t] = await countOf(txn, t);
        if (after[t] !== before[t]) fail(`Verificación: ${t} tenía ${before[t]} filas y ahora ${after[t]}.`);
    }
    log.push('verificaciones OK');

    await txn.runAsync(
        'INSERT INTO _migration_log (version, created_at, kind, payload) VALUES (?, ?, ?, ?)',
        [5, nowIso(), 'summary', JSON.stringify({ version: 5, startedAt, finishedAt: nowIso(), dropped: legacyRows, before, after })]
    );
    log.push('resumen guardado en _migration_log');
}
