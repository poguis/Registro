// Valida un respaldo JSON generado por la app ("Respaldar datos") y lo carga en un
// SQLite local dentro de .local-data/ (base para el dry-run de la Fase 1).
// No modifica el respaldo ni imprime filas: solo conteos, versiones y huellas.
//
// Uso:
//   node scripts/validar-respaldo.mjs <respaldo.json> [--db <copia.db>] [--out <salida.sqlite>] [--overwrite]
//
//   --db         copia física (.db) del mismo respaldo: se comparan conteos y contenido.
//   --out        SQLite a crear con los datos del JSON (por defecto .local-data/<nombre>.sqlite).
//   --overwrite  permite reemplazar --out si ya existe (solo ese archivo derivado).
import { readFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
    PASSWORD_PLACEHOLDER, openReadOnly, listTables, getUserVersion, countAll, hashRows, hashAll,
} from './lib/sqlite-utils.mjs';

const args = process.argv.slice(2);
const flag = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : null;
};
const jsonPath = args.find((a, i) => !a.startsWith('--') && (i === 0 || !['--db', '--out'].includes(args[i - 1])));
if (!jsonPath) {
    console.error('Uso: node scripts/validar-respaldo.mjs <respaldo.json> [--db <copia.db>] [--out <salida.sqlite>] [--overwrite]');
    process.exit(2);
}
const dbCopyPath = flag('--db');
const outPath = resolve(flag('--out') || `.local-data/${basename(jsonPath).replace(/\.json$/i, '')}.sqlite`);

let failures = 0;
const check = (name, condition, detail = '') => {
    console.log(`${condition ? 'OK  ' : 'FALLA'} ${name}${detail ? ` — ${detail}` : ''}`);
    if (!condition) failures++;
};

// 1. Leer y validar la estructura del JSON
const backup = JSON.parse(readFileSync(jsonPath, 'utf8'));
const { meta, data } = backup;
check('Formato registro-respaldo', meta && meta.format === 'registro-respaldo', meta && `v${meta.formatVersion}`);
console.log(`     creado: ${meta.createdAt} · app ${meta.appVersion} · SQLite ${meta.sqliteVersion} · user_version ${meta.userVersion} · archivo ${meta.databaseFile}`);

const schemaTables = meta.schema.map((t) => t.name).sort();
const dataTables = Object.keys(data).sort();
check('Tablas del esquema = tablas con datos', JSON.stringify(schemaTables) === JSON.stringify(dataTables), `${dataTables.length} tablas`);

for (const table of dataTables) {
    check(`Conteo ${table}`, data[table].length === meta.counts[table], `${data[table].length} filas (meta: ${meta.counts[table]})`);
}
if (data.users) {
    check('users.password reemplazado en el JSON', data.users.every((u) => u.password === PASSWORD_PLACEHOLDER), `${data.users.length} cuenta(s)`);
}

// 2. Cargar el JSON en un SQLite nuevo con el DDL original
if (existsSync(outPath)) {
    if (!args.includes('--overwrite')) {
        console.error(`\nYa existe ${outPath}. Usa --overwrite para reemplazar ese archivo derivado, o --out con otra ruta.`);
        process.exit(2);
    }
    rmSync(outPath);
}
mkdirSync(dirname(outPath), { recursive: true });
const out = new DatabaseSync(outPath, { enableForeignKeyConstraints: false });
out.exec('BEGIN');
for (const { sql } of meta.schema) out.exec(sql);
for (const { sql } of meta.indexes || []) out.exec(sql);
for (const table of dataTables) {
    const rows = data[table];
    if (rows.length === 0) continue;
    const columns = Object.keys(rows[0]);
    const insert = out.prepare(
        `INSERT INTO "${table}" (${columns.map((c) => `"${c}"`).join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`
    );
    for (const row of rows) insert.run(...columns.map((c) => row[c]));
}
out.exec(`PRAGMA user_version = ${Number(meta.userVersion) || 0}`);
out.exec('COMMIT');

const loadedCounts = countAll(out);
for (const table of dataTables) {
    check(`Cargado en SQLite: ${table}`, loadedCounts[table] === meta.counts[table], `${loadedCounts[table]} filas`);
}
const fkErrors = out.prepare('PRAGMA foreign_key_check').all();
check('PRAGMA foreign_key_check vacío en la carga', fkErrors.length === 0, `${fkErrors.length} violaciones`);
out.close();
console.log(`     SQLite creado: ${outPath}`);

// 3. Comparar con la copia física, si se indicó
if (dbCopyPath) {
    const copy = openReadOnly(dbCopyPath);
    const copyTables = listTables(copy);
    check('Copia .db: mismas tablas', JSON.stringify(copyTables) === JSON.stringify(dataTables));
    check('Copia .db: mismo user_version', getUserVersion(copy) === meta.userVersion, `${getUserVersion(copy)}`);
    const copyCounts = countAll(copy);
    const copyHashes = hashAll(copy);
    for (const table of dataTables) {
        check(`Copia .db: conteo ${table}`, copyCounts[table] === meta.counts[table], `${copyCounts[table]} filas`);
        check(`Copia .db: contenido ${table}`, copyHashes[table] === hashRows(data[table], { maskPassword: table === 'users' }));
    }
    copy.close();
}

console.log(failures === 0 ? '\nRespaldo válido.' : `\n${failures} verificación(es) fallaron.`);
process.exit(failures === 0 ? 0 : 1);
