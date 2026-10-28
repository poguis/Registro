// Pruebas de la Fase 2: aplica supabase/migrations/ en un Postgres LOCAL embebido (PGlite,
// en memoria; nunca un proyecto remoto) con el stub de auth de scripts/lib/pg-auth-stub.sql,
// y verifica los criterios 1–8 de la 2.2 (+ cascade desde auth.users y upsert sobre un id ajeno).
// No imprime filas: solo conteos.
//
// Uso: node scripts/probar-fase2.mjs
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { TABLES, mapRow, columnsOf, roundMoney, changesWhenRounded, MappingError } from './lib/mapeo-sync.mjs';

const MIGRATIONS_DIR = 'supabase/migrations';
const STUB = readFileSync('scripts/lib/pg-auth-stub.sql', 'utf8');
const migrationFiles = readdirSync(MIGRATIONS_DIR).filter((f) => /^\d{14}_[a-z0-9_]+\.sql$/.test(f)).sort();

let failures = 0;
const check = (name, ok, detail = '') => {
    console.log(`${ok ? 'OK  ' : 'FALLA'} ${name}${detail ? ` — ${detail}` : ''}`);
    if (!ok) failures++;
};
const section = (t) => console.log(`\n== ${t} ==`);

// Base nueva: stub de auth + migraciones en orden.
async function freshDb() {
    const db = new PGlite();
    await db.exec(STUB);
    for (const f of migrationFiles) await db.exec(readFileSync(`${MIGRATIONS_DIR}/${f}`, 'utf8'));
    return db;
}
const one = async (db, sql, params) => (await db.query(sql, params)).rows[0];
const count = async (db, sql, params) => Number(Object.values(await one(db, sql, params))[0]);

// Ejecuta fn como un rol (con el claim sub de Supabase) y siempre vuelve a superusuario.
async function as(db, role, uid, fn) {
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [uid || '']);
    await db.exec(`set role ${role}`);
    try { return await fn(); } finally { await db.exec('reset role'); }
}
async function fails(fn) {
    try { await fn(); return null; } catch (e) { return e.message; }
}
const newUser = async (db, id = randomUUID()) => { await db.query('insert into auth.users (id) values ($1)', [id]); return id; };

const NOW = '2026-10-26T00:00:00.000Z';
const sync = { created_at: NOW, updated_at: NOW };
async function insert(db, table, values) {
    const cols = Object.keys(values);
    await db.query(
        `insert into public.${table} (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')})`,
        cols.map((c) => values[c]),
    );
}

// ---------------------------------------------------------------------------
section('Criterio 1: las migraciones se aplican desde cero (dos bases nuevas)');
check('archivos de migración con formato <YYYYMMDDHHMMSS>_<nombre>.sql', migrationFiles.length === 4, migrationFiles.join(', '));
let db;
for (const attempt of [1, 2]) {
    const err = await fails(async () => { db = await freshDb(); });
    check(`base nueva #${attempt}: stub + ${migrationFiles.length} migraciones sin errores`, err === null, err || '');
}
const pubTables = (await db.query(`select tablename from pg_tables where schemaname = 'public' order by 1`)).rows.map((r) => r.tablename);
check('15 tablas en public (las del mapeo)', pubTables.length === 15 && TABLES.every((t) => pubTables.includes(t)), `${pubTables.length}`);
check('RLS activada en las 15', await count(db, `select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity`) === 15);
const pols = (await db.query(`select cmd, count(*)::int n from pg_policies where schemaname = 'public' group by cmd order by cmd`)).rows;
check('políticas: 15 SELECT, 15 INSERT, 15 UPDATE, 0 DELETE/ALL', JSON.stringify(pols) === JSON.stringify([{ cmd: 'INSERT', n: 15 }, { cmd: 'SELECT', n: 15 }, { cmd: 'UPDATE', n: 15 }]), JSON.stringify(pols));
check('todas las políticas son "to authenticated"', await count(db, `select count(*) from pg_policies where schemaname = 'public' and roles <> '{authenticated}'`) === 0);
check('15 triggers set_server_updated_at', await count(db, `select count(*) from pg_trigger where tgname = 'set_server_updated_at' and not tgisinternal`) === 15);
const grants = (await db.query(`select grantee, privilege_type, count(*)::int n from information_schema.role_table_grants where table_schema = 'public' and grantee in ('anon', 'authenticated', 'PUBLIC') group by 1, 2 order by 1, 2`)).rows;
check('grants: authenticated solo SELECT/INSERT/UPDATE en las 15; nada a anon ni PUBLIC (pese a los default privileges del stub)',
    JSON.stringify(grants) === JSON.stringify([{ grantee: 'authenticated', privilege_type: 'INSERT', n: 15 }, { grantee: 'authenticated', privilege_type: 'SELECT', n: 15 }, { grantee: 'authenticated', privilege_type: 'UPDATE', n: 15 }]),
    JSON.stringify(grants));
