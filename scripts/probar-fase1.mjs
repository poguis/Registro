// Pruebas en PC de la Fase 1 (criterios 6–9 de la 1.5 y cambios de comportamiento 1.4),
// con el código REAL de src/ sobre node:sqlite. Trabaja en .local-data/pruebas-fase1/
// con copias de las BD de prueba (nunca toca originales). No imprime filas.
//
// Uso: node scripts/probar-fase1.mjs
import './lib/test-hooks.mjs';
import { mkdirSync, rmSync, copyFileSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { getSchema, countAll, hashAll } from './lib/sqlite-utils.mjs';

const { __setDatabasePath } = await import('./lib/expo-sqlite-shim.mjs');
const { backupCalls, backupStub } = await import('./lib/backup-stub.mjs');
const { DEV_FLAGS } = await import('../src/services/devFlags.js');
const { DatabaseService, QUEUED_MUTATIONS } = await import('../src/services/db.js');
const { MIGRATED_TABLES } = await import('../src/data/db/migration2.ts');

const WORK = resolve('.local-data/pruebas-fase1').replace(/\\/g, '/');
rmSync(WORK, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });

let failures = 0;
const check = (name, ok, detail = '') => {
    console.log(`${ok ? 'OK  ' : 'FALLA'} ${name}${detail ? ` — ${detail}` : ''}`);
    if (!ok) failures++;
};
const section = (t) => console.log(`\n== ${t} ==`);
const quiet = async (fn) => {
    const { log, error } = console;
    const captured = [];
    console.log = (...a) => captured.push(a.join(' '));
    console.error = (...a) => captured.push(a.join(' '));
    try { return { result: await fn(), captured }; } finally { console.log = log; console.error = error; }
};
const prepare = (label, source) => {
    const dir = `${WORK}/${label}`;
    mkdirSync(dir, { recursive: true });
    copyFileSync(source, `${dir}/app_registro_v3.db`);
    return `${dir}/app_registro_v3.db`;
};
const open = async (path) => {
    __setDatabasePath(path);
    const svc = new DatabaseService();
    const { result: ok, captured } = await quiet(() => svc.init());
    return { svc, ok, captured };
};
const snap = (path) => {
    const db = new DatabaseSync(path, { readOnly: true });
    const s = { uv: db.prepare('PRAGMA user_version').get().user_version, schema: JSON.stringify(getSchema(db)), counts: countAll(db), hashes: hashAll(db) };
    db.close();
    return s;
};
const same = (a, b) => a.uv === b.uv && a.schema === b.schema && JSON.stringify(a.counts) === JSON.stringify(b.counts) && JSON.stringify(a.hashes) === JSON.stringify(b.hashes);

// ---------------------------------------------------------------------------
section('Criterio 6: idempotencia');
const pB = prepare('B', '.local-data/emulador/checklist/app.db');
const r1 = await open(pB);
check('primer arranque migra a v2', r1.ok && r1.svc.lastMigration.applied.includes(2));
await r1.svc.db.closeAsync();
const afterFirst = snap(pB);
const r2 = await open(pB);
check('segundo arranque: sin migraciones pendientes', r2.ok && r2.svc.lastMigration.applied.length === 0 && r2.captured.some((l) => l.includes('Sin migraciones pendientes (user_version = 2)')));
await r2.svc.db.closeAsync();
check('segundo arranque: esquema, conteos y contenido idénticos', same(afterFirst, snap(pB)));

