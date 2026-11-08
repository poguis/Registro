// Pruebas de la Fase 6.2 (ETAPA A): ensaya supabase/pruebas-fase6-2/01–04 en un Postgres LOCAL
// (PGlite, en memoria; nunca un proyecto remoto) con las migraciones reales y el stub de auth de
// scripts/lib/pg-auth-stub.sql. No imprime filas de dominio: solo conteos, tamaños y planes.
//
// Uso: node scripts/probar-fase6-2.mjs [--escala <0..1>]
//   --escala: factor de volumen del 01 (por defecto 1 = volumen completo). Los ensayos del 04
//   usan siempre una escala reducida (ESCALA_04), porque solo prueban las guardas y el borrado.
//
// Criterios (ETAPA A): A1 guardas del 01 y del 04, cascada y usuario "real" intacto; A2
// paginación con server_updated_at repetidos sin duplicadas ni perdidas; A3 02 y 03 sin cambios
// persistentes (catálogo, conteos y sesión iguales antes y después; 03 = una sola sentencia).
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import { TABLES } from '../src/sync/mapping.ts';
import { createPgliteTransport } from './lib/pglite-transport.mjs';

// ---------------------------------------------------------------- parámetros
const args = process.argv.slice(2);
const escalaIndex = args.indexOf('--escala');
const ESCALA = escalaIndex >= 0 ? Number(args[escalaIndex + 1]) : 1;
if (!(ESCALA > 0 && ESCALA <= 1)) {
    console.error('Uso: node scripts/probar-fase6-2.mjs [--escala <número en (0, 1]>]');
    process.exit(2);
}
const ESCALA_04 = Math.min(ESCALA, 0.05);
// Tamaño de página del pull de la app (src/sync/config.ts). Se lee del archivo porque
// config.ts importa expo-constants, que no existe en Node.
const PAGE_SIZE = Number(/pageSize:\s*(\d+)/.exec(readFileSync('src/sync/config.ts', 'utf8'))[1]);

const DIR = 'supabase/pruebas-fase6-2';
const F01 = readFileSync(`${DIR}/01-sembrar-volumen.sql`, 'utf8');
const F02 = readFileSync(`${DIR}/02-medir-pull.sql`, 'utf8');
const F03 = readFileSync(`${DIR}/03-verificar-cascada.sql`, 'utf8');
const F04 = readFileSync(`${DIR}/04-limpieza-emergencia.sql`, 'utf8');
const STUB = readFileSync('scripts/lib/pg-auth-stub.sql', 'utf8');
const MIGRATIONS_DIR = 'supabase/migrations';
const migrationFiles = readdirSync(MIGRATIONS_DIR).filter((f) => /^\d{14}_[a-z0-9_]+\.sql$/.test(f)).sort();

let failures = 0;
const check = (name, ok, detail = '') => {
    console.log(`${ok ? 'OK  ' : 'FALLA'} ${name}${detail ? ` — ${detail}` : ''}`);
    if (!ok) failures++;
};
const section = (t) => console.log(`\n== ${t} ==`);
const secs = (ms) => `${(ms / 1000).toFixed(1)} s`;

// ---------------------------------------------------------------- utilidades SQL
// Separa el código de los comentarios y de los literales '…' (los cuerpos $$…$$ cuentan como código).
function codeOnly(sql) {
    let out = '';
    for (let i = 0; i < sql.length;) {
        if (sql.startsWith('--', i)) { while (i < sql.length && sql[i] !== '\n') i++; continue; }
        if (sql.startsWith('/*', i)) { const end = sql.indexOf('*/', i + 2); i = end < 0 ? sql.length : end + 2; out += ' '; continue; }
        if (sql[i] === "'") {
            i++;
            while (i < sql.length) {
                if (sql[i] === "'" && sql[i + 1] === "'") { i += 2; continue; }
                if (sql[i] === "'") { i++; break; }
                i++;
            }
            out += "''";
            continue;
        }
        if (sql[i] === '"') { const end = sql.indexOf('"', i + 1); out += sql.slice(i, end + 1); i = end + 1; continue; }
        out += sql[i++];
    }
    return out;
}
const wordsIn = (code, words) => words.filter((w) => new RegExp(`\\b${w}\\b`, 'i').test(code));
// Sentencias de primer nivel: los ; dentro de un cuerpo $$…$$ no cuentan.
const topLevel = (code) => code.replace(/\$\$[\s\S]*?\$\$/g, '$$$$').trim();

