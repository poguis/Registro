// Transporte de pruebas para el motor de sync (src/sync/engine.ts) sobre PGlite con el
// esquema real de supabase/migrations/. Ejecuta el SQL equivalente al de PostgREST como
// `authenticated` con el claim sub del usuario (SET ROLE + request.jwt.claim.sub), así pasa
// por RLS, triggers (server_updated_at), CHECK y FK reales:
//   - upsert: INSERT … SELECT FROM json_populate_recordset(…) ON CONFLICT (id) DO UPDATE
//     (lo mismo que hace PostgREST con un upsert masivo por id);
//   - lectura: row_to_json (mismo JSON que PostgREST: timestamptz con µs y zona).
// Permite simular cortes de red (fallar a partir de la N-ésima llamada) y cuenta escrituras.
import { remoteError } from '../../src/sync/transport.ts';

const STATUS = { '23505': 409, '23503': 409, '42501': 403 };
const statusFor = (code) => STATUS[code] || 400;

export function createPgliteTransport(pg) {
    const t = {
        uid: null,
        offline: false,
        failUpsertAfter: null, // nº de upserts que funcionan antes de "cortar la red"
        failPullAfter: null,
        calls: { upsert: 0, pull: 0, find: 0 },
        rowsWritten: 0,
    };
    const networkDown = () => ({ kind: 'network', code: null, status: 0, message: 'Network request failed (simulado)' });

    async function asUser(fn) {
        await pg.query("select set_config('request.jwt.claim.sub', $1, false)", [t.uid || '']);
        await pg.exec('set role authenticated');
        try { return await fn(); } finally { await pg.exec('reset role'); }
    }
    const toError = (e) => remoteError(e.code || null, e.code ? statusFor(e.code) : 0, String(e.message || e));
    const parse = (rows) => rows.map((r) => JSON.parse(r.j));

    t.session = async () => (t.uid ? { uid: t.uid } : null);

    t.upsert = async (table, rows) => {
        t.calls.upsert++;
        if (t.offline || (t.failUpsertAfter !== null && t.calls.upsert > t.failUpsertAfter)) return { error: networkDown() };
        if (rows.length === 0) return { error: null };
        const cols = Object.keys(rows[0]);
        const sql = `insert into public.${table} (${cols.join(', ')})
            select ${cols.join(', ')} from json_populate_recordset(null::public.${table}, $1::json)
            on conflict (id) do update set ${cols.filter((c) => c !== 'id').map((c) => `${c} = excluded.${c}`).join(', ')}`;
        try {
            await asUser(() => pg.query(sql, [JSON.stringify(rows)]));
            t.rowsWritten += rows.length;
            return { error: null };
        } catch (e) {
            return { error: toError(e) };
        }
    };

    t.pullPage = async (table, { since, after, limit }) => {
        t.calls.pull++;
        if (t.offline || (t.failPullAfter !== null && t.calls.pull > t.failPullAfter)) return { rows: [], error: networkDown() };
        let where = 'true';
        const params = [];
        if (after) {
            params.push(after.ts, after.id);
            where = `(server_updated_at > $1::timestamptz or (server_updated_at = $1::timestamptz and id > $2::uuid))`;
        } else if (since) {
            params.push(since);
            where = 'server_updated_at >= $1::timestamptz';
        }
        params.push(limit);
        try {
            const r = await asUser(() => pg.query(
                `select row_to_json(x)::text as j from public.${table} x where ${where} order by server_updated_at, id limit $${params.length}`,
                params
            ));
            return { rows: parse(r.rows), error: null };
        } catch (e) {
            return { rows: [], error: toError(e) };
        }
    };

    t.findByNaturalKey = async (table, key) => {
        t.calls.find++;
        if (t.offline) return { row: null, error: networkDown() };
        const cols = Object.keys(key);
        try {
            const r = await asUser(() => pg.query(
                `select row_to_json(x)::text as j from public.${table} x where ${cols.map((c, i) => `${c} = $${i + 1}`).join(' and ')} limit 1`,
                cols.map((c) => key[c])
            ));
            return { row: r.rows.length ? JSON.parse(r.rows[0].j) : null, error: null };
        } catch (e) {
            return { row: null, error: toError(e) };
        }
    };
    return t;
}
