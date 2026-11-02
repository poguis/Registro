import { getConnection, enqueue, type Row } from '../data/db/connection';
import { nowIso } from '../data/clock';
import {
    TABLES, columnsOf, toRemote, fromRemote, sameAsLocal, MappingError, PARENT_FKS, NATURAL_KEYS,
} from './mapping';
import type { SyncConfig } from './config';
import type { Transport, RemoteError, RemoteRow } from './transport';

// Motor de sincronización (Fase 4). Puro respecto de la UI y del transporte: lo usan la app
// (SupabaseTransport) y las pruebas en PC (PgliteTransport). Reglas (docs/MAPEO-SYNC.md):
//   - Orden: primero push de la outbox, luego pull de las 15 tablas (padres antes que hijos).
//   - Push: estado ACTUAL de cada fila, upsert por id en lotes; se borran de la outbox SOLO las
//     entradas leídas y confirmadas (por su id), así una edición hecha durante el push no se
//     pierde. Nunca se descarta una entrada: transitorio → backoff; permanente → bloqueada.
//   - Pull: cursor (server_updated_at, id) por tabla con ventana de solapamiento; aplicación
//     idempotente sin outbox; una fila con cambios pendientes o bloqueados no se sobrescribe
//     (su push ganará: "último en llegar al servidor gana").
//   - Claves naturales (finance_categories, seasons): fusión adoptando el id del servidor.
// La red nunca corre dentro de una transacción local ni bloquea la cola de escrituras.

const db = () => getConnection();

// Transacción local serializada con las escrituras de la app.
async function localTx<T>(fn: () => Promise<T>): Promise<T> {
    return enqueue(async () => {
        let out: T | undefined;
        await db().withTransactionAsync(async () => { out = await fn(); });
        return out as T;
    });
}

const placeholders = (n: number) => new Array(n).fill('?').join(', ');

// Cancelación cooperativa (watchdog): el motor la consulta entre pasos y se detiene antes de
// escribir nada más. Cada escritura local es su propia transacción, así que nada queda a medias.
export type CancelToken = { aborted: boolean };
const NEVER: CancelToken = { aborted: false };
const backoffMs = (attempts: number) => Math.min(30_000 * 2 ** attempts, 3_600_000);

// ---------------------------------------------------------------- outbox
type Entry = { id: number; table_name: string; row_id: string; attempts: number };
type Group = { table: string; rowId: string; ids: number[]; attempts: number };

async function readyEntries(): Promise<Entry[]> {
    return db().getAllAsync<Entry>(
        `SELECT id, table_name, row_id, attempts FROM outbox
         WHERE blocked_at IS NULL AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
         ORDER BY id`, [nowIso()]
    );
}

const confirm = (ids: number[]) => localTx(async () => {
    if (ids.length) await db().runAsync(`DELETE FROM outbox WHERE id IN (${placeholders(ids.length)})`, ids);
});

const markTransient = (g: Group, err: string, immediate = false) => localTx(async () => {
    const next = immediate ? null : new Date(Date.now() + backoffMs(g.attempts)).toISOString();
    await db().runAsync(
        `UPDATE outbox SET attempts = attempts + 1, last_error = ?, next_attempt_at = ? WHERE id IN (${placeholders(g.ids.length)})`,
        [err, next, ...g.ids]
    );
});

const markBlocked = (g: Group, reason: string) => localTx(async () => {
    await db().runAsync(
        `UPDATE outbox SET blocked_at = ?, block_reason = ?, last_error = ? WHERE id IN (${placeholders(g.ids.length)})`,
        [nowIso(), reason, reason, ...g.ids]
    );
});

const describe = (e: RemoteError) => `${e.code || e.status || 'error'}: ${e.message}`.slice(0, 300);

// ¿La fila tiene cambios locales sin confirmar (pendientes o bloqueados)?
const hasOutbox = async (table: string, id: string) =>
    !!(await db().getFirstAsync<Row>('SELECT 1 AS x FROM outbox WHERE table_name = ? AND row_id = ? LIMIT 1', [table, id]));

