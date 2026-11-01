// Compara una BD antes y después de instalar la Fase 3 en un dispositivo (emulador o celular):
// migración 3 + vinculación con Google. Solo lectura; no imprime filas, emails ni contraseñas.
//
// Uso: node scripts/dryrun-fase3.mjs --par <antes.db> <despues.db> [--etiqueta X] [--sin-vincular]
//   --sin-vincular: la BD "después" es anterior a la vinculación (solo migración 3).
import { readFileSync, existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { hashRows } from './lib/sqlite-utils.mjs';

const argv = process.argv.slice(2);
const i = argv.indexOf('--par');
if (i < 0 || !argv[i + 1] || !argv[i + 2]) {
    console.error('Uso: node scripts/dryrun-fase3.mjs --par <antes.db> <despues.db> [--etiqueta X] [--sin-vincular]');
    process.exit(2);
}
const [beforePath, afterPath] = [argv[i + 1], argv[i + 2]];
const label = argv.includes('--etiqueta') ? argv[argv.indexOf('--etiqueta') + 1] : 'dispositivo';
const expectLinked = !argv.includes('--sin-vincular');

const DOMAIN = ['finance_contacts', 'finance_transactions', 'balance_history', 'finance_categories', 'services',
    'entertainment_categories', 'entertainment_pauses', 'entertainment_quotas_history', 'series', 'seasons',
    'watch_history', 'reading_history', 'backlog', 'work_people', 'cards'];

let failures = 0;
const check = (name, ok, detail = '') => {
    console.log(`${ok ? 'OK  ' : 'FALLA'} ${name}${detail ? ` — ${detail}` : ''}`);
    if (!ok) failures++;
};

console.log(`==== ${label} ====`);
for (const p of [beforePath, afterPath]) if (!existsSync(p)) { console.error(`No existe ${p}`); process.exit(2); }
const A = new DatabaseSync(beforePath, { readOnly: true });
const B = new DatabaseSync(afterPath, { readOnly: true });
const cols = (d, t) => d.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
const count = (d, t, w = '') => d.prepare(`SELECT COUNT(*) n FROM ${t} ${w}`).get().n;

const uvA = A.prepare('PRAGMA user_version').get().user_version;
const uvB = B.prepare('PRAGMA user_version').get().user_version;
check('user_version: antes 2, después 3', uvA === 2 && uvB === 3, `${uvA} → ${uvB}`);

// 1. Las 15 tablas: mismos conteos y mismo contenido salvo user_id
const rows = [];
let same = true;
for (const t of DOMAIN) {
    const strip = (d) => hashRows(d.prepare(`SELECT * FROM ${t}`).all().map(({ user_id, ...r }) => r));
    const [na, nb] = [count(A, t), count(B, t)];
    const ok = na === nb && strip(A) === strip(B);
    same &&= ok;
    rows.push(`${t} ${na}→${nb}${ok ? '' : ' ≠'}`);
}
check('15 tablas: conteos y contenido idénticos (salvo user_id; updated_at intacto)', same, rows.join(' · '));
check('outbox sin cambios (la migración y la vinculación no encolan)', count(A, 'outbox') === count(B, 'outbox'), `${count(A, 'outbox')} → ${count(B, 'outbox')}`);

// 2. users sin password, legacy_users vacío
check('users sin columna password (con email y linked_at)', !cols(B, 'users').includes('password') && ['email', 'linked_at'].every((c) => cols(B, 'users').includes(c)));
check('legacy_users.password vacío en todas las filas', count(B, 'legacy_users', "WHERE password <> ''") === 0, `${count(B, 'legacy_users')} fila(s)`);
const oldPasswords = cols(A, 'users').includes('password')
    ? [...new Set(A.prepare('SELECT password FROM users').all().map((r) => r.password).filter((p) => p && p.length >= 3))] : [];
const bytes = readFileSync(afterPath);
const leaked = oldPasswords.filter((p) => bytes.includes(Buffer.from(p, 'utf8'))).length;
check(`ninguna contraseña antigua en los bytes del .db después (secure_delete)`, leaked === 0, `${oldPasswords.length} revisada(s), ${leaked} encontrada(s)`);
check('resumen de la migración 3 en _migration_log', count(B, '_migration_log', "WHERE version = 3 AND kind = 'summary'") === 1);

// 3. Vinculación
const usersB = B.prepare('SELECT id, email, linked_at FROM users').all();
const usersA = A.prepare('SELECT id FROM users').all();
if (expectLinked) {
    const u = usersB[0];
    check('1 cuenta, vinculada (email y linked_at), con id nuevo (uid de Google)',
        usersB.length === 1 && !!u.email && !!u.linked_at && usersA.length === 1 && u.id !== usersA[0].id);
    let foreign = 0;
    for (const t of DOMAIN) foreign += count(B, t, `WHERE user_id <> '${String(u?.id).replace(/'/g, "''")}'`);
    check('0 filas con user_id distinto del uid', foreign === 0, `${foreign}`);
    check("registro 'link' en _migration_log", count(B, '_migration_log', "WHERE kind = 'link'") === 1);
} else {
    check('sin vincular: mismas cuentas, sin linked_at', JSON.stringify(usersB.map((u) => u.id).sort()) === JSON.stringify(usersA.map((u) => u.id).sort()) && usersB.every((u) => !u.linked_at));
}

console.log(failures === 0 ? `\nDRY-RUN FASE 3 OK (${label}).` : `\n${failures} verificación(es) fallaron.`);
process.exit(failures === 0 ? 0 : 1);
