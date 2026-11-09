// Fase 6.6 — siembra de las categorías por defecto tras el primer pull (H2 de la Fase 5).
// PGlite con las migraciones reales + RLS (servidor) y dispositivos node:sqlite con el código real
// (fachada, createLinkedUser, motor). Nunca toca un proyecto remoto ni imprime filas.
// Uso: node scripts/probar-fase6-6.mjs
// Casos: a) el servidor ya tiene las 6 (una borrada); b) servidor vacío; c) 4 de 6; d) el primer
// pull falla; e) cierre a mitad de la siembra; f) sync apagada; g) BD existente vinculada; h) el
// escenario H2 original (antes revivía una borrada); i) marca con otro uid.
// Los archivos de trabajo van a un directorio temporal del sistema; el fixture de PRUEBA
// .local-data/emulador-antes.db solo se copia.
import './lib/test-hooks.mjs';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const { createServer, createDevices, engine, quiet } = await import('./lib/sync-devices.mjs');
const { constantsState } = await import('./lib/auth-stubs.mjs');
const { DEFAULT_CATEGORIES, DEFAULT_CATEGORIES_PENDING, DEFAULT_CATEGORIES_SEEDED_AT, seedPendingDefaultCategories } = await import('../src/data/repositories/users.ts');
const { DEFAULT_SYNC_CONFIG } = await import('../src/sync/config.ts');
const { mutate, getConnection } = await import('../src/data/db/connection.ts');

let failures = 0;
const check = (name, ok, detail = '') => {
    console.log(`${ok ? 'OK  ' : 'FALLA'} ${name}${detail ? ` — ${detail}` : ''}`);
    if (!ok) failures++;
};
const section = (t) => console.log(`\n== ${t} ==`);

const WORK = join(tmpdir(), 'registro-pruebas-fase6-6').replace(/\\/g, '/');
try { rmSync(WORK, { recursive: true, force: true }); } catch { /* archivos abiertos de una ejecución anterior */ }
mkdirSync(WORK, { recursive: true });
const FIXTURE = '.local-data/emulador-antes.db';
if (!existsSync(FIXTURE)) { console.log(`FALLA falta ${FIXTURE}`); process.exit(1); }

const CFG = { ...DEFAULT_SYNC_CONFIG, enabled: true, pageSize: 50 };
const { pg, T, newAuthUser } = await createServer();
const D = createDevices(WORK);

// La fachada decide con getAppSyncConfig() (expo-constants simulado).
const syncOn = () => { constantsState.expoConfig = { extra: { syncEnabled: true, supabase: { url: null, key: null } } }; };
const syncOff = () => { constantsState.expoConfig = null; };

// ---------------------------------------------------------------- utilidades
const OLD_TS = '2026-10-01T00:00:00.000Z';
const DELETED_TS = '2026-10-02T00:00:00.000Z';
// Categorías del servidor con icono y fechas propias (las que no deben cambiar).
async function seedServer(uid, names, deleted = []) {
    for (const name of names) {
        await pg.query(`insert into public.finance_categories (id, user_id, name, icon, created_at, updated_at, deleted_at)
            values ($1, $2, $3, $4, $5, $6, $7)`, [randomUUID(), uid, name, `icono-${name}`, OLD_TS, deleted.includes(name) ? DELETED_TS : OLD_TS, deleted.includes(name) ? DELETED_TS : null]);
    }
}
const serverCats = async (uid) => (await pg.query(
    `select id, name, icon, created_at::text c, updated_at::text u, deleted_at::text d, server_updated_at::text s
     from public.finance_categories where user_id = $1 order by name`, [uid])).rows;
const localCats = async (dev) => D.all(dev, 'SELECT id, name, deleted_at FROM finance_categories ORDER BY name');
const live = (rows) => rows.filter((r) => !(r.deleted_at ?? r.d));
const markerOf = async (dev) => (await D.one(dev, 'SELECT value FROM sync_meta WHERE key = ?', [DEFAULT_CATEGORIES_PENDING]))?.value ?? null;
const hasKey = async (dev, key) => !!(await D.one(dev, 'SELECT 1 AS x FROM sync_meta WHERE key = ?', [key]));
const outboxCats = async (dev) => (await D.one(dev, "SELECT COUNT(*) AS n FROM outbox WHERE table_name = 'finance_categories'")).n;
const dupNames = (rows) => rows.length - new Set(rows.map((r) => r.name)).size;