// ---------------------------------------------------------------------------
section('Criterio 7: fallo simulado en la migración 2 (DEV_FAIL_MIGRATION)');
const pF = prepare('fallo', '.local-data/emulador/checklist/app.db'); // v1: solo corre la migración 2
const beforeFail = snap(pF);
backupCalls.length = 0;
DEV_FLAGS.DEV_FAIL_MIGRATION = true;
const rf = await open(pF);
DEV_FLAGS.DEV_FAIL_MIGRATION = false;
check('init devuelve false y no asigna la conexión', rf.ok === false && rf.svc.db === null, rf.svc.lastInitError && rf.svc.lastInitError.message);
check('se pidió la copia física previa (requiresBackup)', backupCalls.includes('pre-migracion-v2'));
check('BD idéntica: user_version 1, mismas tablas, conteos y contenido', same(beforeFail, snap(pF)), `user_version ${snap(pF).uv}`);
backupStub.shouldFail = true;
const rb = await open(pF);
backupStub.shouldFail = false;
check('si la copia previa falla, no migra y no toca nada', rb.ok === false && same(beforeFail, snap(pF)), rb.svc.lastInitError && rb.svc.lastInitError.message);
const rr = await open(pF);
check('reintento sin fallos: migra a v2', rr.ok && snap(pF).uv === 2);
await rr.svc.db.closeAsync();

// ---------------------------------------------------------------------------
section('Migración con datos inconsistentes (sintéticos)');
const pS = prepare('sintetica', '.local-data/emulador-antes.db');
{
    // Simula una BD vieja con saldo desfasado y una temporada duplicada (en datos reales no ocurre).
    const d = new DatabaseSync(pS);
    d.exec("UPDATE users SET current_balance = current_balance + 12.5");
    const s = d.prepare('SELECT series_id, season_number, episode_count FROM seasons LIMIT 1').get();
    d.prepare('INSERT INTO seasons (series_id, season_number, episode_count) VALUES (?, ?, ?)').run(s.series_id, s.season_number, s.episode_count + 1);
    d.close();
}
const rs = await open(pS);
check('migra con saldo desfasado y temporada duplicada', rs.ok, rs.svc.lastInitError && rs.svc.lastInitError.message);
if (rs.ok) {
    const summary = (await rs.svc.getLatestMigrationSummary()).summary;
    check('inserta UN movimiento "Ajuste" por la diferencia (+12,50)', summary.balanceAdjustments.length === 1 && summary.balanceAdjustments[0].amount === 12.5);
    check('descarta la temporada duplicada (se conserva la de id mayor) y lo registra', summary.seasonDuplicatesDiscarded === 1);
    const u = (await rs.svc.loginUser('__nadie__', '__nada__'));
    check('loginUser con credenciales malas → error', u.success === false);
    await rs.svc.db.closeAsync();
}

// ---------------------------------------------------------------------------
section('Criterio 8: outbox — una entrada por registro afectado, en la misma transacción');
const pO = prepare('outbox', '.local-data/emulador/checklist/app.db');
const ro = await open(pO);
const svc = ro.svc;
const raw = new DatabaseSync(pO, { readOnly: true });
const SYNC_TABLES = MIGRATED_TABLES.filter((t) => t !== 'users');
const stateOf = () => {
    const m = new Map();
    for (const t of SYNC_TABLES) for (const r of raw.prepare(`SELECT id, updated_at, deleted_at FROM ${t}`).all()) m.set(`${t}:${r.id}`, `${r.updated_at}|${r.deleted_at}`);
    return m;
};
const outboxMax = () => raw.prepare('SELECT COALESCE(MAX(id), 0) m FROM outbox').get().m;
const outboxSince = (id) => raw.prepare('SELECT table_name, row_id FROM outbox WHERE id > ?').all(id).map((r) => `${r.table_name}:${r.row_id}`);
const user = raw.prepare("SELECT u.id FROM users u JOIN balance_history b ON b.user_id = u.id LIMIT 1").get().id;
const firstOf = (sql, ...p) => { const r = raw.prepare(sql).get(...p); return r ? { ...r } : null; };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms)); // updated_at tiene ms: garantiza que cambie
const tested = new Set();
async function op(name, fn, { expectSome = true } = {}) {
    tested.add(name);
    await sleep(3);
    const before = stateOf();
    const mark = outboxMax();
    const { result } = await quiet(fn);
    const after = stateOf();
    const changed = new Set([...after].filter(([k, v]) => before.get(k) !== v).map(([k]) => k));
    const entries = outboxSince(mark);
    const unique = new Set(entries);
    const ok = result && result.success && entries.length === unique.size
        && unique.size === changed.size && [...changed].every((k) => unique.has(k)) && (!expectSome || changed.size > 0);
    check(`${name}: ${changed.size} registro(s) afectado(s) = ${entries.length} entrada(s) en outbox`, ok, result && result.error);
    // Rollback: con DEV_FAIL_TX la misma operación no deja filas ni entradas en la outbox.
    return result;
}
async function opFails(name, fn) {
    const before = stateOf();
    const mark = outboxMax();
    const counts = countAll(raw);
    DEV_FLAGS.DEV_FAIL_TX = true;
    const { result } = await quiet(fn);
    DEV_FLAGS.DEV_FAIL_TX = false;
    const after = stateOf();
    const unchanged = before.size === after.size && [...after].every(([k, v]) => before.get(k) === v);
    check(`${name} con DEV_FAIL_TX: falla sin dejar escrituras ni outbox`, result && result.success === false && unchanged && outboxSince(mark).length === 0 && JSON.stringify(countAll(raw)) === JSON.stringify(counts));
}