check('ninguna función de public es security definer', await count(db, `select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prosecdef`) === 0);
check('usage de public: authenticated sí, anon sí (como Supabase; la protección es por tabla)',
    (await one(db, `select has_schema_privilege('authenticated', 'public', 'USAGE') a, has_schema_privilege('anon', 'public', 'USAGE') b`)).a === true
    && (await one(db, `select has_schema_privilege('anon', 'public', 'USAGE') b`)).b === true);

// ---------------------------------------------------------------------------
section('Consulta de verificación de la 2.3 (supabase/verificar-fase2.sql)');
const VERIFY = readFileSync('supabase/verificar-fase2.sql', 'utf8');
const verifyRows = (await db.query(VERIFY)).rows;
const notOk = verifyRows.filter((r) => !r.ok);
check(`los ${verifyRows.length} chequeos salen ok = true`, verifyRows.length === 22 && notOk.length === 0,
    notOk.map((r) => `#${r.orden} ${r.chequeo}: ${r.valor} (esperado ${r.esperado})`).join(' | '));
// Control: sin el archivo 4/4 (RLS y grants) la consulta debe detectarlo.
const partial = new PGlite();
await partial.exec(STUB);
for (const f of migrationFiles.slice(0, 3)) await partial.exec(readFileSync(`${MIGRATIONS_DIR}/${f}`, 'utf8'));
const partialBad = (await partial.query(VERIFY)).rows.filter((r) => !r.ok).map((r) => r.orden);
check('control: sin la migración 4/4 la consulta marca RLS, políticas y grants como no ok', [3, 4, 9, 10].every((n) => partialBad.includes(n)), `fallan #${partialBad.join(', #')}`);
await partial.close();

// ---------------------------------------------------------------------------
section('Criterio 2: RLS');
const A = await newUser(db);
const B = await newUser(db);
const catA = randomUUID();
const catB = randomUUID();
const cat = (id, user_id, name) => ({ id, user_id, name, type: 'video', ...sync });
let err = await fails(() => as(db, 'authenticated', A, () => insert(db, 'entertainment_categories', cat(catA, A, 'cat A'))));
check('A inserta su propia categoría', err === null, err || '');
await as(db, 'authenticated', B, () => insert(db, 'entertainment_categories', cat(catB, B, 'cat B')));
const seenByA = await as(db, 'authenticated', A, () => count(db, 'select count(*) from public.entertainment_categories'));
check('A ve solo sus filas', seenByA === 1, `${seenByA} visible(s) de 2`);
check('A no ve la fila de B por id', await as(db, 'authenticated', A, () => count(db, 'select count(*) from public.entertainment_categories where id = $1', [catB])) === 0);
err = await fails(() => as(db, 'authenticated', A, () => insert(db, 'entertainment_categories', cat(randomUUID(), B, 'ajena'))));
check('A no puede insertar con user_id de B', err !== null && /row-level security/.test(err), err || 'se insertó');
const updB = await as(db, 'authenticated', A, () => db.query(`update public.entertainment_categories set name = 'x' where id = $1`, [catB]));
check('A no puede actualizar filas de B (0 filas afectadas)', updB.affectedRows === 0 && (await one(db, 'select name from public.entertainment_categories where id = $1', [catB])).name === 'cat B');
err = await fails(() => as(db, 'authenticated', A, () => db.query('update public.entertainment_categories set user_id = $1 where id = $2', [B, catA])));
check('A no puede pasar una fila propia a B (WITH CHECK)', err !== null && /row-level security/.test(err), err || 'se actualizó');
err = await fails(() => as(db, 'authenticated', A, () => db.query('delete from public.entertainment_categories where id = $1', [catA])));
check('DELETE falla para authenticated', err !== null && /permission denied/.test(err), err || 'se borró');
for (const t of TABLES) {
    const e1 = await fails(() => as(db, 'anon', null, () => db.query(`select 1 from public.${t} limit 1`)));
    const e2 = await fails(() => as(db, 'anon', null, () => db.query(`insert into public.${t} (id) values ($1)`, [randomUUID()])));
    if (!(e1 && /permission denied/.test(e1) && e2 && /permission denied/.test(e2))) check(`anon sin acceso a ${t}`, false, `${e1} / ${e2}`);
}
check('anon no puede leer ni escribir ninguna de las 15 tablas', true);
// Prueba nueva: upsert de A sobre un id que pertenece a B.
const beforeUpsert = await one(db, 'select row_to_json(c)::text j from public.entertainment_categories c where id = $1', [catB]);
err = await fails(() => as(db, 'authenticated', A, () => db.query(
    `insert into public.entertainment_categories (id, user_id, name, type, created_at, updated_at)
     values ($1, $2, 'robada', 'video', $3, $3)
     on conflict (id) do update set name = excluded.name, updated_at = excluded.updated_at`, [catB, A, NOW])));