// Sustituye el uid (y la escala) en las líneas marcadas.
const fill = (sql, uid, escala) => {
    let s = sql.replace("'PEGAR_UID_AQUI'", `'${uid}'`);
    if (escala !== undefined) s = s.replace('v_escala numeric := 1;', `v_escala numeric := ${escala};`);
    return s;
};

async function freshDb() {
    const db = new PGlite();
    await db.exec(STUB);
    for (const f of migrationFiles) await db.exec(readFileSync(`${MIGRATIONS_DIR}/${f}`, 'utf8'));
    return db;
}
const newUser = async (db, id = randomUUID()) => { await db.query('insert into auth.users (id) values ($1)', [id]); return id; };
const failsWith = async (fn) => { try { await fn(); return null; } catch (e) { return String(e.message || e); } };

// Usuario "real": 2 filas por tabla, sin prefijo [F6.2] y con fechas de 2026 (como la app).
async function sembrarReal(db, uid) {
    const now = '2026-11-07T12:00:00.000Z';
    const ids = {};
    const ins = async (table, values) => {
        const cols = ['id', 'user_id', ...Object.keys(values), 'created_at', 'updated_at'];
        const id = randomUUID();
        await db.query(
            `insert into public.${table} (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')})`,
            [id, uid, ...Object.values(values), now, now],
        );
        return id;
    };
    for (let k = 1; k <= 2; k++) {
        ids.contact = await ins('finance_contacts', { name: `real contacto ${k}` });
        await ins('finance_transactions', { contact_id: ids.contact, type: 'debt', amount: 10.5, description: `real ${k}` });
        await ins('balance_history', { amount: 20, category: 'Ingreso', description: `real ${k}` });
        await ins('finance_categories', { name: `real categoría ${k}` });
        await ins('services', { name: `real servicio ${k}`, type: 'Local', status: 'Activo', original_value: 5, additional_value: 0, total_value: 5 });
        ids.cat = await ins('entertainment_categories', { name: `real ${k}`, type: 'video', days_of_week: JSON.stringify({ Monday: 1 }) });
        await ins('entertainment_pauses', { category_id: ids.cat, pause_start: '2026-11-01' });
        await ins('entertainment_quotas_history', { category_id: ids.cat, quotas: JSON.stringify({ Monday: 1 }), start_date: '2026-11-01' });
        ids.series = await ins('series', { category_id: ids.cat, name: `real serie ${k}` });
        await ins('seasons', { series_id: ids.series, season_number: 1 });
        await ins('watch_history', { series_id: ids.series, season_number: 1, episode_number: k, watched_at: now });
        await ins('reading_history', { series_id: ids.series, season_number: 1, episode_number: k, read_at: now });
        await ins('backlog', { type: 'movie', title: `real ${k}` });
        await ins('work_people', { name: `real ${k}`, start_date: '2026-11-01', cycle: JSON.stringify([{ type: 'Trabajo', days: 5 }]) });
        await ins('cards', { name: `real ${k}`, type: 'debit' });
    }
}

// Conteos por tabla de un uid y de los demás.
async function counts(db, uid) {
    const out = {};
    for (const t of TABLES) {
        const r = (await db.query(
            `select count(*) filter (where user_id = $1)::int as mio, count(*) filter (where user_id <> $1)::int as otros from public.${t}`, [uid])).rows[0];
        out[t] = r;
    }
    return out;
}
const sum = (c, k) => Object.values(c).reduce((n, x) => n + x[k], 0);
// Hash del contenido de las filas de los demás usuarios (no se imprime nada de las filas).
async function hashOthers(db, uid) {
    const h = createHash('sha256');
    for (const t of TABLES) {
        const rows = (await db.query(`select row_to_json(x)::text as j from public.${t} x where user_id <> $1 order by id`, [uid])).rows;
        h.update(t); for (const r of rows) h.update(r.j);
    }
    return h.digest('hex');
}
// Catálogo y sesión: para comprobar que 02 y 03 no dejan cambios persistentes.
async function snapshot(db) {
    const q = async (sql) => JSON.stringify((await db.query(sql)).rows);
    return {
        catalogo: await q(`select (select count(*) from pg_class) c, (select count(*) from pg_proc) p,
            (select count(*) from pg_policy) pol, (select count(*) from pg_trigger) trg,
            (select string_agg(rolname || '=' || coalesce(array_to_string(rolconfig, ','), ''), ';' order by rolname) from pg_roles) roles`),
        sesion: await q(`select current_user as u, coalesce(current_setting('request.jwt.claims', true), '') as claims,
            coalesce(current_setting('request.jwt.claim.sub', true), '') as sub`),
    };
}

