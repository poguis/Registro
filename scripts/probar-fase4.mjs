// Pruebas en PC de la Fase 4 (sincronización) con el código REAL de src/ (fachada,
// repositorios, motor de sync) en "dispositivos" node:sqlite, contra un Postgres LOCAL (PGlite)
// con el esquema real de supabase/migrations/, RLS, triggers y CHECK (scripts/lib/pglite-transport.mjs).
// Nunca toca un proyecto remoto. No imprime filas: solo conteos.
//
// Uso: node scripts/probar-fase4.mjs
import './lib/test-hooks.mjs';
import { PGlite } from '@electric-sql/pglite';
import { mkdirSync, rmSync, copyFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';

const require = createRequire(import.meta.url);
const { __setDatabasePath } = await import('./lib/expo-sqlite-shim.mjs');
const { DatabaseService } = await import('../src/services/db.js');
const { setConnection, getConnection } = await import('../src/data/db/connection.ts');
const engine = await import('../src/sync/engine.ts');
const { TABLES, toRemote, fromRemote, changesWhenRounded, MONEY_COLUMNS } = await import('../src/sync/mapping.ts');
const { DEFAULT_SYNC_CONFIG } = await import('../src/sync/config.ts');
const { createPgliteTransport } = await import('./lib/pglite-transport.mjs');

const WORK = resolve('.local-data/pruebas-fase4').replace(/\\/g, '/');
rmSync(WORK, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });

let failures = 0;
// Tope por escenario: un cuelgue falla con el nombre del escenario en vez de quedarse colgado.
//   - Cuelgue ocioso (una promesa que nunca resuelve): el timer se dispara.
//   - Escenario ocupado que se pasa del tope (solo microtareas: node:sqlite es síncrono y el
//     event loop no llega a los timers): lo detecta cada check().
// El aviso va por process.stdout.write: quiet() silencia console.log mientras corre una operación.
// PROBAR_LIMITE_S permite bajarlo para comprobar que el tope funciona. Se imprime cuánto tardó cada escenario.
const SCENARIO_LIMIT_MS = (Number(process.env.PROBAR_LIMITE_S) || 180) * 1000;
let scenarioTimer = null;
let currentScenario = null;
let scenarioStart = Date.now();
const overLimit = () => {
    process.stdout.write(`FALLA escenario colgado o demasiado lento: "${currentScenario}" superó ${SCENARIO_LIMIT_MS / 1000} s
`);
    process.exit(1);
};
const check = (name, ok, detail = '') => {
    if (currentScenario && Date.now() - scenarioStart > SCENARIO_LIMIT_MS) overLimit();
    console.log(`${ok ? 'OK  ' : 'FALLA'} ${name}${detail ? ` — ${detail}` : ''}`);
    if (!ok) failures++;
};
const endScenario = () => {
    if (currentScenario) console.log(`     (${((Date.now() - scenarioStart) / 1000).toFixed(1)} s)`);
    clearTimeout(scenarioTimer);
};
const section = (t) => {
    endScenario();
    console.log(`
== ${t} ==`);
    currentScenario = t;
    scenarioStart = Date.now();
    scenarioTimer = setTimeout(overLimit, SCENARIO_LIMIT_MS);
};
const quiet = async (fn) => {
    const { log, error } = console;
    console.log = () => {};
    console.error = () => {};
    try { return await fn(); } finally { console.log = log; console.error = error; }
};

// ---------------------------------------------------------------- servidor local
const pg = new PGlite();
await pg.exec(readFileSync('scripts/lib/pg-auth-stub.sql', 'utf8'));
for (const f of readdirSync('supabase/migrations').filter((x) => x.endsWith('.sql')).sort()) {
    await pg.exec(readFileSync(`supabase/migrations/${f}`, 'utf8'));
}
const T = createPgliteTransport(pg);
const newAuthUser = async (id = randomUUID()) => { await pg.query('insert into auth.users (id) values ($1)', [id]); return id; };
const CFG = { ...DEFAULT_SYNC_CONFIG, enabled: true, pageSize: 50, batchSize: 3 };

// ---------------------------------------------------------------- dispositivos
const devices = {};
async function newDevice(name, source = null) {
    const dir = `${WORK}/${name}`;
    mkdirSync(dir, { recursive: true });
    const path = `${dir}/app_registro_v3.db`;
    if (source) copyFileSync(source, path);
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
const sync = async (dev, cfg = CFG) => { use(dev); return quiet(() => engine.syncOnce(cfg, T)); };
const sql = async (dev, q, p = []) => { use(dev); return getConnection().runAsync(q, p); };
const one = async (dev, q, p = []) => { use(dev); return getConnection().getFirstAsync(q, p); };
const all = async (dev, q, p = []) => { use(dev); return getConnection().getAllAsync(q, p); };

// Contenido normalizado (forma del servidor, JSON con claves ordenadas) de las 15 tablas.
const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x)
    ? Object.fromEntries(Object.keys(x).sort().map((key) => [key, x[key]])) : x));