const cat = firstOf('SELECT id FROM entertainment_categories WHERE user_id = ? AND deleted_at IS NULL', user);
const ser = firstOf('SELECT id FROM series WHERE category_id = ? AND deleted_at IS NULL', cat.id);
const contact = firstOf('SELECT id, name FROM finance_contacts WHERE user_id = ? AND deleted_at IS NULL', user);

await opFails('registerMoneyMovement', () => svc.registerMoneyMovement(user, { amount: 5, category: 'Venta', description: 'x', linked: null }));
await op('registerMoneyMovement (simple)', () => svc.registerMoneyMovement(user, { amount: 5, category: 'Venta', description: 'x', linked: null }));
await op('registerMoneyMovement (con contacto nuevo)', () => svc.registerMoneyMovement(user, { amount: -7, category: 'Me deben', description: 'y', linked: { contactId: null, contactName: 'Prueba outbox', type: 'loan', amount: 7, description: 'y' } }));
const balBefore = (await svc.getUserBalance(user)).balance;
await op('updateUserBalance (crea "Ajuste")', () => svc.updateUserBalance(user, balBefore + 100));
check('updateUserBalance: saldo nuevo = pedido y se registró como movimiento "Ajuste"',
    Math.abs((await svc.getUserBalance(user)).balance - (balBefore + 100)) < 0.005
    && firstOf("SELECT COUNT(*) n FROM balance_history WHERE user_id = ? AND category = 'Ajuste' AND deleted_at IS NULL", user).n >= 1);