// Cantidades esperadas del 01 (mismo redondeo que round() de Postgres para positivos).
function esperado(escala) {
    const n = (base, min = 1) => Math.max(min, Math.round(base * escala));
    const series = n(500);
    return {
        finance_contacts: n(50), finance_transactions: n(5000), balance_history: n(50000), finance_categories: n(20),
        services: n(30), entertainment_categories: n(10, 2), entertainment_pauses: n(100), entertainment_quotas_history: n(100),
        series, seasons: 4 * series, watch_history: n(50000), reading_history: n(10000), backlog: n(2000),
        work_people: n(20), cards: n(10, 2),
    };
}

// ---------------------------------------------------------------- 0. escaneo estático
section('0. Escaneo estático de los 4 SQL (sin comentarios ni literales)');
const PROHIBIDAS_01 = ['DELETE', 'UPDATE', 'DROP', 'TRUNCATE', 'ALTER'];
const PROHIBIDAS_LECTURA = ['INSERT', 'UPDATE', 'DELETE', 'MERGE', 'ALTER', 'CREATE', 'DROP', 'GRANT', 'REVOKE', 'TRUNCATE', 'COPY', 'DO', 'CALL', 'SET', 'VACUUM', 'LOCK'];
{
    const c1 = codeOnly(F01), c2 = codeOnly(F02), c3 = codeOnly(F03), c4 = codeOnly(F04);
    check('01: sin DELETE/UPDATE/DROP/TRUNCATE/ALTER', wordsIn(c1, PROHIBIDAS_01).length === 0, wordsIn(c1, PROHIBIDAS_01).join(', '));
    check('01: una sola sentencia DO', /^do\s+\$\$/i.test(topLevel(c1)) && (topLevel(c1).match(/;/g) || []).length === 1);
    check('02: un solo SELECT (WITH/SELECT, un único ; al final) sin palabras de escritura',
        /^(with|select)\b/i.test(c2.trim()) && (c2.match(/;/g) || []).length === 1 && c2.trim().endsWith(';')
        && wordsIn(c2, PROHIBIDAS_LECTURA).length === 0, wordsIn(c2, PROHIBIDAS_LECTURA).join(', '));
    check('03: un solo SELECT (WITH/SELECT, un único ; al final) sin palabras de escritura',
        /^(with|select)\b/i.test(c3.trim()) && (c3.match(/;/g) || []).length === 1 && c3.trim().endsWith(';')
        && wordsIn(c3, PROHIBIDAS_LECTURA).length === 0, wordsIn(c3, PROHIBIDAS_LECTURA).join(', '));
    const p4 = ['UPDATE', 'DROP', 'TRUNCATE', 'ALTER'];
    check('04: una sola sentencia DO; DELETE permitido (única excepción); sin UPDATE/DROP/TRUNCATE/ALTER',
        /^do\s+\$\$/i.test(topLevel(c4)) && (topLevel(c4).match(/;/g) || []).length === 1 && wordsIn(c4, p4).length === 0
        && wordsIn(c4, ['DELETE']).length === 1, wordsIn(c4, p4).join(', '));
    check('los 4 archivos empiezan con "SOLO Registro Dev. Nunca ejecutar en Poguis."',
        [F01, F02, F03, F04].every((f) => f.startsWith('-- SOLO Registro Dev. Nunca ejecutar en Poguis.')));
    check('autoprueba del escáner', wordsIn(codeOnly("select 'delete' -- update\n"), PROHIBIDAS_01).length === 0
        && wordsIn(codeOnly('do $$ begin delete from t; end $$;'), ['DELETE']).length === 1
        && wordsIn(codeOnly('select server_updated_at, updated_at'), PROHIBIDAS_01).length === 0);
}

