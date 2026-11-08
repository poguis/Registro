// Fase 6.5 — pulido visible: pruebas en PC con el código real de src/ (nunca toca un proyecto
// remoto ni imprime filas). Uso: node scripts/probar-fase6-5.mjs
//   1. Indicador: tabla de describeSyncStatus + controlador con NetInfo simulado (avisos a la UI
//      sin ciclos extra).
//   2. Cerrar sesión: GoTrueClient REAL de @supabase/auth-js + LargeSecureStore real (sobre los
//      stubs de AsyncStorage/SecureStore): sin red con token vencido la sesión se conserva; al
//      pulsar "Cerrar sesión" sin red se borra (clave tomada del cliente), sin resucitar por una
//      renovación en curso, y los datos locales quedan intactos.
//   3. Respaldo: meta.backupDirFiles (nombre, tamaño, fecha) y validar-respaldo con v2 y v1.
//   4. getEntertainmentCategories: equivalencia con la versión anterior (N+1) y nº fijo de consultas.
//   5. Pull: applyPullFilter, mismas páginas con empates de server_updated_at, plan con rango.
// Los archivos de trabajo van a un directorio temporal del sistema (no a .local-data/); el
// fixture de PRUEBA .local-data/emulador-antes.db solo se copia.
import './lib/test-hooks.mjs';
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const { createDevices, quiet, getConnection, TABLES } = await import('./lib/sync-devices.mjs');
const { describeSyncStatus, pendingLabel } = await import('../src/sync/syncStatusText.ts');
const { signOutLocally, forceLocalSignOut, sessionStorageKeyOf } = await import('../src/auth/signOutLocal.ts');
const { readSessionState } = await import('../src/auth/sessionState.ts');
const { LargeSecureStore } = await import('../src/auth/secureStorage.ts');
const { asyncStore, secureStore, constantsState } = await import('./lib/auth-stubs.mjs');
const { applyPullFilter } = await import('../src/sync/supabaseTransport.ts');
const { createPgliteTransport } = await import('./lib/pglite-transport.mjs');
const { GoTrueClient } = require('@supabase/auth-js');
const { PGlite } = await import('@electric-sql/pglite');

let failures = 0;
const check = (name, ok, detail = '') => {
    console.log(`${ok ? 'OK  ' : 'FALLA'} ${name}${detail ? ` — ${detail}` : ''}`);
    if (!ok) failures++;
};
const section = (t) => console.log(`\n== ${t} ==`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (v) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
// Como quiet() de sync-devices, pero también silencia console.warn (auth-js escribe ahí sus
// errores de red). Nunca se anida en paralelo.
const hush = async (fn) => {
    const { log, error, warn } = console;
    console.log = () => {}; console.error = () => {}; console.warn = () => {};
    try { return await fn(); } finally { console.log = log; console.error = error; console.warn = warn; }
};

const WORK = join(tmpdir(), 'registro-pruebas-fase6-5').replace(/\\/g, '/');
rmSync(WORK, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });
const FIXTURE = '.local-data/emulador-antes.db'; // datos de PRUEBA (1 cuenta)
if (!existsSync(FIXTURE)) { console.log(`FALLA falta ${FIXTURE}`); process.exit(1); }
const D = createDevices(WORK);