check('upsert de A sobre un id de B falla', err !== null, err || 'no falló');
check('la fila de B queda intacta (incluido server_updated_at)', (await one(db, 'select row_to_json(c)::text j from public.entertainment_categories c where id = $1', [catB])).j === beforeUpsert.j);
check('A sigue sin poder leer la fila de B', await as(db, 'authenticated', A, () => count(db, 'select count(*) from public.entertainment_categories where id = $1', [catB])) === 0);

// ---------------------------------------------------------------------------
section('Criterio 3: FK compuesta (parent_id, user_id)');
const serB = randomUUID();
await as(db, 'authenticated', B, () => insert(db, 'series', { id: serB, user_id: B, category_id: catB, name: 's B', ...sync }));
err = await fails(() => as(db, 'authenticated', A, () => insert(db, 'series', { id: randomUUID(), user_id: A, category_id: catB, name: 'colgada', ...sync })));
check('A no puede crear una serie en una categoría de B', err !== null && /foreign key/.test(err), err || 'se insertó');
err = await fails(() => as(db, 'authenticated', A, () => insert(db, 'seasons', { id: randomUUID(), user_id: A, series_id: serB, season_number: 1, ...sync })));
check('A no puede crear una temporada en una serie de B', err !== null && /foreign key/.test(err), err || 'se insertó');
const serA = randomUUID();
err = await fails(() => as(db, 'authenticated', A, () => insert(db, 'series', { id: serA, user_id: A, category_id: catA, name: 's A', ...sync })));
check('A sí puede crear una serie en su categoría', err === null, err || '');
// FK diferida: hijo antes que padre dentro de la misma transacción.
const catA2 = randomUUID();
err = await fails(() => as(db, 'authenticated', A, () => db.transaction(async (t) => {
    await t.query(`insert into public.series (id, user_id, category_id, name, created_at, updated_at) values ($1, $2, $3, 'antes del padre', $4, $4)`, [randomUUID(), A, catA2, NOW]);
    await t.query(`insert into public.entertainment_categories (id, user_id, name, type, created_at, updated_at) values ($1, $2, 'padre tardío', 'reading', $3, $3)`, [catA2, A, NOW]);
})));
check('FK diferida: hijo antes que el padre en la misma transacción', err === null, err || '');

// ---------------------------------------------------------------------------
section('Criterio 4: server_updated_at');
const fake = '2000-01-01T00:00:00.000Z';
const t0 = Date.now();
const bk = randomUUID();
await as(db, 'authenticated', A, () => db.query(
    `insert into public.backlog (id, user_id, type, title, created_at, updated_at, server_updated_at) values ($1, $2, 'movie', 't', $3, $3, $4)`,
    [bk, A, NOW, fake]));