// ---------------------------------------------------------------- 1. guardas del 01 (A1)
section('1. Guardas del 01: abortan sin dejar filas (A1)');
{
    // (1) uid inexistente
    let db = await freshDb();
    let real = await newUser(db); await newUser(db); await sembrarReal(db, real);
    let antes = sum(await counts(db, real), 'mio') + sum(await counts(db, real), 'otros');
    let err = await failsWith(() => db.exec(fill(F01, randomUUID(), ESCALA_04)));
    let despues = sum(await counts(db, real), 'mio') + sum(await counts(db, real), 'otros');
    check('guarda 1 (uid inexistente) aborta', /guarda 1/.test(err || ''), err ? err.slice(0, 80) : 'no falló');
    check('guarda 1: 0 filas nuevas', antes === despues, `${antes} → ${despues}`);
    // (2) uid con filas (el usuario "real")
    const hashAntes = await hashOthers(db, '00000000-0000-0000-0000-000000000000');
    err = await failsWith(() => db.exec(fill(F01, real, ESCALA_04)));
    despues = sum(await counts(db, real), 'mio') + sum(await counts(db, real), 'otros');
    check('guarda 2 (uid con filas) aborta', /guarda 2/.test(err || ''), err ? err.slice(0, 80) : 'no falló');
    check('guarda 2: 0 filas nuevas y contenido idéntico', antes === despues
        && hashAntes === await hashOthers(db, '00000000-0000-0000-0000-000000000000'), `${antes} → ${despues}`);
    // (3) un único usuario en auth.users
    db = await freshDb();
    const solo = await newUser(db);
    err = await failsWith(() => db.exec(fill(F01, solo, ESCALA_04)));
    check('guarda 3 (menos de 2 usuarios) aborta', /guarda 3/.test(err || ''), err ? err.slice(0, 80) : 'no falló');
    check('guarda 3: 0 filas', sum(await counts(db, solo), 'mio') === 0);
    // uid sin pegar
    err = await failsWith(() => db.exec(F01));
    check('sin pegar el uid: falla el cast y no escribe nada', /uuid/i.test(err || '') && sum(await counts(db, solo), 'mio') === 0, err ? err.slice(0, 60) : 'no falló');
}

// ---------------------------------------------------------------- 2. siembra completa (A1)
section(`2. Siembra del 01 a escala ${ESCALA}`);
const db = await freshDb();
const REAL = await newUser(db);
const PRUEBA = await newUser(db);
await sembrarReal(db, REAL);
const realAntes = await counts(db, PRUEBA);
const hashRealAntes = await hashOthers(db, PRUEBA);
let t0 = Date.now();
const errSiembra = await failsWith(() => db.exec(fill(F01, PRUEBA, ESCALA)));
const T01 = Date.now() - t0;
check('01 termina sin error', errSiembra === null, errSiembra || secs(T01));
{
    const c = await counts(db, PRUEBA);
    const e = esperado(ESCALA);
    const malas = TABLES.filter((t) => c[t].mio !== e[t]);
    check('conteos por tabla = los esperados', malas.length === 0, malas.map((t) => `${t} ${c[t].mio}≠${e[t]}`).join(', ') || `${sum(c, 'mio')} filas`);
    check('usuario "real" intacto tras la siembra', sum(c, 'otros') === sum(realAntes, 'otros') && hashRealAntes === await hashOthers(db, PRUEBA));
    const bytes = Number((await db.query(
        `select sum(pg_total_relation_size(('public.' || t)::regclass))::bigint as b from unnest($1::text[]) t`, [TABLES])).rows[0].b);
    const mbEscala1 = bytes / ESCALA / 1048576;
    check('tamaño estimado a escala 1 < 100 MB', mbEscala1 < 100, `${(bytes / 1048576).toFixed(1)} MB a escala ${ESCALA} → ~${mbEscala1.toFixed(1)} MB a escala 1`);
    const ties = Number((await db.query(
        `select count(*)::int as n from (select 1 from public.watch_history where user_id = $1 group by server_updated_at having count(*) > 1) g`, [PRUEBA])).rows[0].n);
    console.log(`     grupos de server_updated_at repetidos en watch_history con el trigger normal: ${ties} (informativo: depende de la resolución del reloj; en PGlite es baja)`);
    console.log(`     tiempo del 01 en PGlite: ${secs(T01)}`);
}