async function localSnap(dev) {
    const out = {};
    for (const t of TABLES) {
        const rows = await all(dev, `SELECT * FROM ${t} ORDER BY id`);
        out[t] = rows.map((r) => canon(toRemote(t, r)));
    }
    return out;
}
async function serverSnap(uid) {
    const out = {};
    for (const t of TABLES) {
        const r = await pg.query(`select row_to_json(x)::text as j from public.${t} x where user_id = $1 order by id`, [uid]);
        out[t] = r.rows.map((x) => canon(toRemote(t, fromRemote(t, JSON.parse(x.j)))));
    }
    return out;
}
const diffTables = (a, b) => TABLES.filter((t) => JSON.stringify(a[t]) !== JSON.stringify(b[t]));
const total = (s) => TABLES.reduce((n, t) => n + s[t].length, 0);
async function converged(label, uid, ...devs) {
    const server = await serverSnap(uid);
    const bad = [];
    for (const d of devs) {
        const diff = diffTables(await localSnap(d), server);
        if (diff.length) bad.push(`${d.name}≠servidor en ${diff.join(',')}`);
    }
    check(label, bad.length === 0, bad.length ? bad.join(' · ') : `${total(server)} filas idénticas en ${devs.map((d) => d.name).join(', ')} y el servidor`);
}
const outboxCount = async (dev) => (await one(dev, 'SELECT COUNT(*) n FROM outbox')).n;

// =========================================================================== base
section('Base: dos instalaciones nuevas de la misma cuenta (6 categorías por defecto cada una)');
const U = await newAuthUser();
T.uid = U;
const A = await newDevice('A');
const B = await newDevice('B');
await run(A, (s) => s.createLinkedUser(U, 'a@ejemplo.test'));
await run(B, (s) => s.createLinkedUser(U, 'a@ejemplo.test'));
const rA = await sync(A);
const rB = await sync(B);
await sync(A);
check('A sube sus 6 categorías', rA.status === 'ok' && rA.push.pushed === 6, JSON.stringify({ status: rA.status, pushed: rA.push?.pushed }));
check('B (otra instalación) choca en las 6 y las fusiona (23505 → id del servidor)', rB.status === 'ok' && rB.merged === 6 && rB.push.blocked === 0, `fusionadas ${rB.merged}`);
check('servidor: 6 categorías, sin duplicados', (await pg.query('select count(*)::int n from public.finance_categories where user_id = $1', [U])).rows[0].n === 6);
await converged('A, B y servidor convergen', U, A, B);

// =========================================================================== 1
section('1. Crear, editar y borrar en A → sync A → sync B → idénticos');
const catRes = await run(A, (s) => s.addEntertainmentCategory(U, { name: 'Anime', type: 'video', startDate: '2026-01-01', daysOfWeek: { Monday: 1, Friday: 2 }, frequency: 0, seriesCount: 2, description: null }));
const CAT = catRes.id;
await run(A, (s) => s.addSeriesWithSeasons({ category_id: CAT, name: 'Serie 1', description: null, status: 'Mirando', current_season: 1, current_episode: 1, total_seasons: 2 }, [{ season_number: 1, episode_count: 12 }, { season_number: 2, episode_count: 10 }]));
const SER = (await one(A, "SELECT id FROM series WHERE name = 'Serie 1'")).id;
await run(A, (s) => s.addHistory(SER, 1, 1, Date.parse('2026-10-30T20:00:00Z')));
await run(A, (s) => s.pauseCategory(CAT, '2026-10-31'));
await run(A, (s) => s.addBacklogItem(U, { type: 'movie', title: 'Peli 1' }));
await run(A, (s) => s.addBacklogItem(U, { type: 'anime', title: 'Para borrar' }));
await run(A, (s) => s.registerMoneyMovement(U, { amount: -20, category: 'Comida', description: 'almuerzo', linked: { contactId: null, contactName: 'Ana', type: 'loan', amount: 20, description: 'almuerzo' } }));
await run(A, (s) => s.addCard(U, { name: 'Visa', type: 'credit', cutoff_date: 5, payment_due_date: 20, limit_amount: 1500 }));
await run(A, (s) => s.addWorkPerson(U, 'Luis', '2026-01-01', '[{"type":"dia","days":2}]'));
const P = (await one(A, "SELECT id FROM backlog WHERE title = 'Peli 1'")).id;
await run(A, (s) => s.updateBacklogStatus(P, 'Mirando'));
const DEL = (await one(A, "SELECT id FROM backlog WHERE title = 'Para borrar'")).id;
await run(A, (s) => s.deleteBacklogItem(DEL));
const s1a = await sync(A);
const s1b = await sync(B);
check('A sube todo sin bloqueos', s1a.status === 'ok' && s1a.push.blocked === 0 && (await outboxCount(A)) === 0, `subidas ${s1a.push?.pushed}`);
check('B baja todo', s1b.status === 'ok' && s1b.applied > 0, `aplicadas ${s1b.applied}`);
await converged('1. A, B y servidor idénticos (incluido el borrado)', U, A, B);

// =========================================================================== 2
section('2. Ediciones offline acumuladas → se suben en orden, sin duplicados');
T.offline = true;
await run(A, (s) => s.addBacklogItem(U, { type: 'series', title: 'Offline X' }));
const X = (await one(A, "SELECT id FROM backlog WHERE title = 'Offline X'")).id;
for (const title of ['Offline X1', 'Offline X2', 'Offline X3']) await run(A, (s) => s.updateBacklogItem(X, { title, franchise: 'Otros' }));
await run(A, (s) => s.addBacklogItem(U, { type: 'movie', title: 'Offline Y' }));
const Y = (await one(A, "SELECT id FROM backlog WHERE title = 'Offline Y'")).id;
await run(A, (s) => s.deleteBacklogItem(Y)); // creada y borrada sin conexión
const before2 = await outboxCount(A);
const off = await sync(A);
check('sin red: resultado "offline", la outbox no pierde entradas', off.status === 'offline' && (await outboxCount(A)) === before2, `${before2} entradas`);
T.offline = false;
await sql(A, 'UPDATE outbox SET next_attempt_at = NULL'); // simula que pasó el backoff
const on = await sync(A);
await sync(B);
const xServer = (await pg.query("select title from public.backlog where id = $1", [X])).rows;
check('con red: se sube el estado final, una sola fila', on.status === 'ok' && xServer.length === 1 && xServer[0].title === 'Offline X3' && (await outboxCount(A)) === 0);
await converged('2. convergen', U, A, B);