const sua = async () => (await one(db, 'select server_updated_at s, updated_at u from public.backlog where id = $1', [bk]));
let r = await sua();
check('insert: se asigna e ignora el valor del cliente', new Date(r.s).getUTCFullYear() !== 2000 && Math.abs(new Date(r.s).getTime() - t0) < 60000);
const seq = [new Date(r.s).getTime()];
for (let i = 0; i < 5; i++) {
    await as(db, 'authenticated', A, () => db.query(`update public.backlog set title = $1, server_updated_at = $2 where id = $3`, [`t${i}`, fake, bk]));
    seq.push(new Date((await sua()).s).getTime());
}
check('update: ignora el valor del cliente', seq.every((x) => new Date(x).getUTCFullYear() !== 2000));
check('update: no decreciente en 5 updates seguidos', seq.every((x, i) => i === 0 || x >= seq[i - 1]));
check('updated_at lo conserva tal cual lo manda el cliente', new Date((await sua()).u).toISOString() === NOW);
// Reloj que retrocede: se simula un server_updated_at en el futuro.
await db.exec('alter table public.backlog disable trigger set_server_updated_at');
await db.query(`update public.backlog set server_updated_at = now() + interval '1 day' where id = $1`, [bk]);
await db.exec('alter table public.backlog enable trigger set_server_updated_at');
const future = new Date((await sua()).s).getTime();
await as(db, 'authenticated', A, () => db.query(`update public.backlog set title = 'z' where id = $1`, [bk]));
check('update con reloj "atrasado": greatest() mantiene el valor (no decrece)', new Date((await sua()).s).getTime() >= future);

// ---------------------------------------------------------------------------
section('Criterio 5: CHECK');
const rejects = async (name, table, values, re = /check constraint/) => {
    const e = await fails(() => as(db, 'authenticated', A, () => insert(db, table, { id: randomUUID(), user_id: A, ...sync, ...values })));
    check(name, e !== null && re.test(e), e || 'se insertó');
};
await rejects('series.status fuera de la lista ("Terminada")', 'series', { category_id: catA, name: 'x', status: 'Terminada' });
await rejects('backlog.type inválido', 'backlog', { type: 'book', title: 'x' });
await rejects('backlog.status inválido', 'backlog', { type: 'movie', title: 'x', status: 'Visto' });
await rejects('services.type inválido', 'services', { name: 'x', type: 'Otro', status: 'Activo', original_value: '1', total_value: '1' });
await rejects('services.status inválido', 'services', { name: 'x', type: 'Local', status: 'Pausado', original_value: '1', total_value: '1' });
await rejects('finance_transactions.type inválido', 'finance_transactions', { contact_id: randomUUID(), type: 'gift', amount: '1' });
await rejects('entertainment_categories.type inválido', 'entertainment_categories', { name: 'x', type: 'audio' });
await rejects('cards.type inválido', 'cards', { name: 'x', type: 'prepaid' });
await rejects('cards.cutoff_date fuera de 1–31', 'cards', { name: 'x', type: 'credit', cutoff_date: '32' });
await rejects('days_of_week con forma array', 'entertainment_categories', { name: 'x', type: 'video', days_of_week: '["Monday"]' });
await rejects('quotas con forma array', 'entertainment_quotas_history', { category_id: catA, quotas: '[1,2]', start_date: '2026-01-01' });
await rejects('cycle con forma objeto', 'work_people', { name: 'x', start_date: '2026-01-01', cycle: '{"type":"x"}' });

// ---------------------------------------------------------------------------
section('Criterio 6: upsert idempotente');
const up = randomUUID();
const upsert = () => as(db, 'authenticated', A, () => db.query(
    `insert into public.finance_contacts (id, user_id, name, created_at, updated_at) values ($1, $2, 'contacto', $3, $3)
     on conflict (id) do update set name = excluded.name, updated_at = excluded.updated_at, deleted_at = excluded.deleted_at`, [up, A, NOW]));
const rowSnap = async () => (await one(db, `select (to_jsonb(c) - 'server_updated_at')::text j, server_updated_at s from public.finance_contacts c where id = $1`, [up]));
await upsert();
const s1 = await rowSnap();
await upsert();
const s2 = await rowSnap();
check('el mismo upsert dos veces deja la fila igual (salvo server_updated_at)', s1.j === s2.j && await count(db, 'select count(*) from public.finance_contacts where id = $1', [up]) === 1);
check('server_updated_at avanza (o se mantiene) en el segundo upsert', new Date(s2.s) >= new Date(s1.s));

