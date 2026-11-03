// Arnés de la Fase 5 (probar-fase5, dryrun-fase5): servidor Postgres LOCAL (PGlite con las
// migraciones reales de supabase/migrations/ + el stub de auth) y "dispositivos" node:sqlite con
// el código real de src/ (fachada, migraciones, motor). Nunca toca un proyecto remoto ni imprime
// filas. Requiere haber importado antes './test-hooks.mjs'.
import { PGlite } from '@electric-sql/pglite';
import { mkdirSync, copyFileSync, readFileSync, readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const { __setDatabasePath } = await import('./expo-sqlite-shim.mjs');
const { DatabaseService } = await import('../../src/services/db.js');
const { setConnection, getConnection } = await import('../../src/data/db/connection.ts');
const engine = await import('../../src/sync/engine.ts');
const { TABLES } = await import('../../src/sync/mapping.ts');
const { createPgliteTransport } = await import('./pglite-transport.mjs');

export { engine, TABLES, getConnection };

// Silencia console.log/error mientras corre fn (el código real registra mensajes).
export const quiet = async (fn) => {
    const { log, error } = console;
    console.log = () => {};
    console.error = () => {};
    try { return await fn(); } finally { console.log = log; console.error = error; }
};

export async function createServer() {
    const pg = new PGlite();
    await pg.exec(readFileSync('scripts/lib/pg-auth-stub.sql', 'utf8'));
    for (const f of readdirSync('supabase/migrations').filter((x) => x.endsWith('.sql')).sort()) {
        await pg.exec(readFileSync(`supabase/migrations/${f}`, 'utf8'));
    }
    const T = createPgliteTransport(pg);
    const newAuthUser = async (id = randomUUID()) => { await pg.query('insert into auth.users (id) values ($1)', [id]); return id; };
    // Conteos del servidor por tabla para un usuario: total, vivos, borrados.
    const counts = async (uid) => {
        const out = {};
        for (const t of TABLES) {
            const r = await pg.query(`select count(*)::int total, count(*) filter (where deleted_at is null)::int live from public.${t} where user_id = $1`, [uid]);
            out[t] = { total: r.rows[0].total, live: r.rows[0].live, deleted: r.rows[0].total - r.rows[0].live };
        }
        return out;
    };
    return { pg, T, newAuthUser, counts };
}

export function createDevices(workDir) {
    const devices = {};
    async function newDevice(name, source = null) {
        const dir = `${workDir}/${name}`;
        mkdirSync(dir, { recursive: true });
        const path = `${dir}/app_registro_v3.db`;
        if (source) copyFileSync(source, path);
        return openDevice(name, path);
    }
    // Abre (o reabre: "reinicio de la app") la BD de un dispositivo con init() real.
    async function openDevice(name, path) {
        __setDatabasePath(path);
        const svc = new DatabaseService();
        const ok = await quiet(() => svc.init());
        if (!ok) throw new Error(`no abrió ${name}: ${svc.lastInitError && svc.lastInitError.message}`);
        const dev = { name, path, svc };
        devices[name] = dev;
        return dev;
    }
    const use = (dev) => setConnection(dev.svc.db);
    const run = async (dev, fn) => { use(dev); return quiet(() => fn(dev.svc)); };
    const sql = async (dev, q, p = []) => { use(dev); return getConnection().runAsync(q, p); };
    const one = async (dev, q, p = []) => { use(dev); return getConnection().getFirstAsync(q, p); };
    const all = async (dev, q, p = []) => { use(dev); return getConnection().getAllAsync(q, p); };
    const restart = async (dev) => { await dev.svc.db.closeAsync(); return openDevice(dev.name, dev.path); };
    // Conteos locales por tabla.
    const counts = async (dev) => {
        const out = {};
        for (const t of TABLES) {
            const r = await one(dev, `SELECT COUNT(*) total, SUM(deleted_at IS NULL) live FROM ${t}`);
            out[t] = { total: r.total, live: r.live || 0, deleted: r.total - (r.live || 0) };
        }
        return out;
    };
    const outbox = async (dev) => one(dev,
        `SELECT COUNT(*) raw, COUNT(DISTINCT table_name || '|' || row_id) rows, SUM(blocked_at IS NOT NULL) blocked FROM outbox`);
    const meta = async (dev) => Object.fromEntries((await all(dev, 'SELECT key, value FROM sync_meta')).map((r) => [r.key, r.value]));
    return { devices, newDevice, openDevice, use, run, sql, one, all, restart, counts, outbox, meta };
}

export const sumCounts = (c) => Object.values(c).reduce((n, x) => n + x.total, 0);
