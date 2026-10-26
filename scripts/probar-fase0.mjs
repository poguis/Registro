// Pruebas en PC de lo construido en la Fase 0 que sigue vigente: la migración 1
// (línea base aditiva) con el runner real, y el respaldo (backup.js). Las pruebas de
// la capa de datos (mutaciones, transacciones, cola, outbox) y de la migración 2
// están en scripts/probar-fase1.mjs y scripts/dryrun-fase1.mjs.
// Sustituye expo-sqlite por node:sqlite (scripts/lib). Trabaja en .local-data/pruebas-pc/
// con datos ficticios; no toca el celular ni el emulador.
//
// Uso: node scripts/probar-fase0.mjs
//
// La BD "existente" se construye ejecutando el SQL de init() del commit 306987d
// (anterior a la Fase 0), simulando dos arranques de la app vieja.
import './lib/test-hooks.mjs';
import { execSync } from 'node:child_process';
import { mkdirSync, rmSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { listTables, getUserVersion, getSchema, countAll, hashAll } from './lib/sqlite-utils.mjs';

const PRE_PHASE0_COMMIT = '306987d';

const { openDatabaseAsync, __setDatabasePath } = await import('./lib/expo-sqlite-shim.mjs');
const { DEV_FLAGS } = await import('../src/services/devFlags.js');
const { MIGRATIONS, TABLE_NAMES, runMigrations } = await import('../src/services/migrations.js');
const backup = await import('../src/services/backup.js');

const WORK_DIR = resolve('.local-data/pruebas-pc').replace(/\\/g, '/');
rmSync(WORK_DIR, { recursive: true, force: true });
mkdirSync(WORK_DIR, { recursive: true });

let failures = 0;
const check = (name, condition, detail = '') => {
    console.log(`${condition ? 'OK  ' : 'FALLA'} ${name}${detail ? ` — ${detail}` : ''}`);
    if (!condition) failures++;
};
const section = (title) => console.log(`\n== ${title} ==`);

const snapshot = (path) => {
    const db = new DatabaseSync(path, { readOnly: true });
    const snap = {
        userVersion: getUserVersion(db),
        tables: listTables(db),
        schema: JSON.stringify(getSchema(db)),
        counts: countAll(db),
        hashes: hashAll(db),
    };
    db.close();
    return snap;
};
const sameData = (a, b) => JSON.stringify(a.counts) === JSON.stringify(b.counts) && JSON.stringify(a.hashes) === JSON.stringify(b.hashes);

// Silencia los console.log/error del código de la app durante una llamada
const quiet = async (fn) => {
    const { log, error } = console;
    const captured = [];
    console.log = (...a) => captured.push(['log', a]);
    console.error = (...a) => captured.push(['error', a]);
    try {
        return { result: await fn(), captured };
    } finally {
        console.log = log;
        console.error = error;
    }
};

// Corre el runner real con SOLO la migración 1 (la 2 se prueba en probar-fase1.mjs).
const runV1 = async (path) => {
    const removed = MIGRATIONS.splice(1);
    __setDatabasePath(path);
    const conn = await openDatabaseAsync();
    try {
        const { result, captured } = await quiet(() => runMigrations(conn, { createPhysicalCopy: async () => ({}) })
            .then((r) => ({ ok: true, r }), (error) => ({ ok: false, error })));
        return { ...result, captured };
    } finally {
        MIGRATIONS.push(...removed);
        await conn.closeAsync();
    }
};

// --- BD "existente": SQL de init() de 306987d, dos arranques ---
const legacySource = execSync(`git show ${PRE_PHASE0_COMMIT}:src/services/db.js`, { encoding: 'utf8' });
const statements = [];
for (const m of legacySource.matchAll(/`\s*(CREATE TABLE IF NOT EXISTS[\s\S]*?\);)\s*`/g)) statements.push({ index: m.index, sql: m[1], alter: false });
for (const m of legacySource.matchAll(/`(ALTER TABLE [^`]+)`/g)) statements.push({ index: m.index, sql: m[1], alter: true });
statements.sort((a, b) => a.index - b.index);

const buildLegacyDb = (path) => {
    for (let launch = 0; launch < 2; launch++) {
        const db = new DatabaseSync(path);
        db.exec('PRAGMA foreign_keys = ON;');
        for (const st of statements) {
            try { db.exec(st.sql); } catch (e) { if (!st.alter) throw e; } // la app vieja ignoraba los ALTER fallidos
        }
        db.close();
    }
    // Datos ficticios en las 16 tablas
    const db = new DatabaseSync(path);
    db.exec(`
        INSERT INTO users (username, password, current_balance) VALUES ('prueba', 'clave-ficticia', 150.5);
        INSERT INTO finance_categories (user_id, name) VALUES (1, 'Comida'), (1, 'Sueldo');
        INSERT INTO finance_contacts (user_id, name) VALUES (1, 'Contacto A');
        INSERT INTO finance_transactions (contact_id, type, amount, description) VALUES (1, 'loan', 20, 'préstamo'), (1, 'loan', -5, 'abono');
        INSERT INTO balance_history (user_id, amount, category, description, created_at) VALUES (1, 200, 'Sueldo', 'x', '2026-10-01 15:00:00'), (1, -49.5, 'Comida', 'y', '2026-10-02 01:30:00');
        INSERT INTO services (user_id, name, type, status, original_value, additional_value, total_value) VALUES (1, 'Servicio', 'Local', 'Activo', 10, 2, 12);
        INSERT INTO entertainment_categories (user_id, name, type, start_date, days_of_week, frequency, series_count) VALUES (1, 'Anime', 'video', '2026-01-01', '{"Monday":1}', 0, 2), (1, 'Manga', 'reading', '2026-01-01', '{"Friday":2}', 0, 1);
        INSERT INTO entertainment_pauses (category_id, pause_start, pause_end) VALUES (1, '2026-03-01', '2026-03-05');
        INSERT INTO entertainment_quotas_history (category_id, quotas, start_date) VALUES (1, '{"Monday":1}', '2026-01-01'), (2, '{"Friday":2}', '2026-01-01');
        INSERT INTO series (category_id, name, status, current_season, current_episode, total_seasons, sort_order, cycle_offset) VALUES (1, 'Serie 1', 'Mirando', 1, 3, 1, 1, 0), (2, 'Lectura 1', 'Nueva', 1, 1, 1, 1, 0);
        INSERT INTO seasons (series_id, season_number, episode_count) VALUES (1, 1, 12), (2, 1, 50);
        INSERT INTO watch_history (series_id, season_number, episode_number, watched_at) VALUES (1, 1, 1, 1760000000000), (1, 1, 2, 1760000100000);
        INSERT INTO reading_history (series_id, season_number, episode_number, read_at) VALUES (2, 1, 1, 1760000200000);
        INSERT INTO backlog (user_id, type, title) VALUES (1, 'movie', 'Película');
        INSERT INTO work_people (user_id, name, start_date, cycle) VALUES (1, 'Persona', '2026-01-01', '[{"type":"dia","days":1}]');
        INSERT INTO cards (user_id, name, type, cutoff_date, payment_due_date, limit_amount) VALUES (1, 'Tarjeta', 'credit', 5, 20, 1000);
    `);
    db.close();
};

// ---------------------------------------------------------------------------
section('BD existente (esquema de 306987d) → migración 1');
const legacyPath = `${WORK_DIR}/existente.db`;
buildLegacyDb(legacyPath);
const before = snapshot(legacyPath);
check('BD existente creada con el código anterior a la Fase 0', before.tables.length === 16 && before.userVersion === 0, `${before.tables.length} tablas, user_version ${before.userVersion}`);
const run1 = await runV1(legacyPath);
const after = snapshot(legacyPath);
check('runMigrations aplica la migración 1', run1.ok && run1.r.applied.join() === '1', run1.error && run1.error.message);
check('user_version = 1', after.userVersion === 1);
check('sqlite_master idéntico', after.schema === before.schema);
check('Mismos conteos y contenido en las 16 tablas', sameData(before, after));

section('Segundo arranque (solo migración 1)');
const run2 = await runV1(legacyPath);
check('Sin migraciones pendientes', run2.ok && run2.r.applied.length === 0 && run2.captured.some(([, a]) => a.join(' ').includes('Sin migraciones pendientes (user_version = 1)')));
check('Esquema y datos sin cambios', sameData(after, snapshot(legacyPath)));

section('BD nueva (solo migración 1)');
const freshPath = `${WORK_DIR}/nueva.db`;
const run3 = await runV1(freshPath);
const fresh = snapshot(freshPath);
check('16 tablas creadas, user_version = 1', run3.ok && fresh.userVersion === 1 && JSON.stringify(fresh.tables) === JSON.stringify([...TABLE_NAMES].sort()));
const freshDb = new DatabaseSync(freshPath, { readOnly: true });
const legacyDb = new DatabaseSync(legacyPath, { readOnly: true });
const cols = (db, t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => `${c.name}:${c.type}:${c.dflt_value}:${c.notnull}:${c.pk}`);
check('work_people tiene sort_order', cols(freshDb, 'work_people').some((c) => c.startsWith('sort_order:')));
const colDiffs = TABLE_NAMES.filter((t) => JSON.stringify(cols(freshDb, t)) !== JSON.stringify(cols(legacyDb, t)));
check('Columnas de la BD nueva = columnas de la BD existente', colDiffs.length === 0, colDiffs.join(', '));
freshDb.close();
legacyDb.close();

section('DEV_FAIL_MIGRATION en la migración 1: no deja nada a medias');
const oldPath = `${WORK_DIR}/antigua-sin-columna.db`;
buildLegacyDb(oldPath);
{
    const db = new DatabaseSync(oldPath);
    db.exec('ALTER TABLE series DROP COLUMN last_watched_at'); // simula una BD aún más vieja
    db.close();
}
const beforeFail = snapshot(oldPath);
DEV_FLAGS.DEV_FAIL_MIGRATION = true;
const runFail = await runV1(oldPath);
DEV_FLAGS.DEV_FAIL_MIGRATION = false;
const afterFail = snapshot(oldPath);
check('runMigrations falla con un mensaje claro', !runFail.ok && runFail.error.message.includes('Falló la migración 1'), runFail.error && runFail.error.message);
check('user_version sigue en 0 y el esquema no cambió', afterFail.userVersion === 0 && afterFail.schema === beforeFail.schema);
check('Datos idénticos', sameData(beforeFail, afterFail));
__setDatabasePath(oldPath);
const { result: failBackup } = await quiet(() => backup.createBackup());
check('El respaldo funciona igual con la migración fallida', existsSync(failBackup.physical.path) && existsSync(failBackup.json.path)
    && sameData(afterFail, snapshot(failBackup.physical.path)));
const runRetry = await runV1(oldPath);
check('Reintento: aplica la migración 1 y agrega series.last_watched_at', runRetry.ok && snapshot(oldPath).schema.includes('last_watched_at'));

// ---------------------------------------------------------------------------
section('Respaldo real con backup.js');
__setDatabasePath(legacyPath);
const beforeBackup = snapshot(legacyPath);
const { result: bk } = await quiet(() => backup.createBackup());
const afterBackup = snapshot(legacyPath);
check('El respaldo no modifica la BD', afterBackup.schema === beforeBackup.schema && sameData(beforeBackup, afterBackup) && afterBackup.userVersion === beforeBackup.userVersion);
check('Se generaron .db y .json en respaldos/', existsSync(bk.physical.path) && existsSync(bk.json.path), readdirSync(`${WORK_DIR}/respaldos`).length + ' archivo(s)');
const copySnap = snapshot(bk.physical.path);
check('Copia física (VACUUM INTO): mismo user_version, esquema y datos', copySnap.userVersion === beforeBackup.userVersion && copySnap.schema === beforeBackup.schema && sameData(beforeBackup, copySnap));
const bkJson = JSON.parse(readFileSync(bk.json.path, 'utf8'));
check('JSON: users.password reemplazado', bkJson.data.users.every((u) => u.password === '[OCULTO]'));
check('JSON: metadatos completos (incluye los .db del directorio)', ['sqliteVersion', 'userVersion', 'appVersion', 'createdAt', 'counts', 'schema', 'dbFilesInSqliteDir'].every((k) => bkJson.meta[k] !== undefined)
    && bkJson.meta.dbFilesInSqliteDir.some((f) => f.name === 'existente.db'), `app ${bkJson.meta.appVersion}; ${bkJson.meta.dbFilesInSqliteDir.length} .db listados`);
let validatorOk = true;
try {
    execSync(`node scripts/validar-respaldo.mjs "${bk.json.path}" --db "${bk.physical.path}" --out "${WORK_DIR}/validado.sqlite"`, { stdio: 'pipe' });
} catch (e) {
    validatorOk = false;
    console.log(e.stdout.toString());
}
check('validar-respaldo.mjs acepta el respaldo y coincide con la copia .db', validatorOk);
let compareOk = true;
try {
    execSync(`node scripts/comparar-bd.mjs "${legacyPath}" "${bk.physical.path}"`, { stdio: 'pipe' });
} catch (e) {
    compareOk = false;
    console.log(e.stdout.toString());
}
check('comparar-bd.mjs: BD = copia física', compareOk);

console.log(failures === 0 ? '\nTODAS LAS PRUEBAS PASARON.' : `\n${failures} prueba(s) fallaron.`);
process.exit(failures === 0 ? 0 : 1);