// =========================================================================== 1. indicador
section('1. Indicador: describeSyncStatus (tabla)');
{
    const NOW = Date.parse('2026-11-08T12:00:00Z');
    const okOutcome = { status: 'ok' };
    const base = { connected: true, pending: 0, syncing: false, outcome: okOutcome, lastSuccessAt: '2026-11-08T11:55:00Z', nowMs: NOW };
    const cases = [
        ['con red, sin pendientes, último ciclo OK', {}, 'Sincronizado hace 5 min', 'ok'],
        ['con red, último ciclo hace segundos', { lastSuccessAt: '2026-11-08T11:59:50Z' }, 'Sincronizado hace un momento', 'ok'],
        ['con red y 1 pendiente (nunca "Sincronizado")', { pending: 1 }, 'Sincronizando…', 'syncing'],
        ['con red y 3 pendientes', { pending: 3 }, 'Sincronizando…', 'syncing'],
        ['ciclo en curso', { syncing: true }, 'Sincronizando…', 'syncing'],
        ['sin red, 0 pendientes', { connected: false }, 'Sin conexión', 'offline'],
        ['sin red, 1 pendiente', { connected: false, pending: 1 }, 'Sin conexión — 1 cambio pendiente', 'offline'],
        ['sin red, 4 pendientes', { connected: false, pending: 4 }, 'Sin conexión — 4 cambios pendientes', 'offline'],
        ['sin red con un ciclo en curso', { connected: false, syncing: true, pending: 2 }, 'Sin conexión — 2 cambios pendientes', 'offline'],
        ['H1: sin red y sesión vencida (ciclo "offline"): no pide iniciar sesión', { connected: false, outcome: { status: 'offline' }, pending: 2 }, 'Sin conexión — 2 cambios pendientes', 'offline'],
        ['sin red y ciclo omitido sin sesión: tampoco pide iniciar sesión', { connected: false, outcome: { status: 'skipped', reason: 'no-session' } }, 'Sin conexión', 'offline'],
        ['NetInfo con red pero ciclo "offline" (enfriamiento de auth-js)', { outcome: { status: 'offline' }, pending: 1 }, 'Sin conexión — 1 cambio pendiente', 'offline'],
        ['NetInfo con red, ciclo "offline", 0 pendientes', { outcome: { status: 'offline' } }, 'Sin conexión', 'offline'],
        ['con red, sin sesión', { outcome: { status: 'skipped', reason: 'no-session' } }, 'Inicia sesión con Google para sincronizar', 'signin'],
        ['con red, sesión vencida', { outcome: { status: 'skipped', reason: 'session-expired' } }, 'Inicia sesión con Google para sincronizar', 'signin'],
        ['con red, otra cuenta', { outcome: { status: 'skipped', reason: 'other-account' } }, 'Inicia sesión con Google para sincronizar', 'signin'],
        ['con red, sin vincular', { outcome: { status: 'skipped', reason: 'not-linked' } }, 'Vincula tu cuenta para sincronizar', 'link'],
        ['watchdog, sin pendientes', { outcome: { status: 'timeout' } }, 'La sincronización tardó demasiado; se reintentará', 'timeout'],
        ['watchdog, 1 pendiente', { outcome: { status: 'timeout' }, pending: 1 }, 'La sincronización tardó demasiado; se reintentará · 1 cambio pendiente', 'timeout'],
        ['watchdog, 2 pendientes', { outcome: { status: 'timeout' }, pending: 2 }, 'La sincronización tardó demasiado; se reintentará · 2 cambios pendientes', 'timeout'],
        ['NetInfo desconocido (null), sin pendientes', { connected: null }, 'Sincronizado hace 5 min', 'ok'],
        ['NetInfo desconocido (null), con pendientes', { connected: null, pending: 2 }, 'Sincronizando…', 'syncing'],
        ['nunca sincronizado, sin pendientes', { outcome: null, lastSuccessAt: null }, 'Aún no sincronizado', 'idle'],
        ['hace horas', { lastSuccessAt: '2026-11-08T09:00:00Z' }, 'Sincronizado hace 3 h', 'ok'],
        ['hace días', { lastSuccessAt: '2026-11-06T12:00:00Z' }, 'Sincronizado hace 2 d', 'ok'],
    ];
    let bad = [];
    for (const [name, over, text, kind] of cases) {
        const r = describeSyncStatus({ ...base, ...over });
        if (r.text !== text || r.kind !== kind) bad.push(`${name}: "${r.text}" (${r.kind})`);
    }
    check(`describeSyncStatus: ${cases.length} casos con el texto y el tipo esperados`, bad.length === 0, bad.join(' | '));
    const all = cases.map(([, over]) => describeSyncStatus({ ...base, ...over }).text).join('\n');
    check('ningún texto dice "pendiente(s)" ni "cambio(s)"', !/\(s\)/.test(all));
    check('pendingLabel: 1 → singular, 0/2 → plural', pendingLabel(1) === '1 cambio pendiente' && pendingLabel(2) === '2 cambios pendientes' && pendingLabel(0) === '0 cambios pendientes');
    const withPending = cases.filter(([, o]) => (o.pending || 0) > 0).map(([, o]) => describeSyncStatus({ ...base, ...o }).text);
    check('con pendientes nunca dice "Sincronizado"', withPending.every((t) => !t.startsWith('Sincronizado')), `${withPending.length} casos`);
}

section('1. Indicador: el controlador avisa a la UI (NetInfo y commits) sin ciclos extra');
{
    // Variante con la sync encendida pero sin proyecto configurado: getSupabase() = null, así que
    // cada ciclo termina "omitido" sin tocar la red.
    constantsState.expoConfig = { extra: { syncEnabled: true, supabase: { url: null, key: null } } };
    const dev = await D.newDevice('controlador', FIXTURE);
    D.use(dev);
    const controller = await import('../src/sync/controller.ts');
    let notices = 0;
    let cycleStarts = 0;
    let wasSyncing = false;
    const unsub = controller.subscribe(() => {
        notices++;
        const s = controller.getControllerState().syncing;
        if (s && !wasSyncing) cycleStarts++;
        wasSyncing = s;
    });
    const waitIdle = async () => { for (let i = 0; i < 100 && controller.getControllerState().syncing; i++) await sleep(20); };
    const stop = await quiet(async () => controller.startSyncTriggers());
    await waitIdle();
    await sleep(50);
    const startsAfterOpen = cycleStarts;
    check('al abrir: 1 ciclo ("apertura"), conectividad desconocida (null)', startsAfterOpen === 1 && controller.getConnectivity() === null, `ciclos ${startsAfterOpen}`);

    let n0 = notices;
    globalThis.__netInfoEmit(false);
    check('NetInfo → sin red: la UI recibe aviso y getConnectivity() = false, sin ciclo', notices === n0 + 1 && controller.getConnectivity() === false && cycleStarts === startsAfterOpen,
        `avisos +${notices - n0}, ciclos ${cycleStarts}`);
    n0 = notices;
    globalThis.__netInfoEmit(false);
    check('mismo estado de NetInfo otra vez: sin aviso', notices === n0);

    const users = await D.one(dev, 'SELECT id FROM users LIMIT 1');
    n0 = notices;
    const add = await D.run(dev, (s) => s.addBacklogItem(users.id, { type: 'movie', title: '[prueba F6.5] indicador' }));
    await sleep(3300); // más que el antirrebote de 3 s de autoSync
    check('commit que encola sin red: la UI recibe aviso; ningún ciclo (ni tras el antirrebote)',
        add.success && notices >= n0 + 1 && cycleStarts === startsAfterOpen, `avisos +${notices - n0}, ciclos ${cycleStarts}`);

    n0 = notices;
    await quiet(async () => { globalThis.__netInfoEmit(true); await sleep(10); await waitIdle(); });
    check('NetInfo → con red: aviso y el ciclo de "reconexion" de siempre (uno)', controller.getConnectivity() === true && notices > n0 && cycleStarts === startsAfterOpen + 1, `ciclos ${cycleStarts}`);
    stop();
    unsub();
    check('al detener los disparadores, la conectividad vuelve a null', controller.getConnectivity() === null);
    constantsState.expoConfig = null;
}