// Encola el upsert de una fila (sin duplicar si ya hay una entrada pendiente). Fuera de `tx`:
// la usa el motor (padres por 23503) y la primera subida.
async function enqueueRaw(table: string, id: string): Promise<'enqueued' | 'pending' | 'blocked'> {
    const e = await db().getFirstAsync<Row>(
        'SELECT blocked_at FROM outbox WHERE table_name = ? AND row_id = ? ORDER BY blocked_at IS NULL DESC LIMIT 1', [table, id]
    );
    if (e) return e.blocked_at ? 'blocked' : 'pending';
    await db().runAsync('INSERT INTO outbox (table_name, row_id, op, created_at, attempts) VALUES (?, ?, ?, ?, 0)', [table, id, 'upsert', nowIso()]);
    return 'enqueued';
}

// ---------------------------------------------------------------- push
export type PushResult = {
    pushed: number; blocked: number; transient: number; merged: number; parentsEnqueued: number;
    stop: 'network' | 'auth' | 'cancelled' | null; lastError: string | null;
};

export async function pushOutbox(cfg: SyncConfig, transport: Transport, uid: string, cancel: CancelToken = NEVER): Promise<PushResult> {
    const res: PushResult = { pushed: 0, blocked: 0, transient: 0, merged: 0, parentsEnqueued: 0, stop: null, lastError: null };
    const cancelled = () => { if (cancel.aborted) res.stop = 'cancelled'; return cancel.aborted; };
    for (let round = 0; round < cfg.maxPushRounds; round++) {
        if (cancelled()) return res;
        const entries = await readyEntries();
        if (entries.length === 0) break;
        const groups = new Map<string, Group>();
        for (const e of entries) {
            const k = `${e.table_name}\u0000${e.row_id}`;
            const g = groups.get(k) || { table: e.table_name, rowId: e.row_id, ids: [], attempts: 0 };
            g.ids.push(e.id);
            g.attempts = Math.max(g.attempts, e.attempts || 0);
            groups.set(k, g);
        }
        let retryNextRound = false;
        const all = [...groups.values()];
        for (const g of all.filter((x) => !TABLES.includes(x.table))) {
            await markBlocked(g, `tabla desconocida: ${g.table}`); res.blocked++;
        }
        for (const table of TABLES) {
            const tg = all.filter((g) => g.table === table);
            if (tg.length === 0) continue;
            // Estado ACTUAL de cada fila
            const rows = new Map<string, Row>();
            for (let i = 0; i < tg.length; i += 500) {
                const ids = tg.slice(i, i + 500).map((g) => g.rowId);
                for (const r of await db().getAllAsync<Row>(`SELECT * FROM ${table} WHERE id IN (${placeholders(ids.length)})`, ids)) rows.set(r.id, r);
            }
            const ready: { g: Group; remote: RemoteRow; local: Row }[] = [];
            for (const g of tg) {
                const local = rows.get(g.rowId);
                if (!local) { await markBlocked(g, 'la fila no existe localmente'); res.blocked++; continue; }
                if (local.user_id !== uid) { await markBlocked(g, 'la fila pertenece a otra cuenta'); res.blocked++; continue; }
                try {
                    ready.push({ g, remote: toRemote(table, local), local });
                } catch (e: any) {
                    await markBlocked(g, `mapeo: ${e instanceof MappingError ? e.message : String(e?.message || e)}`); res.blocked++;
                }
            }
            for (let i = 0; i < ready.length; i += cfg.batchSize) {
                if (cancelled()) return res;
                const batch = ready.slice(i, i + cfg.batchSize);
                const { error } = await transport.upsert(table, batch.map((b) => b.remote));
                // Cancelado mientras esperaba: no se confirma nada (el siguiente ciclo repite el
                // upsert, que es idempotente).
                if (cancelled()) return res;
                if (!error) {
                    await confirm(batch.flatMap((b) => b.g.ids)); res.pushed += batch.length;
                    continue;
                }
                if (error.kind === 'network' || error.kind === 'auth') {
                    for (const b of ready.slice(i)) { await markTransient(b.g, describe(error)); res.transient++; }
                    res.stop = error.kind; res.lastError = describe(error);
                    return res;
                }
                // Error de datos en el lote: fila por fila para aislar la culpable.
                for (const b of batch) {
                    if (cancelled()) return res;
                    const one = await transport.upsert(table, [b.remote]);
                    if (cancelled()) return res;
                    if (!one.error) { await confirm(b.g.ids); res.pushed++; continue; }
                    const err = one.error;
                    res.lastError = describe(err);
                    if (err.kind === 'network' || err.kind === 'auth') {
                        await markTransient(b.g, describe(err)); res.transient++;
                        res.stop = err.kind;
                        return res;
                    }
                    if (err.kind === 'conflict' && NATURAL_KEYS[table]) {
                        const m = await mergeOnPush(transport, table, b.local);
                        if (m.ok) { res.merged++; retryNextRound = true; continue; }
                        if (m.network) { await markTransient(b.g, m.reason); res.transient++; res.stop = 'network'; return res; }
                        await markBlocked(b.g, m.reason); res.blocked++;
                        continue;
                    }
                    if (err.kind === 'fk') {
                        const p = await enqueueMissingParents(table, b.local, err);
                        if (p === 'enqueued' || p === 'pending') {
                            if (p === 'enqueued') res.parentsEnqueued++;
                            await markTransient(b.g, 'padre pendiente de subir', true); res.transient++;
                            retryNextRound = true;
                        } else if (p === 'parent-blocked') {
                            await markTransient(b.g, 'el padre tiene un error bloqueado'); res.transient++;
                        } else {
                            await markBlocked(b.g, `padre inexistente: ${describe(err)}`); res.blocked++;
                        }
                        continue;
                    }
                    await markBlocked(b.g, describe(err)); res.blocked++;
                }
            }
        }
        if (!retryNextRound) break;
    }
    return res;
}

