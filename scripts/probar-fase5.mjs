// Pruebas en PC de la Fase 5 (primera subida y sesión sin red) con el código REAL de src/
// en "dispositivos" node:sqlite contra un Postgres LOCAL (PGlite con las migraciones reales,
// RLS y triggers). Para la sesión usa el GoTrueClient REAL de @supabase/auth-js (el que
// empaqueta supabase-js) con un fetch simulado. Nunca toca un proyecto remoto. No imprime filas.
//
// Uso: node scripts/probar-fase5.mjs
import './lib/test-hooks.mjs';
import { rmSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { createServer, createDevices, engine, TABLES, quiet, sumCounts } from './lib/sync-devices.mjs';
import { snapshotDb, compareSnapshots } from './comparar-sync.mjs';

const require = createRequire(import.meta.url);
const { GoTrueClient } = require('@supabase/auth-js');
const { DEFAULT_SYNC_CONFIG } = await import('../src/sync/config.ts');
const { createSyncRunner, shouldSyncOnSessionRestored, RESET_BACKOFF_REASONS } = await import('../src/sync/runner.ts');
const { setOutboxCommitListener } = await import('../src/data/db/connection.ts');
const { readSessionState, subscribeSessionRestored } = await import('../src/auth/sessionState.ts');

const WORK = resolve('.local-data/pruebas-fase5').replace(/\\/g, '/');
rmSync(WORK, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });

let failures = 0;
const check = (name, ok, detail = '') => {
    console.log(`${ok ? 'OK  ' : 'FALLA'} ${name}${detail ? ` — ${detail}` : ''}`);
    if (!ok) failures++;
};
const section = (t) => console.log(`\n== ${t} ==`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CFG = { ...DEFAULT_SYNC_CONFIG, enabled: true, pageSize: 50, batchSize: 7 };
const FIXTURE = '.local-data/emulador-antes.db'; // datos de PRUEBA (1 cuenta, sin vincular)
const REAL = '.local-data/respaldo-post-fase3/registro_respaldo_20261101-124308.db'; // copia del celular (vinculada)
if (!existsSync(FIXTURE)) { console.log(`FALLA falta ${FIXTURE}`); process.exit(1); }

const { pg, T, newAuthUser, counts: serverCounts } = await createServer();
const D = createDevices(WORK);
const { newDevice, use, run, one, all, restart, counts, outbox, meta } = D;
const now = new Date().toISOString();

// Runner real con prepare = ensureInitialUpload (como controller.ts).
const makeRunner = (transport = T, extra = {}) => createSyncRunner({
    config: () => CFG,
    transport: () => transport,
    prepare: () => engine.ensureInitialUpload(CFG),
    ...extra,
});
const cycle = async (dev, runner) => { use(dev); await quiet(() => runner.request('apertura')); return runner.state().lastOutcome; };

// Dispositivo con los datos de prueba, vinculado a un uid nuevo del servidor local.
async function linkedFixture(name) {
    const dev = await newDevice(name, FIXTURE);
    const uid = await newAuthUser();
    const l = await run(dev, (s) => s.linkAccount(uid, 'prueba@ejemplo.test'));
    if (!l.success || l.result.status !== 'linked') throw new Error(`vinculación de ${name}: ${l.error || l.result.status}`);
    return { dev, uid };
}

// =========================================================================== a
section('a) La primera subida se encola UNA sola vez, también tras reiniciar');
{
    const { dev: A, uid } = await linkedFixture('a');
    const rows = sumCounts(await counts(A));
    const before = await outbox(A);
    let notified = 0;
    setOutboxCommitListener(() => { notified++; });
    use(A);
    const r1 = await quiet(() => engine.ensureInitialUpload(CFG));
    const ob1 = await outbox(A);
    const m = await meta(A);
    check('primera llamada: "done" y filas distintas en la outbox = filas de las 15 tablas',
        r1.status === 'done' && ob1.rows === rows && r1.enqueued === rows - before.rows, `filas ${rows}, encoladas ${r1.enqueued}, ya estaban ${before.rows}`);
    const summary = JSON.parse(m.initial_upload_summary || '{}');
    check('marca, uid y resumen (solo conteos por tabla) en sync_meta',
        !!m.initial_upload_done_at && m.initial_upload_uid === uid
        && Object.keys(summary).length === TABLES.length
        && Object.values(summary).every((c) => Object.keys(c).sort().join() === 'enqueued,rows' && Number.isInteger(c.rows) && Number.isInteger(c.enqueued)));
    const r2 = await quiet(() => engine.ensureInitialUpload(CFG));
    check('segunda llamada: "already" y la outbox no cambia', r2.status === 'already' && (await outbox(A)).raw === ob1.raw);
    const A2 = await restart(A);
    use(A2);
    const r3 = await quiet(() => engine.ensureInitialUpload(CFG));
    check('tras reiniciar (reabrir la BD): "already" y la outbox no cambia', r3.status === 'already' && (await outbox(A2)).raw === ob1.raw);
    check('no dispara el aviso de outbox de la sync automática (sin bucle)', notified === 0, `avisos ${notified}`);
    setOutboxCommitListener(null);
}

// Concurrencia con una mutación del usuario: las dos pasan por la cola de escrituras.
for (const order of ['prepare primero', 'mutación primero']) {
    const { dev: C } = await linkedFixture(`a-concurrente-${order === 'prepare primero' ? 1 : 2}`);
    const uid = (await one(C, 'SELECT id FROM users')).id;
    use(C);
    const prepare = () => engine.ensureInitialUpload(CFG);
    const mutation = () => C.svc.addBacklogItem(uid, { type: 'movie', title: 'concurrente', year: 2026 });
    let res;
    try {
        res = await quiet(() => (order === 'prepare primero' ? Promise.all([prepare(), mutation()]) : Promise.all([mutation(), prepare()]).then(([m, p]) => [p, m])));
    } catch (e) {
        res = [{ status: 'error' }, { success: false, error: String(e.message) }];
    }
    const added = await one(C, "SELECT id FROM backlog WHERE title = 'concurrente'");
    const entries = added ? (await one(C, "SELECT COUNT(*) n FROM outbox WHERE table_name = 'backlog' AND row_id = ?", [added.id])).n : -1;
    const ob = await outbox(C);
    check(`a) concurrente (${order}): ambas terminan, la fila nueva tiene 1 sola entrada y la outbox cubre todas las filas`,
        res[0].status === 'done' && res[1].success === true && entries === 1 && ob.rows === sumCounts(await counts(C)),
        `prepare ${res[0].status}, mutación ${res[1].success ? 'ok' : res[1].error}, entradas ${entries}`);
}

// =========================================================================== b
section('b) Sin red: encola igual; el ciclo queda "offline"/"skipped" y la outbox no se pierde');
{
    const { dev: B, uid } = await linkedFixture('b');
    const rows = sumCounts(await counts(B));
    T.uid = uid;
    T.offline = true;
    const runner = makeRunner();
    const o1 = await cycle(B, runner);
    const ob1 = await outbox(B);
    check('token válido sin red: encolado + ciclo "offline", outbox = filas, 0 bloqueadas',
        o1.status === 'offline' && ob1.rows === rows && !ob1.blocked, `${o1.status}, outbox ${ob1.rows}/${rows}`);
    T.sessionOffline = true;
    const o2 = await cycle(B, runner);
    check('sesión guardada que no se puede renovar sin red: "offline" (no "Inicia sesión"), outbox intacta',
        o2.status === 'offline' && o2.push.pushed === 0 && (await outbox(B)).raw === ob1.raw, o2.status);
    T.sessionOffline = false;
    const uidKeep = T.uid;
    T.uid = null;
    const o3 = await cycle(B, runner);
    check('sin sesión guardada: "skipped no-session", outbox intacta', o3.status === 'skipped' && o3.reason === 'no-session' && (await outbox(B)).raw === ob1.raw);
    T.uid = uidKeep;
    T.offline = false;
    use(B);
    await quiet(() => runner.request('reconexion'));
    const o4 = runner.state().lastOutcome;
    const ob4 = await outbox(B);
    const sc = await serverCounts(uid);
    check('al volver la red: "ok", outbox 0, 0 bloqueadas y servidor = local',
        o4.status === 'ok' && ob4.raw === 0 && o4.push.blocked === 0 && JSON.stringify(sc) === JSON.stringify(await counts(B)), `subidas ${o4.push?.pushed}`);
}

// =========================================================================== c
section('c) Sin vincular no encola; al vincular, el primer ciclo sí');
{
    const NL = await newDevice('c', FIXTURE);
    const V = await newAuthUser();
    T.uid = V;
    const runner = makeRunner();
    const o1 = await cycle(NL, runner);
    const ob1 = await outbox(NL);
    check('sin vincular: "skipped not-linked", outbox vacía y sin marca',
        o1.status === 'skipped' && o1.reason === 'not-linked' && ob1.raw === 0 && !(await meta(NL)).initial_upload_done_at);
    const l = await run(NL, (s) => s.linkAccount(V, 'prueba@ejemplo.test'));
    check('vinculación OK', l.success && l.result.status === 'linked');
    const o2 = await cycle(NL, runner);
    check('primer ciclo tras vincular: encola todo, sube y queda en 0',
        o2.status === 'ok' && o2.push.blocked === 0 && (await outbox(NL)).raw === 0 && !!(await meta(NL)).initial_upload_done_at
        && JSON.stringify(await serverCounts(V)) === JSON.stringify(await counts(NL)), `subidas ${o2.push?.pushed}`);
}

// =========================================================================== d, e, f
section('d/e/f) Celular con datos + tombstone del servidor → dispositivo vacío → convergen');
{
    let P, uid;
    if (existsSync(REAL)) {
        P = await newDevice('d-celular', REAL);
        uid = (await one(P, 'SELECT id FROM users')).id;
        await newAuthUser(uid);
    } else {
        ({ dev: P, uid } = await linkedFixture('d-celular'));
    }
    T.uid = uid;
    // Tombstone [prueba RLS] (como el que dejó la Fase 3 en producción), escrito como el usuario.
    const tomb = '00000000-0000-4000-8000-00000000f005';
    await T.upsert('backlog', [{ id: tomb, user_id: uid, type: 'movie', title: '[prueba RLS]', status: 'Pendiente', franchise: 'Otros',
        year: null, start_year: null, end_year: null, format: null, created_at: now, updated_at: now, deleted_at: now }]);
    const runner = makeRunner();
    const op = await cycle(P, runner);
    check('celular: primera subida OK, 0 bloqueadas, outbox 0', op.status === 'ok' && op.push.blocked === 0 && (await outbox(P)).raw === 0, `subidas ${op.push?.pushed}`);
    const sc = await serverCounts(uid);
    const lc = await counts(P);
    check('servidor = celular por tabla (incluido el tombstone que bajó)', JSON.stringify(sc) === JSON.stringify(lc));

    const E = await newDevice('d-vacio');
    await run(E, (s) => s.createLinkedUser(uid, 'prueba@ejemplo.test'));
    const runnerE = makeRunner();
    const oe = await cycle(E, runnerE);
    const catsP = (await all(P, 'SELECT id FROM finance_categories ORDER BY id')).map((r) => r.id).join();
    const catsE = (await all(E, 'SELECT id FROM finance_categories ORDER BY id')).map((r) => r.id).join();
    const srvCats = (await pg.query('select count(*)::int n from public.finance_categories where user_id = $1', [uid])).rows[0].n;
    check('d) vacío: las categorías por defecto convergen al id del servidor, sin duplicados',
        oe.status === 'ok' && oe.push.blocked === 0 && catsE === catsP && srvCats === lc.finance_categories.total, `fusionadas ${oe.merged}`);
    await cycle(P, runner); // vuelta en el celular (adopta fechas de las categorías del vacío)
    const cmp = compareSnapshots(snapshotDb(P.path), snapshotDb(E.path));
    check('celular vs vacío idénticos en las 15 tablas (comparar-sync) y mismo saldo', cmp.identical && cmp.balanceEqual,
        TABLES.filter((t) => !cmp.tables[t].same).join(','));

    const tombP = await one(P, 'SELECT deleted_at FROM backlog WHERE id = ?', [tomb]);
    const tombE = await one(E, 'SELECT deleted_at FROM backlog WHERE id = ?', [tomb]);
    let visible = 0;
    for (const dev of [P, E]) {
        for (const type of ['movie', 'series', 'anime', 'reading']) {
            use(dev);
            const r = await quiet(() => dev.svc.getBacklogItems(uid, type));
            visible += (Array.isArray(r) ? r : []).filter((x) => x.id === tomb).length;
        }
    }
    check('e) el tombstone llega como fila borrada y la fachada no lo muestra', !!tombP?.deleted_at && !!tombE?.deleted_at && visible === 0);

    const writes0 = T.rowsWritten;
    const f1 = await cycle(P, runner);
    const f2 = await cycle(E, runnerE);
    check('f) segunda sync en los dos: 0 escrituras remotas y locales',
        f1.status === 'ok' && f2.status === 'ok' && f1.remoteWrites + f1.localWrites + f2.remoteWrites + f2.localWrites === 0 && T.rowsWritten === writes0);
}

// =========================================================================== sesión real (auth-js)
section('Sesión con el auth-js REAL: sin red ≠ sin sesión; reconexión con el token vencido');
{
    const { dev: S, uid } = await linkedFixture('sesion');
    T.uid = uid;
    let online = false;
    let tokenCalls = 0;
    let rt = 0;
    const fakeFetch = async (url, init = {}) => {
        if (!online) throw new TypeError('Network request failed');
        if (String(url).includes('/token?grant_type=refresh_token')) {
            tokenCalls++;
            await sleep(30); // la petición tarda: da tiempo a que coincidan el autorrefresco y el ciclo
            rt++;
            return new Response(JSON.stringify({
                access_token: `acceso-${rt}`, refresh_token: `renovacion-${rt}`, token_type: 'bearer', expires_in: 3600,
                user: { id: uid, aud: 'authenticated', role: 'authenticated', email: 'prueba@ejemplo.test', app_metadata: {}, user_metadata: {}, created_at: now },
            }), { status: 200, headers: { 'content-type': 'application/json' } });
        }
        return new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } });
    };
    const memory = new Map();
    const storage = { getItem: async (k) => memory.get(k) ?? null, setItem: async (k, v) => { memory.set(k, v); }, removeItem: async (k) => { memory.delete(k); } };
    const newClient = () => new GoTrueClient({ url: 'http://auth.local/auth/v1', headers: {}, storage, storageKey: 'sb-prueba-auth-token',
        autoRefreshToken: false, persistSession: true, detectSessionInUrl: false, flowType: 'pkce', fetch: fakeFetch });
    // Transporte del ciclo: sesión del auth-js real (como supabaseTransport) + datos en PGlite.
    const transportOf = (auth) => ({ ...T, session: async () => {
        const s = await readSessionState(auth);
        return s.session ? { uid: s.session.user.id } : s.offline ? { offline: true } : null;
    } });

    // 3: sin sesión guardada y sin red → sigue pidiendo iniciar sesión.
    const empty = newClient();
    const s0 = await quiet(() => readSessionState(empty));
    const o0 = await quiet(() => engine.syncOnce(CFG, transportOf(empty)));
    check('sin sesión guardada y sin red: offline=false → "skipped no-session" ("Inicia sesión")', s0.session === null && s0.offline === false && o0.status === 'skipped' && o0.reason === 'no-session');

    // 3: con sesión guardada vencida y sin red → "sin conexión".
    const expired = Math.floor(Date.now() / 1000) - 3600;
    memory.set('sb-prueba-auth-token', JSON.stringify({ access_token: 'acceso-0', refresh_token: 'renovacion-0', token_type: 'bearer',
        expires_in: 3600, expires_at: expired, user: { id: uid, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: now } }));
    const auth = newClient();
    use(S);
    const runner = createSyncRunner({ config: () => CFG, transport: () => transportOf(auth), prepare: () => engine.ensureInitialUpload(CFG) });
    const s1 = await quiet(() => readSessionState(auth));
    await quiet(() => runner.request('apertura'));
    const o1 = runner.state().lastOutcome;
    const ob1 = await outbox(S);
    check('sesión guardada vencida y sin red: offline=true → ciclo "offline", outbox = filas, sesión conservada',
        s1.offline === true && o1.status === 'offline' && ob1.rows === sumCounts(await counts(S)) && memory.has('sb-prueba-auth-token'), o1.status);

    // Reconexión dentro del enfriamiento de auth-js (60 s tras el refresco fallido): sigue "offline".
    online = true;
    await quiet(() => runner.request('reconexion'));
    const o2 = runner.state().lastOutcome;
    check('reconexión dentro del enfriamiento de 60 s de auth-js: el ciclo queda "offline" sin tocar la outbox', o2.status === 'offline' && (await outbox(S)).raw === ob1.raw && tokenCalls === 0, `${o2.status}, /token ${tokenCalls}`);

    // Pasado el enfriamiento: el autorrefresco y el ciclo piden la sesión A LA VEZ.
    const realNow = Date.now;
    Date.now = () => realNow() + 61_000;
    let restored = 0;
    const unsub = subscribeSessionRestored(auth, () => {
        restored++;
        if (shouldSyncOnSessionRestored(runner.state().lastOutcome)) runner.request('sesion');
    });
    try {
        use(S);
        const [tick, s2] = await quiet(() => Promise.all([auth._autoRefreshTokenTick(), readSessionState(auth), readSessionState(auth)]));
        check('autorrefresco + getSession() simultáneos: UNA sola llamada a /token (sin lock en RN: refresco compartido)', tokenCalls === 1 && !!s2.session, `/token ${tokenCalls}`);
        // TOKEN_REFRESHED → aviso (fuera del callback) → ciclo 'sesion'.
        for (let i = 0; i < 100 && (restored === 0 || runner.state().syncing || runner.state().lastOutcome?.status !== 'ok'); i++) await sleep(20);
        const o3 = runner.state().lastOutcome;
        check('sesión restaurada → ciclo automático "ok", outbox 0 y 0 bloqueadas', restored >= 1 && o3.status === 'ok' && o3.push.blocked === 0 && (await outbox(S)).raw === 0,
            `avisos ${restored}, ${o3.status}`);
        await quiet(() => runner.request('boton'));
        check('ciclo siguiente con el token renovado: "ok" sin nuevas llamadas a /token', runner.state().lastOutcome.status === 'ok' && tokenCalls === 1);
    } finally {
        Date.now = realNow;
        unsub();
    }
    check('"sesion" reinicia el backoff de red; solo reintenta tras "offline" o sesión ausente/vencida',
        RESET_BACKOFF_REASONS.has('sesion') && !shouldSyncOnSessionRestored(null) && !shouldSyncOnSessionRestored({ status: 'ok' })
        && !shouldSyncOnSessionRestored({ status: 'disabled' }) && !shouldSyncOnSessionRestored({ status: 'timeout' })
        && !shouldSyncOnSessionRestored({ status: 'skipped', reason: 'not-linked' }) && !shouldSyncOnSessionRestored({ status: 'skipped', reason: 'other-account' })
        && shouldSyncOnSessionRestored({ status: 'offline' }) && shouldSyncOnSessionRestored({ status: 'skipped', reason: 'no-session' })
        && shouldSyncOnSessionRestored({ status: 'skipped', reason: 'session-expired' }));

    // Solo TOKEN_REFRESHED dispara el aviso (no SIGNED_IN, INITIAL_SESSION, USER_UPDATED ni SIGNED_OUT).
    let cb = null;
    const fakeAuth = { onAuthStateChange: (f) => { cb = f; return { data: { subscription: { unsubscribe() { cb = null; } } } }; } };
    let fired = 0;
    const off = subscribeSessionRestored(fakeAuth, () => { fired++; });
    const fakeSession = { user: { id: uid } };
    for (const ev of ['INITIAL_SESSION', 'SIGNED_IN', 'SIGNED_IN', 'USER_UPDATED', 'SIGNED_OUT']) cb(ev, ev === 'SIGNED_OUT' ? null : fakeSession);
    await sleep(20);
    const firedOthers = fired;
    cb('TOKEN_REFRESHED', fakeSession);
    cb('TOKEN_REFRESHED', null);
    await sleep(20);
    off();
    check('el aviso reacciona SOLO a TOKEN_REFRESHED con sesión', firedOthers === 0 && fired === 1 && cb === null, `otros ${firedOthers}, TOKEN_REFRESHED ${fired}`);

    // Pasa por request(): con la sync apagada no hace nada; muchos avisos seguidos → single-flight.
    const offRunner = createSyncRunner({ config: () => ({ ...CFG, enabled: false }), transport: () => transportOf(auth), prepare: () => engine.ensureInitialUpload(CFG) });
    check('con la sync apagada request("sesion") no hace nada', offRunner.request('sesion') === null && offRunner.state().lastOutcome === null);
    let cycles = 0, maxConcurrent = 0, current = 0;
    const counting = { ...transportOf(auth), session: async () => { current++; maxConcurrent = Math.max(maxConcurrent, current); cycles++; await sleep(30); current--; return { uid }; } };
    const burst = createSyncRunner({ config: () => CFG, transport: () => counting });
    use(S);
    await quiet(() => Promise.all(Array.from({ length: 5 }, () => burst.request('sesion'))));
    check('5 avisos seguidos → single-flight: a lo sumo 2 ciclos y nunca 2 a la vez', cycles <= 2 && maxConcurrent === 1, `ciclos ${cycles}`);
}

