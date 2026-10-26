// Dry-run de la migración 2 (Fase 1) en PC, con el código REAL de src/ sobre node:sqlite.
// Trabaja SIEMPRE sobre copias en .local-data/dryrun-fase1/; nunca toca los originales.
// No imprime filas ni textos: solo conteos, sumas y OK/FALLA.
//
// Uso: node scripts/dryrun-fase1.mjs
//      node scripts/dryrun-fase1.mjs --par <antes.db> <despues.db> [--etiqueta X]
//        (modo dispositivo: "después" ya fue migrada por la app en el emulador/celular;
//         se verifican los mismos criterios sin volver a migrar)
//
// Para cada BD (respaldo real + pruebas A, B, C):
//   - "antes": el db.js de la Fase 0 (commit 522161a) sobre una copia sin migrar;
//   - "después": el db.js actual (migraciones 1 y 2) sobre otra copia;
//   - criterios 1–5 de la 1.5 (conteos, _id_map, FK, user_id, equivalencias de negocio).
import './lib/test-hooks.mjs';
import { execSync } from 'node:child_process';
import { mkdirSync, rmSync, copyFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const argv = process.argv.slice(2);
const pairIndex = argv.indexOf('--par');
const DATABASES = pairIndex >= 0
    ? [[argv[argv.indexOf('--etiqueta') + 1] && argv.includes('--etiqueta') ? argv[argv.indexOf('--etiqueta') + 1] : 'dispositivo', argv[pairIndex + 1], argv[pairIndex + 2]]]
    : [
        ['real', '.local-data/respaldo-real/registro_respaldo_20261020-211827.db'],
        ['A', '.local-data/emulador-antes.db'],
        ['B', '.local-data/emulador/checklist/app.db'],
        ['C', '.local-data/emulador-eas/antes.db'],
    ];
const OLD_COMMIT = '522161a';
const WORK = resolve('.local-data/dryrun-fase1').replace(/\\/g, '/');
rmSync(WORK, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });

// Código "antes" (Fase 0) extraído de git, para calcular las equivalencias con la lógica vieja.
const OLD_SRC = `${WORK}/_old_src/services`;
mkdirSync(OLD_SRC, { recursive: true });
for (const f of ['db.js', 'migrations.js', 'dbConfig.js', 'devFlags.js']) {
    writeFileSync(`${OLD_SRC}/${f}`, execSync(`git show ${OLD_COMMIT}:src/services/${f}`));
}

const { __setDatabasePath } = await import('./lib/expo-sqlite-shim.mjs');
const { DatabaseService: OldService } = await import(`file:///${OLD_SRC}/db.js`);
const { DatabaseService: NewService } = await import('../src/services/db.js');
const { calculateBacklogV2 } = await import('../src/services/backlogUtils.js');
const { MIGRATED_TABLES } = await import('../src/data/db/migration2.ts');
const { UUID_V4_RE } = await import('../src/data/ids.ts');

let failures = 0;
const check = (name, ok, detail = '') => {
    console.log(`${ok ? 'OK  ' : 'FALLA'} ${name}${detail ? ` — ${detail}` : ''}`);
    if (!ok) failures++;
};
const quiet = async (fn) => {
    const { log, error } = console;
    console.log = () => {};
    console.error = () => {};
    try { return await fn(); } finally { console.log = log; console.error = error; }
};
const near = (a, b) => Math.abs((a || 0) - (b || 0)) < 0.005;

const summary = [];

