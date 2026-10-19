// Pruebas en PC de la Fase 0 con el código REAL de src/services (migrations.js,
// db.js, backup.js), sustituyendo expo-sqlite por node:sqlite (scripts/lib).
// No toca el celular ni el emulador. Trabaja en .local-data/pruebas-pc/ con datos ficticios.
//
// Uso: node scripts/probar-fase0.mjs
//
// La BD "existente" se construye ejecutando el SQL de init() tal como está en
// git HEAD (commit anterior a la Fase 0), simulando dos arranques de la app vieja.
import './lib/test-hooks.mjs';
import { execSync } from 'node:child_process';
import { mkdirSync, rmSync, copyFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { listTables, getUserVersion, getSchema, countAll, hashAll } from './lib/sqlite-utils.mjs';

const { __setDatabasePath } = await import('./lib/expo-sqlite-shim.mjs');
const { backupCalls, backupStub } = await import('./lib/backup-stub.mjs');
const { DEV_FLAGS } = await import('../src/services/devFlags.js');
const { MIGRATIONS, TABLE_NAMES } = await import('../src/services/migrations.js');
const { DatabaseService, QUEUED_MUTATIONS, TX_MUTATIONS } = await import('../src/services/db.js');
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

const newService = async (path) => {
    __setDatabasePath(path);
    const service = new DatabaseService();
    const { result: ok, captured } = await quiet(() => service.init());
    return { service, ok, captured };
};

// --- BD "existente": SQL de init() de git HEAD, dos arranques ---
const legacySource = execSync('git show HEAD:src/services/db.js', { encoding: 'utf8' });
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
section('Criterio 4: BD existente (esquema de HEAD) → migración 1');
const legacyPath = `${WORK_DIR}/existente.db`;
buildLegacyDb(legacyPath);
const before = snapshot(legacyPath);
check('BD existente creada con el código de HEAD', before.tables.length === 16 && before.userVersion === 0, `${before.tables.length} tablas, user_version ${before.userVersion}`);
backupCalls.length = 0;
const run1 = await newService(legacyPath);
check('init() devuelve true', run1.ok === true);
const after = snapshot(legacyPath);
check('user_version = 1', after.userVersion === 1);
check('sqlite_master idéntico', after.schema === before.schema);
check('Mismos conteos y contenido en las 16 tablas', sameData(before, after), JSON.stringify(after.counts));
check('Migración 1 no pidió copia física (solo las >= 2)', backupCalls.length === 0);
await run1.service.db.closeAsync();

section('Criterio 6: segundo arranque');
const run2 = await newService(legacyPath);
const logs2 = run2.captured.map(([, a]) => a.join(' ')).join('\n');
check('init() devuelve true', run2.ok === true);
check('Log "Sin migraciones pendientes"', logs2.includes('Sin migraciones pendientes (user_version = 1)'));
const after2 = snapshot(legacyPath);
check('Esquema y datos sin cambios', after2.schema === after.schema && sameData(after, after2));
await run2.service.db.closeAsync();

// ---------------------------------------------------------------------------
section('Criterio 5: BD nueva');
const freshPath = `${WORK_DIR}/nueva.db`;
const run3 = await newService(freshPath);
const fresh = snapshot(freshPath);
const errors3 = run3.captured.filter(([k]) => k === 'error');
check('init() devuelve true', run3.ok === true);
check('16 tablas creadas', fresh.tables.length === 16 && JSON.stringify(fresh.tables) === JSON.stringify([...TABLE_NAMES].sort()));
check('user_version = 1', fresh.userVersion === 1);
check('Sin errores en el log', errors3.length === 0, `${errors3.length} errores`);
const freshDb = new DatabaseSync(freshPath, { readOnly: true });
const cols = (db, t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => `${c.name}:${c.type}:${c.dflt_value}:${c.notnull}:${c.pk}`);
check('work_people tiene sort_order', cols(freshDb, 'work_people').some((c) => c.startsWith('sort_order:')));
const legacyDb = new DatabaseSync(legacyPath, { readOnly: true });
const colDiffs = TABLE_NAMES.filter((t) => JSON.stringify(cols(freshDb, t)) !== JSON.stringify(cols(legacyDb, t)));
check('Columnas de la BD nueva = columnas de la BD existente (mismo orden y tipo)', colDiffs.length === 0, colDiffs.join(', '));
freshDb.close();
legacyDb.close();
await run3.service.db.closeAsync();

// ---------------------------------------------------------------------------
section('DEV_FAIL_MIGRATION: la migración falla y no deja nada a medias');
const oldPath = `${WORK_DIR}/antigua-sin-columna.db`;
buildLegacyDb(oldPath);
{
    const db = new DatabaseSync(oldPath);
    db.exec('ALTER TABLE series DROP COLUMN last_watched_at'); // simula una BD aún más vieja
    db.close();
}
const beforeFail = snapshot(oldPath);
DEV_FLAGS.DEV_FAIL_MIGRATION = true;
const runFail = await newService(oldPath);
DEV_FLAGS.DEV_FAIL_MIGRATION = false;
const afterFail = snapshot(oldPath);
check('init() devuelve false', runFail.ok === false);
check('lastInitError explica el fallo', !!runFail.service.lastInitError && runFail.service.lastInitError.message.includes('Falló la migración 1'), runFail.service.lastInitError && runFail.service.lastInitError.message);
check('this.db queda sin asignar (la app no arranca con esquema a medias)', runFail.service.db === null);
check('user_version sigue en 0', afterFail.userVersion === 0);
check('La columna agregada se deshizo (sqlite_master idéntico)', afterFail.schema === beforeFail.schema);
check('Datos idénticos', sameData(beforeFail, afterFail));

// El respaldo funciona igual con la migración fallida (conexión propia, sin init)
__setDatabasePath(oldPath);
const { result: failBackup } = await quiet(() => backup.createBackup());
const failCopy = snapshot(failBackup.physical.path);
check('Respaldo generado tras la migración fallida', existsSync(failBackup.physical.path) && existsSync(failBackup.json.path));
check('Copia física = BD sin migrar (user_version 0, mismos datos)', failCopy.userVersion === 0 && sameData(afterFail, failCopy));
const failJson = JSON.parse(readFileSync(failBackup.json.path, 'utf8'));
check('JSON: user_version 0 y conteos correctos', failJson.meta.userVersion === 0 && JSON.stringify(failJson.meta.counts) === JSON.stringify(afterFail.counts));

const runRetry = await newService(oldPath);
const afterRetry = snapshot(oldPath);
check('Reintento sin el flag: init() devuelve true y user_version = 1', runRetry.ok === true && afterRetry.userVersion === 1);
check('Reintento: agrega series.last_watched_at y conserva los datos', afterRetry.schema.includes('last_watched_at') && JSON.stringify(afterRetry.counts) === JSON.stringify(afterFail.counts));
await runRetry.service.db.closeAsync();

// ---------------------------------------------------------------------------
section('Migraciones >= 2 exigen copia física previa');
const v2Path = `${WORK_DIR}/v2.db`;
copyFileSync(legacyPath, v2Path);
MIGRATIONS.push({
    version: 2,
    description: 'migración ficticia de prueba',
    up: async (txn) => { await txn.execAsync('CREATE TABLE prueba_v2 (id INTEGER PRIMARY KEY)'); },
});
backupCalls.length = 0;
backupStub.shouldFail = true;
const runNoBackup = await newService(v2Path);
const afterNoBackup = snapshot(v2Path);
check('Si la copia falla: init() devuelve false', runNoBackup.ok === false, runNoBackup.service.lastInitError && runNoBackup.service.lastInitError.message);
check('Si la copia falla: no se toca nada (user_version 1, sin tabla nueva)', afterNoBackup.userVersion === 1 && !afterNoBackup.tables.includes('prueba_v2'));
backupStub.shouldFail = false;
backupCalls.length = 0;
const runWithBackup = await newService(v2Path);
const afterWithBackup = snapshot(v2Path);
check('Con copia OK: se pidió la copia "pre-migracion-v2"', backupCalls.includes('pre-migracion-v2'));
check('Con copia OK: migración aplicada (user_version 2)', runWithBackup.ok === true && afterWithBackup.userVersion === 2);
await runWithBackup.service.db.closeAsync();
MIGRATIONS.pop();
const runNewer = await newService(v2Path);
check('BD de una versión más nueva: se rechaza sin tocarla', runNewer.ok === false && runNewer.service.lastInitError.message.includes('versión más nueva') && snapshot(v2Path).userVersion === 2);

// ---------------------------------------------------------------------------
section('Criterio 7: DEV_FAIL_TX en cada operación transaccional');
const txPath = `${WORK_DIR}/transacciones.db`;
copyFileSync(legacyPath, txPath);
const { service: svc } = await newService(txPath);
const daysChanged = { name: 'Anime', type: 'video', startDate: '2026-01-01', daysOfWeek: { Monday: 2 }, frequency: 0, seriesCount: 2, description: null };
const operations = {
    registerUser: () => svc.registerUser('nuevo', 'x'),
    addTransaction: () => svc.addTransaction(1, null, 'Contacto nuevo', 'debt', 10, 'd'),
    registerMoneyMovement: () => svc.registerMoneyMovement(1, { amount: 30, category: 'Préstamos', description: 'm', linked: { contactId: null, contactName: 'Contacto nuevo 2', type: 'debt', amount: 30, description: 'm' } }),
    addEntertainmentCategory: () => svc.addEntertainmentCategory(1, { name: 'Nueva', type: 'video', startDate: '2026-02-01', daysOfWeek: { Monday: 1 }, frequency: 0, seriesCount: 1, description: null }),
    updateEntertainmentCategory: () => svc.updateEntertainmentCategory(1, daysChanged),
    addSeriesWithSeasons: () => svc.addSeriesWithSeasons({ category_id: 1, name: 'Serie nueva', description: null, status: 'Nueva', current_season: 1, current_episode: 1, total_seasons: 2 }, [{ season_number: 1, episode_count: 10 }, { season_number: 2, episode_count: 8 }]),
    updateSeriesWithSeasons: () => svc.updateSeriesWithSeasons(1, { name: 'Serie 1', description: null, total_seasons: 2, status: 'Mirando' }, [{ season_number: 1, episode_count: 12 }, { season_number: 2, episode_count: 6 }]),
};
check('Las 7 operaciones probadas son exactamente TX_MUTATIONS', JSON.stringify(Object.keys(operations).sort()) === JSON.stringify([...TX_MUTATIONS].sort()));
for (const [name, op] of Object.entries(operations)) {
    const beforeOp = snapshot(txPath);
    DEV_FLAGS.DEV_FAIL_TX = true;
    const { result } = await quiet(op);
    DEV_FLAGS.DEV_FAIL_TX = false;
    const afterOp = snapshot(txPath);
    check(`${name}: con fallo simulado devuelve success:false y no deja escrituras`, result.success === false && sameData(beforeOp, afterOp), result.error);
    const { result: okResult } = await quiet(op);
    const afterOk = snapshot(txPath);
    check(`${name}: sin fallo funciona y escribe`, okResult.success === true && !sameData(afterOp, afterOk));
}

// ---------------------------------------------------------------------------
section('Cola serializada');
check('Todas las mutaciones de db.js están en QUEUED_MUTATIONS', (() => {
    const source = readFileSync('src/services/db.js', 'utf8');
    const writers = new Set();
    let current = null;
    for (const line of source.split('\n')) {
        const m = line.match(/^ {4}async ([a-zA-Z]\w*)\(/);
        if (m) current = m[1];
        if (current && /runAsync|execAsync|this\._tx\(/.test(line)) writers.add(current);
    }
    writers.delete('init');
    const missing = [...writers].filter((w) => !QUEUED_MUTATIONS.includes(w));
    if (missing.length) console.log('     faltan:', missing.join(', '));
    return missing.length === 0;
})(), `${QUEUED_MUTATIONS.length} mutaciones encoladas, ${TX_MUTATIONS.length} con transacción`);
const balanceBefore = (await svc.getUserBalance(1)).balance;
const concurrent = [];
for (let i = 0; i < 20; i++) {
    concurrent.push(svc.registerMoneyMovement(1, { amount: 1, category: 'Comida', description: `c${i}`, linked: null }));
    concurrent.push(svc.addBalanceTransaction(1, 0, 'Comida', `b${i}`));
    concurrent.push(svc.updateSeriesSortOrder(1, i));
}
const { result: results } = await quiet(() => Promise.all(concurrent));
const balanceAfter = (await svc.getUserBalance(1)).balance;
check('60 mutaciones concurrentes sin errores', results.every((r) => r.success), `${results.filter((r) => !r.success).length} fallaron`);
check('Saldo final = saldo inicial + 20 (sin escrituras perdidas)', Math.abs(balanceAfter - (balanceBefore + 20)) < 1e-9, `${balanceBefore} → ${balanceAfter}`);
await svc.db.closeAsync();

// ---------------------------------------------------------------------------
section('Criterio 3 (en PC): respaldo real con backup.js');
__setDatabasePath(legacyPath);
const beforeBackup = snapshot(legacyPath);
const { result: bk } = await quiet(() => backup.createBackup());
const afterBackup = snapshot(legacyPath);
check('El respaldo no modifica la BD', afterBackup.schema === beforeBackup.schema && sameData(beforeBackup, afterBackup) && afterBackup.userVersion === beforeBackup.userVersion);
check('Se generaron .db y .json en respaldos/', existsSync(bk.physical.path) && existsSync(bk.json.path), readdirSync(`${WORK_DIR}/respaldos`).join(', '));
const copySnap = snapshot(bk.physical.path);
check('Copia física (VACUUM INTO): mismo user_version, esquema y datos', copySnap.userVersion === beforeBackup.userVersion && copySnap.schema === beforeBackup.schema && sameData(beforeBackup, copySnap));
const bkJson = JSON.parse(readFileSync(bk.json.path, 'utf8'));
check('JSON: users.password reemplazado', bkJson.data.users.every((u) => u.password === '[OCULTO]'));
check('JSON: metadatos completos', ['sqliteVersion', 'userVersion', 'appVersion', 'createdAt', 'counts', 'schema'].every((k) => bkJson.meta[k] !== undefined), `SQLite ${bkJson.meta.sqliteVersion}, app ${bkJson.meta.appVersion}`);
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