// =========================================================================== verificar-fase5.sql
section('verificar-fase5.sql: solo lectura, 16 filas, detecta más de un user_id');
{
    const text = readFileSync('supabase/verificar-fase5.sql', 'utf8');
    const code = text.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');
    check('sin INSERT/UPDATE/DELETE/DDL/GRANT (fuera de comentarios)', !/\b(insert|update|delete|alter|create|drop|truncate|grant|revoke|copy)\b/i.test(code));
    const fingerprint = async () => (await pg.query(`select ${TABLES.map((t) => `(select count(*) || ':' || coalesce(max(server_updated_at)::text, '') from public.${t})`).join(" || '|' || ")} as f`)).rows[0].f;
    const f0 = await fingerprint();
    const r = (await pg.query(text)).rows;
    check('16 filas: 15 tablas + TODAS, columnas sin contenido', r.length === 16 && r[15].tabla === 'TODAS'
        && Object.keys(r[0]).join() === 'tabla,total,vivos,borrados,usuarios_distintos,ok');
    check('servidor de prueba con varias cuentas → TODAS ok = false', r[15].ok === false && Number(r[15].usuarios_distintos) > 1);
    check('no escribe nada (huella del servidor igual)', (await fingerprint()) === f0);
    const { pg: pg1, T: T1, newAuthUser: nu1 } = await createServer();
    const W = await nu1();
    T1.uid = W;
    const one1 = await newDevice('sql-una-cuenta');
    await run(one1, (s) => s.createLinkedUser(W, 'prueba@ejemplo.test'));
    use(one1);
    await quiet(() => engine.ensureInitialUpload(CFG));
    await quiet(() => engine.syncOnce(CFG, T1));
    const r1 = (await pg1.query(text)).rows;
    check('una sola cuenta → TODAS ok = true y conteos = local', r1[15].ok === true && Number(r1[15].usuarios_distintos) === 1
        && Number(r1.find((x) => x.tabla === 'finance_categories').total) === 6 && r1.slice(0, 15).every((x) => x.ok === true));
}

console.log(failures === 0 ? '\nFASE 5: TODO OK.' : `\n${failures} verificación(es) fallaron.`);
process.exit(failures === 0 ? 0 : 1);