await op('addBalanceTransaction', () => svc.addBalanceTransaction(user, 1, 'Venta', null));
await op('addFinanceCategory', () => svc.addFinanceCategory(user, 'Categoría prueba'));
await op('addTransaction (contacto existente)', () => svc.addTransaction(user, contact.id, contact.name, 'loan', 3, null));
const tx = firstOf('SELECT id FROM finance_transactions WHERE user_id = ? AND deleted_at IS NULL', user);
await op('deleteTransaction (lógico)', () => svc.deleteTransaction(tx.id));
check('deleteTransaction no borra físicamente', firstOf('SELECT deleted_at FROM finance_transactions WHERE id = ?', tx.id).deleted_at !== null);
const svcAdd = await op('addService', () => svc.addService(user, { name: 'S', type: 'Internacional', status: 'Activo', originalValue: 10, additionalValue: 0, totalValue: 12 }));
check('services.total_value se almacena tal cual', firstOf('SELECT total_value FROM services WHERE id = ?', svcAdd.id).total_value === 12);
await op('updateService', () => svc.updateService(svcAdd.id, { name: 'S2', type: 'Local', status: 'Activo', originalValue: 10, additionalValue: 2, totalValue: 12 }));
await op('toggleServiceStatus', () => svc.toggleServiceStatus(svcAdd.id, 'Activo'));
await op('deleteService', () => svc.deleteService(svcAdd.id));
const cardAdd = await op('addCard', () => svc.addCard(user, { name: 'C', type: 'debit' }));
await op('updateCard', () => svc.updateCard(cardAdd.id, { name: 'C2', type: 'credit', cutoff_date: 3, payment_due_date: 9, limit_amount: 50 }));
await op('deleteCard', () => svc.deleteCard(cardAdd.id));
await op('addBacklogItem', () => svc.addBacklogItem(user, { type: 'anime', title: 'T' }));
const bl = firstOf("SELECT id FROM backlog WHERE user_id = ? AND type = 'anime' AND deleted_at IS NULL", user);
await op('updateBacklogStatus', () => svc.updateBacklogStatus(bl.id, 'Mirando'));
check('updateBacklogStatus rechaza un estado no canónico', (await quiet(() => svc.updateBacklogStatus(bl.id, 'Visto'))).result.success === false);
await op('updateBacklogItem', () => svc.updateBacklogItem(bl.id, { title: 'T2' }));
await op('deleteBacklogItem', () => svc.deleteBacklogItem(bl.id));
const wp = await op('addWorkPerson', () => svc.addWorkPerson(user, 'P', '2026-01-01', '[{"type":"dia","days":1}]'));
await op('updateWorkPersonOrder', () => svc.updateWorkPersonOrder(wp.id, 9));
await op('updateWorkPerson', () => svc.updateWorkPerson(wp.id, 'P2', '2026-01-02', '[{"type":"noche","days":2}]'));
await op('deleteWorkPerson', () => svc.deleteWorkPerson(wp.id));
await op('pauseCategory', () => svc.pauseCategory(cat.id, '2026-10-20'));
await op('resumeCategory', () => svc.resumeCategory(cat.id, '2026-10-21'));
await op('updateEntertainmentCategory (cambia cuotas)', () => svc.updateEntertainmentCategory(cat.id, { name: 'N', type: 'video', startDate: '2026-01-01', daysOfWeek: { Monday: 3 }, frequency: 0, seriesCount: 2, description: null }));
await op('updateSeriesSortOrder', () => svc.updateSeriesSortOrder(ser.id, 7));
await op('updateSeriesProgress', () => svc.updateSeriesProgress(ser.id, 1, 2, 'Mirando'));
const before0 = firstOf('SELECT cycle_offset FROM series WHERE id = ?', ser.id).cycle_offset;
await op('restartSeries', () => svc.restartSeries(ser.id, 10));
check('restartSeries escribe cycle_offset absoluto (anterior + total)', firstOf('SELECT cycle_offset FROM series WHERE id = ?', ser.id).cycle_offset === before0 + 10);
const seasonsBefore = raw.prepare('SELECT id, season_number FROM seasons WHERE series_id = ? AND deleted_at IS NULL ORDER BY season_number').all(ser.id).map((r) => ({ ...r }));
await op('updateSeriesWithSeasons (upsert + borrado lógico)', () => svc.updateSeriesWithSeasons(ser.id, { name: 'X', description: null, total_seasons: 1, status: 'Mirando' }, [{ season_number: 1, episode_count: 99 }]));
const s1 = firstOf('SELECT id, episode_count FROM seasons WHERE series_id = ? AND season_number = 1', ser.id);
check('upsert conserva el id de la temporada 1 y actualiza su conteo', s1.id === seasonsBefore.find((s) => s.season_number === 1).id && s1.episode_count === 99);
check('las temporadas que ya no vienen quedan borradas lógicamente',
    seasonsBefore.filter((s) => s.season_number !== 1).every((s) => firstOf('SELECT deleted_at FROM seasons WHERE id = ?', s.id).deleted_at !== null));
