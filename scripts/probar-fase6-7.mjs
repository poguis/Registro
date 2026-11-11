// Fase 6.7 — limpieza: migración 5 (elimina legacy_*) y retención de respaldos/. Código real de
// src/ sobre node:sqlite (shims de scripts/lib). Nunca toca un proyecto remoto ni imprime filas ni
// contraseñas. Uso: node scripts/probar-fase6-7.mjs
//   1. Migración 5 sobre el fixture y sobre una COPIA del respaldo real "después" de la 6.6.
//   2. Retención (función pura): el inventario real de 49 archivos da exactamente el resultado de
//      D4 y tabla de casos (menos de 10, pares incompletos, desconocidos, sufijo -N, contraseña entre
//      los 10, protegido, idempotencia, rutas inseguras).
//   3. Ejecutor real sobre un respaldos/ temporal (verificación de contraseñas solo en lo que se
//      conserva, WAL, auxiliares, fallo de borrado, resumen sin nombres).
//   4. Integración: limpieza inicial una sola vez tras la migración y tras "Respaldar datos" sin
//      borrar el respaldo recién creado.
// Los archivos de trabajo van a un directorio temporal del sistema; .local-data/ solo se lee.
import './lib/test-hooks.mjs';
import { mkdirSync, rmSync, copyFileSync, existsSync, readdirSync, writeFileSync, statSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const { createDevices, quiet } = await import('./lib/sync-devices.mjs');
const { __setDatabasePath, __openLog } = await import('./lib/expo-sqlite-shim.mjs');
const { MIGRATIONS, runMigrations, LATEST_VERSION } = await import('../src/services/migrations.js');
const { LEGACY_TABLES } = await import('../src/data/db/migration5.ts');
const { DEV_FLAGS } = await import('../src/services/devFlags.js');
const { backupCalls, backupStub } = await import('./lib/backup-stub.mjs');
const { planRetention, backupPairKey } = await import('../src/services/backupRetention.ts');
const { cleanupBackupDir, safeBackupPath } = await import('../src/services/backupCleanup.js');
const { snapshotDb, compareSnapshots } = await import('./comparar-sync.mjs');
const { openDatabaseAsync } = await import('expo-sqlite');

let failures = 0;
const check = (name, ok, detail = '') => {
    console.log(`${ok ? 'OK  ' : 'FALLA'} ${name}${detail ? ` — ${detail}` : ''}`);
    if (!ok) failures++;
};
const section = (t) => console.log(`\n== ${t} ==`);
const sha = (v) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const mb = (b) => (b / 1048576).toFixed(2);

const WORK = join(tmpdir(), 'registro-pruebas-fase6-7').replace(/\\/g, '/');
try { rmSync(WORK, { recursive: true, force: true }); } catch { /* archivos abiertos de una ejecución anterior */ }
mkdirSync(WORK, { recursive: true });
const FIXTURE = '.local-data/emulador-antes.db';
const REAL_AFTER = '.local-data/fase6-6/prod/registro_respaldo_20261110-211539'; // respaldo "después" de la 6.6 (v4)
for (const f of [FIXTURE, `${REAL_AFTER}.db`, `${REAL_AFTER}.json`]) if (!existsSync(f)) { console.log(`FALLA falta ${f}`); process.exit(1); }
const D = createDevices(WORK);

// ---------------------------------------------------------------- utilidades
const tablesOf = (path) => { const d = new DatabaseSync(path, { readOnly: true }); const r = d.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((x) => x.name); d.close(); return r; };
const uvOf = (path) => { const d = new DatabaseSync(path, { readOnly: true }); const r = d.prepare('PRAGMA user_version').get().user_version; d.close(); return r; };
// Huella de las tablas que la migración 5 no debe tocar (y de todas, para el fallo simulado).
function hashTables(path, names) {
    const d = new DatabaseSync(path, { readOnly: true });
    const out = {};
    for (const t of names) out[t] = d.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all().map((r) => ({ ...r }));
    d.close();
    return sha(out);
}
const KEPT_LOCAL = ['users', 'outbox', 'sync_meta', 'sync_state', '_id_map'];
async function toVersion(path, target) {
    const later = MIGRATIONS.splice(target);
    try {
        __setDatabasePath(path);
        const conn = await openDatabaseAsync('app_registro_v3.db');
        await quiet(() => runMigrations(conn, { createPhysicalCopy: async () => ({ path: 'stub' }), listDbFiles: () => [] }));
        await conn.closeAsync();
    } finally { MIGRATIONS.push(...later); }
}
const dir = (name) => { const p = `${WORK}/${name}`; mkdirSync(p, { recursive: true }); return p; };

// =========================================================================== 1. migración 5
section('1. Migración 5: elimina SOLO legacy_* (lista explícita), con copia previa');
check('LATEST_VERSION = 5 y la lista explícita tiene las 16 tablas legacy_*', LATEST_VERSION === 5 && LEGACY_TABLES.length === 16 && LEGACY_TABLES.every((t) => t.startsWith('legacy_')));
for (const [label, source] of [['fixture (v0)', FIXTURE], ['copia del respaldo real "después" de la 6.6 (v4)', `${REAL_AFTER}.db`]]) {
    const key = label.startsWith('fixture') ? 'm5-fixture' : 'm5-real';
    const path = `${dir(key)}/app_registro_v3.db`;
    copyFileSync(source, path);
    await toVersion(path, 4);
    const before = { snap: snapshotDb(path), kept: hashTables(path, KEPT_LOCAL), log: tablesOf(path).includes('_migration_log') && new DatabaseSync(path, { readOnly: true }).prepare('SELECT COUNT(*) n FROM _migration_log').get().n };
    const legacyBefore = tablesOf(path).filter((t) => t.startsWith('legacy_')).length;
    backupCalls.length = 0;
    const dev = await D.openDevice(key, path);
    await dev.svc.db.closeAsync();
    const after = { snap: snapshotDb(path), kept: hashTables(path, KEPT_LOCAL) };
    const cmp = compareSnapshots(before.snap, after.snap);
    const legacyAfter = tablesOf(path).filter((t) => t.startsWith('legacy_'));
    const d = new DatabaseSync(path, { readOnly: true });
    const log5 = d.prepare("SELECT COUNT(*) n FROM _migration_log WHERE version = 5 AND kind = 'summary'").get().n;
    const logTotal = d.prepare('SELECT COUNT(*) n FROM _migration_log').get().n;
    d.close();
    check(`${label}: ${legacyBefore} legacy_* antes → 0 después, user_version 5, copia pre-migracion-v5 pedida`,
        legacyBefore === 16 && legacyAfter.length === 0 && uvOf(path) === 5 && backupCalls.includes('pre-migracion-v5'), backupCalls.join(', '));
    check(`${label}: las 15 tablas sincronizadas idénticas (comparar-sync) y mismo saldo`, cmp.identical && cmp.balanceEqual);
    check(`${label}: users, outbox, sync_meta, sync_state y _id_map intactos; _migration_log + 1 resumen (v5)`, after.kept === before.kept && log5 === 1 && logTotal === before.log + 1);
    const again = await D.openDevice(key, path);
    await again.svc.db.closeAsync();
    check(`${label}: reabrir no repite nada`, again.svc.lastMigration.applied.length === 0 && hashTables(path, KEPT_LOCAL) === after.kept);
}
{
    const path = `${dir('m5-fallo')}/app_registro_v3.db`;
    copyFileSync(`${REAL_AFTER}.db`, path);
    const all = tablesOf(path);
    const before = hashTables(path, all);
    DEV_FLAGS.DEV_FAIL_MIGRATION = true;
    let failed = false;
    try { await D.openDevice('m5-fallo', path); } catch { failed = true; }
    DEV_FLAGS.DEV_FAIL_MIGRATION = false;
    check('fallo simulado a mitad de la migración 5: no abre y la BD queda en v4 idéntica (incluidas legacy_*)',
        failed && uvOf(path) === 4 && hashTables(path, all) === before && tablesOf(path).filter((t) => t.startsWith('legacy_')).length === 16);
    backupStub.shouldFail = true;
    let noCopy = false;
    try { await D.openDevice('m5-fallo', path); } catch { noCopy = true; }
    backupStub.shouldFail = false;
    check('sin la copia previa la migración 5 no corre y no toca nada', noCopy && uvOf(path) === 4 && hashTables(path, all) === before);
    const ok = await D.openDevice('m5-fallo', path);
    await ok.svc.db.closeAsync();
    check('reintento: migra hasta v5', uvOf(path) === 5 && tablesOf(path).every((t) => !t.startsWith('legacy_')));
}

// =========================================================================== 2. retención pura
section('2. Retención (función pura): inventario real = D4 y tabla de casos');
// Inventario real de respaldos/ del celular (respaldo "después" de la 6.6; solo nombres, tamaños y fechas).
const inventory = JSON.parse(readFileSync(`${REAL_AFTER}.json`, 'utf8')).meta.backupDirFiles;
// Diagnóstico D2: archivos con la contraseña antigua (comprobados en su copia de la PC o deducidos).
const D2_PASSWORD = [
    'registro_pre-migracion-v2_20261025-191651.db', 'registro_pre-migracion-v3_20261101-124039.db',
    'registro_respaldo_20261020-211119.db', 'registro_respaldo_20261020-211149.db', 'registro_respaldo_20261020-211211.db',
    'registro_respaldo_20261020-211224.db', 'registro_respaldo_20261020-211827.db', 'registro_respaldo_20261025-191228.db',
    'registro_respaldo_20261025-191742.db', 'registro_respaldo_20261025-195442.db', 'registro_respaldo_20261101-123248.db',
];
// D4: lo que se conserva (los 10 respaldos más recientes —el más nuevo aún sin .json— y la pre-migración v4).
const D4_KEEP = [
    'registro_pre-migracion-v4_20261104-203741.db',
    ...['20261104-212144', '20261104-215120', '20261107-130116', '20261108-072452', '20261108-090644', '20261108-091040',
        '20261108-202832', '20261108-203714', '20261110-211210'].flatMap((s) => [`registro_respaldo_${s}.db`, `registro_respaldo_${s}.json`]),
    'registro_respaldo_20261110-211539.db',
].sort();
{
    const plan = planRetention(inventory, { keepBackups: 10, passwordFiles: D2_PASSWORD });
    const keepNames = plan.keep.map((f) => f.name).sort();
    const keepBytes = plan.keep.reduce((a, f) => a + f.size, 0);
    const removeBytes = plan.remove.reduce((a, f) => a + f.size, 0);
    check('inventario real (49 archivos): se conservan EXACTAMENTE los 20 de D4', inventory.length === 49 && JSON.stringify(keepNames) === JSON.stringify(D4_KEEP) && plan.unknown.length === 0,
        `${plan.keep.length} conservados`);
    check(`inventario real: se borran 29 (${mb(removeBytes)} MB) y se conservan 20 (${mb(keepBytes)} MB), como D4`, plan.remove.length === 29 && mb(removeBytes) === '4.59' && mb(keepBytes) === '5.04');
    check('los 11 archivos con contraseña están entre los borrados', D2_PASSWORD.every((n) => plan.remove.some((f) => f.name === n)));
    // Con la 1.3.4 aparece la pre-migracion-v5: se conserva ella y la v4 pasa a borrarse.
    const withV5 = [...inventory, { name: 'registro_pre-migracion-v5_20261111-090000.db', size: 446464 }];
    const p5 = planRetention(withV5, { passwordFiles: D2_PASSWORD });
    check('con la pre-migracion-v5: se conserva la v5 y la v4 se borra',
        p5.keep.some((f) => f.name.includes('pre-migracion-v5')) && p5.remove.some((f) => f.name.includes('pre-migracion-v4')));
}
{
    const mk = (stamps, ext = ['db', 'json']) => stamps.flatMap((s) => ext.map((e) => ({ name: `registro_respaldo_${s}.${e}`, size: 10 })));
    const stamps = Array.from({ length: 14 }, (_, i) => `202611${String(10 + i).padStart(2, '0')}-120000`);
    const cases = [];
    // menos de 10
    let p = planRetention(mk(stamps.slice(0, 4)));
    cases.push(['menos de 10 respaldos: se conservan todos', p.keep.length === 8 && p.remove.length === 0]);
    // 14 pares: se conservan los 10 más recientes
    p = planRetention(mk(stamps));
    cases.push(['14 pares: se conservan los 10 más recientes (20 archivos) y se borran 4 pares', p.keep.length === 20 && p.remove.length === 8 && p.keep.every((f) => f.name >= `registro_respaldo_${stamps[4]}`)]);
    // pares incompletos
    const incomplete = [...mk(stamps.slice(0, 3)), { name: `registro_respaldo_${stamps[3]}.db`, size: 10 }, { name: `registro_respaldo_${stamps[4]}.json`, size: 10 }];
    p = planRetention(incomplete, { keepBackups: 4 });
    cases.push(['pares incompletos: cuentan como un par (solo .db o solo .json)', p.keep.length === 6 && p.remove.length === 2 && p.remove.every((f) => f.name.includes(stamps[0]))]);
    // desconocidos
    const unknown = [{ name: 'app_registro_v3.db', size: 1 }, { name: 'nota.txt', size: 1 }, { name: `registro_respaldo_${stamps[13]}.db-journal`, size: 1 }, { name: 'registro_respaldo_2026.db', size: 1 }];
    p = planRetention([...mk(stamps), ...unknown]);
    cases.push(['nombres desconocidos (BD principal, .txt, -journal, sello mal formado): se conservan y se informan', p.unknown.length === 4 && !p.remove.some((f) => unknown.some((u) => u.name === f.name))]);
    // sufijo -N
    const suffix = [...mk(stamps.slice(0, 10)), { name: `registro_respaldo_${stamps[9]}-2.db`, size: 10 }, { name: `registro_respaldo_${stamps[9]}-2.json`, size: 10 }];
    p = planRetention(suffix);
    cases.push(['sufijo -N: es un par propio, más reciente que el del mismo sello', p.keep.some((f) => f.name.endsWith(`${stamps[9]}-2.db`)) && p.remove.length === 2 && p.remove.every((f) => f.name.includes(stamps[0]))]);
    // contraseña entre los 10 más recientes
    const pwNewest = `registro_respaldo_${stamps[13]}.db`;
    p = planRetention(mk(stamps), { passwordFiles: [pwNewest] });
    cases.push(['un archivo con contraseña entre los 10 más recientes: se borra con su par y no ocupa puesto (siguen 10 pares)',
        p.remove.some((f) => f.name === pwNewest) && p.remove.some((f) => f.name === `registro_respaldo_${stamps[13]}.json`) && p.keep.length === 20 && p.keep.some((f) => f.name.includes(stamps[3]))]);
    // pre-migración / pre-vinculación
    const pre = [{ name: 'registro_pre-migracion-v2_20261025-191651.db', size: 1 }, { name: 'registro_pre-migracion-v4_20261104-203741.db', size: 1 },
        { name: 'registro_pre-migracion-v5_20261111-090000.db', size: 1 }, { name: 'registro_pre-vinculacion_20261101-124141.db', size: 1 }];
    p = planRetention(pre, { passwordFiles: ['registro_pre-migracion-v5_20261111-090000.db'] });
    cases.push(['pre-migración: se conserva la más reciente SIN contraseña; la pre-vinculación se borra',
        p.keep.length === 1 && p.keep[0].name.includes('-v4_') && p.remove.length === 3]);
    // protegido
    const future = mk(stamps);
    p = planRetention([...future, ...mk(['20261101-000000'])], { protectKeys: ['20261101-000000'] });
    cases.push(['un respaldo protegido (el recién creado) se conserva aunque quede fuera de los 10', p.keep.some((f) => f.name.includes('20261101-000000')) && p.keep.length === 22]);
    // idempotencia
    const first = planRetention(inventory, { passwordFiles: D2_PASSWORD });
    const remaining = inventory.filter((f) => !first.remove.some((r) => r.name === f.name));
    const second = planRetention(remaining, { passwordFiles: D2_PASSWORD });
    cases.push(['idempotencia: una segunda pasada sobre lo que queda no borra nada', second.remove.length === 0 && second.keep.length === first.keep.length]);
    for (const [name, ok] of cases) check(name, ok);
    // rutas inseguras
    const db = `${WORK}/x/app_registro_v3.db`, rd = `${WORK}/x/respaldos`;
    const unsafe = ['../app_registro_v3.db', 'sub/registro_respaldo_20261110-211539.db', 'app_registro_v3.db', 'registro_respaldo_20261110-211539.db/..', '', null];
    check('rutas inseguras rechazadas ("..", "/", la BD principal, vacías) y fuera de respaldos/',
        unsafe.every((n) => safeBackupPath(rd, db, n) === null) && safeBackupPath(`${WORK}/x`, db, 'registro_respaldo_20261110-211539.db') === null
        && safeBackupPath(rd, db, 'registro_respaldo_20261110-211539.db') === `${rd}/registro_respaldo_20261110-211539.db`);
}

// =========================================================================== 3. ejecutor real
section('3. Ejecutor sobre un respaldos/ temporal: verifica contraseñas solo en lo que se conserva');
function makeDb(path, { password = false, userVersion = 4, wal = false } = {}) {
    rmSync(path, { force: true });
    const d = new DatabaseSync(path);
    if (wal) d.exec('PRAGMA journal_mode = WAL');
    d.exec(`CREATE TABLE users (id TEXT, username TEXT${password ? ', password TEXT' : ''})`);
    if (password) d.prepare('INSERT INTO users VALUES (?, ?, ?)').run('u', 'prueba', 'secreta');
    else d.prepare('INSERT INTO users VALUES (?, ?)').run('u', 'prueba');
    d.exec(`PRAGMA user_version = ${userVersion}`);
    d.close();
}
const makeJson = (path, visible = false) => writeFileSync(path, JSON.stringify({ meta: { formatVersion: 2 }, data: { users: [{ id: 'u', ...(visible ? { password: 'secreta' } : {}) }] } }));
{
    const base = dir('exec');
    const dbPath = `${base}/app_registro_v3.db`;
    writeFileSync(dbPath, 'no es la BD');
    const rd = dir('exec/respaldos');
    const st = Array.from({ length: 13 }, (_, i) => `202611${String(10 + i).padStart(2, '0')}-120000`);
    for (const s of st) { makeDb(`${rd}/registro_respaldo_${s}.db`); makeJson(`${rd}/registro_respaldo_${s}.json`); }
    // Dentro de los 10 más recientes: un .db con contraseña, un JSON con contraseña visible, un .db en WAL
    // (no se abre; user_version 4 → sin contraseña) y un .db con un -journal ya presente (no se abre ni se borra).
    makeDb(`${rd}/registro_respaldo_${st[12]}.db`, { password: true });
    makeJson(`${rd}/registro_respaldo_${st[11]}.json`, true);
    makeDb(`${rd}/registro_respaldo_${st[10]}.db`, { wal: true }); // la cabecera queda marcada como WAL (bytes 18/19 = 2)
    writeFileSync(`${rd}/registro_respaldo_${st[9]}.db-journal`, 'diario');
    makeDb(`${rd}/registro_pre-migracion-v2_20261025-191651.db`, { password: true, userVersion: 1 });
    makeDb(`${rd}/registro_pre-migracion-v4_20261104-203741.db`, { userVersion: 3 });
    makeDb(`${rd}/registro_pre-migracion-v5_20261109-090000.db`, { userVersion: 4 });
    makeDb(`${rd}/registro_pre-vinculacion_20261101-124141.db`, { userVersion: 3 });
    writeFileSync(`${rd}/nota.txt`, 'desconocido');
    const failName = `registro_respaldo_${st[0]}.json`;
    globalThis.__fsStubDeleteFails = (uri) => uri.endsWith(failName);
    const auxBefore = readdirSync(rd).filter((n) => /-(journal|wal|shm)$/.test(n));
    __openLog.length = 0;
    const summary = await quiet(() => cleanupBackupDir({ databasePath: dbPath }));
    globalThis.__fsStubDeleteFails = null;
    const left = readdirSync(rd).sort();
    const has = (n) => left.includes(n);
    const keptStamps = st.filter((s) => has(`registro_respaldo_${s}.db`) || has(`registro_respaldo_${s}.json`));
    check('el par con un .db con contraseña y el par con un JSON con contraseña visible se borran enteros',
        !has(`registro_respaldo_${st[12]}.db`) && !has(`registro_respaldo_${st[12]}.json`) && !has(`registro_respaldo_${st[11]}.db`) && !has(`registro_respaldo_${st[11]}.json`));
    check('quedan 10 pares válidos (los siguientes más recientes) y los más viejos se borran (salvo el que falla al borrar)',
        keptStamps.filter((s) => s !== st[0]).length === 10 && !has(`registro_respaldo_${st[0]}.db`) && has(failName) && summary.failed === 1, `pares ${keptStamps.length}`);
    check('pre-migración: se conserva la v5; v2 (con contraseña) y v4 se borran; la pre-vinculación se borra; nota.txt se conserva',
        has('registro_pre-migracion-v5_20261109-090000.db') && !has('registro_pre-migracion-v2_20261025-191651.db') && !has('registro_pre-migracion-v4_20261104-203741.db')
        && !has('registro_pre-vinculacion_20261101-124141.db') && has('nota.txt'));
    const opened = __openLog.map((p) => p.split('/').pop());
    const keptDbs = left.filter((n) => n.endsWith('.db'));
    // Se abren solo los .db que la retención conservaría en ese momento: los finales y los de los pares
    // st[11]/st[12], que se conservaban hasta descubrir su contraseña. Nunca los que se borran por
    // antigüedad o por ser pre-vinculación/pre-migración vieja, ni el WAL ni el del -journal.
    const allowed = new Set([...keptDbs, `registro_respaldo_${st[11]}.db`, `registro_respaldo_${st[12]}.db`]);
    check('solo se abrieron .db que la retención conservaría; nunca los que se borran sin más, ni el WAL ni el del -journal',
        opened.length > 0 && opened.every((n) => allowed.has(n))
        && !opened.includes(`registro_respaldo_${st[10]}.db`) && !opened.includes(`registro_respaldo_${st[9]}.db`) && !opened.includes(`registro_respaldo_${st[0]}.db`)
        && !opened.includes('registro_pre-migracion-v2_20261025-191651.db') && !opened.includes('registro_pre-migracion-v4_20261104-203741.db')
        && !opened.includes('registro_pre-vinculacion_20261101-124141.db'), `${opened.length} abiertos`);
    const auxAfter = readdirSync(rd).filter((n) => /-(journal|wal|shm)$/.test(n));
    check('abrir las copias no dejó archivos auxiliares nuevos; el .db con -journal previo se conserva', JSON.stringify(auxAfter) === JSON.stringify(auxBefore) && has(`registro_respaldo_${st[9]}.db`));
    check('el .db en WAL no se abrió y se decidió por su cabecera (user_version 4: sin contraseña, se conserva)', has(`registro_respaldo_${st[10]}.db`) && summary.unverified >= 2);
    check('resumen solo con conteos (sin nombres de archivo)', !JSON.stringify(summary).includes('registro_') && summary.deleted > 0 && summary.deletedBytes > 0, JSON.stringify(summary));
    const again = await quiet(() => cleanupBackupDir({ databasePath: dbPath }));
    check('segunda pasada: solo reintenta el que había fallado, nada más', again.deleted === 1 && !readdirSync(rd).includes(failName) && readdirSync(rd).length === left.length - 1);
}

// =========================================================================== 4. integración
section('4. Integración: limpieza inicial una vez tras la migración y tras "Respaldar datos"');
{
    // Dispositivo en v4 (copia del respaldo real) con un respaldos/ que imita el inventario real.
    const key = 'integracion';
    const base = dir(key);
    const path = `${base}/app_registro_v3.db`;
    copyFileSync(`${REAL_AFTER}.db`, path);
    const rd = dir(`${key}/respaldos`);
    for (const f of inventory) {
        if (f.name.endsWith('.json')) makeJson(`${rd}/${f.name}`, false);
        else if (D2_PASSWORD.includes(f.name)) makeDb(`${rd}/${f.name}`, { password: true, userVersion: f.name.includes('pre-migracion-v2') ? 1 : 2 });
        else makeDb(`${rd}/${f.name}`, { userVersion: 4 });
    }
    // La copia pre-migracion-v5 la crearía createPhysicalCopy (aquí stub): se simula su archivo.
    makeDb(`${rd}/registro_pre-migracion-v5_20261111-090000.db`, { userVersion: 4 });
    const dev = await D.openDevice(key, path);
    const first = await dev.svc.initialBackupCleanup;
    const meta = Object.fromEntries((await dev.svc.db.getAllAsync('SELECT key, value FROM sync_meta WHERE key LIKE ?', ['backup_cleanup%'])).map((r) => [r.key, r.value]));
    const leftNames = readdirSync(rd).sort();
    const expected = [...D4_KEEP.filter((n) => !n.includes('pre-migracion-v4')), 'registro_pre-migracion-v5_20261111-090000.db'].sort();
    check('al abrir tras la migración 5: la limpieza inicial deja exactamente los 10 respaldos de D4 + la pre-migracion-v5',
        !!first && JSON.stringify(leftNames) === JSON.stringify(expected), `${leftNames.length} archivos; borrados ${first && first.deleted}`);
    check('sync_meta: fecha de la primera limpieza, última fecha y resumen sin nombres', !!meta.backup_cleanup_first_at && !!meta.backup_cleanup_last_at
        && !String(meta.backup_cleanup_last_summary).includes('registro_'));
    await dev.svc.db.closeAsync();
    const dev2 = await D.openDevice(key, path);
    const second = await dev2.svc.initialBackupCleanup;
    const meta2 = Object.fromEntries((await dev2.svc.db.getAllAsync('SELECT key, value FROM sync_meta WHERE key LIKE ?', ['backup_cleanup%'])).map((r) => [r.key, r.value]));
    check('reabrir: la limpieza inicial no se repite', second === null && meta2.backup_cleanup_first_at === meta.backup_cleanup_first_at && meta2.backup_cleanup_last_at === meta.backup_cleanup_last_at);

    // "Respaldar datos": respaldos con sellos MÁS NUEVOS que el recién creado → aun así no se borra.
    for (const s of Array.from({ length: 10 }, (_, i) => `2099010${i}-120000`)) { makeDb(`${rd}/registro_respaldo_${s}.db`); makeJson(`${rd}/registro_respaldo_${s}.json`); }
    const backup = await import('../src/services/backup.js');
    __setDatabasePath(path);
    const bk = await quiet(() => backup.createBackup());
    const newDb = bk.physical.path.split('/').pop(), newJson = bk.json.path.split('/').pop();
    const bothWritten = existsSync(bk.physical.path) && existsSync(bk.json.path) && statSync(bk.json.path).size > 0;
    const r = await quiet(() => dev2.svc.cleanupBackups(bk.stamp));
    const after = readdirSync(rd);
    check('tras "Respaldar datos" (con el .db y el .json ya escritos): el respaldo recién creado NO se borra',
        bothWritten && r.success && after.includes(newDb) && after.includes(newJson), backupPairKey(newDb));
    check('…y se aplican las reglas al resto: quedan los 10 más recientes + el protegido', after.filter((n) => n.startsWith('registro_respaldo_')).length === 22);
    await dev2.svc.db.closeAsync();
}

console.log(failures ? `\n${failures} prueba(s) fallaron.` : '\nFASE 6.7: TODO OK.');
process.exit(failures ? 1 : 0);
