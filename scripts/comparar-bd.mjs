// Compara dos archivos SQLite de la app (p. ej. extraídos del emulador antes y
// después de actualizar el APK). Solo lectura. No imprime filas.
//
// Uso: node scripts/comparar-bd.mjs <antes.db> <despues.db> [--user-version N]
//
// Verifica: mismas tablas, mismos conteos y contenido por tabla, mismo sqlite_master
// (lista las diferencias para justificarlas) y user_version esperado en "después".
import { openReadOnly, listTables, getUserVersion, getSchema, countAll, hashAll } from './lib/sqlite-utils.mjs';

const args = process.argv.slice(2);
const [beforePath, afterPath] = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--user-version');
if (!beforePath || !afterPath) {
    console.error('Uso: node scripts/comparar-bd.mjs <antes.db> <despues.db> [--user-version N]');
    process.exit(2);
}
const uvIndex = args.indexOf('--user-version');
const expectedUserVersion = uvIndex >= 0 ? Number(args[uvIndex + 1]) : 1;

let failures = 0;
const check = (name, condition, detail = '') => {
    console.log(`${condition ? 'OK  ' : 'FALLA'} ${name}${detail ? ` — ${detail}` : ''}`);
    if (!condition) failures++;
};

const before = openReadOnly(beforePath);
const after = openReadOnly(afterPath);

console.log(`user_version: antes ${getUserVersion(before)} · después ${getUserVersion(after)}`);
check(`user_version después = ${expectedUserVersion}`, getUserVersion(after) === expectedUserVersion);

const tablesBefore = listTables(before);
const tablesAfter = listTables(after);
check('Mismas tablas', JSON.stringify(tablesBefore) === JSON.stringify(tablesAfter), `${tablesBefore.length} → ${tablesAfter.length}`);

const countsBefore = countAll(before);
const countsAfter = countAll(after);
const hashesBefore = hashAll(before);
const hashesAfter = hashAll(after);
for (const table of tablesBefore) {
    check(`Conteo ${table}`, countsBefore[table] === countsAfter[table], `${countsBefore[table]} → ${countsAfter[table] ?? 'no existe'}`);
    check(`Contenido ${table}`, hashesBefore[table] === hashesAfter[table]);
}

// sqlite_master: lista cada entrada que cambió, apareció o desapareció
const key = (e) => `${e.type}:${e.name}`;
const schemaBefore = new Map(getSchema(before).map((e) => [key(e), e.sql]));
const schemaAfter = new Map(getSchema(after).map((e) => [key(e), e.sql]));
const diffs = [];
for (const [k, sql] of schemaBefore) {
    if (!schemaAfter.has(k)) diffs.push(`eliminado ${k}`);
    else if (schemaAfter.get(k) !== sql) diffs.push(`modificado ${k}`);
}
for (const k of schemaAfter.keys()) if (!schemaBefore.has(k)) diffs.push(`nuevo ${k}`);
check('sqlite_master idéntico', diffs.length === 0, diffs.length ? diffs.join('; ') : `${schemaBefore.size} entradas`);

before.close();
after.close();
console.log(failures === 0 ? '\nLas bases coinciden.' : `\n${failures} diferencia(s).`);
process.exit(failures === 0 ? 0 : 1);