await op('updateSeriesWithSeasons (revive temporada borrada)', () => svc.updateSeriesWithSeasons(ser.id, { name: 'X', description: null, total_seasons: 2 }, [{ season_number: 1, episode_count: 99 }, { season_number: 2, episode_count: 5 }]));
if (seasonsBefore.some((s) => s.season_number === 2)) {
    check('la temporada 2 revive con el MISMO id', firstOf('SELECT id, deleted_at FROM seasons WHERE series_id = ? AND season_number = 2', ser.id).id === seasonsBefore.find((s) => s.season_number === 2).id);
}
check('updateSeriesWithSeasons rechaza un estado no canónico', (await quiet(() => svc.updateSeriesWithSeasons(ser.id, { name: 'X', total_seasons: 1, status: 'Viendo' }, [{ season_number: 1, episode_count: 1 }]))).result.success === false);
// Timestamps posteriores a cualquier dato existente (la BD de prueba ya tiene vistos reales).
const T_OLD = 9_000_000_000_000;
const T_NEW = 9_000_000_001_000;
await op('addHistory', () => svc.addHistory(ser.id, 1, 3, T_OLD));
await op('addHistory (misma, más reciente)', () => svc.addHistory(ser.id, 1, 3, T_NEW));
await op('removeHistory (borra lógicamente la más reciente)', () => svc.removeHistory(ser.id, 1, 3));
check('removeHistory dejó viva la más antigua',
    firstOf('SELECT COUNT(*) n FROM watch_history WHERE series_id = ? AND season_number = 1 AND episode_number = 3 AND deleted_at IS NULL AND watched_at = ?', ser.id, T_OLD).n === 1
    && firstOf('SELECT COUNT(*) n FROM watch_history WHERE series_id = ? AND watched_at = ? AND deleted_at IS NOT NULL', ser.id, T_NEW).n === 1);
await op('addReadingHistory', () => svc.addReadingHistory(ser.id, 1, 4, 3000));
await op('removeReadingHistory', () => svc.removeReadingHistory(ser.id, 1, 4));
await op('addSeriesWithSeasons', () => svc.addSeriesWithSeasons({ category_id: cat.id, name: 'Nueva', description: null, status: 'Nueva', current_season: 1, current_episode: 1, total_seasons: 2 }, [{ season_number: 1, episode_count: 4 }, { season_number: 2, episode_count: 4 }]));
const newCat = await op('addEntertainmentCategory', () => svc.addEntertainmentCategory(user, { name: 'Cat', type: 'reading', startDate: '2026-01-01', daysOfWeek: { Friday: 1 }, frequency: 0, seriesCount: 0, description: null }));
await op('deleteSeries (cascada a temporadas e historial)', () => svc.deleteSeries(ser.id));
// Cascada de categoría: preparar hijas y borrar
await quiet(() => svc.addSeriesWithSeasons({ category_id: newCat.id, name: 'Hija', description: null, status: 'Mirando', current_season: 1, current_episode: 1, total_seasons: 1 }, [{ season_number: 1, episode_count: 3 }]));
const hija = firstOf('SELECT id FROM series WHERE category_id = ?', newCat.id);
await quiet(() => svc.addReadingHistory(hija.id, 1, 1, 5000));
await quiet(() => svc.pauseCategory(newCat.id, '2026-10-20'));
const childCount = ['series', 'entertainment_pauses', 'entertainment_quotas_history'].reduce((a, t) => a + firstOf(`SELECT COUNT(*) n FROM ${t} WHERE category_id = ? AND deleted_at IS NULL`, newCat.id).n, 0)
    + firstOf('SELECT COUNT(*) n FROM seasons WHERE series_id = ? AND deleted_at IS NULL', hija.id).n
    + firstOf('SELECT COUNT(*) n FROM reading_history WHERE series_id = ? AND deleted_at IS NULL', hija.id).n;
await op('deleteEntertainmentCategory (cascada lógica a todas las hijas)', () => svc.deleteEntertainmentCategory(newCat.id));
check(`la cascada de categoría encola la categoría + sus ${childCount} hijas`,
    outboxSince(0).filter((k) => k.endsWith(newCat.id)).length >= 1 && childCount === 5);