// 23503: identifica el padre por la FK compuesta. Si existe localmente, encola su upsert (sin
// duplicar) y el hijo se reintenta después; si no existe, el hijo se bloquea.
async function enqueueMissingParents(table: string, local: Row, err: RemoteError):
    Promise<'enqueued' | 'pending' | 'parent-blocked' | 'missing'> {
    const fks = PARENT_FKS[table] || [];
    // El mensaje nombra la restricción: <tabla>_<col sin _id>_fkey (o user_id → auth.users).
    const named = fks.filter((fk) => err.message.includes(`${table}_${fk.column.replace(/_id$/, '')}_fkey`));
    const candidates = named.length ? named : fks;
    if (candidates.length === 0) return 'missing';
    let outcome: 'enqueued' | 'pending' | 'parent-blocked' | 'missing' = 'pending';
    await localTx(async () => {
        for (const fk of candidates) {
            const parentId = local[fk.column];
            const parent = parentId ? await db().getFirstAsync<Row>(`SELECT id FROM ${fk.parent} WHERE id = ?`, [parentId]) : null;
            if (!parent) { outcome = 'missing'; return; }
            const r = await enqueueRaw(fk.parent, parentId);
            if (r === 'blocked') outcome = 'parent-blocked';
            else if (r === 'enqueued' && outcome === 'pending') outcome = 'enqueued';
        }
    });
    return outcome;
}

// 23505 en el push: la fila del servidor con la misma clave natural se queda con su id; la
// local adopta ese id (y sus entradas de outbox) y se reintenta con el contenido local, que
// llega último y gana.
async function mergeOnPush(transport: Transport, table: string, local: Row):
    Promise<{ ok: boolean; network?: boolean; reason: string }> {
    const key = Object.fromEntries(NATURAL_KEYS[table].map((c) => [c, local[c]]));
    const found = await transport.findByNaturalKey(table, key);
    if (found.error) return { ok: false, network: found.error.kind === 'network' || found.error.kind === 'auth', reason: describe(found.error) };
    const server = found.row;
    if (!server || server.id === local.id) return { ok: false, reason: 'clave única duplicada sin fila que fusionar' };
    let ok = false;
    await localTx(async () => {
        const clash = await db().getFirstAsync<Row>(`SELECT id FROM ${table} WHERE id = ?`, [server.id]);
        if (clash) return; // ya existe localmente otra fila con ese id: fusión imposible
        await renameLocalId(table, local.id, server.id);
        ok = true;
    });
    return ok ? { ok: true, reason: '' } : { ok: false, reason: 'fusión imposible: el id del servidor ya existe localmente' };
}