// =========================================================================== 2. sesión
section('2. Cerrar sesión: auth-js REAL + LargeSecureStore (sin red, token vencido, renovación en curso)');
{
    const dev = await D.newDevice('sesion', FIXTURE);
    const localSnapshot = async () => {
        const out = {};
        for (const t of [...TABLES, 'outbox', 'users', 'sync_meta', 'sync_state']) out[t] = sha(await D.all(dev, `SELECT * FROM ${t} ORDER BY rowid`));
        return sha(out);
    };
    const local0 = await localSnapshot();
    const uid = randomUUID();
    const now = new Date().toISOString();
    const userJson = { id: uid, aud: 'authenticated', role: 'authenticated', email: 'prueba@ejemplo.test', app_metadata: {}, user_metadata: {}, created_at: now };
    const net = { online: false, tokenGate: null, tokenCalls: 0, logoutCalls: 0 };
    const fakeFetch = async (url) => {
        const u = String(url);
        if (u.includes('/token?grant_type=refresh_token')) {
            net.tokenCalls++;
            if (net.tokenGate) await net.tokenGate.promise;
            if (!net.online) throw new TypeError('Network request failed');
            return new Response(JSON.stringify({ access_token: `acceso-${net.tokenCalls}`, refresh_token: `renovacion-${net.tokenCalls}`, token_type: 'bearer', expires_in: 3600, user: userJson }),
                { status: 200, headers: { 'content-type': 'application/json' } });
        }
        if (!net.online) throw new TypeError('Network request failed');
        if (u.includes('/logout')) { net.logoutCalls++; return new Response(null, { status: 204 }); }
        return new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } });
    };
    const STORAGE_KEY = 'sb-prueba65-auth-token';
    const newClient = () => new GoTrueClient({ url: 'http://auth.local/auth/v1', headers: {}, storage: LargeSecureStore, storageKey: STORAGE_KEY,
        autoRefreshToken: false, persistSession: true, detectSessionInUrl: false, flowType: 'pkce', fetch: fakeFetch });
    const storeSession = async (expiresAt) => LargeSecureStore.setItem(STORAGE_KEY, JSON.stringify({ access_token: 'acceso-0', refresh_token: 'renovacion-0',
        token_type: 'bearer', expires_in: 3600, expires_at: expiresAt, user: userJson }));
    const expired = () => Math.floor(Date.now() / 1000) - 3600;
    const valid = () => Math.floor(Date.now() / 1000) + 3600;
    // "Ninguna clave de sesión": ni el cifrado (AsyncStorage) ni la llave (SecureStore), ni -user.
    const sessionKeysLeft = () => [...asyncStore.keys()].filter((k) => k.startsWith(STORAGE_KEY))
        .concat([...secureStore.keys()].filter((k) => k.startsWith(STORAGE_KEY)));
    const resetStores = () => { asyncStore.clear(); secureStore.clear(); };
    const events = (auth) => { const list = []; auth.onAuthStateChange((e) => { list.push(e); }); return list; };

    // La clave sale de la configuración real del cliente.
    const probe = newClient();
    check('la clave de sesión se toma del cliente de auth-js (storageKey configurado)', sessionStorageKeyOf(probe) === STORAGE_KEY, String(sessionStorageKeyOf(probe)));
    {
        // Y en la app es la que supabase-js le pone a su cliente (createClient REAL, sin red al crearlo).
        const supabaseJs = require(join(process.cwd(), 'node_modules/@supabase/supabase-js/dist/index.cjs'));
        const mem = new Map();
        const client = supabaseJs.createClient('https://abcdefghij.supabase.co', 'sb_publishable_prueba', {
            auth: { storage: { getItem: async (k) => mem.get(k) ?? null, setItem: async (k, v) => { mem.set(k, v); }, removeItem: async (k) => { mem.delete(k); } },
                autoRefreshToken: false, persistSession: true, detectSessionInUrl: false },
        });
        check('en un cliente real de supabase-js, la clave es la de su configuración (sb-<ref>-auth-token)', sessionStorageKeyOf(client.auth) === 'sb-abcdefghij-auth-token', String(sessionStorageKeyOf(client.auth)));
    }

    // (a) Sin red y con el token vencido, la sesión NO se cierra sola.
    resetStores();
    await storeSession(expired());
    // El constructor de auth-js arranca su carga inicial (y escribe el error de red en consola):
    // se crea dentro de hush() y se espera a que termine.
    const a = await hush(async () => { const c = newClient(); await sleep(50); return c; });
    const reads = [];
    for (let i = 0; i < 3; i++) reads.push(await hush(() => readSessionState(a)));
    const stillStored = (await LargeSecureStore.getItem(STORAGE_KEY)) !== null;
    check('sin red + token vencido: 3 lecturas → "offline" y la sesión sigue guardada (no hay cierre automático)',
        reads.every((r) => r.session === null && r.offline === true) && stillStored, `tokenCalls ${net.tokenCalls}`);

    // (b) "Cerrar sesión" sin red con el token vencido: se borra igual.
    // onAuthStateChange emite INITIAL_SESSION y auth-js escribe en consola el error de red: dentro de hush().
    const evB = await hush(async () => { const l = events(a); await sleep(50); return l; });
    const rB = await hush(() => signOutLocally(a, LargeSecureStore));
    const sB = await hush(() => a.getSession());
    // (auth-js escribe en consola el error de red del primer intento; hush() lo oculta)
    const stB = await hush(() => readSessionState(newClient()));
    check('Cerrar sesión sin red + token vencido: forzado, sesión borrada, getSession() = null',
        rB.forced && rB.cleared && sB.data.session === null && stB.session === null && stB.offline === false, JSON.stringify(rB));
    check('…sin ninguna clave de sesión en el almacenamiento (AsyncStorage ni SecureStore)', sessionKeysLeft().length === 0, sessionKeysLeft().join(','));
    check('…y auth-js emitió SIGNED_OUT (la UI pasa a "sin sesión")', evB.includes('SIGNED_OUT'), evB.join(','));
    check('…los datos locales (15 tablas, outbox, users, sync_meta, sync_state) quedan intactos', (await localSnapshot()) === local0);

    // (c) Sin red con el token vigente: auth-js ya la borra (el fallo de /logout no es de API) y
    // devuelve el error de red; el paso forzado que sigue no encuentra nada que borrar.
    resetStores();
    await storeSession(valid());
    const c = newClient();
    const rC = await hush(() => signOutLocally(c, LargeSecureStore));
    check('Cerrar sesión sin red + token vigente: borrada (auth-js ya la borra; el paso forzado no cambia nada)', rC.cleared && sessionKeysLeft().length === 0, JSON.stringify(rC));

    // (d) Con red: /logout y borrada sin forzar.
    resetStores();
    net.online = true;
    await storeSession(valid());
    const d = newClient();
    const logout0 = net.logoutCalls;
    const rD = await hush(() => signOutLocally(d, LargeSecureStore));
    check('Cerrar sesión con red: llama a /logout y la borra sin forzar', !rD.forced && rD.cleared && net.logoutCalls === logout0 + 1 && sessionKeysLeft().length === 0, JSON.stringify(rD));

    // (e) Renovación en curso que se une al cierre (con red): termina sin sesión.
    resetStores();
    await storeSession(expired());
    const e = newClient();
    // Un solo hush() alrededor de todo el bloque concurrente (hush() anidados en paralelo
    // dejarían console.log silenciado).
    await hush(async () => {
        net.tokenGate = Promise.withResolvers();
        const pRefresh = e.getSession();
        await sleep(20);
        const pOut = signOutLocally(e, LargeSecureStore);
        await sleep(20);
        net.tokenGate.resolve();
        await Promise.all([pRefresh, pOut]);
        net.tokenGate = null;
        await sleep(50);
    });
    check('renovación automática en curso durante el cierre (con red): la sesión no vuelve a guardarse',
        sessionKeysLeft().length === 0 && (await hush(() => e.getSession())).data.session === null);

    // (f) Renovación en curso que termina BIEN después del borrado forzado: el commit guard de
    // auth-js (_sessionRemovalEpoch, subido por el segundo signOut) descarta la sesión nueva.
    resetStores();
    await storeSession(expired());
    const f = newClient();
    const rF = await hush(async () => {
        net.tokenGate = Promise.withResolvers();
        const pRefreshF = f.getSession(); // refresco en vuelo
        await sleep(20);
        const r = await forceLocalSignOut(f, LargeSecureStore); // pasos 2–3 mientras tanto
        net.tokenGate.resolve(); // el refresco termina bien DESPUÉS del borrado
        await pRefreshF;
        net.tokenGate = null;
        await sleep(50);
        return r;
    });
    check('renovación en curso que termina después del borrado forzado: no resucita la sesión',
        rF.cleared && sessionKeysLeft().length === 0 && (await hush(() => newClient().getSession())).data.session === null, `tokenCalls ${net.tokenCalls}`);

    // (g) Lo mismo sin red: la renovación en curso falla y el cierre se completa.
    resetStores();
    net.online = false;
    await storeSession(expired());
    const g = newClient();
    const rG = await hush(async () => {
        net.tokenGate = Promise.withResolvers();
        const pRefreshG = g.getSession();
        await sleep(20);
        const pOutG = signOutLocally(g, LargeSecureStore);
        await sleep(20);
        net.tokenGate.resolve();
        const [, r] = await Promise.all([pRefreshG, pOutG]);
        net.tokenGate = null;
        return r;
    });
    check('renovación en curso sin red durante el cierre: forzado y sin sesión', rG.forced && rG.cleared && sessionKeysLeft().length === 0, JSON.stringify(rG));
    check('los datos locales siguen intactos tras todos los cierres', (await localSnapshot()) === local0);
    resetStores();
}