// ---------------------------------------------------------------------------
section('Criterio 7: únicos');
const seasonRow = () => ({ id: randomUUID(), user_id: A, series_id: serA, season_number: '1', ...sync });
await as(db, 'authenticated', A, () => insert(db, 'seasons', seasonRow()));
err = await fails(() => as(db, 'authenticated', A, () => insert(db, 'seasons', seasonRow())));
check('seasons(series_id, season_number) duplicado falla', err !== null && /duplicate key/.test(err), err || 'se insertó');
await as(db, 'authenticated', A, () => insert(db, 'finance_categories', { id: randomUUID(), user_id: A, name: 'Comida', ...sync }));
err = await fails(() => as(db, 'authenticated', A, () => insert(db, 'finance_categories', { id: randomUUID(), user_id: A, name: 'Comida', ...sync })));
check('finance_categories(user_id, name) duplicado falla', err !== null && /duplicate key/.test(err), err || 'se insertó');
err = await fails(() => as(db, 'authenticated', B, () => insert(db, 'finance_categories', { id: randomUUID(), user_id: B, name: 'Comida', ...sync })));
check('el mismo nombre de categoría sí se permite para otro usuario', err === null, err || '');

// ---------------------------------------------------------------------------
section('Extra: on delete cascade desde auth.users');
const rowsOf = async (uid) => {
    let n = 0;
    for (const t of TABLES) n += await count(db, `select count(*) from public.${t} where user_id = $1`, [uid]);
    return n;
};
const aRows = await rowsOf(A);
const bRows = await rowsOf(B);
err = await fails(() => db.query('delete from auth.users where id = $1', [A]));
check('borrar el usuario A en auth.users no falla (FK diferidas incluidas)', err === null, err || '');
check('todas las filas de A desaparecen de las 15 tablas', await rowsOf(A) === 0, `${aRows} → ${await rowsOf(A)}`);
check('las filas de B quedan intactas', await rowsOf(B) === bRows, `${bRows}`);
await db.close();

// ---------------------------------------------------------------------------
section('Redondeo a centavos (mapeador vs numeric(14,2) de Postgres)');
const pg = await freshDb();
const tricky = [1.005, -1.005, 2.675, 0.125, -0.125, 0.005, -0.005, 11.988000000000001, 9.99 * 1.2, 1e-7, 1.5e-2, 123456789012.345, -0.001, 100, 0.1 + 0.2];
let mismatches = 0;
for (const v of tricky) {
    const pgv = (await one(pg, 'select ($1::numeric(14,2))::text t', [JSON.stringify(v)])).t;
    if (pgv !== roundMoney(v)) { mismatches++; console.log(`     difiere: ${JSON.stringify(v)} → mapeador ${roundMoney(v)} / postgres ${pgv}`); }
}
check(`roundMoney coincide con Postgres en ${tricky.length} casos límite (1,005 → 1,01; empates alejándose de cero)`, mismatches === 0);
check('Math.round(x*100) fallaría con 1,005 (por eso no se usa)', Math.round(1.005 * 100) / 100 !== 1.01 && roundMoney(1.005) === '1.01');
await pg.close();