async function renameLocalId(table: string, fromId: string, toId: string) {
    await db().runAsync(`UPDATE ${table} SET id = ? WHERE id = ?`, [toId, fromId]);
    await db().runAsync('UPDATE outbox SET row_id = ? WHERE table_name = ? AND row_id = ?', [toId, table, fromId]);
}

// ---------------------------------------------------------------- pull
// Timestamp de PostgREST (µs y zona) → microsegundos, para comparar cursores sin perder µs.
export function tsMicros(ts: string): bigint {
    const m = /^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}(?::?\d{2})?)$/.exec(ts);
    if (!m) return BigInt(Date.parse(ts)) * 1000n;
    const zone = m[3] === 'Z' ? 'Z' : (m[3].length === 3 ? `${m[3]}:00` : m[3]);
    const base = BigInt(Date.parse(`${m[1].replace(' ', 'T')}${zone}`)) * 1000n;
    return base + BigInt((m[2] || '').padEnd(6, '0').slice(0, 6));
}
const after = (a: { ts: string; id: string }, b: { ts: string; id: string }) => {
    const x = tsMicros(a.ts), y = tsMicros(b.ts);
    return x > y || (x === y && a.id > b.id);
};

export type PullResult = { received: number; applied: number; skippedPending: number; skippedSame: number; merged: number; conflicts: number; error: RemoteError | null; cancelled: boolean };

export async function pullTable(cfg: SyncConfig, transport: Transport, table: string, uid: string, cancel: CancelToken = NEVER): Promise<PullResult> {
    const res: PullResult = { received: 0, applied: 0, skippedPending: 0, skippedSame: 0, merged: 0, conflicts: 0, error: null, cancelled: false };
    const state = await db().getFirstAsync<Row>('SELECT user_id, cursor_ts, cursor_id FROM sync_state WHERE table_name = ?', [table]);
    let cursor = state && state.user_id === uid && state.cursor_ts ? { ts: state.cursor_ts as string, id: state.cursor_id as string } : null;
    const since = cursor ? new Date(Number(tsMicros(cursor.ts) / 1000n) - cfg.overlapMs).toISOString() : null;
    let pageAfter: { ts: string; id: string } | null = null;
    for (;;) {
        if (cancel.aborted) { res.cancelled = true; return res; }
        const page = await transport.pullPage(table, { since, after: pageAfter, limit: cfg.pageSize });
        // Cancelado mientras esperaba la página: no se aplica (ni se mueve el cursor).
        if (cancel.aborted) { res.cancelled = true; return res; }
        if (page.error) { res.error = page.error; return res; }
        if (page.rows.length === 0) break;
        res.received += page.rows.length;
        const last = page.rows[page.rows.length - 1];
        pageAfter = { ts: last.server_updated_at, id: last.id };
        const newCursor = !cursor || after(pageAfter, cursor) ? pageAfter : cursor;
        await localTx(async () => {
            await applyRemoteRows(table, page.rows, uid, res);
            await db().runAsync(
                `INSERT INTO sync_state (table_name, user_id, cursor_ts, cursor_id, updated_at) VALUES (?, ?, ?, ?, ?)
                 ON CONFLICT(table_name) DO UPDATE SET user_id = excluded.user_id, cursor_ts = excluded.cursor_ts,
                 cursor_id = excluded.cursor_id, updated_at = excluded.updated_at`,
                [table, uid, newCursor.ts, newCursor.id, nowIso()]
            );
        });
        cursor = newCursor;
        if (page.rows.length < cfg.pageSize) break;
    }
    return res;
}

