import { nowIso } from '../clock';
import { maybeFail } from '../../services/devFlags';
import { DOMAIN_TABLES } from './migration3';

// Migración 4 (Fase 4): estado de sincronización. Solo agrega estructura; NO modifica datos.
//   - outbox: blocked_at / block_reason (errores permanentes: visibles en la UI, sin reintentos
//     en bucle, nunca se borran) + índice por (table_name, row_id).
//   - sync_state: cursor del pull por tabla (server_updated_at tal cual lo devuelve el servidor, id).
//   - sync_meta: última sincronización, último error y conteos del último ciclo.
// Corre dentro de UNA withExclusiveTransactionAsync después de la copia física previa.

type Db = {
    execAsync(sql: string): Promise<void>;
    runAsync(sql: string, params?: any[]): Promise<{ changes: number; lastInsertRowId: number }>;
    getAllAsync<T = any>(sql: string, params?: any[]): Promise<T[]>;
    getFirstAsync<T = any>(sql: string, params?: any[]): Promise<T | null>;
};

const countOf = async (txn: Db, table: string) =>
    (await txn.getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`))!.n;

export async function migration4(txn: Db, log: string[]) {
    const fail = (msg: string): never => { throw new Error(msg); };
    const startedAt = nowIso();
    const before: Record<string, number> = {};
    for (const t of [...DOMAIN_TABLES, 'outbox', 'users']) before[t] = await countOf(txn, t);
    log.push('chequeos previos OK');

    await txn.execAsync('ALTER TABLE outbox ADD COLUMN blocked_at TEXT'); // NULL = no bloqueada
    await txn.execAsync('ALTER TABLE outbox ADD COLUMN block_reason TEXT');
    await txn.execAsync('CREATE INDEX idx_outbox_row ON outbox(table_name, row_id)');
    await txn.execAsync(`CREATE TABLE sync_state (
        table_name TEXT PRIMARY KEY,
        user_id TEXT NOT NULL, -- si cambia la cuenta, el cursor se reinicia
        cursor_ts TEXT, -- server_updated_at crudo del servidor (µs y zona), sin pasar por Date
        cursor_id TEXT,
        updated_at TEXT NOT NULL
    )`);
    await txn.execAsync(`CREATE TABLE sync_meta (
        key TEXT PRIMARY KEY,
        value TEXT
    )`);
    log.push('outbox, sync_state y sync_meta listas');

    const outboxCols = (await txn.getAllAsync<{ name: string }>('PRAGMA table_info(outbox)')).map((c) => c.name);
    if (!outboxCols.includes('blocked_at') || !outboxCols.includes('block_reason')) fail('Verificación: faltan columnas en outbox.');
    const after: Record<string, number> = {};
    for (const t of Object.keys(before)) {
        after[t] = await countOf(txn, t);
        if (after[t] !== before[t]) fail(`Verificación: ${t} tenía ${before[t]} filas y ahora ${after[t]}.`);
    }
    log.push('verificaciones OK');

    await txn.runAsync(
        'INSERT INTO _migration_log (version, created_at, kind, payload) VALUES (?, ?, ?, ?)',
        [4, nowIso(), 'summary', JSON.stringify({ version: 4, startedAt, finishedAt: nowIso(), before, after })]
    );
    maybeFail('DEV_FAIL_MIGRATION', 'migración 4, antes de fijar user_version');
    log.push('resumen guardado en _migration_log');
}