// =========================================================================== 3. respaldo
section('3. Respaldo: listado de respaldos/ (formato 2) y validar-respaldo con v2 y v1');
{
    const dev = await D.newDevice('respaldo', FIXTURE);
    D.use(dev);
    const backupDir = `${WORK}/respaldo/respaldos`;
    mkdirSync(backupDir, { recursive: true });
    writeFileSync(`${backupDir}/registro_pre-migracion-v2_20261025-100000.db`, Buffer.alloc(1234, 1));
    writeFileSync(`${backupDir}/registro_pre-vinculacion_20261101-120000.db`, Buffer.alloc(4321, 2));
    const backup = await import('../src/services/backup.js');
    const bk = await quiet(() => backup.createBackup());
    const meta = JSON.parse(readFileSync(bk.json.path, 'utf8')).meta;
    const list = meta.backupDirFiles || [];
    const byName = Object.fromEntries(list.map((f) => [f.name, f]));
    check('formatVersion 2 y backupDirFiles es un array', meta.formatVersion === 2 && Array.isArray(meta.backupDirFiles), `v${meta.formatVersion}`);
    check('lista las copias pre-migración y pre-vinculación con su tamaño real',
        byName['registro_pre-migracion-v2_20261025-100000.db']?.size === 1234 && byName['registro_pre-vinculacion_20261101-120000.db']?.size === 4321);
    check('cada entrada tiene SOLO nombre, tamaño y fecha ISO (sin contenido)',
        list.length >= 3 && list.every((f) => JSON.stringify(Object.keys(f).sort()) === '["modifiedAt","name","size"]' && !Number.isNaN(Date.parse(f.modifiedAt))),
        `${list.length} archivo(s)`);
    check('el listado coincide con los archivos de respaldos/ al crear el JSON (el .json no se lista a sí mismo)',
        list.map((f) => f.name).join('|') === readdirSync(backupDir).filter((n) => n !== bk.json.path.split('/').pop()).sort((x, y) => x.localeCompare(y)).join('|'));

    const validate = (jsonPath) => spawnSync(process.execPath, ['scripts/validar-respaldo.mjs', jsonPath, '--db', bk.physical.path, '--out', `${WORK}/validado.sqlite`, '--overwrite'], { encoding: 'utf8' });
    const v2 = validate(bk.json.path);
    check('validar-respaldo acepta el formato 2', v2.status === 0 && /Listado de respaldos\/ \(solo nombre, tamaño y fecha\)/.test(v2.stdout), `exit ${v2.status}`);
    const original = JSON.parse(readFileSync(bk.json.path, 'utf8'));
    const v1Json = { ...original, meta: { ...original.meta, formatVersion: 1 } };
    delete v1Json.meta.backupDirFiles;
    writeFileSync(`${WORK}/respaldo-v1.json`, JSON.stringify(v1Json));
    const v1 = validate(`${WORK}/respaldo-v1.json`);
    check('validar-respaldo acepta un respaldo antiguo (formato 1, sin el campo)', v1.status === 0 && /formato 1: sin listado/.test(v1.stdout), `exit ${v1.status}`);
    const badJson = { ...original, meta: { ...original.meta, backupDirFiles: [{ name: 'x.db', size: 1, modifiedAt: null, contenido: 'no' }] } };
    writeFileSync(`${WORK}/respaldo-malo.json`, JSON.stringify(badJson));
    const bad = validate(`${WORK}/respaldo-malo.json`);
    check('validar-respaldo rechaza un listado con campos de más (contenido)', bad.status !== 0);
}