// =========================================================================== 3
section('3. Conflicto: misma fila editada en A y B sin conexión → gana el último en llegar');
await run(A, (s) => s.updateBacklogItem(P, { title: 'desde A', franchise: 'Otros' }));
await run(B, (s) => s.updateBacklogItem(P, { title: 'desde B', franchise: 'Otros' }));
await sync(A);
await sync(B);
await sync(A);
const pA = await one(A, 'SELECT title FROM backlog WHERE id = ?', [P]);
const pB = await one(B, 'SELECT title FROM backlog WHERE id = ?', [P]);
check('ganó B (llegó último al servidor) en los dos dispositivos', pA.title === 'desde B' && pB.title === 'desde B');
await converged('3. convergen', U, A, B);

// =========================================================================== 4
section('4. Cambio local pendiente + pull de la misma fila → no se sobrescribe');
await run(B, (s) => s.updateBacklogItem(P, { title: 'B2', franchise: 'Otros' }));
await sync(B);
await run(A, (s) => s.updateBacklogItem(P, { title: 'A2', franchise: 'Otros' }));
use(A);
const pr = await quiet(() => engine.pullTable(CFG, T, 'backlog', U));
check('el pull omite la fila con cambio pendiente', pr.skippedPending >= 1 && (await one(A, 'SELECT title FROM backlog WHERE id = ?', [P])).title === 'A2');
await sync(A);
await sync(B);
check('después, su push gana y B converge', (await one(B, 'SELECT title FROM backlog WHERE id = ?', [P])).title === 'A2');
await converged('4. convergen', U, A, B);

// =========================================================================== 5
section('5. Tombstones con cascada lógica de una categoría con hijas');
await run(A, (s) => s.deleteEntertainmentCategory(CAT));
await sync(A);
await sync(B);
const live = await one(B, 'SELECT (SELECT COUNT(*) FROM series WHERE category_id = ? AND deleted_at IS NULL) + (SELECT COUNT(*) FROM seasons WHERE series_id = ? AND deleted_at IS NULL) + (SELECT COUNT(*) FROM entertainment_pauses WHERE category_id = ? AND deleted_at IS NULL) + (SELECT COUNT(*) FROM watch_history WHERE series_id = ? AND deleted_at IS NULL) AS n', [CAT, SER, CAT, SER]);
const tomb = await one(B, 'SELECT (SELECT COUNT(*) FROM series WHERE category_id = ? AND deleted_at IS NOT NULL) + (SELECT COUNT(*) FROM seasons WHERE series_id = ? AND deleted_at IS NOT NULL) AS n', [CAT, SER]);
check('en B la categoría y todas sus hijas quedan borradas (tombstones)', live.n === 0 && tomb.n >= 3, `${tomb.n} tombstones de serie/temporadas`);
await converged('5. convergen', U, A, B);

// =========================================================================== 6
section('6. Claves naturales: reinstalación y dos dispositivos creando lo mismo');
const C = await newDevice('C');
await run(C, (s) => s.createLinkedUser(U, 'a@ejemplo.test'));
const rc = await sync(C);
check('reinstalación (C nuevo): sus 6 categorías por defecto se fusionan, sin duplicados', rc.status === 'ok' && rc.merged >= 6 && (await pg.query('select count(*)::int n from public.finance_categories where user_id = $1', [U])).rows[0].n === 6);
await run(A, (s) => s.addFinanceCategory(U, 'Viajes'));
await run(B, (s) => s.addFinanceCategory(U, 'Viajes'));
await sync(A); await sync(B); await sync(A); await sync(C);
const vA = await one(A, "SELECT id FROM finance_categories WHERE name = 'Viajes'");
const vB = await one(B, "SELECT id FROM finance_categories WHERE name = 'Viajes'");
check('misma categoría creada en A y B → un solo id en los dos y en el servidor', vA.id === vB.id && (await pg.query("select count(*)::int n from public.finance_categories where user_id = $1 and name = 'Viajes'", [U])).rows[0].n === 1);
// Temporadas: misma serie, la misma temporada nueva creada en A y en B
const cat2 = (await run(A, (s) => s.addEntertainmentCategory(U, { name: 'Series', type: 'video', startDate: '2026-01-01', daysOfWeek: { Monday: 1 }, frequency: 0, seriesCount: 0, description: null }))).id;
await run(A, (s) => s.addSeriesWithSeasons({ category_id: cat2, name: 'Serie 2', description: null, status: 'Nueva', current_season: 1, current_episode: 1, total_seasons: 1 }, [{ season_number: 1, episode_count: 8 }]));
const SER2 = (await one(A, "SELECT id FROM series WHERE name = 'Serie 2'")).id;
await sync(A); await sync(B);
await run(A, (s) => s.updateSeriesWithSeasons(SER2, { name: 'Serie 2', description: null, total_seasons: 2, status: 'Nueva' }, [{ season_number: 1, episode_count: 8 }, { season_number: 2, episode_count: 6 }]));
await run(B, (s) => s.updateSeriesWithSeasons(SER2, { name: 'Serie 2', description: null, total_seasons: 2, status: 'Nueva' }, [{ season_number: 1, episode_count: 8 }, { season_number: 2, episode_count: 9 }]));
await sync(A); await sync(B); await sync(A); await sync(C);
const s2 = (await pg.query('select count(*)::int n from public.seasons where series_id = $1', [SER2])).rows[0].n;
const sA = await one(A, 'SELECT id, episode_count FROM seasons WHERE series_id = ? AND season_number = 2', [SER2]);
const sB = await one(B, 'SELECT id, episode_count FROM seasons WHERE series_id = ? AND season_number = 2', [SER2]);
check('misma temporada creada en A y B → fusionada (gana el último: B) y un solo id', s2 === 2 && sA.id === sB.id && sA.episode_count === 9 && sB.episode_count === 9);
await converged('6. A, B, C y servidor convergen', U, A, B, C);