// ---------------------------------------------------------------------------
section('Criterio 8: compatibilidad con BD reales y de prueba (v2)');
// Regenera las 4 BD de prueba migradas a v2 (real 2026-10-20, A, B, C) con el dry-run de la Fase 1.
execSync('node scripts/dryrun-fase1.mjs', { stdio: 'pipe' });
const SOURCES = {
    'real (celular, post-fix)': '.local-data/respaldo-post-fase1-fix/registro_respaldo_20261025-195442.db',
    'real 2026-10-20 (dry-run)': '.local-data/dryrun-fase1/real/despues/app_registro_v3.db',
    'A (dry-run)': '.local-data/dryrun-fase1/A/despues/app_registro_v3.db',
    'B (dry-run)': '.local-data/dryrun-fase1/B/despues/app_registro_v3.db',
    'C (dry-run)': '.local-data/dryrun-fase1/C/despues/app_registro_v3.db',
    'emulador tras checklist': '.local-data/emulador-fase1/tras-checklist.db',
    'emulador fase1 después': '.local-data/emulador-fase1/despues.db',
    'sintética (inconsistente)': '.local-data/pruebas-fase1/sintetica/app_registro_v3.db',
};
const MONEY_COLS = Object.fromEntries(TABLES.map((t) => [t, Object.entries(columnsOf(t)).filter(([, k]) => k === 'money').map(([c]) => c)]));
const totals = { rows: 0, loaded: 0, moneyValues: 0, moneyChanged: 0 };
for (const [label, path] of Object.entries(SOURCES)) {
    if (!existsSync(path)) { check(`${label}: existe`, false, path); continue; }
    const src = new DatabaseSync(path, { readOnly: true });
    const uv = src.prepare('PRAGMA user_version').get().user_version;
    const pgdb = await freshDb();
    const users = new Set();
    for (const t of TABLES) for (const r of src.prepare(`SELECT DISTINCT user_id u FROM ${t}`).all()) users.add(r.u);
    for (const u of users) await newUser(pgdb, u); // cada cuenta local → su propio usuario de prueba
    let rows = 0, loaded = 0, mapErrors = 0, dbErrors = 0, moneyValues = 0, moneyChanged = 0;
    const firstErrors = [];
    const perTable = {};
    for (const u of users) {
        await as(pgdb, 'authenticated', u, () => pgdb.transaction(async (tx) => {
            for (const t of TABLES) {
                for (const row of src.prepare(`SELECT * FROM ${t} WHERE user_id = ?`).all(u)) {
                    rows++;
                    for (const c of MONEY_COLS[t]) if (row[c] !== null) { moneyValues++; if (changesWhenRounded(row[c])) moneyChanged++; }
                    let mapped;
                    try { mapped = mapRow(t, row); } catch (e) {
                        mapErrors++; if (firstErrors.length < 3) firstErrors.push(`${t}: ${e instanceof MappingError ? e.message : 'error'}`); continue;
                    }
                    try {
                        await tx.query('savepoint fila');
                        await tx.query(`insert into public.${t} (${mapped.columns.join(', ')}) values (${mapped.columns.map((_, i) => `$${i + 1}`).join(', ')})`, mapped.values);
                        await tx.query('release savepoint fila');
                        loaded++;
                        perTable[t] = (perTable[t] || 0) + 1;
                    } catch (e) {
                        await tx.query('rollback to savepoint fila');
                        dbErrors++; if (firstErrors.length < 3) firstErrors.push(`${t}: ${e.message.replace(/"[^"]*"/g, '"…"').slice(0, 90)}`);
                    }
                }
            }
        }));
    }
    // Conteos finales en Postgres = conteos en SQLite, tabla por tabla (incluye tombstones).
    let sameCounts = true;
    for (const t of TABLES) {
        const a = src.prepare(`SELECT count(*) n FROM ${t}`).get().n;
        const b = await count(pgdb, `select count(*) from public.${t}`);
        if (a !== b) sameCounts = false;
    }
    const tombstones = TABLES.reduce((n, t) => n + src.prepare(`SELECT count(*) n FROM ${t} WHERE deleted_at IS NOT NULL`).get().n, 0);
    check(`${label} (uv ${uv}, ${users.size} cuenta(s)): ${loaded}/${rows} filas cargadas, ${tombstones} tombstones`,
        uv === 2 && mapErrors === 0 && dbErrors === 0 && loaded === rows && sameCounts,
        `${mapErrors} error(es) de mapeo, ${dbErrors} de Postgres; montos ${moneyValues}, cambian al redondear ${moneyChanged}${firstErrors.length ? ' · ' + firstErrors.join(' | ') : ''}`);
    totals.rows += rows; totals.loaded += loaded; totals.moneyValues += moneyValues; totals.moneyChanged += moneyChanged;
    src.close();
    await pgdb.close();
}
console.log(`     total: ${totals.loaded}/${totals.rows} filas; ${totals.moneyChanged} de ${totals.moneyValues} montos cambiarían al redondear a 2 decimales`);

console.log(failures === 0 ? '\nTODAS LAS PRUEBAS DE LA FASE 2 PASARON.' : `\n${failures} prueba(s) fallaron.`);
process.exit(failures === 0 ? 0 : 1);