// =========================================================================== 4. entretenimiento
section('4. getEntertainmentCategories: mismo resultado que la versión anterior y nº fijo de consultas');
{
    const dev = await D.newDevice('entretenimiento', FIXTURE);
    D.use(dev);
    const user = (await D.one(dev, 'SELECT id FROM users LIMIT 1')).id;
    const other = randomUUID();
    const t0 = Date.parse('2026-01-01T00:00:00Z');
    let tick = 0;
    const ts = () => new Date(t0 + (tick++) * 1000).toISOString();
    const ins = async (table, row) => {
        const r = { id: randomUUID(), created_at: ts(), updated_at: ts(), ...row };
        const cols = Object.keys(r);
        await D.sql(dev, `INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, cols.map((c) => r[c]));
        return r.id;
    };
    const days = JSON.stringify({ Monday: 1, Tuesday: 2, Wednesday: 0, Thursday: 1, Friday: 1, Saturday: 0, Sunday: 0 });
    // 3 categorías del usuario (una borrada), 1 de otro usuario; series con y sin temporadas,
    // borradas, estados cerrados, cycle_offset; cuotas con empates de start_date; pausas abiertas.
    const cats = [];
    for (let i = 0; i < 3; i++) cats.push(await ins('entertainment_categories', { user_id: user, name: `[F6.5] cat ${i}`, type: i % 2 ? 'reading' : 'video', start_date: '2026-01-01', days_of_week: days, frequency: 1 }));
    await ins('entertainment_categories', { user_id: user, name: '[F6.5] borrada', type: 'video', days_of_week: days, deleted_at: ts() });
    const otherCat = await ins('entertainment_categories', { user_id: other, name: '[F6.5] ajena', type: 'video', days_of_week: days });
    for (const [ci, cat] of cats.entries()) {
        for (const start of ['2026-03-01', '2026-01-01', '2026-03-01', '2026-02-01']) await ins('entertainment_quotas_history', { user_id: user, category_id: cat, quotas: days, start_date: start, end_date: null });
        await ins('entertainment_quotas_history', { user_id: user, category_id: cat, quotas: days, start_date: '2026-01-15', deleted_at: ts() });
        await ins('entertainment_pauses', { user_id: user, category_id: cat, pause_start: '2026-02-10', pause_end: '2026-02-12' });
        await ins('entertainment_pauses', { user_id: user, category_id: cat, pause_start: '2026-01-05', pause_end: ci === 0 ? null : '2026-01-06' });
        await ins('entertainment_pauses', { user_id: user, category_id: cat, pause_start: '2026-01-01', pause_end: null, deleted_at: ts() });
        const statuses = ['Mirando', 'Terminado', 'En espera', 'Pausado'];
        for (let s = 0; s < 4; s++) {
            const ser = await ins('series', { user_id: user, category_id: cat, name: `[F6.5] serie ${ci}-${s}`, status: statuses[s], current_season: 2 + (s % 2), current_episode: 3 + s,
                initial_season: s === 3 ? 2 : 1, initial_episode: 1 + (s % 3), cycle_offset: s === 2 ? 7 : 0 });
            if (s !== 1) for (let n = 1; n <= 3; n++) await ins('seasons', { user_id: user, series_id: ser, season_number: n, episode_count: 10 + n + s, deleted_at: n === 3 && s === 2 ? ts() : null });
        }
        await ins('series', { user_id: user, category_id: cat, name: '[F6.5] serie borrada', status: 'Mirando', current_season: 5, current_episode: 5, deleted_at: ts() });
    }
    await ins('entertainment_quotas_history', { user_id: other, category_id: otherCat, quotas: days, start_date: '2026-01-01' });
    await ins('series', { user_id: other, category_id: otherCat, name: '[F6.5] ajena', status: 'Mirando', current_season: 2, current_episode: 2 });

    // Copia de referencia de getEntertainmentCategories en f3772d9. Verificada idéntica (JSON byte a
    // byte) contra el original de git show f3772d9 el 2026-11-08 en 3 casos: usuario con 5
    // categorías, otro usuario y usuario sin datos.
    const parseJson = (value, fallback) => {
        if (typeof value !== 'string') return value ?? fallback;
        try { return JSON.parse(value || 'null') ?? fallback; } catch { return fallback; }
    };
    const refGetEntertainmentCategories_f3772d9 = async (userId) => {
        const db = getConnection();
        const categories = await db.getAllAsync('SELECT * FROM entertainment_categories WHERE user_id = ? AND deleted_at IS NULL ORDER BY created_at DESC', [userId]);
        return Promise.all(categories.map(async (cat) => {
            const quotasHistory = await db.getAllAsync('SELECT quotas, start_date, end_date FROM entertainment_quotas_history WHERE category_id = ? AND deleted_at IS NULL ORDER BY start_date ASC', [cat.id]);
            const seriesList = await db.getAllAsync('SELECT id, current_season, current_episode, initial_season, initial_episode, status, cycle_offset FROM series WHERE category_id = ? AND deleted_at IS NULL', [cat.id]);
            let totalWatched = 0;
            for (const s of seriesList) {
                const seasons = await db.getAllAsync('SELECT season_number, episode_count FROM seasons WHERE series_id = ? AND deleted_at IS NULL', [s.id]);
                const getAbs = (seasonNum, episodeNum) => {
                    let count = 0;
                    for (let i = 1; i < seasonNum; i++) { const sea = seasons.find((se) => se.season_number === i); count += sea ? sea.episode_count : 0; }
                    return count + (episodeNum - 1);
                };
                let diff = getAbs(s.current_season, s.current_episode) - getAbs(s.initial_season || 1, s.initial_episode || 1);
                if (s.status === 'Terminado' || s.status === 'En espera') diff += 1;
                totalWatched += (diff > 0 ? diff : 0) + (s.cycle_offset || 0);
            }
            const pauses = await db.getAllAsync('SELECT pause_start, pause_end FROM entertainment_pauses WHERE category_id = ? AND deleted_at IS NULL', [cat.id]);
            return { ...cat, days_of_week: parseJson(cat.days_of_week, []), totalWatched, pauses,
                quotas_history: quotasHistory.map((qh) => ({ ...qh, quotas: parseJson(qh.quotas, {}) })), is_paused: pauses.some((p) => !p.pause_end) };
        }));
    };
    const { getEntertainmentCategories } = await import('../src/data/repositories/entertainment.ts');
    const conn = getConnection();
    const realGetAll = conn.getAllAsync.bind(conn);
    let queries = 0;
    conn.getAllAsync = (...args) => { queries++; return realGetAll(...args); };
    const nobodyId = randomUUID();
    queries = 0; const before = await refGetEntertainmentCategories_f3772d9(user); const oldQueries = queries;
    queries = 0; const after = await getEntertainmentCategories(user); const newQueries = queries;
    queries = 0; const otherRes = await getEntertainmentCategories(other); const otherQueries = queries;
    queries = 0; const nobody = await getEntertainmentCategories(nobodyId); const nobodyQueries = queries;
    conn.getAllAsync = realGetAll;
    const otherRef = await refGetEntertainmentCategories_f3772d9(other);
    const nobodyRef = await refGetEntertainmentCategories_f3772d9(nobodyId);
    // Primera diferencia (índice de categoría y clave), sin imprimir contenido.
    const firstDiff = (x, y) => {
        if (x.length !== y.length) return `longitud ${x.length} vs ${y.length}`;
        for (let i = 0; i < x.length; i++) for (const k of new Set([...Object.keys(x[i]), ...Object.keys(y[i])])) {
            if (JSON.stringify(x[i][k]) !== JSON.stringify(y[i][k])) return `categoría ${i}, clave ${k}`;
        }
        return null;
    };
    // Igualdad del resultado COMPLETO de cada caso (todas las categorías, incluidas las del fixture).
    const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
    const diffNote = (x, y) => (firstDiff(x, y) ? `; difiere: ${firstDiff(x, y)}` : '');
    check('usuario: resultado completo idéntico a la referencia f3772d9 (todas sus categorías)',
        same(after, before), `${after.length} categorías; totalWatched ${after.map((c) => c.totalWatched).join('/')}${diffNote(after, before)}`);
    check('otro usuario: resultado completo idéntico a la referencia f3772d9', same(otherRes, otherRef), `${otherRes.length} categoría(s)${diffNote(otherRes, otherRef)}`);
    check('usuario sin datos: resultado completo idéntico a la referencia f3772d9 (lista vacía)', same(nobody, nobodyRef) && nobody.length === 0);
    // Suposiciones de conteo sobre los datos sembrados (el fixture trae sus propias categorías).
    const mine = after.filter((c) => cats.includes(c.id));
    check('las 3 categorías sembradas están, con empates de start_date (4 cuotas) y una pausa abierta (is_paused)',
        mine.length === 3 && mine.some((c) => c.is_paused) && mine.every((c) => c.quotas_history.length === 4));
    check(`número fijo de consultas: 5 (antes ${oldQueries} con ${before.length} categorías)`, newQueries === 5 && otherQueries === 5 && oldQueries > 5, `nueva ${newQueries}, otro usuario ${otherQueries}`);
    check('sin categorías: 1 consulta y lista vacía', nobody.length === 0 && nobodyQueries === 1);
}

// =========================================================================== 5. pull
section('5. Pull: filtro redundante server_updated_at >= cursor (mismas páginas, plan con rango)');
{
    // applyPullFilter con un constructor falso que registra las llamadas.
    const rec = () => { const calls = []; const q = { gte: (c, v) => { calls.push(['gte', c, v]); return q; }, or: (f) => { calls.push(['or', f]); return q; } }; return { q, calls }; };
    const after = { ts: '2026-11-07T22:23:45.275407+00:00', id: '00000000-0000-4000-8000-000000000001' };
    const r1 = rec(); applyPullFilter(r1.q, { since: null, after });
    const r2 = rec(); applyPullFilter(r2.q, { since: '2026-11-07T22:00:00.000Z', after: null });
    const r3 = rec(); applyPullFilter(r3.q, { since: null, after: null });
    check('con cursor: gte(server_updated_at, cursor.ts) + el MISMO or() de antes',
        JSON.stringify(r1.calls) === JSON.stringify([['gte', 'server_updated_at', after.ts],
            ['or', `server_updated_at.gt."${after.ts}",and(server_updated_at.eq."${after.ts}",id.gt.${after.id})`]]));
    check('sin cursor con since: solo gte(since); sin nada: ningún filtro', JSON.stringify(r2.calls) === JSON.stringify([['gte', 'server_updated_at', '2026-11-07T22:00:00.000Z']]) && r3.calls.length === 0);

    const pg = new PGlite();
    await pg.exec(readFileSync('scripts/lib/pg-auth-stub.sql', 'utf8'));
    for (const f of readdirSync('supabase/migrations').filter((x) => /^\d{14}_[a-z0-9_]+\.sql$/.test(x)).sort()) await pg.exec(readFileSync(`supabase/migrations/${f}`, 'utf8'));
    const uid = randomUUID();
    const otherUid = randomUUID();
    await pg.query('insert into auth.users (id) values ($1), ($2)', [uid, otherUid]);
    // Empates forzados (solo en la prueba): bloques de 700 filas con el mismo server_updated_at,
    // que cruzan los límites de página de 500.
    const N = 20000;
    await pg.exec('alter table public.backlog disable trigger set_server_updated_at');
    await pg.query(`insert into public.backlog (id, user_id, type, title, status, created_at, updated_at, server_updated_at)
        select gen_random_uuid(), $1, 'movie', '[F6.5] ' || g, 'Pendiente', now(), now(), timestamptz '2026-11-01 00:00:00+00' + (g / 700) * interval '1 second'
        from generate_series(1, $2::int) g`, [uid, N]);
    await pg.query(`insert into public.backlog (id, user_id, type, title, status, created_at, updated_at, server_updated_at)
        select gen_random_uuid(), $1, 'movie', '[F6.5] ajena ' || g, 'Pendiente', now(), now(), timestamptz '2026-11-01 00:00:00+00' + (g / 50) * interval '1 second'
        from generate_series(1, 3000) g`, [otherUid]);
    await pg.exec('alter table public.backlog enable trigger set_server_updated_at');
    await pg.exec('analyze');

    const OLD = (p) => `(server_updated_at > $${p}::timestamptz or (server_updated_at = $${p}::timestamptz and id > $${p + 1}::uuid))`;
    const asUser = async (fn) => {
        await pg.query("select set_config('request.jwt.claim.sub', $1, false)", [uid]);
        await pg.exec('set role authenticated');
        try { return await fn(); } finally { await pg.exec('reset role'); }
    };
    const oldPage = (cursor) => asUser(() => pg.query(
        `select id::text as id, server_updated_at::text as ts from public.backlog ${cursor ? `where ${OLD(1)}` : ''} order by server_updated_at, id limit 500`,
        cursor ? [cursor.ts, cursor.id] : []));
    const walkOld = async () => {
        const pages = []; let cursor = null;
        for (;;) { const r = (await oldPage(cursor)).rows; if (!r.length) break; pages.push(r.map((x) => x.id)); const last = r[r.length - 1]; cursor = { ts: last.ts, id: last.id }; if (r.length < 500) break; }
        return pages;
    };
    const T = createPgliteTransport(pg);
    T.uid = uid;
    const walkNew = async () => {
        const pages = []; let cursor = null;
        for (;;) { const { rows, error } = await T.pullPage('backlog', { since: null, after: cursor, limit: 500 }); if (error) throw new Error(error.message); if (!rows.length) break;
            pages.push(rows.map((x) => x.id)); const last = rows[rows.length - 1]; cursor = { ts: last.server_updated_at, id: last.id }; if (rows.length < 500) break; }
        return pages;
    };
    const pOld = await walkOld();
    const pNew = await walkNew();
    const flat = pNew.flat();
    check('mismas páginas y mismo orden que antes (con empates que cruzan páginas)', JSON.stringify(pOld) === JSON.stringify(pNew), `${pNew.length} páginas`);
    check('0 duplicadas y 0 perdidas; solo filas del usuario (RLS)', flat.length === N && new Set(flat).size === N);

    // Plan de la página intermedia (cursor en la fila N/2), con el mismo SQL que cada transporte.
    const mid = (await asUser(() => pg.query(`select id::text as id, server_updated_at::text as ts from public.backlog order by server_updated_at, id offset $1 limit 1`, [N / 2 - 1]))).rows[0];
    const planOf = async (where) => asUser(async () => {
        const r = await pg.query(`explain (analyze, format json) select * from public.backlog where ${where} order by server_updated_at, id limit 500`, [mid.ts, mid.id]);
        const plan = r.rows[0]['QUERY PLAN'][0].Plan;
        const find = (n) => (n['Relation Name'] === 'backlog' ? n : (n.Plans || []).map(find).find(Boolean));
        const node = find(plan);
        return { cond: node['Index Cond'] || node['Recheck Cond'] || '', removed: node['Rows Removed by Filter'] || 0, type: node['Node Type'] };
    });
    const planOld = await planOf(OLD(1));
    const planNew = await planOf(`server_updated_at >= $1::timestamptz and ${OLD(1)}`);
    check('antes: la condición de índice es solo user_id y se descartan miles de filas', !/server_updated_at/.test(planOld.cond) && planOld.removed >= N / 2 - 700, `${planOld.type}, descartadas ${planOld.removed}`);
    check('ahora: server_updated_at >= … va en la condición del índice y casi no se descartan filas', /server_updated_at >=/.test(planNew.cond) && planNew.removed < 700, `${planNew.type}, descartadas ${planNew.removed}`);
    await pg.close();
}

// Las BD de trabajo siguen abiertas (conexiones del shim): en Windows no se pueden borrar ahora;
// se borran al empezar la siguiente ejecución.
try { rmSync(WORK, { recursive: true, force: true }); } catch { /* archivos abiertos */ }
console.log(failures ? `\n${failures} prueba(s) fallaron.` : '\nFASE 6.5: TODO OK.');
process.exit(failures ? 1 : 0);