// Aplica filas remotas en la transacción en curso. Nunca escribe en la outbox.
export async function applyRemoteRows(table: string, rows: RemoteRow[], uid: string, res: PullResult): Promise<void> {
    const cols = Object.keys(columnsOf(table));
    const nk = NATURAL_KEYS[table];
    for (const remote of rows) {
        if (remote.user_id !== uid) continue; // RLS ya lo garantiza
        const incoming = fromRemote(table, remote);
        // Clave natural: otra fila local con la misma clave y otro id → adopta el id del servidor.
        if (nk) {
            const where = nk.map((c) => `${c} = ?`).join(' AND ');
            const twin = await db().getFirstAsync<Row>(`SELECT id FROM ${table} WHERE ${where} AND id <> ?`, [...nk.map((c) => incoming[c]), incoming.id]);
            if (twin) {
                const clash = await db().getFirstAsync<Row>(`SELECT id FROM ${table} WHERE id = ?`, [incoming.id]);
                if (clash) { res.conflicts++; continue; } // dos filas locales: se deja como está
                await renameLocalId(table, twin.id, incoming.id);
                res.merged++;
            }
        }
        if (await hasOutbox(table, incoming.id)) { res.skippedPending++; continue; }
        const existing = await db().getFirstAsync<Row>(`SELECT * FROM ${table} WHERE id = ?`, [incoming.id]);
        if (existing && sameAsLocal(table, existing, incoming)) { res.skippedSame++; continue; }
        await db().runAsync(
            `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders(cols.length)})
             ON CONFLICT(id) DO UPDATE SET ${cols.filter((c) => c !== 'id').map((c) => `${c} = excluded.${c}`).join(', ')}`,
            cols.map((c) => incoming[c])
        );
        res.applied++;
    }
}

// ---------------------------------------------------------------- ciclo completo
export type SyncOutcome =
    | { status: 'disabled' }
    | { status: 'skipped'; reason: 'not-linked' | 'no-session' | 'other-account' | 'session-expired' }
    | { status: 'offline'; push: PushResult; pulled: number }
    | { status: 'timeout' }
    | { status: 'ok'; push: PushResult; pulled: number; applied: number; skippedPending: number; merged: number; remoteWrites: number; localWrites: number };