// ---------------------------------------------------------------- 3. 02: planes sin cambios persistentes (A3)
section('3. 02-medir-pull: generador + 9 bloques EXPLAIN, sin cambios persistentes (A3)');
{
    const antes = await snapshot(db);
    const cAntes = await counts(db, PRUEBA);
    await db.exec('begin transaction read only');
    let gen;
    try { gen = (await db.query(fill(F02, PRUEBA))).rows; } finally { await db.exec('rollback'); }
    check('el generador devuelve 9 bloques', gen.length === 9 && gen.every((r) => r.bloque && !r.bloque.startsWith('--')), `${gen.length} filas`);
    const permitidas = (b) => codeOnly(b).split(';').map((s) => s.trim()).filter(Boolean)
        .every((s) => /^select set_config\(/i.test(s) || /^set local role authenticated$/i.test(s) || /^explain \(analyze, buffers\) select /i.test(s));
    check('cada bloque solo tiene select set_config / set local role / explain', gen.every((r) => permitidas(r.bloque)));
    // Ejecuta los 9 bloques e imprime un resumen de cada plan; devuelve si la RLS se aplicó en todos.
    const planes = async (titulo) => {
        console.log(`     Planes de PGlite, ${titulo} (referencia; los tiempos que valen son los de Supabase):`);
        let rls = true;
        for (const r of gen) {
            const res = await db.exec(r.bloque);
            const plan = res[res.length - 1].rows.map((x) => x['QUERY PLAN']).join('\n');
            if (!/user_id = \(InitPlan \d+\)\.col\d+|\(InitPlan \d+\)\.col\d+ = user_id/.test(plan) || !/InitPlan/.test(plan)) rls = false;
            const recorrido = (plan.match(/->\s+(Index Scan|Index Only Scan|Seq Scan|Bitmap Heap Scan)[^(]*/) || [''])[0].replace('->', '').trim();
            const orden = /Sort Method: top-N/.test(plan) ? ' + top-N sort' : '';
            const leidas = (plan.match(/(?:Index Scan|Bitmap Heap Scan|Seq Scan)[^\n]*actual time=[\d.]+\.\.[\d.]+ rows=([\d.]+)/) || [, '?'])[1];
            const removed = [...plan.matchAll(/Rows Removed by Filter: (\d+)/g)].reduce((n, m) => n + Number(m[1]), 0);
            const buffers = (plan.match(/Buffers: shared hit=(\d+)(?: read=(\d+))?/) || [, '0', '0']);
            const exec = (plan.match(/Execution Time: ([\d.]+) ms/) || [, '?'])[1];
            const filas = (plan.match(/^Limit .*actual time=[\d.]+\.\.[\d.]+ rows=([\d.]+)/m) || [, '?'])[1];
            console.log(`     ${String(r.orden).padStart(2)} ${r.tabla.padEnd(16)} ${r.pagina.padEnd(10)} N=${String(r.filas_del_usuario).padEnd(6)} `
                + `devueltas=${parseInt(filas, 10)} leídas=${parseInt(leidas, 10) + removed} filtradas=${removed} buffers=${buffers[1]}${buffers[2] ? `+${buffers[2]}` : ''} `
                + `${exec} ms · ${recorrido}${orden}`);
        }
        return rls;
    };
    const rlsSinStats = await planes('sin estadísticas (recién sembrado)');
    // Solo en el ensayo: ANALYZE, como el autoanalyze de Supabase tras la siembra (el 03 informa
    // n_mod_since_analyze para medir en Registro Dev con estadísticas al día).
    await db.exec('analyze');
    const antesB = await snapshot(db);
    const rlsConStats = await planes('con ANALYZE (como tras el autoanalyze de Supabase)');
    check('la RLS se aplicó en los 18 planes (InitPlan + "user_id =")', rlsSinStats && rlsConStats);
    check('catálogo idéntico antes y después de la segunda pasada', antesB.catalogo === (await snapshot(db)).catalogo);
    const despues = await snapshot(db);
    check('catálogo idéntico antes y después', antes.catalogo === despues.catalogo);
    check('sesión idéntica después (rol postgres, sin claims): set_config(…, true) y set local no persisten',
        antes.sesion === despues.sesion, despues.sesion);
    check('conteos idénticos antes y después', JSON.stringify(cAntes) === JSON.stringify(await counts(db, PRUEBA)));
}

// ---------------------------------------------------------------- 4. cascada (A1, ajuste 3)
section('4. Cascada: borrar el usuario de prueba de auth.users (simula el dashboard)');
const run03 = async (uid) => {
    await db.exec('begin transaction read only');
    try { return (await db.query(fill(F03, uid))).rows; } finally { await db.exec('rollback'); }
};
let TCASCADA = 0;
{
    const antes = await snapshot(db);
    const r03a = await run03(PRUEBA);
    check('03 antes del borrado: no deja cambios persistentes', JSON.stringify(antes) === JSON.stringify(await snapshot(db)));
    const e = esperado(ESCALA);
    check('03 antes: prueba_filas = siembra en las 15 tablas y uid en auth.users = sí',
        r03a.slice(0, 15).every((r) => Number(r.prueba_filas) === e[r.tabla]) && r03a.find((r) => r.orden === 17).valor === 'sí');
    // set constraints all immediate: las FK diferidas (NO ACTION) se comprueban al final de la
    // sentencia y aparecen en el EXPLAIN; en el dashboard se comprueban al commit (mismo trabajo).
    t0 = Date.now();
    await db.exec('begin');
    await db.exec('set constraints all immediate');
    const plan = (await db.query('explain (analyze, format json) delete from auth.users where id = $1', [PRUEBA])).rows[0]['QUERY PLAN'];
    await db.exec('commit');
    TCASCADA = Date.now() - t0;
    const p = (typeof plan === 'string' ? JSON.parse(plan) : plan)[0];
    console.log(`     tiempo total del borrado (con commit): ${secs(TCASCADA)} · Execution Time: ${(p['Execution Time'] / 1000).toFixed(2)} s`);
    const triggers = (p.Triggers || []).slice().sort((a, b) => b.Time - a.Time);
    for (const t of triggers) {
        console.log(`       ${String((t.Time / 1000).toFixed(2)).padStart(6)} s  calls=${String(t.Calls).padStart(6)}  ${t['Constraint Name'] || t['Trigger Name']} (${t.Relation})`);
    }
    const ss = triggers.find((t) => t['Constraint Name'] === 'seasons_series_fkey');
    check('el trigger RI de seasons_series_fkey aparece medido', !!ss, ss ? `${(ss.Time / 1000).toFixed(3)} s en ${ss.Calls} llamadas` : '');
    const r03b = await run03(PRUEBA);
    check('03 después: 0 filas del usuario de prueba en las 15 tablas', r03b.slice(0, 15).every((r) => Number(r.prueba_filas) === 0));
    check('03 después: uid en auth.users = no', r03b.find((r) => r.orden === 17).valor === 'no');
    const otros = (rows) => JSON.stringify(rows.slice(0, 16).map((r) => [r.tabla, r.otros_total, r.otros_vivos, r.otros_borrados, r.otros_usuarios_distintos]));
    check('03: conteos de los demás usuarios idénticos antes y después', otros(r03a) === otros(r03b));
    check('usuario "real": contenido idéntico (hash) antes y después', hashRealAntes === await hashOthers(db, PRUEBA));
    if (ESCALA === 1) {
        const mayor = Math.max(T01, TCASCADA) / 1000;
        const rec = mayor <= 20 ? 1 : mayor <= 40 ? 0.5 : 0.25;
        console.log(`     Escala recomendada para Supabase: ${rec} (01 ${secs(T01)}, cascada ${secs(TCASCADA)}; criterio: ≤20 s → 1, ≤40 s → 0.5, >40 s → 0.25)`);
    } else {
        console.log('     (la escala recomendada solo se calcula a escala 1)');
    }
}

// ---------------------------------------------------------------- 5. 04: limpieza de emergencia (A1)
section(`5. 04-limpieza-emergencia (siembra a escala ${ESCALA_04})`);
async function base04() {
    const d = await freshDb();
    const real = await newUser(d), prueba = await newUser(d);
    await sembrarReal(d, real);
    await d.exec(fill(F01, prueba, ESCALA_04));
    return { d, real, prueba };
}
{
    // con el uid del usuario "real": guarda (c)
    let { d, real, prueba } = await base04();
    let cAntes = await counts(d, prueba), hAntes = await hashOthers(d, prueba);
    let err = await failsWith(() => d.exec(fill(F04, real)));
    check('uid del usuario "real": aborta por la guarda (c)', /guarda \(c\)/.test(err || ''), err ? err.slice(0, 90) : 'no falló');
    check('… y no borra nada (conteos y hash iguales)', JSON.stringify(cAntes) === JSON.stringify(await counts(d, prueba)) && hAntes === await hashOthers(d, prueba));
    // guarda (a): uid inexistente
    err = await failsWith(() => d.exec(fill(F04, randomUUID())));
    check('uid inexistente: aborta por la guarda (a) sin borrar nada', /guarda \(a\)/.test(err || '') && JSON.stringify(cAntes) === JSON.stringify(await counts(d, prueba)));
    // contraprueba de (c): una fila del uid de prueba sin prefijo
    await d.query(`insert into public.backlog (id, user_id, type, title, created_at, updated_at) values ($1, $2, 'movie', 'sin prefijo', '2026-11-07T00:00:00Z', '2026-11-07T00:00:00Z')`, [randomUUID(), prueba]);
    cAntes = await counts(d, prueba);
    err = await failsWith(() => d.exec(fill(F04, prueba)));
    check('contraprueba: una fila del uid de prueba sin prefijo → aborta por la guarda (c) (backlog)', /guarda \(c\): backlog/.test(err || ''), err ? err.slice(0, 90) : 'no falló');
    check('… y no borra nada', JSON.stringify(cAntes) === JSON.stringify(await counts(d, prueba)));
    // contraprueba de (c) en una tabla sin texto: un watch_history con created_at real
    ({ d, real, prueba } = await base04());
    const serie = (await d.query('select id from public.series where user_id = $1 limit 1', [prueba])).rows[0].id;
    await d.query(`insert into public.watch_history (id, user_id, series_id, season_number, episode_number, watched_at, created_at, updated_at)
        values ($1, $2, $3, 1, 1, now(), '2026-11-07T00:00:00Z', '2026-11-07T00:00:00Z')`, [randomUUID(), prueba, serie]);
    cAntes = await counts(d, prueba);
    err = await failsWith(() => d.exec(fill(F04, prueba)));
    check('contraprueba: watch_history con created_at real → aborta por la guarda (c) sin borrar nada',
        /guarda \(c\): watch_history/.test(err || '') && JSON.stringify(cAntes) === JSON.stringify(await counts(d, prueba)), err ? err.slice(0, 90) : 'no falló');
    // con el uid de prueba: borra todo lo suyo; el "real" queda idéntico
    ({ d, real, prueba } = await base04());
    hAntes = await hashOthers(d, prueba);
    const otrosAntes = sum(await counts(d, prueba), 'otros');
    err = await failsWith(() => d.exec(fill(F04, prueba)));
    const cDespues = await counts(d, prueba);
    check('uid de prueba: termina sin error', err === null, err || '');
    check('… deja 0 filas suyas en las 15 tablas', sum(cDespues, 'mio') === 0);
    check('… el usuario "real" queda idéntico (conteos y hash)', sum(cDespues, 'otros') === otrosAntes && hAntes === await hashOthers(d, prueba));
    check('… no toca auth.users', Number((await d.query('select count(*)::int n from auth.users where id = $1', [prueba])).rows[0].n) === 1);
    // guarda (b): un único usuario
    ({ d, real, prueba } = await base04());
    await d.query('delete from auth.users where id = $1', [real]); // solo en el ensayo: deja 1 usuario
    cAntes = await counts(d, prueba);
    err = await failsWith(() => d.exec(fill(F04, prueba)));
    check('un único usuario: aborta por la guarda (b) sin borrar nada', /guarda \(b\)/.test(err || '') && JSON.stringify(cAntes) === JSON.stringify(await counts(d, prueba)), err ? err.slice(0, 90) : 'no falló');
}

// ---------------------------------------------------------------- 6. paginación con server_updated_at repetidos (A2)
section('6. Paginación con server_updated_at repetidos (A2)');
{
    const d = await freshDb();
    const uid = await newUser(d);
    const cat = randomUUID(), serie = randomUUID(), now = '2026-11-07T00:00:00Z';
    await d.query(`insert into public.entertainment_categories (id, user_id, name, type, created_at, updated_at) values ($1, $2, 'c', 'video', $3, $3)`, [cat, uid, now]);
    await d.query(`insert into public.series (id, user_id, category_id, name, created_at, updated_at) values ($1, $2, $3, 's', $4, $4)`, [serie, uid, cat, now]);
    const N = Math.max(2000, Math.round(50000 * ESCALA));
    const BLOQUE = 700; // > página de 500: cada grupo de empates cruza al menos un límite de página
    // Solo en el ensayo (superusuario): se apaga el trigger para poder fijar server_updated_at.
    await d.exec('alter table public.watch_history disable trigger set_server_updated_at');
    await d.query(`insert into public.watch_history (id, user_id, series_id, season_number, episode_number, watched_at, created_at, updated_at, server_updated_at)
        select gen_random_uuid(), $1, $2, 1, g, $3, $3, $3, timestamptz '2026-11-07 00:00:00+00' + (g / $4) * interval '1 millisecond'
        from generate_series(0, $5 - 1) g`, [uid, serie, now, BLOQUE, N]);
    await d.exec('alter table public.watch_history enable trigger set_server_updated_at');
    const grupos = Number((await d.query(`select count(*)::int n from (select 1 from public.watch_history group by server_updated_at having count(*) > 1) g`)).rows[0].n);
    console.log(`     ${N} filas en ${grupos} grupos de ${BLOQUE} con el mismo server_updated_at; página = ${PAGE_SIZE} (src/sync/config.ts)`);
    // Recorrido como pullTable (src/sync/engine.ts): primera página sin cursor, luego keyset por (ts, id).
    const tr = createPgliteTransport(d);
    tr.uid = uid;
    const vistos = new Set();
    let recibidas = 0, paginas = 0, after = null, ordenOk = true, prev = null, error = null;
    t0 = Date.now();
    for (;;) {
        const page = await tr.pullPage('watch_history', { since: null, after, limit: PAGE_SIZE });
        if (page.error) { error = page.error.message; break; }
        if (page.rows.length === 0) break;
        paginas++;
        for (const r of page.rows) {
            const key = [Date.parse(r.server_updated_at) * 1000 + Number((r.server_updated_at.match(/\.(\d+)/) || [, '0'])[1].padEnd(6, '0').slice(3, 6)), r.id];
            if (prev && (key[0] < prev[0] || (key[0] === prev[0] && key[1] <= prev[1]))) ordenOk = false;
            prev = key;
            vistos.add(r.id); recibidas++;
        }
        const last = page.rows[page.rows.length - 1];
        after = { ts: last.server_updated_at, id: last.id };
        if (page.rows.length < PAGE_SIZE) break;
    }
    const tPag = Date.now() - t0;
    check('recorrido sin errores', error === null, error || `${paginas} páginas en ${secs(tPag)}`);
    check('0 filas duplicadas', recibidas === vistos.size, `${recibidas - vistos.size} duplicadas`);
    check('0 filas perdidas', vistos.size === N, `${N - vistos.size} perdidas`);
    check('orden estrictamente creciente por (server_updated_at, id)', ordenOk);
}

console.log(`\nEscala: ${ESCALA} (04 a ${ESCALA_04}) · ${failures === 0 ? 'TODO OK' : `${failures} FALLA(S)`}`);
process.exit(failures === 0 ? 0 : 1);
