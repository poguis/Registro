// Ensayo de la Fase 5 con una COPIA del respaldo real ("A") y el código real de src/:
// migración 4 → ensureInitialUpload → push/pull contra un Postgres LOCAL (PGlite con las 4
// migraciones reales, el stub de auth con el uid del respaldo y el tombstone [prueba RLS]
// simulado en backlog) → dispositivo B vacío con la siembra real de categorías → sync → sync de
// vuelta en A → comparar-sync A vs B → segunda sync. Nunca toca un proyecto remoto ni el
// respaldo original. No imprime filas: solo conteos, indicadores y UUID.
//
// Uso: node scripts/dryrun-fase5.mjs --respaldo <A.db> [--etiqueta X]
import './lib/test-hooks.mjs';
import { rmSync, mkdirSync, existsSync, copyFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer, createDevices, engine, TABLES, quiet, sumCounts } from './lib/sync-devices.mjs';
import { snapshotDb, compareSnapshots, printReport } from './comparar-sync.mjs';
import { openReadOnly, getUserVersion } from './lib/sqlite-utils.mjs';

const { DEFAULT_SYNC_CONFIG } = await import('../src/sync/config.ts');
const { DEFAULT_CATEGORIES } = await import('../src/data/repositories/users.ts');
const { backupCalls } = await import('./lib/backup-stub.mjs');
const { toCents } = await import('../src/sync/mapping.ts');

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const source = flag('--respaldo');
const label = flag('--etiqueta') || 'respaldo A';
if (!source || !existsSync(source)) {
    console.error('Uso: node scripts/dryrun-fase5.mjs --respaldo <A.db> [--etiqueta X]');
    process.exit(2);
}

const WORK = resolve('.local-data/fase5/dryrun').replace(/\\/g, '/');
rmSync(WORK, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });

let failures = 0;
const rows = [];
const check = (name, ok, detail = '') => {
    console.log(`${ok ? 'OK  ' : 'FALLA'} ${name}${detail ? ` — ${detail}` : ''}`);
    rows.push({ name, ok, detail });
    if (!ok) failures++;
};
const CFG = { ...DEFAULT_SYNC_CONFIG, enabled: true }; // lotes de 100 y páginas de 500, como la app

console.log(`== dryrun-fase5 · ${label} ==`);
// Copia intacta de A para la comparación final (A original vs A sincronizada).
const original = `${WORK}/A-original.db`;
copyFileSync(source, original);
const uvSource = getUserVersion(openReadOnly(original));

const { pg, T, newAuthUser, counts: serverCounts } = await createServer();
const D = createDevices(WORK);
const { newDevice, use, run, one, all, counts, outbox, meta } = D;

// 1. Migración 4 sobre la copia (init() real; la copia física previa la registra el stub).
const backupsBefore = backupCalls.length;
const A = await newDevice('A', source);
const uvA = (await one(A, 'PRAGMA user_version')).user_version;
check(`migración 4 aplicada (user_version ${uvSource} → ${uvA}) con copia física previa`,
    // Desde la Fase 6.7 init() sigue hasta la migración 5 (elimina legacy_*): se exige ≥ 4.
    uvA >= 4 && (uvSource >= 4 || backupCalls.slice(backupsBefore).includes('pre-migracion-v4')), backupCalls.slice(backupsBefore).join(', '));
const users = await all(A, 'SELECT id, linked_at FROM users');
check('1 cuenta local, vinculada', users.length === 1 && !!users[0].linked_at);
const uid = users[0].id;
console.log(`     uid ${uid}`);
const countsA = await counts(A);
const rowsA = sumCounts(countsA);

// H2: riesgo de la fusión de categorías por defecto en un dispositivo nuevo (solo conteos).
const defaults = await all(A, `SELECT deleted_at IS NOT NULL AS deleted, icon IS NOT NULL AS has_icon FROM finance_categories WHERE name IN (${DEFAULT_CATEGORIES.map(() => '?').join(',')})`, DEFAULT_CATEGORIES);
const h2Deleted = defaults.filter((r) => r.deleted).length;
const h2Icon = defaults.filter((r) => r.has_icon).length;
check('H2: categorías por defecto de A borradas o con icono = 0 (si no, PARAR antes de 5.5)', h2Deleted + h2Icon === 0,
    `por defecto presentes ${defaults.length}/${DEFAULT_CATEGORIES.length}, borradas ${h2Deleted}, con icono ${h2Icon}`);

// 2. Primera subida (sin red ni sesión).
const ob0 = await outbox(A);
use(A);
const up = await quiet(() => engine.ensureInitialUpload(CFG));
const ob1 = await outbox(A);
const m = await meta(A);
check('ensureInitialUpload: "done" con marca y resumen en sync_meta', up.status === 'done' && !!m.initial_upload_done_at && m.initial_upload_uid === uid);
check('outbox: filas distintas = filas (vivas + borradas) de las 15 tablas de A', ob1.rows === rowsA,
    `filas A ${rowsA}, outbox distintas ${ob1.rows}, entradas crudas ${ob1.raw} (antes ${ob0.raw} crudas / ${ob0.rows} distintas)`);