async function setMeta(values: Record<string, string | null>) {
    await localTx(async () => {
        for (const [k, v] of Object.entries(values)) {
            await db().runAsync('INSERT INTO sync_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [k, v]);
        }
    });
}

export async function syncOnce(cfg: SyncConfig, transport: Transport, cancel: CancelToken = NEVER): Promise<SyncOutcome> {
    if (!cfg.enabled) return { status: 'disabled' };
    const users = await db().getAllAsync<Row>('SELECT id, linked_at FROM users');
    if (users.length !== 1 || !users[0].linked_at) return { status: 'skipped', reason: 'not-linked' };
    let session: { uid: string } | null = null;
    try { session = await transport.session(); } catch { session = null; }
    if (!session) return { status: 'skipped', reason: 'no-session' };
    if (session.uid !== users[0].id) return { status: 'skipped', reason: 'other-account' };
    const uid = session.uid;
    await setMeta({ last_attempt_at: nowIso() });

    const push = await pushOutbox(cfg, transport, uid, cancel);
    if (push.stop === 'cancelled') return { status: 'timeout' };
    if (push.stop === 'auth') {
        await setMeta({ last_error: push.lastError });
        return { status: 'skipped', reason: 'session-expired' };
    }
    if (push.stop === 'network') {
        await setMeta({ last_error: push.lastError });
        return { status: 'offline', push, pulled: 0 };
    }
    let pulled = 0, applied = 0, skippedPending = 0, merged = 0;
    for (const table of TABLES) {
        const r = await pullTable(cfg, transport, table, uid, cancel);
        if (r.cancelled) return { status: 'timeout' };
        pulled += r.received; applied += r.applied; skippedPending += r.skippedPending; merged += r.merged;
        if (r.error) {
            await setMeta({ last_error: describe(r.error) });
            if (r.error.kind === 'auth') return { status: 'skipped', reason: 'session-expired' };
            return { status: 'offline', push, pulled };
        }
    }
    await setMeta({ last_success_at: nowIso(), last_error: push.lastError && push.blocked ? push.lastError : null });
    return {
        status: 'ok', push, pulled, applied, skippedPending, merged: merged + push.merged,
        remoteWrites: push.pushed, localWrites: applied,
    };
}

// ---------------------------------------------------------------- watchdog
// Un ciclo que supera `timeoutMs` (p. ej. una petición que nunca responde) se da por fallido:
// devuelve 'timeout', deja last_error en sync_meta y marca la cancelación para que el ciclo
// colgado, si alguna vez despierta, se detenga sin escribir nada más. El llamador puede liberar
// el single-flight de inmediato. La outbox no se toca: el siguiente ciclo la vuelve a subir.
export const SYNC_CYCLE_TIMEOUT_MS = 120_000;

export async function syncWithWatchdog(cfg: SyncConfig, transport: Transport, timeoutMs: number = SYNC_CYCLE_TIMEOUT_MS): Promise<SyncOutcome> {
    const cancel: CancelToken = { aborted: false };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<SyncOutcome>((resolve) => {
        timer = setTimeout(() => { cancel.aborted = true; resolve({ status: 'timeout' }); }, timeoutMs);
    });
    try {
        const out = await Promise.race([syncOnce(cfg, transport, cancel), expired]);
        if (out.status === 'timeout') {
            cancel.aborted = true;
            await setMeta({ last_attempt_at: nowIso(), last_error: `La sincronización superó ${Math.round(timeoutMs / 1000)} s y se canceló; se reintentará.` });
        }
        return out;
    } finally {
        if (timer) clearTimeout(timer);
    }
}

// ---------------------------------------------------------------- primera subida (Fase 5)
// Encola TODAS las filas (vivas y tombstones) de las 15 tablas en orden de dependencias, en
// una transacción, sin duplicar entradas pendientes. No se ejecuta sola: la Fase 5 decidirá
// cuándo llamarla. Rechaza la ejecución si la sync está apagada (producción).
export async function enqueueAllForInitialUpload(cfg: SyncConfig): Promise<number> {
    if (!cfg.enabled) throw new Error('La sincronización está desactivada en esta variante.');
    let n = 0;
    await localTx(async () => {
        for (const table of TABLES) {
            const r = await db().runAsync(
                `INSERT INTO outbox (table_name, row_id, op, created_at, attempts)
                 SELECT ?, t.id, 'upsert', ?, 0 FROM ${table} t
                 WHERE NOT EXISTS (SELECT 1 FROM outbox o WHERE o.table_name = ? AND o.row_id = t.id)
                 ORDER BY t.created_at, t.id`,
                [table, nowIso(), table]
            );
            n += r.changes;
        }
    });
    return n;
}

// ---------------------------------------------------------------- estado para la UI
export type SyncStatus = {
    pending: number;
    blocked: { table: string; rowId: string; reason: string }[];
    lastSuccessAt: string | null;
    lastError: string | null;
};

export async function getSyncStatus(): Promise<SyncStatus> {
    const pending = (await db().getFirstAsync<Row>('SELECT COUNT(DISTINCT table_name || row_id) AS n FROM outbox WHERE blocked_at IS NULL'))!.n;
    const blocked = await db().getAllAsync<Row>(
        'SELECT table_name, row_id, MAX(block_reason) AS reason FROM outbox WHERE blocked_at IS NOT NULL GROUP BY table_name, row_id ORDER BY MIN(id)'
    );
    const meta = Object.fromEntries((await db().getAllAsync<Row>('SELECT key, value FROM sync_meta')).map((r) => [r.key, r.value]));
    return {
        pending,
        blocked: blocked.map((b) => ({ table: b.table_name, rowId: b.row_id, reason: b.reason })),
        lastSuccessAt: meta.last_success_at || null,
        lastError: meta.last_error || null,
    };
}

// "Reintentar": desbloquea las entradas; el siguiente ciclo vuelve a subirlas.
export async function unblockAll(): Promise<number> {
    let n = 0;
    await localTx(async () => {
        n = (await db().runAsync(
            'UPDATE outbox SET blocked_at = NULL, block_reason = NULL, attempts = 0, next_attempt_at = NULL WHERE blocked_at IS NOT NULL'
        )).changes;
    });
    return n;
}