// =========================================================================== 7
section('7. Paginación (más filas que la página) y ventana de solapamiento');
for (let i = 0; i < 23; i++) await run(A, (s) => s.addBacklogItem(U, { type: 'movie', title: `Página ${i}` }));
await sync(A);
// Empates de server_updated_at: 12 filas con el MISMO instante (desempate por id).
await pg.exec('alter table public.backlog disable trigger set_server_updated_at');
await pg.query("update public.backlog set server_updated_at = now() where user_id = $1 and title like 'Página 1%'", [U]);
await pg.exec('alter table public.backlog enable trigger set_server_updated_at');
const PAGE = { ...CFG, pageSize: 5 };
const D = await newDevice('D');
await sql(D, 'INSERT INTO users (id, username, email, linked_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', [U, 'd', 'a@ejemplo.test', '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z']);
const rd = await sync(D, PAGE);
const backlogServer = (await pg.query('select count(*)::int n from public.backlog where user_id = $1', [U])).rows[0].n;
const backlogD = (await one(D, 'SELECT COUNT(*) n FROM backlog')).n;
check(`páginas de 5 con empates: D baja ${backlogServer} filas de backlog exactamente una vez`, rd.status === 'ok' && backlogD === backlogServer);
const rd2 = await sync(D, PAGE);
check('segunda pasada: la ventana re-recibe filas pero no escribe nada', rd2.status === 'ok' && rd2.localWrites === 0, `re-recibidas ${rd2.pulled}`);
await converged('7. D idéntico al servidor', U, D);

// =========================================================================== 8
section('8. Corte de red a mitad del push y del pull');
for (let i = 0; i < 7; i++) await run(A, (s) => s.addBacklogItem(U, { type: 'anime', title: `Corte ${i}` }));
T.calls.upsert = 0; T.failUpsertAfter = 1; // primer lote (3) sí, luego se corta
const cut = await sync(A);
T.failUpsertAfter = null;
const left = await outboxCount(A);
const onServer = (await pg.query("select count(*)::int n from public.backlog where user_id = $1 and title like 'Corte %'", [U])).rows[0].n;
check('push cortado: 3 subidas, 4 siguen en la outbox con backoff', cut.status === 'offline' && onServer === 3 && left === 4
    && (await one(A, 'SELECT COUNT(*) n FROM outbox WHERE next_attempt_at IS NOT NULL AND attempts = 1')).n === 4);
await sql(A, 'UPDATE outbox SET next_attempt_at = NULL');
await sync(A);
check('reintento: 7 en el servidor, sin duplicados, outbox vacía', (await pg.query("select count(*)::int n from public.backlog where user_id = $1 and title like 'Corte %'", [U])).rows[0].n === 7 && (await outboxCount(A)) === 0);
T.calls.pull = 0; T.failPullAfter = 3;
const pcut = await sync(B, { ...CFG, pageSize: 3 });
T.failPullAfter = null;
check('pull cortado: resultado "offline" sin error en la app', pcut.status === 'offline');
await sync(B, { ...CFG, pageSize: 3 });
await converged('8. tras reconectar convergen sin duplicados ni pérdidas', U, A, B);