for (const [label, source, migratedOnDevice] of DATABASES) {
    console.log(`\n==== ${label}: ${source} ====`);
    if (!existsSync(source)) { check('existe la BD', false, source); continue; }
    const oldPath = `${WORK}/${label}/antes/app_registro_v3.db`;
    const newPath = `${WORK}/${label}/despues/app_registro_v3.db`;
    mkdirSync(`${WORK}/${label}/antes`, { recursive: true });
    mkdirSync(`${WORK}/${label}/despues`, { recursive: true });
    copyFileSync(source, oldPath);
    copyFileSync(migratedOnDevice || source, newPath);

    // ---- ANTES (lógica Fase 0) ----
    __setDatabasePath(oldPath);
    const oldSvc = new OldService();
    check('antes: init (Fase 0)', await quiet(() => oldSvc.init()));
    const oldDb = new DatabaseSync(oldPath, { readOnly: false });
    const oldUsers = oldDb.prepare('SELECT id, current_balance FROM users ORDER BY id').all().map((r) => ({ ...r }));
    const before = {};
    for (const u of oldUsers) {
        const cats = (await oldSvc.getEntertainmentCategories(u.id)).categories;
        const perCat = {};
        for (const c of cats) {
            const list = (await oldSvc.getSeriesByCategory(c.id)).series;
            const withSeasons = [];
            for (const s of list) withSeasons.push({ ...s, seasons: (await oldSvc.getSeasonsBySeries(s.id)).seasons });
            perCat[c.id] = { totalWatched: c.totalWatched, backlog: JSON.stringify(calculateBacklogV2(c, withSeasons)) };
        }
        before[u.id] = { balance: u.current_balance || 0, perCat };
    }
    const legacySums = {
        debts: oldDb.prepare('SELECT contact_id, type, SUM(amount) s FROM finance_transactions GROUP BY contact_id, type').all().map((r) => ({ ...r })),
        cycle: oldDb.prepare('SELECT COALESCE(SUM(cycle_offset), 0) s FROM series').get().s,
        watch: { ...oldDb.prepare('SELECT MIN(watched_at) mn, MAX(watched_at) mx FROM watch_history').get() },
        read: { ...oldDb.prepare('SELECT MIN(read_at) mn, MAX(read_at) mx FROM reading_history').get() },
    };
    oldDb.close();

    // ---- DESPUÉS (migraciones 1 y 2 con el código actual) ----
    __setDatabasePath(newPath);
    const newSvc = new NewService();
    const okInit = await quiet(() => newSvc.init());
    check(migratedOnDevice ? 'después (migrada en el dispositivo): abre sin migraciones pendientes' : 'después: init con migración 2',
        okInit && (!migratedOnDevice || newSvc.lastMigration.applied.length === 0),
        okInit ? `aplicadas ahora: ${newSvc.lastMigration.applied.join(', ') || 'ninguna'}` : newSvc.lastInitError && newSvc.lastInitError.message);
    if (!okInit) continue;
    const db = new DatabaseSync(newPath, { readOnly: true });
    const q = (sql, ...p) => db.prepare(sql).all(...p).map((r) => ({ ...r }));
    const one = (sql, ...p) => ({ ...db.prepare(sql).get(...p) });
    check('user_version = 2', one('PRAGMA user_version').user_version === 2);
    const log = JSON.parse(one("SELECT payload FROM _migration_log WHERE kind = 'summary' ORDER BY id DESC LIMIT 1").payload);

    // 1. Conteos
    const rows = [];
    let countsOk = true;
    for (const t of MIGRATED_TABLES) {
        const legacyN = one(`SELECT COUNT(*) n FROM legacy_${t}`).n;
        const newN = one(`SELECT COUNT(*) n FROM ${t}${t === 'users' ? '' : ' WHERE deleted_at IS NULL'}`).n;
        const allowed = t === 'balance_history' ? log.balanceAdjustments.length : 0;
        const ok = newN === legacyN + allowed - (t === 'seasons' ? log.seasonDuplicatesDiscarded : 0);
        countsOk &&= ok;
        rows.push([t, legacyN, newN, ok ? '' : '≠']);
    }
    check('1. conteos legacy_* = nuevos', countsOk, `ajustes de saldo declarados: ${log.balanceAdjustments.length}`);

    // 2. _id_map
    const totalLegacy = rows.reduce((a, r) => a + r[1], 0) - log.seasonDuplicatesDiscarded;
    const ids = q('SELECT new_id FROM _id_map').map((r) => r.new_id);
    check('2. _id_map = filas migradas, únicos, UUID v4',
        ids.length === totalLegacy && new Set(ids).size === ids.length && ids.every((x) => UUID_V4_RE.test(x)),
        `${ids.length} UUID`);

    // 3. FK sin huérfanos
    const FKS = [['finance_transactions', 'contact_id', 'finance_contacts'], ['entertainment_pauses', 'category_id', 'entertainment_categories'],
        ['entertainment_quotas_history', 'category_id', 'entertainment_categories'], ['series', 'category_id', 'entertainment_categories'],
        ['seasons', 'series_id', 'series'], ['watch_history', 'series_id', 'series'], ['reading_history', 'series_id', 'series']];
    let orphans = 0;
    for (const [t, c, p] of FKS) orphans += one(`SELECT COUNT(*) n FROM ${t} x WHERE NOT EXISTS (SELECT 1 FROM ${p} y WHERE y.id = x.${c})`).n;
    for (const t of MIGRATED_TABLES.filter((x) => x !== 'users')) orphans += one(`SELECT COUNT(*) n FROM ${t} x WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = x.user_id)`).n;
    check('3. FK sin huérfanos y foreign_key_check vacío', orphans === 0 && q('PRAGMA foreign_key_check').length === 0, `${orphans} huérfanas`);

    // 4. user_id desnormalizado coherente
    const OWN = [['finance_transactions', 'finance_contacts', 'contact_id'], ['entertainment_pauses', 'entertainment_categories', 'category_id'],
        ['entertainment_quotas_history', 'entertainment_categories', 'category_id'], ['series', 'entertainment_categories', 'category_id'],
        ['seasons', 'series', 'series_id'], ['watch_history', 'series', 'series_id'], ['reading_history', 'series', 'series_id']];
    let mismatched = 0;
    for (const [t, p, c] of OWN) mismatched += one(`SELECT COUNT(*) n FROM ${t} x JOIN ${p} y ON y.id = x.${c} WHERE x.user_id <> y.user_id`).n;
    check('4. user_id de las hijas = dueño por la cadena de padres', mismatched === 0, `${mismatched} distintas`);

    // 5. Equivalencias de negocio
    const userMap = Object.fromEntries(q("SELECT old_id, new_id FROM _id_map WHERE table_name = 'users'").map((r) => [r.old_id, r.new_id]));
    const catMap = Object.fromEntries(q("SELECT old_id, new_id FROM _id_map WHERE table_name = 'entertainment_categories'").map((r) => [r.old_id, r.new_id]));
    const contactMap = Object.fromEntries(q("SELECT old_id, new_id FROM _id_map WHERE table_name = 'finance_contacts'").map((r) => [r.old_id, r.new_id]));
    let balanceOk = true; let watchedOk = true; let backlogOk = true; let cats = 0;
    for (const [oldUserId, b] of Object.entries(before)) {
        const newUserId = userMap[oldUserId];
        balanceOk &&= near((await newSvc.getUserBalance(newUserId)).balance, b.balance);
        const newCats = (await newSvc.getEntertainmentCategories(newUserId)).categories;
        for (const [oldCatId, v] of Object.entries(b.perCat)) {
            cats++;
            const c = newCats.find((x) => x.id === catMap[oldCatId]);
            if (!c) { watchedOk = false; continue; }
            const list = (await newSvc.getSeriesByCategory(c.id)).series;
            const withSeasons = [];
            for (const s of list) withSeasons.push({ ...s, seasons: (await newSvc.getSeasonsBySeries(s.id)).seasons });
            watchedOk &&= c.totalWatched === v.totalWatched;
            backlogOk &&= JSON.stringify(calculateBacklogV2(c, withSeasons)) === v.backlog;
        }
    }
    check('5a. saldo calculado después = current_balance antes (por cuenta)', balanceOk, `${oldUsers.length} cuenta(s)`);
    const newDebts = q('SELECT contact_id, type, SUM(amount) s FROM finance_transactions WHERE deleted_at IS NULL GROUP BY contact_id, type');
    check('5b. SUM(amount) por contacto y tipo idéntico',
        legacySums.debts.length === newDebts.length && legacySums.debts.every((d) => newDebts.some((n) => n.contact_id === contactMap[d.contact_id] && n.type === d.type && near(n.s, d.s))),
        `${newDebts.length} grupo(s)`);
    check('5c. SUM(cycle_offset) idéntico', one('SELECT COALESCE(SUM(cycle_offset), 0) s FROM series').s === legacySums.cycle);
    check('5d. totalWatched por categoría idéntico', watchedOk, `${cats} categoría(s)`);
    check('5e. calculateBacklogV2 por categoría idéntico', backlogOk);
    const w = one('SELECT MIN(watched_at) mn, MAX(watched_at) mx FROM watch_history');
    const r = one('SELECT MIN(read_at) mn, MAX(read_at) mx FROM reading_history');
    check('5f. mín/máx de watched_at y read_at idénticos',
        w.mn === legacySums.watch.mn && w.mx === legacySums.watch.mx && r.mn === legacySums.read.mn && r.mx === legacySums.read.mx);
    check('_migration_log lista los .db del directorio', Array.isArray(log.dbFilesInSqliteDir) && log.dbFilesInSqliteDir.length > 0,
        log.dbFilesInSqliteDir.map((f) => `${f.name} (${f.size} B)`).join(', '));
    if (!migratedOnDevice) check('outbox vacía (las filas migradas no se encolan)', one('SELECT COUNT(*) n FROM outbox').n === 0);
    else console.log(`     outbox: ${one('SELECT COUNT(*) n FROM outbox').n} entrada(s) (las de escrituras hechas en el dispositivo después de migrar)`);
    db.close();
    await newSvc.db.closeAsync();
    summary.push([label, rows]);
}

console.log('\n==== Conteos antes (legacy_*) → después (vivos) ====');
const labels = summary.map(([l]) => l);
console.log(['tabla', ...labels].join(' | '));
for (const t of MIGRATED_TABLES) {
    console.log([t, ...summary.map(([, rows]) => {
        const r = rows.find((x) => x[0] === t);
        return `${r[1]}→${r[2]}${r[3]}`;
    })].join(' | '));
}

console.log(failures === 0 ? '\nDRY-RUN OK: criterios 1–5 cumplidos en todas las BD.' : `\n${failures} verificación(es) fallaron.`);
process.exit(failures === 0 ? 0 : 1);