// registerUser al final (cambia la cantidad de cuentas)
await opFails('registerUser', () => svc.registerUser('nueva_cuenta', 'x'));
await op('registerUser (+6 categorías por defecto; users no pasa por outbox)', () => svc.registerUser('nueva_cuenta', 'x'));
const login = await svc.loginUser('nueva_cuenta', 'x');
check('loginUser devuelve solo { id, username }', login.success && JSON.stringify(Object.keys(login.user).sort()) === '["id","username"]');
const missing = QUEUED_MUTATIONS.filter((m) => ![...tested].some((t) => t.startsWith(m)));
check('todas las mutaciones de la fachada fueron probadas', missing.length === 0, missing.join(', '));
raw.close();
await svc.db.closeAsync();

// ---------------------------------------------------------------------------
section('Sesión: id entero anterior a la migración → UUID');
const pSe = prepare('sesion', '.local-data/emulador-antes.db');
const rse = await open(pSe);
const mapped = await rse.svc.resolveSessionUser(1);
check('resolveSessionUser(1) devuelve el UUID y username de la cuenta 1', mapped.success && /^[0-9a-f-]{36}$/.test(mapped.user.id) && typeof mapped.user.username === 'string' && !('password' in mapped.user));
check('resolveSessionUser de un id inexistente → sin usuario (se cierra la sesión)', (await rse.svc.resolveSessionUser(999)).user === null);
await rse.svc.db.closeAsync();

// ---------------------------------------------------------------------------
section('Criterio 9: grep');
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]);
const srcFiles = [...walk('src'), 'App.js'].filter((f) => /\.(js|ts|tsx)$/.test(f));
const grep = (re, files) => files.flatMap((f) => readFileSync(f, 'utf8').split('\n').map((l, i) => [f, i + 1, l]).filter(([, , l]) => re.test(l)));
const deletes = grep(/DELETE FROM/i, srcFiles.filter((f) => !/migration/i.test(f)));
check('0 DELETE FROM sobre tablas de dominio fuera de las migraciones', deletes.length === 0, deletes.map(([f, n]) => `${f}:${n}`).join(', '));
const lastIds = grep(/lastInsertRowId/, srcFiles.filter((f) => !/migration/i.test(f)));
check('0 usos de lastInsertRowId para IDs de dominio', lastIds.length === 0, lastIds.map(([f, n]) => `${f}:${n}`).join(', '));
// Lecturas de tablas de dominio sin filtro de borrados (excepciones justificadas)
const repoFiles = srcFiles.filter((f) => f.includes(`src${'\\'}data${'\\'}repositories`) || f.includes('src/data/repositories'));
const JUSTIFIED = {
    'SELECT id, deleted_at FROM finance_categories': 'ensureCategory: busca también borradas para revivirlas (UNIQUE)',
    'SELECT id, episode_count, deleted_at FROM seasons': 'upsertSeasons: busca también borradas para revivirlas (UNIQUE)',
    'SELECT id, username FROM users': 'users no tiene borrado lógico (tabla local)',
    'SELECT u.id, u.username FROM _id_map': 'tablas internas de la migración',
    'SELECT payload FROM _migration_log': 'tabla interna de la migración',
};
const reads = [];
for (const f of repoFiles) {
    const text = readFileSync(f, 'utf8');
    for (const m of text.matchAll(/['`](\s*SELECT[\s\S]*?)['`]/g)) {
        const sql = m[1].replace(/\s+/g, ' ').trim();
        if (/deleted_at/.test(sql)) continue;
        const just = Object.keys(JUSTIFIED).find((k) => sql.startsWith(k));
        reads.push({ f, sql: sql.slice(0, 70), just: just ? JUSTIFIED[just] : null });
    }
}
const unjustified = reads.filter((r) => !r.just);
check('toda lectura de dominio filtra deleted_at IS NULL', unjustified.length === 0, unjustified.map((r) => `${r.f}: ${r.sql}`).join(' | '));
for (const r of reads.filter((x) => x.just)) console.log(`     excepción: ${r.just}`);

console.log(failures === 0 ? '\nTODAS LAS PRUEBAS DE LA FASE 1 PASARON.' : `\n${failures} prueba(s) fallaron.`);
process.exit(failures === 0 ? 0 : 1);
