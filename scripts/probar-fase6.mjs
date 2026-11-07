// Pruebas de la Fase 6.1 (auditoría de solo lectura): ejecuta supabase/auditar-fase6.sql en un
// Postgres LOCAL (PGlite, en memoria; nunca un proyecto remoto) con las migraciones reales y el
// stub de auth de scripts/lib/pg-auth-stub.sql. No imprime filas de dominio: solo valores de
// catálogo y conteos.
//
// Uso:
//   node scripts/probar-fase6.mjs                   # escaneo estático + ejecución read only + negativas
//   node scripts/probar-fase6.mjs --conteos <db>    # conteos de un respaldo (formato de verificar-fase5.sql)
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { TABLES } from '../src/sync/mapping.ts';
import { openReadOnly } from './lib/sqlite-utils.mjs';

// ---------------------------------------------------------------- --conteos <db>
const args = process.argv.slice(2);
const conteosIndex = args.indexOf('--conteos');
if (conteosIndex >= 0) {
    const path = args[conteosIndex + 1];
    if (!path || !existsSync(path)) {
        console.error('Uso: node scripts/probar-fase6.mjs --conteos <respaldo.db>');
        process.exit(2);
    }
    const db = openReadOnly(path);
    const users = new Set();
    let total = 0, live = 0;
    console.log('tabla | total | vivos | borrados | usuarios_distintos');
    for (const t of TABLES) {
        const r = db.prepare(`SELECT COUNT(*) AS total, COALESCE(SUM(deleted_at IS NULL), 0) AS vivos, COUNT(DISTINCT user_id) AS u FROM ${t}`).get();
        for (const u of db.prepare(`SELECT DISTINCT user_id FROM ${t}`).all()) users.add(u.user_id);
        total += r.total; live += r.vivos;
        console.log(`${t} | ${r.total} | ${r.vivos} | ${r.total - r.vivos} | ${r.u}`);
    }
    console.log(`TODAS | ${total} | ${live} | ${total - live} | ${users.size}`);
    db.close();
    process.exit(users.size <= 1 ? 0 : 1);
}

// ---------------------------------------------------------------- utilidades
const SQL_FILE = 'supabase/auditar-fase6.sql';
const SQL = readFileSync(SQL_FILE, 'utf8');
const STUB = readFileSync('scripts/lib/pg-auth-stub.sql', 'utf8');
const MIGRATIONS_DIR = 'supabase/migrations';
const migrationFiles = readdirSync(MIGRATIONS_DIR).filter((f) => /^\d{14}_[a-z0-9_]+\.sql$/.test(f)).sort();

let failures = 0;
const check = (name, ok, detail = '') => {
    console.log(`${ok ? 'OK  ' : 'FALLA'} ${name}${detail ? ` — ${detail}` : ''}`);
    if (!ok) failures++;
};
const section = (t) => console.log(`\n== ${t} ==`);

// Base nueva como en probar-fase2 (stub + migraciones en orden) + 1 usuario de prueba con
// identidad google (solo PGlite), para que los chequeos de Auth sean comprobables.
async function freshDb() {
    const db = new PGlite();
    await db.exec(STUB);
    for (const f of migrationFiles) await db.exec(readFileSync(`${MIGRATIONS_DIR}/${f}`, 'utf8'));
    const uid = randomUUID();
    await db.query('insert into auth.users (id) values ($1)', [uid]);
    await db.query("insert into auth.identities (user_id, provider) values ($1, 'google')", [uid]);
    return db;
}

// Ejecuta la auditoría en una transacción de solo lectura.
async function audit(db) {
    await db.exec('begin transaction read only');
    try {
        return (await db.query(SQL)).rows;
    } finally {
        await db.exec('rollback');
    }
}
const kind = (r) => (r.esperado === null ? 'I' : r.chequeo.startsWith('(solo Supabase)') ? 'S' : 'E');

// Separa el código de los comentarios y de los literales '…' (respeta "identificadores").
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

// ---------------------------------------------------------------- A1: escaneo estático
section(`A1. ${SQL_FILE}: una sola sentencia SELECT, sin palabras prohibidas`);
const code = codeOnly(SQL);
const WORDS = ['INSERT', 'UPDATE', 'DELETE', 'MERGE', 'UPSERT', 'ALTER', 'CREATE', 'DROP', 'GRANT', 'REVOKE', 'TRUNCATE',
    'COPY', 'DO', 'CALL', 'SET', 'VACUUM', 'LOCK'];