// 3. Servidor local: uid del respaldo + tombstone [prueba RLS] en backlog.
await newAuthUser(uid);
T.uid = uid;
const iso = new Date().toISOString();
const tomb = '00000000-0000-4000-8000-00000000f005';
await T.upsert('backlog', [{ id: tomb, user_id: uid, type: 'movie', title: '[prueba RLS]', status: 'Pendiente', franchise: 'Otros',
    year: null, start_year: null, end_year: null, format: null, created_at: iso, updated_at: iso, deleted_at: iso }]);

// 4. Push → pull en A.
use(A);
const s1 = await quiet(() => engine.syncOnce(CFG, T));
const ob2 = await outbox(A);
check('sync de A: "ok", outbox 0 y 0 bloqueadas', s1.status === 'ok' && ob2.raw === 0 && !ob2.blocked && s1.push.blocked === 0,
    `${s1.status}, subidas ${s1.push?.pushed}, bajadas aplicadas ${s1.applied}`);
const sc = await serverCounts(uid);
const expected = JSON.parse(JSON.stringify(countsA));
expected.backlog.total++; expected.backlog.deleted++;
check('servidor = A por tabla + 1 borrado en backlog', JSON.stringify(sc) === JSON.stringify(expected),
    TABLES.filter((t) => JSON.stringify(sc[t]) !== JSON.stringify(expected[t])).join(','));

// 5. Dispositivo B vacío: login simulado = createLinkedUser real (6 categorías) → sync.
const B = await newDevice('B');
await run(B, (s) => s.createLinkedUser(uid, 'prueba@ejemplo.test'));
use(B);
await quiet(() => engine.ensureInitialUpload(CFG));
const sB = await quiet(() => engine.syncOnce(CFG, T));
check('sync de B vacío: "ok", 0 bloqueadas, outbox 0', sB.status === 'ok' && sB.push.blocked === 0 && (await outbox(B)).raw === 0,
    `fusionadas ${sB.merged}, aplicadas ${sB.applied}`);

// 6. Vuelta en A y comparación.
use(A);
const s2 = await quiet(() => engine.syncOnce(CFG, T));
check('vuelta en A: "ok"', s2.status === 'ok', `aplicadas ${s2.applied}`);
const report = { a: snapshotDb(A.path), b: snapshotDb(B.path) };
report.result = compareSnapshots(report.a, report.b);
printReport(report, 'A vs B (tras la vuelta en A)');
check('comparar-sync A vs B idéntico en las 15 tablas', report.result.identical);
const srvBalance = (await pg.query('select coalesce(sum(amount), 0)::text s from public.balance_history where user_id = $1 and deleted_at is null', [uid])).rows[0].s;
check('saldo igual en A, servidor y B', report.result.balanceEqual && toCents(srvBalance) === report.a.balanceCents);
const catIds = async (dev) => (await all(dev, 'SELECT id FROM finance_categories ORDER BY id')).map((r) => r.id).join();
check('categorías: mismos id en A y B', (await catIds(A)) === (await catIds(B)));

// 7. Segunda sync: 0 escrituras.
const w0 = T.rowsWritten;
use(A); const s3 = await quiet(() => engine.syncOnce(CFG, T));
use(B); const s4 = await quiet(() => engine.syncOnce(CFG, T));
check('segunda sync en A y en B: 0 escrituras', s3.status === 'ok' && s4.status === 'ok'
    && s3.remoteWrites + s3.localWrites + s4.remoteWrites + s4.localWrites === 0 && T.rowsWritten === w0);

// 8. A original vs A sincronizada (esperado: +1 borrado en backlog; categorías solo si H2/fechas).
const fin = { a: snapshotDb(original), b: snapshotDb(A.path) };
fin.result = compareSnapshots(fin.a, fin.b);
printReport(fin, 'A original vs A sincronizada');
const onlyTomb = TABLES.every((t) => {
    const r = fin.result.tables[t];
    if (t === 'backlog') return r.differ.length === 0 && r.onlyA.length === 0 && r.onlyB.length === 1 && r.onlyB[0] === tomb;
    if (t === 'finance_categories') return r.onlyA.length === 0 && r.onlyB.length === 0;
    return r.same;
});
const catDates = fin.result.tables.finance_categories.differ.length;
check('A original vs sincronizada: solo +1 tombstone en backlog (categorías: mismos id)', onlyTomb,
    `categorías con fechas cambiadas por la fusión: ${catDates}`);

console.log(`\nResumen: ${rows.filter((r) => r.ok).length}/${rows.length} OK`);
console.log(failures === 0 ? 'DRYRUN FASE 5: OK.' : `${failures} criterio(s) fallaron.`);
process.exit(failures === 0 ? 0 : 1);
