import { nowIso } from '../clock';
import { maybeFail } from '../../services/devFlags';
import { DOMAIN_TABLES } from './migration3';

// Migración 7 (Fase 7.5): vínculo Pendiente ↔ Series/Lectura y subtipo de lectura.
//   - SOLO aditiva: ALTER TABLE series ADD COLUMN backlog_id TEXT (NULL), ALTER TABLE backlog ADD
//     COLUMN subtype TEXT (NULL) y el índice series_backlog_idx;
//   - con copia física previa (requiresBackup → registro_pre-migracion-v7_<sello>.db);
//   - no borra datos, no renombra ni recrea el .db, sin VACUUM; no rellena valores (las series de
//     antes quedan sin vínculo y la lectura de antes sin subtipo) y no encola nada;
//   - verifica que las columnas y el índice existen y que los conteos de todas las tablas no cambian.
// backlog_id NO lleva REFERENCES local (a diferencia de las FK de la migración 2): con la FK local
// diferida, una serie que llega en el pull antes que su título (otro dispositivo los subió entre el
// pull de backlog y el de series de este) haría fallar la confirmación de la página y cortaría el
// ciclo. La integridad la cuida el repositorio (src/data/repositories/series.ts y backlog.ts) y,
// en el servidor, la FK compuesta series_backlog_fkey.
// Par en Supabase: supabase/migrations/20261122000100_vinculo_pendiente.sql (se aplica ANTES de
// instalar el APK). Corre dentro de UNA withExclusiveTransactionAsync: si algo falla, queda en v6.

type Db = {
    execAsync(sql: string): Promise<void>;
    runAsync(sql: string, params?: any[]): Promise<{ changes: number; lastInsertRowId: number }>;
    getAllAsync<T = any>(sql: string, params?: any[]): Promise<T[]>;
    getFirstAsync<T = any>(sql: string, params?: any[]): Promise<T | null>;
};

const KEPT_TABLES = [...DOMAIN_TABLES, 'users', 'outbox', 'sync_meta', 'sync_state', '_id_map', '_migration_log'];
const ADDED = [['series', 'backlog_id'], ['backlog', 'subtype']];

const countOf = async (txn: Db, table: string) =>
    (await txn.getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`))!.n;
const hasColumn = async (txn: Db, table: string, column: string) =>
    (await txn.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`)).some((c) => c.name === column);
const hasIndex = async (txn: Db, name: string) =>
    !!(await txn.getFirstAsync<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?", [name]));

export async function migration7(txn: Db, log: string[]) {
    const fail = (msg: string): never => { throw new Error(msg); };
    const startedAt = nowIso();
    const before: Record<string, number> = {};
    for (const t of KEPT_TABLES) before[t] = await countOf(txn, t);
    for (const [t, c] of ADDED) if (await hasColumn(txn, t, c)) fail(`La columna ${t}.${c} ya existe.`);
    if (await hasIndex(txn, 'series_backlog_idx')) fail('El índice series_backlog_idx ya existe.');
    log.push('chequeos previos OK');

    await txn.execAsync('ALTER TABLE series ADD COLUMN backlog_id TEXT');
    await txn.execAsync('ALTER TABLE backlog ADD COLUMN subtype TEXT');
    await txn.execAsync('CREATE INDEX series_backlog_idx ON series(backlog_id)');
    log.push('columnas series.backlog_id y backlog.subtype e índice series_backlog_idx agregados');
    maybeFail('DEV_FAIL_MIGRATION', 'migración 7, tras agregar las columnas y antes de verificar');

    for (const [t, c] of ADDED) if (!(await hasColumn(txn, t, c))) fail(`Verificación: la columna ${t}.${c} no quedó creada.`);
    if (!(await hasIndex(txn, 'series_backlog_idx'))) fail('Verificación: el índice series_backlog_idx no quedó creado.');
    const after: Record<string, number> = {};
    for (const t of KEPT_TABLES) {
        after[t] = await countOf(txn, t);
        if (after[t] !== before[t]) fail(`Verificación: ${t} tenía ${before[t]} filas y ahora ${after[t]}.`);
    }
    log.push('verificaciones OK');

    await txn.runAsync(
        'INSERT INTO _migration_log (version, created_at, kind, payload) VALUES (?, ?, ?, ?)',
        [7, nowIso(), 'summary', JSON.stringify({ version: 7, startedAt, finishedAt: nowIso(), added: ['series.backlog_id', 'backlog.subtype', 'index series_backlog_idx'], before, after })]
    );
    log.push('resumen guardado en _migration_log');
}