const SUBSTRINGS = ['pg_read_file', 'pg_write', 'lo_'];
const hits = [
    ...WORDS.filter((w) => new RegExp(`\\b${w}\\b`, 'i').test(code)),
    ...SUBSTRINGS.filter((s) => code.toLowerCase().includes(s)),
];
check('0 palabras prohibidas fuera de comentarios y literales', hits.length === 0, hits.join(', '));
// El escáner funciona: detecta palabras en código y las ignora en comentarios y literales.
const scan = (s) => WORDS.filter((w) => new RegExp(`\\b${w}\\b`, 'i').test(codeOnly(s)));
check('autoprueba del escáner (detecta "delete from" y "SET role"; ignora "-- drop" y \'UPDATE\')',
    scan('select 1; delete from t').join() === 'DELETE' && scan('SET role x').join() === 'SET'
    && scan("select 'UPDATE' -- drop table\n").length === 0 && scan('select set_server_updated_at()').length === 0);
const trimmed = code.trim();
const semicolons = (trimmed.match(/;/g) || []).length;
check('una sola sentencia (un único ; y al final)', semicolons === 1 && trimmed.endsWith(';'), `${semicolons} ;`);
check('empieza por WITH o SELECT', /^(with|select)\b/i.test(trimmed));

// ---------------------------------------------------------------- A1/A2: ejecución
section('A2. Ejecución en PGlite (stub + migraciones reales) dentro de "begin transaction read only"');
let rows = [];
try {
    rows = await audit(await freshDb());
    check('corre sin error en una transacción de solo lectura', true, `${rows.length} chequeos`);
} catch (e) {
    check('corre sin error en una transacción de solo lectura', false, e.message);
}
const byKind = { E: [], I: [], S: [] };
for (const r of rows) byKind[kind(r)].push(r);
console.log('\n  #  tipo  ok     chequeo · valor');
for (const r of rows) {
    console.log(`${String(r.orden).padStart(3)}  ${kind(r)}     ${String(r.ok).padEnd(6)} ${r.chequeo} · ${String(r.valor).slice(0, 120)}`);
}
console.log('');
const strictBad = byKind.E.filter((r) => r.ok !== true);
check('todos los estrictos (no solo Supabase) en ok = true', byKind.E.length > 0 && strictBad.length === 0,
    strictBad.map((r) => `#${r.orden}`).join(', '));
check('todos los informativos con ok NULL', byKind.I.every((r) => r.ok === null));
check('chequeos numerados 1..N sin huecos', rows.every((r, i) => Number(r.orden) === i + 1));
console.log(`     ${byKind.E.filter((r) => r.ok === true).length}/${byKind.E.length} estrictos ok · ${byKind.I.length} informativos · `
    + `${byKind.S.length} solo Supabase (en PGlite: ${byKind.S.map((r) => `#${r.orden}=${r.ok}`).join(', ')}; no se evalúan aquí)`);

// ---------------------------------------------------------------- A3: negativas
section('A3. Pruebas negativas (cada una en una base nueva): el chequeo esperado pasa a false');
const NEGATIVES = [
    ['grant delete en public.backlog a authenticated', 'grant delete on public.backlog to authenticated', [15]],
    ['función security definer en public',
        `create function public.f_prueba_definer() returns int language sql security definer as $$ select 1 $$;
         revoke all on function public.f_prueba_definer() from public, anon, authenticated;`, [5, 17]],
    ['RLS desactivada en public.backlog', 'alter table public.backlog disable row level security', [10]],
    ['política SELECT para anon en public.backlog', 'create policy backlog_anon_prueba on public.backlog for select to anon using (true)', [8, 9]],
    ['FK user_id de public.backlog sin on delete cascade',
        `alter table public.backlog drop constraint backlog_user_id_fkey;
         alter table public.backlog add constraint backlog_user_id_fkey foreign key (user_id) references auth.users (id);`, [23]],
];
for (const [label, change, expected] of NEGATIVES) {
    try {
        const db = await freshDb();
        await db.exec(change);
        const res = await audit(db);
        const falseNow = res.filter((r) => kind(r) === 'E' && r.ok === false).map((r) => Number(r.orden)).sort((a, b) => a - b);
        check(`${label} → false exactamente en ${expected.map((n) => `#${n}`).join(' y ')}`,
            JSON.stringify(falseNow) === JSON.stringify(expected), `en false: ${falseNow.map((n) => `#${n}`).join(', ') || 'ninguno'}`);
    } catch (e) {
        check(label, false, e.message);
    }
}

console.log(failures === 0 ? '\nFASE 6.1: TODO OK.' : `\n${failures} verificación(es) fallaron.`);
process.exit(failures === 0 ? 0 : 1);