// Dispositivo NUEVO (BD vacía) con el login simulado = createLinkedUser real de la fachada.
async function newLinkedDevice(name, uid, sync = true) {
    const dev = await D.newDevice(name);
    if (sync) syncOn(); else syncOff();
    const r = await D.run(dev, (s) => s.createLinkedUser(uid, 'prueba@ejemplo.test'));
    if (!r.success) throw new Error(`createLinkedUser de ${name}: ${r.error}`);
    syncOff();
    return dev;
}
// Un ciclo como el del runner: prepare (primera subida) + syncOnce, con la sesión del uid.
async function cycle(dev, uid) {
    T.uid = uid;
    D.use(dev);
    return quiet(async () => { await engine.ensureInitialUpload(CFG); return engine.syncOnce(CFG, T); });
}

// =========================================================================== a
section('a) Dispositivo nuevo; el servidor ya tiene las 6 por defecto (una borrada)');
{
    const uid = await newAuthUser();
    await seedServer(uid, DEFAULT_CATEGORIES, ['Salud']);
    const before = await serverCats(uid);
    const dev = await newLinkedDevice('a', uid);
    check('al crear el usuario: 0 categorías locales y la marca = uid', (await localCats(dev)).length === 0 && (await markerOf(dev)) === uid);
    const o = await cycle(dev, uid);
    const after = await serverCats(uid);
    const lc = await localCats(dev);
    check('primer ciclo "ok" sin sembrar nada', o.status === 'ok' && o.seededDefaults === 0, `${o.status}, sembradas ${o.seededDefaults}`);
    check('la borrada sigue borrada (en local y en el servidor)', lc.find((r) => r.name === 'Salud')?.deleted_at && after.find((r) => r.name === 'Salud')?.d);
    check('0 categorías en la outbox', (await outboxCats(dev)) === 0);
    check('servidor idéntico (id, icon, created_at, updated_at, deleted_at, server_updated_at)', JSON.stringify(after) === JSON.stringify(before));
    check('en local: las 6 del servidor con sus id, 5 vivas', lc.length === 6 && live(lc).length === 5 && JSON.stringify(lc.map((r) => r.id)) === JSON.stringify(after.map((r) => r.id)));
    check('la marca queda limpia y se anota la fecha de siembra', (await markerOf(dev)) === null && (await hasKey(dev, DEFAULT_CATEGORIES_SEEDED_AT)));
}

// =========================================================================== b
section('b) Usuario nuevo con el servidor vacío');
{
    const uid = await newAuthUser();
    const dev = await newLinkedDevice('b', uid);
    const o = await cycle(dev, uid);
    const srv = await serverCats(uid);
    check('tras el primer pull completo se siembran las 6 y se suben en el mismo ciclo', o.status === 'ok' && o.seededDefaults === 6 && o.remoteWrites === 6, `sembradas ${o.seededDefaults}, subidas ${o.remoteWrites}`);
    check('el servidor tiene las 6, vivas, con los mismos id que el dispositivo', live(srv).length === 6
        && JSON.stringify(srv.map((r) => r.id)) === JSON.stringify((await localCats(dev)).map((r) => r.id)));
    check('outbox vacía y marca limpia', (await outboxCats(dev)) === 0 && (await markerOf(dev)) === null);
    const o2 = await cycle(dev, uid);
    check('segundo ciclo: 0 escrituras y 0 sembradas (convergió)', o2.status === 'ok' && o2.remoteWrites === 0 && o2.localWrites === 0 && o2.seededDefaults === 0);
}

// =========================================================================== c
section('c) El servidor tiene 4 de las 6');
{
    const uid = await newAuthUser();
    const four = DEFAULT_CATEGORIES.slice(0, 4);
    await seedServer(uid, four);
    const before = await serverCats(uid);
    const dev = await newLinkedDevice('c', uid);
    const o = await cycle(dev, uid);
    const srv = await serverCats(uid);
    const missing = DEFAULT_CATEGORIES.slice(4);
    check('se siembran solo las 2 que faltan', o.seededDefaults === 2 && missing.every((n) => srv.some((r) => r.name === n && !r.d)), `sembradas ${o.seededDefaults}`);
    check('las 4 del servidor no cambian (icon, fechas, server_updated_at)', JSON.stringify(srv.filter((r) => four.includes(r.name))) === JSON.stringify(before));
    check('6 en total, sin duplicados, outbox vacía', srv.length === 6 && dupNames(await localCats(dev)) === 0 && (await outboxCats(dev)) === 0);
}

