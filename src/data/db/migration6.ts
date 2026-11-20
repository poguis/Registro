import { nowIso } from '../clock';
import { maybeFail } from '../../services/devFlags';
import { DOMAIN_TABLES } from './migration3';

// Migración 6 (Fase 7.4b): frecuencia de lectura en el historial de ritmo.
//   - SOLO aditiva: ALTER TABLE entertainment_quotas_history ADD COLUMN frequency INTEGER (NULL);
//   - con copia física previa (requiresBackup → registro_pre-migracion-v6_<sello>.db);
//   - no borra datos, no renombra ni recrea el .db, sin VACUUM; no rellena valores (los períodos
//     de antes quedan con NULL = la frecuencia de la categoría; el repositorio congela el valor
//     al cerrar el período, con su entrada en la outbox) y no encola nada;
//   - verifica que la columna existe y que los conteos de todas las tablas no cambian.
// Par en Supabase: supabase/migrations/20261121000100_frecuencia_cuotas.sql (se aplica ANTES de
// instalar el APK). Corre dentro de UNA withExclusiveTransactionAsync: si algo falla, queda en v5.

type Db = {
    execAsync(sql: string): Promise<void>;
    runAsync(sql: string, params?: any[]): Promise<{ changes: number; lastInsertRowId: number }>;
    getAllAsync<T = any>(sql: string, params?: any[]): Promise<T[]>;
    getFirstAsync<T = any>(sql: string, params?: any[]): Promise<T | null>;
};

const KEPT_TABLES = [...DOMAIN_TABLES, 'users', 'outbox', 'sync_meta', 'sync_state', '_id_map', '_migration_log'];

const countOf = async (txn: Db, table: string) =>
    (await txn.getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`))!.n;
const hasColumn = async (txn: Db, table: string, column: string) =>
    (await txn.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`)).some((c) => c.name === column);

export async function migration6(txn: Db, log: string[]) {
    const fail = (msg: string): never => { throw new Error(msg); };
    const startedAt = nowIso();
    const before: Record<string, number> = {};
    for (const t of KEPT_TABLES) before[t] = await countOf(txn, t);
    if (await hasColumn(txn, 'entertainment_quotas_history', 'frequency')) fail('La columna entertainment_quotas_history.frequency ya existe.');
    log.push('chequeos previos OK');

    await txn.execAsync('ALTER TABLE entertainment_quotas_history ADD COLUMN frequency INTEGER');
    log.push('columna entertainment_quotas_history.frequency agregada');
    maybeFail('DEV_FAIL_MIGRATION', 'migración 6, tras agregar la columna y antes de verificar');

    if (!(await hasColumn(txn, 'entertainment_quotas_history', 'frequency'))) fail('Verificación: la columna frequency no quedó creada.');
    const after: Record<string, number> = {};
    for (const t of KEPT_TABLES) {
        after[t] = await countOf(txn, t);
        if (after[t] !== before[t]) fail(`Verificación: ${t} tenía ${before[t]} filas y ahora ${after[t]}.`);
    }
    log.push('verificaciones OK');

    await txn.runAsync(
        'INSERT INTO _migration_log (version, created_at, kind, payload) VALUES (?, ?, ?, ?)',
        [6, nowIso(), 'summary', JSON.stringify({ version: 6, startedAt, finishedAt: nowIso(), added: ['entertainment_quotas_history.frequency'], before, after })]
    );
    log.push('resumen guardado en _migration_log');
}