// =========================================================================== 9
section('9. Error permanente → entrada bloqueada y visible; el resto sigue');
const now = new Date().toISOString();
const BAD = randomUUID();
await sql(A, 'INSERT INTO series (id, user_id, category_id, name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [BAD, U, cat2, 'Estado inválido', 'Terminada', now, now]);
await sql(A, "INSERT INTO outbox (table_name, row_id, op, created_at, attempts) VALUES ('series', ?, 'upsert', ?, 0)", [BAD, now]);
await run(A, (s) => s.addBacklogItem(U, { type: 'movie', title: 'Sigue sincronizando' }));
const r9 = await sync(A);
use(A);
const st = await quiet(() => engine.getSyncStatus());
check('la fila inválida queda bloqueada con su motivo (23514) y la otra se sube', r9.status === 'ok' && r9.push.blocked === 1
    && st.blocked.length === 1 && /23514/.test(st.blocked[0].reason)
    && (await pg.query("select count(*)::int n from public.backlog where title = 'Sigue sincronizando'")).rows[0].n === 1, st.blocked[0]?.reason);
// Mientras una fila está bloqueada, el pull no la actualiza.
await sql(A, 'UPDATE backlog SET status = ? WHERE id = ?', ['Visto', P]);
await sql(A, "INSERT INTO outbox (table_name, row_id, op, created_at, attempts) VALUES ('backlog', ?, 'upsert', ?, 0)", [P, now]);
await sync(A);
await run(B, (s) => s.updateBacklogItem(P, { title: 'B3', franchise: 'Otros' }));
await sync(B);
await sync(A);
const pBlocked = await one(A, 'SELECT title, status FROM backlog WHERE id = ?', [P]);
check('fila bloqueada: el pull no la sobrescribe', pBlocked.status === 'Visto' && pBlocked.title !== 'B3');
check('la outbox conserva las entradas bloqueadas (nunca se descartan)', (await one(A, 'SELECT COUNT(*) n FROM outbox WHERE blocked_at IS NOT NULL')).n === 2);
use(A);
const unb = await quiet(() => engine.unblockAll());
await sql(A, 'UPDATE series SET status = ? WHERE id = ?', ['Terminado', BAD]); // corregida localmente
await run(A, (s) => s.updateBacklogStatus(P, 'Terminado'));
const r9b = await sync(A);
await sync(B);
check('"Reintentar" desbloquea y el siguiente ciclo las sube', unb === 2 && r9b.status === 'ok' && r9b.push.blocked === 0 && (await outboxCount(A)) === 0);
await converged('9. convergen tras corregir', U, A, B);

// =========================================================================== 10
section('10. Segunda sincronización sin cambios → 0 escrituras');
await sync(A); await sync(B);
const w0 = T.rowsWritten;
const z1 = await sync(A);
const z2 = await sync(B);
check('0 escrituras en el servidor y 0 locales', z1.remoteWrites === 0 && z2.remoteWrites === 0 && z1.localWrites === 0 && z2.localWrites === 0 && T.rowsWritten === w0);

// =========================================================================== 11
section('11. Dinero: redondeo a centavos al escribir y en el mapeador');
await run(A, (s) => s.addService(U, { name: 'Streaming', type: 'Internacional', status: 'Activo', originalValue: 9.99, additionalValue: 0, totalValue: 9.99 * 1.2 }));
const svcRow = await one(A, "SELECT total_value FROM services WHERE name = 'Streaming'");
await sync(A); await sync(B);
const svcServer = (await pg.query("select total_value::text v from public.services where name = 'Streaming'")).rows[0].v;
check('11,988 → 11,99 en SQLite, en el servidor y en B', svcRow.total_value === 11.99 && svcServer === '11.99'
    && (await one(B, "SELECT total_value FROM services WHERE name = 'Streaming'")).total_value === 11.99);
let moneyValues = 0, moneyChanged = 0;
const REAL = ['.local-data/respaldo-post-fase3/registro_respaldo_20261101-124308.db', '.local-data/emulador-fase3/release/post-reinstalar.db',
    '.local-data/emulador-antes.db', '.local-data/emulador/checklist/app.db', '.local-data/emulador-eas/antes.db', '.local-data/emulador-fase1/tras-checklist.db'];
for (const p of REAL.filter(existsSync)) {
    const d = new DatabaseSync(p, { readOnly: true });
    for (const [t, cols] of Object.entries(MONEY_COLUMNS)) {
        for (const c of cols) {
            for (const r of d.prepare(`SELECT ${c} v FROM ${t} WHERE ${c} IS NOT NULL`).all()) { moneyValues++; if (changesWhenRounded(r.v)) moneyChanged++; }
        }
    }
    d.close();
}
check(`valores locales que cambiarían al redondear (BD reales y de prueba): ${moneyChanged} de ${moneyValues}`, true);

// =========================================================================== 12
section('12. Sin sesión, sin vincular u otra cuenta → no sincroniza y no falla');
const ob12 = await outboxCount(A);
await run(A, (s) => s.addBacklogItem(U, { type: 'movie', title: 'Sin sesión' }));
T.uid = null;
const ns = await sync(A);
check('sin sesión: "skipped no-session", la outbox intacta', ns.status === 'skipped' && ns.reason === 'no-session' && (await outboxCount(A)) === ob12 + 1);
T.uid = await newAuthUser();
const oa = await sync(A);
check('sesión de otra cuenta: "skipped other-account"', oa.status === 'skipped' && oa.reason === 'other-account');
T.uid = U;
const NL = await newDevice('sin-vincular', '.local-data/emulador-antes.db');
const nl = await sync(NL);
check('datos sin vincular: "skipped not-linked"', nl.status === 'skipped' && nl.reason === 'not-linked');
await sync(A);

// =========================================================================== 13
section('13. La sincronización está apagada en producción');
const calls0 = { ...T.calls };
const dis = await sync(A, { ...CFG, enabled: false });
check('enabled: false → "disabled" sin ninguna llamada al servidor', dis.status === 'disabled' && JSON.stringify(T.calls) === JSON.stringify(calls0));
const appJson = JSON.parse(readFileSync('app.json', 'utf8')).expo;
const appConfig = require('../app.config.js');
const evalVariant = (v) => {
    const keep = { ...process.env };
    process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://prodref000000000000.supabase.co';
    process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_PROD';
    process.env.EXPO_PUBLIC_SUPABASE_DEV_URL = 'https://devref0000000000000.supabase.co';
    process.env.EXPO_PUBLIC_SUPABASE_DEV_PUBLISHABLE_KEY = 'sb_publishable_DEV';
    if (v) process.env.APP_VARIANT = v; else delete process.env.APP_VARIANT;
    try { return appConfig({ config: appJson }); } finally { process.env = keep; }
};
const prod = evalVariant(null);
const dev = evalVariant('development');
check('producción: syncEnabled false y solo el proyecto de producción', prod.extra.syncEnabled === false && prod.extra.supabase.url.includes('prodref') && !JSON.stringify(prod).includes('devref'));
check('desarrollo: syncEnabled true y solo el proyecto Registro Dev', dev.extra.syncEnabled === true && dev.extra.supabase.url.includes('devref') && !JSON.stringify(dev).includes('prodref'));
let refused = false;
use(A);
try { await engine.enqueueAllForInitialUpload({ ...CFG, enabled: false }); } catch { refused = true; }
check('enqueueAllForInitialUpload se niega con la sync apagada', refused);

// =========================================================================== 14
section('14. Primera subida completa (motor + enqueueAllForInitialUpload) y bajada a un dispositivo vacío');
const SOURCES = [
    ['A', '.local-data/emulador-antes.db'],
    ['B', '.local-data/emulador/checklist/app.db'],
    ['C', '.local-data/emulador-eas/antes.db'],
    ['sintética', '.local-data/pruebas-fase1/sintetica/app_registro_v3.db'],
    ['emulador (con tombstones)', '.local-data/emulador-fase1/tras-checklist.db'],
    ['real (celular, post-fase3)', '.local-data/respaldo-post-fase3/registro_respaldo_20261101-124308.db'],
];
let k = 0;
for (const [label, src] of SOURCES) {
    if (!existsSync(src)) { check(`${label}: existe`, false, src); continue; }
    k++;
    const S = await newDevice(`fuente-${k}`, src);
    const users = await all(S, 'SELECT id, linked_at FROM users ORDER BY created_at');
    let V;
    if (users.length === 1 && users[0].linked_at) {
        V = users[0].id; // ya vinculada (celular real): se usa su uid en el Postgres LOCAL
        await newAuthUser(V);
    } else {
        if (users.length > 1) {
            // B tiene 2 cuentas: la vinculación exige una. En esta COPIA de prueba se deja solo la primera.
            const keepId = users[0].id;
            for (const t of TABLES) await sql(S, `DELETE FROM ${t} WHERE user_id <> ?`, [keepId]);
            await sql(S, 'DELETE FROM users WHERE id <> ?', [keepId]);
        }
        V = await newAuthUser();
        const l = await run(S, (s) => s.linkAccount(V, 'prueba@ejemplo.test'));
        if (!l.success || l.result.status !== 'linked') { check(`${label}: vinculación`, false, l.error || l.result.status); continue; }
    }
    T.uid = V;
    // Filas con cambios locales que ya estaban en la outbox (no se vuelven a encolar).
    const preexisting = (await one(S, 'SELECT COUNT(DISTINCT table_name || row_id) n FROM outbox')).n;
    use(S);
    const queued = await quiet(() => engine.enqueueAllForInitialUpload(CFG));
    const up = await sync(S, { ...CFG, batchSize: 100 });
    const E = await newDevice(`vacio-${k}`);
    await sql(E, 'INSERT INTO users (id, username, email, linked_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', [V, 'e', 'prueba@ejemplo.test', now, now, now]);
    const down = await sync(E, { ...CFG, pageSize: 500 });
    const a = await localSnap(S);
    const b = await localSnap(E);
    const diff = diffTables(a, b);
    const tombs = TABLES.reduce((n, t) => n + a[t].filter((x) => JSON.parse(x).deleted_at).length, 0);
    check(`${label}: ${queued} filas encoladas (+${preexisting} ya en la outbox) → subidas → bajadas a un dispositivo vacío, idénticas (${tombs} tombstones)`,
        up.status === 'ok' && up.push.blocked === 0 && down.status === 'ok' && diff.length === 0 && (await outboxCount(S)) === 0 && total(a) === queued + preexisting,
        diff.length ? `difieren: ${diff.join(',')}` : `subidas ${up.push.pushed}, bajadas ${down.applied}`);
}
T.uid = U;

// =========================================================================== 15
section('15. Hijo nuevo de un padre que nunca entró en la outbox (datos migrados) → el padre sube solo');
const F = await newDevice('F', '.local-data/emulador-antes.db');
const W = await newAuthUser();
await run(F, (s) => s.linkAccount(W, 'prueba@ejemplo.test'));
T.uid = W;
const migCat = (await one(F, 'SELECT id FROM entertainment_categories WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1')).id;
const migSer = await one(F, 'SELECT id, name, description, total_seasons, status FROM series WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1');
const migSeasons = await all(F, 'SELECT season_number, episode_count FROM seasons WHERE series_id = ? AND deleted_at IS NULL ORDER BY season_number', [migSer.id]);
const migContact = await one(F, 'SELECT id, name FROM finance_contacts WHERE deleted_at IS NULL LIMIT 1');
check('F: datos migrados sin outbox', (await outboxCount(F)) === 0);
await run(F, (s) => s.addSeriesWithSeasons({ category_id: migCat, name: 'Hija de categoría migrada', description: null, status: 'Nueva', current_season: 1, current_episode: 1, total_seasons: 1 }, [{ season_number: 1, episode_count: 3 }]));
const nextSeason = migSeasons.length ? Math.max(...migSeasons.map((x) => x.season_number)) + 1 : 1;
await run(F, (s) => s.updateSeriesWithSeasons(migSer.id, { name: migSer.name, description: migSer.description, total_seasons: nextSeason, status: migSer.status || 'Nueva' }, [...migSeasons, { season_number: nextSeason, episode_count: 5 }]));
await run(F, (s) => s.addHistory(migSer.id, 1, 1, Date.parse('2026-11-01T12:00:00Z')));
await run(F, (s) => s.registerMoneyMovement(W, { amount: -3, category: 'Comida', description: 'x', linked: { contactId: migContact.id, contactName: migContact.name, type: 'loan', amount: 3, description: 'x' } }));
await run(F, (s) => s.pauseCategory(migCat, '2026-11-01'));
const rf = await sync(F);
const onSrv = async (t, id) => (await pg.query(`select count(*)::int n from public.${t} where id = $1`, [id])).rows[0].n === 1;
check('los padres migrados se suben solos (23503 → padre encolado) y nada queda bloqueado',
    rf.status === 'ok' && rf.push.blocked === 0 && rf.push.parentsEnqueued >= 2 && (await outboxCount(F)) === 0
    && await onSrv('entertainment_categories', migCat) && await onSrv('series', migSer.id) && await onSrv('finance_contacts', migContact.id),
    `padres encolados ${rf.push.parentsEnqueued}, subidas ${rf.push.pushed}`);
const G = await newDevice('G');
await sql(G, 'INSERT INTO users (id, username, email, linked_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', [W, 'g', 'prueba@ejemplo.test', now, now, now]);
const rg = await sync(G);
check('un dispositivo vacío recibe los hijos y sus padres', rg.status === 'ok' && rg.applied >= 7, `aplicadas ${rg.applied}`);
await converged('15. G idéntico al servidor', W, G);

// =========================================================================== 16
section('16. Transporte que nunca responde (push y pull) → el watchdog libera el single-flight');
{
    const { createSyncRunner } = await import('../src/sync/runner.ts');
    const { createFetchWithTimeout } = await import('../src/auth/fetchWithTimeout.ts');
    const { classifyError } = await import('../src/sync/transport.ts');
    T.uid = U;
    await sync(A); await sync(B);
    const hang = { upsert: false, pull: false };
    const H = {
        session: () => T.session(),
        upsert: (t, rows) => (hang.upsert ? new Promise(() => {}) : T.upsert(t, rows)),
        pullPage: (t, o) => (hang.pull ? new Promise(() => {}) : T.pullPage(t, o)),
        findByNaturalKey: (t, k) => T.findByNaturalKey(t, k),
    };
    const runner = createSyncRunner({ config: () => CFG, transport: () => H, timeoutMs: 1500 });
    use(A);
    await run(A, (s) => s.addBacklogItem(U, { type: 'movie', title: 'Colgado 1' }));
    await run(A, (s) => s.addBacklogItem(U, { type: 'movie', title: 'Colgado 2' }));
    const outboxBefore = JSON.stringify(await all(A, 'SELECT id, table_name, row_id, attempts, next_attempt_at, blocked_at FROM outbox ORDER BY id'));
    hang.upsert = true;
    const t0 = Date.now();
    use(A);
    await quiet(() => runner.request('prueba-push'));
    const pushHang = runner.state();
    const outboxAfter = JSON.stringify(await all(A, 'SELECT id, table_name, row_id, attempts, next_attempt_at, blocked_at FROM outbox ORDER BY id'));
    const meta = await one(A, "SELECT value FROM sync_meta WHERE key = 'last_error'");
    check('push colgado: el ciclo termina por timeout y libera el single-flight', pushHang.lastOutcome?.status === 'timeout' && pushHang.syncing === false && Date.now() - t0 < 5000,
        `${Date.now() - t0} ms`);
    check('outbox intacta (sin intentos, sin bloqueos) y last_error en sync_meta', outboxAfter === outboxBefore && /superó/.test(meta?.value || ''));
    hang.upsert = false;
    use(A);
    await quiet(() => runner.request('prueba-sana'));
    check('el siguiente ciclo (transporte sano) sincroniza bien', runner.state().lastOutcome?.status === 'ok' && (await outboxCount(A)) === 0);
    // Pull colgado
    await run(B, (s) => s.addBacklogItem(U, { type: 'anime', title: 'Para el pull colgado' }));
    await sync(B);
    const cursorsBefore = JSON.stringify(await all(A, 'SELECT table_name, cursor_ts, cursor_id FROM sync_state ORDER BY table_name'));
    hang.pull = true;
    use(A);
    await quiet(() => runner.request('prueba-pull'));
    const pullHang = runner.state();
    const cursorsAfter = JSON.stringify(await all(A, 'SELECT table_name, cursor_ts, cursor_id FROM sync_state ORDER BY table_name'));
    check('pull colgado: timeout, single-flight libre y cursores sin mover', pullHang.lastOutcome?.status === 'timeout' && pullHang.syncing === false && cursorsAfter === cursorsBefore);
    hang.pull = false;
    use(A);
    await quiet(() => runner.request('prueba-sana-2'));
    check('el siguiente ciclo baja lo pendiente', runner.state().lastOutcome?.status === 'ok'
        && (await one(A, "SELECT COUNT(*) n FROM backlog WHERE title = 'Para el pull colgado'")).n === 1);
    await converged('16. A, B y servidor convergen tras los cuelgues', U, A, B);
    // fetch con timeout por petición (el que usa supabase-js): un servidor que nunca responde.
    const http = await import('node:http');
    const server = http.createServer(() => {}); // acepta la conexión y nunca responde
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    const f = createFetchWithTimeout(400);
    const t1 = Date.now();
    let fetchErr = null;
    try { await f(`http://127.0.0.1:${port}/rest/v1/backlog`); } catch (e) { fetchErr = e; }
    server.closeAllConnections?.();
    server.close();
    check('fetch con timeout: aborta una petición sin respuesta y el motor lo clasifica como transitorio',
        fetchErr && Date.now() - t1 < 3000 && classifyError(null, 0, `${fetchErr.name}: ${fetchErr.message}`) === 'network',
        fetchErr ? `${fetchErr.name} a los ${Date.now() - t1} ms` : 'no abortó');
}

// =========================================================================== 17
section('17. Cambio offline + fallo de red + reconexión antes de vencer el backoff → sube sin tocar el botón');
{
    const { createSyncRunner } = await import('../src/sync/runner.ts');
    T.uid = U;
    T.offline = false;
    await sync(A); await sync(B);
    const runner = createSyncRunner({ config: () => CFG, transport: () => T });
    const req = async (reason) => { use(A); await quiet(() => runner.request(reason)); return runner.state().lastOutcome; };
    const entry = async (title) => one(A,
        `SELECT o.attempts, o.last_error, o.next_attempt_at, o.blocked_at FROM outbox o JOIN backlog b ON b.id = o.row_id
         WHERE o.table_name = 'backlog' AND b.title = ? ORDER BY o.id DESC LIMIT 1`, [title]);
    const onServer = async (title) => (await pg.query('select count(*)::int n from public.backlog where user_id = $1 and title = $2', [U, title])).rows[0].n === 1;

    // Sin conexión: el cambio falla por red y queda con backoff (30 s) marcado como error de red.
    T.offline = true;
    await run(A, (s) => s.addBacklogItem(U, { type: 'movie', title: 'Offline 17' }));
    const off = await req('boton');
    const e1 = await entry('Offline 17');
    check('sin red: el ciclo termina "offline" y la entrada queda con backoff y error de red',
        off?.status === 'offline' && e1 && e1.attempts === 1 && e1.next_attempt_at > new Date().toISOString() && /^red · /.test(e1.last_error) && !e1.blocked_at,
        e1 ? `intentos ${e1.attempts}` : 'sin entrada');
    // Vuelve la red ANTES de vencer el backoff.
    T.offline = false;
    const fg = await req('primer-plano');
    check('el backoff automático sigue igual: volver a primer plano no la sube antes de tiempo',
        fg?.status === 'ok' && !(await onServer('Offline 17')) && (await entry('Offline 17'))?.attempts === 1);
    const rc = await req('reconexion');
    check('reconexión: se sube en esa misma sync, sin tocar el botón',
        rc?.status === 'ok' && rc.push.pushed >= 1 && await onServer('Offline 17') && (await outboxCount(A)) === 0,
        `subidas ${rc?.push?.pushed}`);

    // "Sincronizar ahora" también la reintenta de inmediato.
    T.offline = true;
    await run(A, (s) => s.addBacklogItem(U, { type: 'movie', title: 'Offline 17b' }));
    await req('primer-plano');
    T.offline = false;
    const bt = await req('boton');
    check('"Sincronizar ahora": se sube aunque su backoff no haya vencido', bt?.status === 'ok' && await onServer('Offline 17b') && (await outboxCount(A)) === 0);

    // Errores de sesión: NO se reinician (no son de red).
    const authDown = { kind: 'auth', code: 'PGRST301', status: 401, message: 'JWT expired (simulado)' };
    const AU = {
        session: () => T.session(),
        upsert: async () => ({ error: authDown }),
        pullPage: (t, o) => T.pullPage(t, o),
        findByNaturalKey: (t, k) => T.findByNaturalKey(t, k),
    };
    let authOn = true;
    const runner2 = createSyncRunner({ config: () => CFG, transport: () => (authOn ? AU : T) });
    const req2 = async (reason) => { use(A); await quiet(() => runner2.request(reason)); return runner2.state().lastOutcome; };
    await run(A, (s) => s.addBacklogItem(U, { type: 'movie', title: 'Sesion 17' }));
    const au = await req2('primer-plano');
    const e2 = await entry('Sesion 17');
    authOn = false;
    const au2 = await req2('reconexion');
    const e3 = await entry('Sesion 17');
    check('error de sesión: la reconexión NO reinicia su backoff',
        au?.status === 'skipped' && au.reason === 'session-expired' && e2?.next_attempt_at && !/^red · /.test(e2.last_error)
        && au2?.status === 'ok' && e3 && e3.next_attempt_at === e2.next_attempt_at && !(await onServer('Sesion 17')));

    // Entradas bloqueadas: tampoco (aunque su último error haya sido de red).
    const blockedNext = new Date(Date.now() + 3_600_000).toISOString();
    await sql(A, "UPDATE outbox SET blocked_at = ?, block_reason = 'prueba', last_error = 'red · prueba', next_attempt_at = ? WHERE table_name = 'backlog' AND row_id IN (SELECT id FROM backlog WHERE title = 'Sesion 17')", [new Date().toISOString(), blockedNext]);
    use(A);
    const resetN = await quiet(() => engine.resetNetworkBackoff());
    const e4 = await entry('Sesion 17');
    check('bloqueada: resetNetworkBackoff no la toca', resetN === 0 && e4?.blocked_at && e4.next_attempt_at === blockedNext);
    // Limpieza: desbloquear (como "Reintentar") y converger.
    use(A);
    await quiet(() => engine.unblockAll());
    await sync(A); await sync(B);
    await converged('17. A, B y servidor convergen', U, A, B);
}
endScenario();

console.log(failures === 0 ? '\nTODAS LAS PRUEBAS DE LA FASE 4 PASARON.' : `\n${failures} prueba(s) fallaron.`);
process.exit(failures === 0 ? 0 : 1);