// =========================================================================== d
section('d) El primer pull falla (error de red en finance_categories y luego sin red)');
{
    const uid = await newAuthUser();
    await seedServer(uid, ['Comida', 'Hogar'], ['Hogar']);
    const dev = await newLinkedDevice('d', uid);
    // Orden del pull: finance_contacts, finance_transactions, balance_history, finance_categories → la 4.ª página falla.
    T.calls.pull = 0;
    T.failPullAfter = 3;
    const o1 = await cycle(dev, uid);
    T.failPullAfter = null;
    check('pull cortado en finance_categories: ciclo "offline", nada sembrado, la marca sigue', o1.status === 'offline' && (await localCats(dev)).length === 0 && (await markerOf(dev)) === uid, o1.status);
    T.offline = true;
    const o2 = await cycle(dev, uid);
    T.offline = false;
    check('sin red: "offline", nada sembrado, la marca sigue', o2.status === 'offline' && (await localCats(dev)).length === 0 && (await markerOf(dev)) === uid, o2.status);
    const o3 = await cycle(dev, uid);
    const lc = await localCats(dev);
    check('con el pull completo: se siembra solo lo que falta (4) y la borrada no revive', o3.status === 'ok' && o3.seededDefaults === 4
        && lc.find((r) => r.name === 'Hogar')?.deleted_at && lc.length === 6 && dupNames(lc) === 0, `sembradas ${o3.seededDefaults}`);
    const srv = await serverCats(uid);
    check('servidor: 6, "Hogar" sigue borrada, marca limpia', srv.length === 6 && srv.find((r) => r.name === 'Hogar').d && (await markerOf(dev)) === null);
}

// =========================================================================== e
section('e) Cierre a mitad de la siembra / antes de limpiar la marca');
{
    const uid = await newAuthUser();
    let dev = await newLinkedDevice('e', uid);
    // Error dentro de la transacción de la siembra, tras el 3.er INSERT (como si la app se cerrara).
    D.use(dev);
    const conn = getConnection();
    const realRun = conn.runAsync.bind(conn);
    let inserts = 0;
    conn.runAsync = async (sql, ...args) => {
        if (/^\s*INSERT INTO finance_categories/i.test(sql) && ++inserts === 3) throw new Error('cierre simulado a mitad de la siembra');
        return realRun(sql, ...args);
    };
    let threw = null;
    try { await cycle(dev, uid); } catch (e) { threw = String(e.message || e); }
    conn.runAsync = realRun;
    check('el error a mitad deshace TODA la siembra: 0 categorías, 0 en la outbox, la marca sigue',
        !!threw && (await localCats(dev)).length === 0 && (await outboxCats(dev)) === 0 && (await markerOf(dev)) === uid, threw ? 'interrumpida' : 'no se interrumpió');
    dev = await D.restart(dev); // "reabrir la app"
    const o = await cycle(dev, uid);
    const lc = await localCats(dev);
    check('al reabrir: se siembran las 6 una sola vez', o.seededDefaults === 6 && lc.length === 6 && dupNames(lc) === 0, `sembradas ${o.seededDefaults}`);
    // Marca que quedó puesta (p. ej. restaurada): volver a sembrar no duplica nada.
    await D.sql(dev, 'UPDATE sync_meta SET value = ? WHERE key = ?', [uid, DEFAULT_CATEGORIES_PENDING]);
    D.use(dev);
    const again = await mutate(() => seedPendingDefaultCategories(uid));
    const lc2 = await localCats(dev);
    check('con la marca puesta otra vez: 0 sembradas, sin duplicados, marca limpia', again === 0 && lc2.length === 6 && dupNames(lc2) === 0 && (await markerOf(dev)) === null);
    const oFinal = await cycle(dev, uid);
    const srv = await serverCats(uid);
    check('servidor: 6 sin duplicados tras subir', oFinal.status === 'ok' && srv.length === 6 && dupNames(srv) === 0);
}

