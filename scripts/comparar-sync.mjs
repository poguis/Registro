// Compara el contenido SINCRONIZABLE de dos BD de la app (Fase 5): las 15 tablas que van al
// servidor; excluye users, outbox, sync_state, sync_meta, _id_map, _migration_log y legacy_*.
// Solo lectura. Nunca imprime contenido de filas: conteos, huellas SHA-256 y UUID.
//
// Uso: node scripts/comparar-sync.mjs --a <a.db> --b <b.db> [--etiqueta X] [--ignorar-fechas-categorias]
//
// Normalización (la forma en que la fila llega al servidor, src/sync/mapping.ts → toRemote):
// timestamps ISO en ms, montos a centavos con la regla de Postgres (texto), last_watched_at 0 ≡
// NULL, JSON parseado; después JSON canónico con claves ordenadas. Con
// --ignorar-fechas-categorias se quitan created_at/updated_at de finance_categories (comparación
// intermedia de la Fase 5.5: un dispositivo nuevo sube sus categorías por defecto con sus fechas).
// Si toRemote falla en una fila, se informa tabla e id y el script sale con código 2.
// Salida: 0 idénticas, 1 difieren, 2 error de uso o de normalización.
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { openReadOnly } from './lib/sqlite-utils.mjs';
import { TABLES, toRemote, toCents } from '../src/sync/mapping.ts';

const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x)
    ? Object.fromEntries(Object.keys(x).sort().map((key) => [key, x[key]])) : x));

// Normaliza una BD: por tabla, filas canónicas por id, conteos, errores de mapeo y saldo en centavos.
export function snapshotDb(path, { ignoreCategoryDates = false } = {}) {
    const db = openReadOnly(path);
    const out = { tables: {}, errors: [], balanceCents: 0n };
    try {
        for (const t of TABLES) {
            const rows = db.prepare(`SELECT * FROM ${t} ORDER BY id`).all().map((r) => Object.fromEntries(Object.entries(r)));
            const byId = new Map();
            let live = 0;
            for (const r of rows) {
                if (r.deleted_at == null) live++;
                let remote;
                try {
                    remote = toRemote(t, r);
                } catch (e) {
                    out.errors.push({ table: t, id: r.id, message: String(e && e.message || e) });
                    continue;
                }
                if (ignoreCategoryDates && t === 'finance_categories') { delete remote.created_at; delete remote.updated_at; }
                byId.set(r.id, canon(remote));
                if (t === 'balance_history' && r.deleted_at == null) out.balanceCents += toCents(remote.amount);
            }
            const hash = createHash('sha256').update([...byId.entries()].map(([id, c]) => `${id}\u0000${c}`).join('\n')).digest('hex');
            out.tables[t] = { total: rows.length, live, deleted: rows.length - live, byId, hash };
        }
    } finally {
        db.close();
    }
    return out;
}

// Diferencias por tabla: ids con contenido distinto, solo en A, solo en B.
export function compareSnapshots(a, b) {
    const tables = {};
    let identical = a.errors.length === 0 && b.errors.length === 0;
    for (const t of TABLES) {
        const x = a.tables[t], y = b.tables[t];
        const differ = [], onlyA = [], onlyB = [];
        for (const [id, c] of x.byId) {
            if (!y.byId.has(id)) onlyA.push(id);
            else if (y.byId.get(id) !== c) differ.push(id);
        }
        for (const id of y.byId.keys()) if (!x.byId.has(id)) onlyB.push(id);
        const same = differ.length === 0 && onlyA.length === 0 && onlyB.length === 0 && x.hash === y.hash;
        if (!same) identical = false;
        tables[t] = { same, differ, onlyA, onlyB };
    }
    return { identical, tables, balanceEqual: a.balanceCents === b.balanceCents };
}

export function compareDbs(pathA, pathB, opts = {}) {
    const a = snapshotDb(pathA, opts);
    const b = snapshotDb(pathB, opts);
    return { a, b, result: compareSnapshots(a, b) };
}

export function printReport({ a, b, result }, label = '') {
    console.log(`\n== comparar-sync${label ? ` · ${label}` : ''} ==`);
    for (const [side, s] of [['A', a], ['B', b]]) {
        for (const e of s.errors) console.log(`ERROR de normalización en ${side}: ${e.table} id ${e.id} — ${e.message}`);
    }
    console.log('tabla                         A total/vivos/borrados   B total/vivos/borrados   hash A        hash B        igual');
    for (const t of TABLES) {
        const x = a.tables[t], y = b.tables[t], r = result.tables[t];
        console.log(`${t.padEnd(30)}${`${x.total}/${x.live}/${x.deleted}`.padEnd(25)}${`${y.total}/${y.live}/${y.deleted}`.padEnd(25)}${x.hash.slice(0, 12).padEnd(14)}${y.hash.slice(0, 12).padEnd(14)}${r.same ? 'sí' : 'NO'}`);
        if (r.differ.length) console.log(`    contenido distinto (${r.differ.length}): ${r.differ.join(', ')}`);
        if (r.onlyA.length) console.log(`    solo en A (${r.onlyA.length}): ${r.onlyA.join(', ')}`);
        if (r.onlyB.length) console.log(`    solo en B (${r.onlyB.length}): ${r.onlyB.join(', ')}`);
    }
    console.log(`saldo (SUM de balance_history vivos) igual en A y B: ${result.balanceEqual ? 'sí' : 'NO'}`);
    const errors = a.errors.length + b.errors.length;
    console.log(errors ? `\n${errors} fila(s) no se pudieron normalizar.` : result.identical ? '\nIDÉNTICAS en las 15 tablas.' : '\nDIFIEREN (ver arriba).');
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    const args = process.argv.slice(2);
    const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
    const pathA = flag('--a'), pathB = flag('--b');
    if (!pathA || !pathB || !existsSync(pathA) || !existsSync(pathB)) {
        console.error('Uso: node scripts/comparar-sync.mjs --a <a.db> --b <b.db> [--etiqueta X] [--ignorar-fechas-categorias]');
        process.exit(2);
    }
    let report;
    try {
        report = compareDbs(pathA, pathB, { ignoreCategoryDates: args.includes('--ignorar-fechas-categorias') });
    } catch (e) {
        console.error(`ERROR: ${e && e.message || e}`);
        process.exit(2);
    }
    printReport(report, flag('--etiqueta') || '');
    if (report.a.errors.length || report.b.errors.length) process.exit(2);
    process.exit(report.result.identical ? 0 : 1);
}