// =========================================================================== f
section('f) syncEnabled = false: siembra inmediata como siempre');
{
    const uid = randomUUID();
    const dev = await newLinkedDevice('f', uid, false);
    const lc = await localCats(dev);
    check('6 categorías vivas al crear el usuario, sin marca', lc.length === 6 && live(lc).length === 6 && !(await hasKey(dev, DEFAULT_CATEGORIES_PENDING)));
    check('las 6 van a la outbox como creación local', (await outboxCats(dev)) === 6);
}

// =========================================================================== g
section('g) BD existente con usuario vinculado (como el celular real)');
{
    const uid = await newAuthUser();
    const dev = await D.newDevice('g', FIXTURE);
    syncOn();
    const l = await D.run(dev, (s) => s.linkAccount(uid, 'prueba@ejemplo.test'));
    syncOff();
    const catsBefore = await localCats(dev);
    const o = await cycle(dev, uid);
    const catsAfter = await localCats(dev);
    check('vinculada: sin marca antes ni después, 0 sembradas, mismas categorías',
        l.success && !(await hasKey(dev, DEFAULT_CATEGORIES_PENDING)) && !(await hasKey(dev, DEFAULT_CATEGORIES_SEEDED_AT)) && o.status === 'ok' && o.seededDefaults === 0
        && JSON.stringify(catsAfter.map((r) => r.id)) === JSON.stringify(catsBefore.map((r) => r.id)), `${o.status}, ${catsAfter.length} categorías`);
}

// =========================================================================== h
section('h) Escenario H2 original: una categoría por defecto borrada en el servidor y un dispositivo nuevo');
{
    // Control: el comportamiento anterior (sembrar al crear el usuario, antes del pull) la revive.
    const uidOld = await newAuthUser();
    await seedServer(uidOld, DEFAULT_CATEGORIES, ['Venta']);
    const oldDev = await newLinkedDevice('h-antes', uidOld, false); // siembra inmediata (como 1.3.2 con sync)
    await cycle(oldDev, uidOld);
    const ventaOld = (await serverCats(uidOld)).find((r) => r.name === 'Venta');
    check('control (siembra antes del pull): "Venta" REVIVE en el servidor y pierde su icono — la prueba detecta el problema',
        ventaOld && !ventaOld.d && ventaOld.icon === null, `deleted_at ${ventaOld?.d ?? 'null'}, icon ${ventaOld?.icon ?? 'null'}`);
    // Ahora: siembra diferida.
    const uid = await newAuthUser();
    await seedServer(uid, DEFAULT_CATEGORIES, ['Venta']);
    const before = await serverCats(uid);
    const dev = await newLinkedDevice('h-ahora', uid);
    const o = await cycle(dev, uid);
    const after = await serverCats(uid);
    check('ahora: "Venta" NO revive, nada sembrado y el servidor queda idéntico', o.status === 'ok' && o.seededDefaults === 0
        && after.find((r) => r.name === 'Venta').d && JSON.stringify(after) === JSON.stringify(before));
}

// =========================================================================== i
section('i) La marca contiene un uid distinto del usuario actual');
{
    const uid = await newAuthUser();
    const dev = await newLinkedDevice('i', uid);
    const other = randomUUID();
    await D.sql(dev, 'UPDATE sync_meta SET value = ? WHERE key = ?', [other, DEFAULT_CATEGORIES_PENDING]);
    D.use(dev);
    const n = await mutate(() => seedPendingDefaultCategories(uid));
    check('seedPendingDefaultCategories no siembra nada y no toca la marca', n === 0 && (await localCats(dev)).length === 0 && (await markerOf(dev)) === other);
    const o = await cycle(dev, uid);
    check('tampoco en un ciclo completo: 0 sembradas, la marca sigue con el otro uid', o.status === 'ok' && o.seededDefaults === 0 && (await markerOf(dev)) === other
        && (await localCats(dev)).length === 0, o.status);
}

await pg.close();
console.log(failures ? `\n${failures} prueba(s) fallaron.` : '\nFASE 6.6: TODO OK.');
process.exit(failures ? 1 : 0);
