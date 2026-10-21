// Inventario de datos para la Fase 1 (UUID, sync, soft delete). SOLO LECTURA.
// Nunca imprime filas, nombres, descripciones ni textos libres: solo conteos,
// enumerados (status/type) y agregados.
//
// Uso: node scripts/inventario-fase1.mjs <bd.db> [--json <respaldo.json>] [--etiqueta "texto"]
//   --json      respaldo JSON de la app: cruza conteos con meta.counts y muestra su metadata.
//   --etiqueta  título del reporte (p. ej. "datos reales" / "datos de prueba").
import { readFileSync } from 'node:fs';
import { openReadOnly, listTables, getUserVersion, countAll } from './lib/sqlite-utils.mjs';

const args = process.argv.slice(2);
const flag = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : null;
};
const dbPath = args.find((a, i) => !a.startsWith('--') && !['--json', '--etiqueta'].includes(args[i - 1]));
if (!dbPath) {
    console.error('Uso: node scripts/inventario-fase1.mjs <bd.db> [--json <respaldo.json>] [--etiqueta "texto"]');
    process.exit(2);
}
const jsonPath = flag('--json');
const label = flag('--etiqueta') || dbPath;

const db = openReadOnly(dbPath);
const all = (sql, ...p) => db.prepare(sql).all(...p).map((r) => ({ ...r }));
const one = (sql, ...p) => {
    const r = db.prepare(sql).get(...p);
    return r ? { ...r } : null;
};
const has = (table) => listTables(db).includes(table);
const out = (s = '') => console.log(s);

out(`# Inventario Fase 1 — ${label}`);

// 10. Versiones y metadata
out(`\n## 10. Versiones`);
out(`user_version: ${getUserVersion(db)} · sqlite_version (de quien lee): ${one('SELECT sqlite_version() AS v').v}`);
let meta = null;
if (jsonPath) {
    meta = JSON.parse(readFileSync(jsonPath, 'utf8')).meta;
    out(`respaldo: creado ${meta.createdAt} · app ${meta.appVersion} · SQLite del dispositivo ${meta.sqliteVersion} · user_version ${meta.userVersion}`);
}

// 1. Conteos por tabla y por cuenta
const counts = countAll(db);
out(`\n## 1. Conteos por tabla`);
for (const [t, c] of Object.entries(counts)) {
    const metaNote = meta ? (meta.counts[t] === c ? ' (= meta)' : ` (≠ meta: ${meta.counts[t]})`) : '';
    out(`${t}: ${c}${metaNote}`);
}
const users = all('SELECT id FROM users ORDER BY id');
out(`cuentas en users: ${users.length}`);

// Dueño de cada tabla: SQL que devuelve (owner, n) agrupado
const OWNER_SQL = {
    finance_contacts: 'SELECT user_id AS owner, COUNT(*) n FROM finance_contacts GROUP BY user_id',
    balance_history: 'SELECT user_id AS owner, COUNT(*) n FROM balance_history GROUP BY user_id',
    finance_categories: 'SELECT user_id AS owner, COUNT(*) n FROM finance_categories GROUP BY user_id',
    services: 'SELECT user_id AS owner, COUNT(*) n FROM services GROUP BY user_id',
    entertainment_categories: 'SELECT user_id AS owner, COUNT(*) n FROM entertainment_categories GROUP BY user_id',
    backlog: 'SELECT user_id AS owner, COUNT(*) n FROM backlog GROUP BY user_id',
    work_people: 'SELECT user_id AS owner, COUNT(*) n FROM work_people GROUP BY user_id',
    cards: 'SELECT user_id AS owner, COUNT(*) n FROM cards GROUP BY user_id',
    finance_transactions: 'SELECT c.user_id AS owner, COUNT(*) n FROM finance_transactions t LEFT JOIN finance_contacts c ON c.id = t.contact_id GROUP BY c.user_id',
    entertainment_pauses: 'SELECT ec.user_id AS owner, COUNT(*) n FROM entertainment_pauses p LEFT JOIN entertainment_categories ec ON ec.id = p.category_id GROUP BY ec.user_id',
    entertainment_quotas_history: 'SELECT ec.user_id AS owner, COUNT(*) n FROM entertainment_quotas_history q LEFT JOIN entertainment_categories ec ON ec.id = q.category_id GROUP BY ec.user_id',
    series: 'SELECT ec.user_id AS owner, COUNT(*) n FROM series s LEFT JOIN entertainment_categories ec ON ec.id = s.category_id GROUP BY ec.user_id',
    seasons: 'SELECT ec.user_id AS owner, COUNT(*) n FROM seasons se LEFT JOIN series s ON s.id = se.series_id LEFT JOIN entertainment_categories ec ON ec.id = s.category_id GROUP BY ec.user_id',
    watch_history: 'SELECT ec.user_id AS owner, COUNT(*) n FROM watch_history w LEFT JOIN series s ON s.id = w.series_id LEFT JOIN entertainment_categories ec ON ec.id = s.category_id GROUP BY ec.user_id',
    reading_history: 'SELECT ec.user_id AS owner, COUNT(*) n FROM reading_history r LEFT JOIN series s ON s.id = r.series_id LEFT JOIN entertainment_categories ec ON ec.id = s.category_id GROUP BY ec.user_id',
};
out(`\n## 1b. Filas por cuenta (id de cuenta → filas; "sin dueño" = cadena de padres rota)`);
for (const [t, sql] of Object.entries(OWNER_SQL)) {
    if (!has(t)) continue;
    const rows = all(sql);
    const txt = rows.length ? rows.map((r) => `${r.owner === null ? 'sin dueño' : `cuenta ${r.owner}`}: ${r.n}`).join(' · ') : '0';
    out(`${t}: ${txt}`);
}

// 2. Enumerados
out(`\n## 2. Enumerados presentes (valor: filas)`);
const ENUMS = [
    ['series', 'status'], ['backlog', 'type'], ['backlog', 'status'],
    ['services', 'type'], ['services', 'status'], ['cards', 'type'], ['finance_transactions', 'type'],
];
for (const [t, c] of ENUMS) {
    const rows = all(`SELECT ${c} AS v, COUNT(*) n FROM ${t} GROUP BY ${c} ORDER BY n DESC`);
    out(`${t}.${c}: ${rows.length ? rows.map((r) => `${r.v === null ? 'NULL' : JSON.stringify(r.v)}: ${r.n}`).join(' · ') : '(sin filas)'}`);
}
const fr = one(`SELECT COUNT(DISTINCT franchise) AS d, COUNT(*) AS n, SUM(franchise IS NULL) AS nulls FROM backlog`);
out(`backlog.franchise (texto libre, no se muestran valores): ${fr.d} valores distintos en ${fr.n} filas, ${fr.nulls || 0} NULL`);

// 4. Duplicados en seasons
out(`\n## 4. Duplicados en seasons por (series_id, season_number)`);
const dupSeasons = one(`SELECT COUNT(*) AS grupos, COALESCE(SUM(n), 0) AS filas FROM (SELECT COUNT(*) n FROM seasons GROUP BY series_id, season_number HAVING COUNT(*) > 1)`);
out(`grupos duplicados: ${dupSeasons.grupos} · filas involucradas: ${dupSeasons.filas}`);

// 5. services.total_value
// Regla real de ServiciosScreen: Local = base + adicional; Internacional = base × 1,20
// (15 % IVA + 5 % ISD) con additional_value = 0.
out(`\n## 5. services.total_value (tolerancia 0,005)`);
const naive = one(`SELECT COUNT(*) AS n FROM services WHERE ABS(total_value - (original_value + COALESCE(additional_value, 0))) > 0.005`);
out(`≠ original + adicional (fórmula simple): ${naive.n} fila(s)`);
const RULE = `CASE WHEN type = 'Internacional' THEN original_value * 1.20 ELSE original_value + COALESCE(additional_value, 0) END`;
for (const r of all(`SELECT type, COUNT(*) AS n, SUM(ABS(total_value - (${RULE})) > 0.005) AS malos, MAX(ABS(total_value - (${RULE}))) AS maxdiff FROM services GROUP BY type`)) {
    out(`${r.type}: ${r.n} fila(s) · no cumplen la regla de la app: ${r.malos}${r.malos ? ` (dif. máx ${r.maxdiff.toFixed(2)})` : ''}`);
}
const intlExtra = one(`SELECT COUNT(*) AS n FROM services WHERE type = 'Internacional' AND COALESCE(additional_value, 0) <> 0`);
out(`Internacional con additional_value ≠ 0: ${intlExtra.n}`);

// 6. Saldo vs historial
out(`\n## 6. current_balance vs SUM(balance_history.amount) por cuenta`);
for (const r of all(`SELECT u.id, u.current_balance AS saldo, COALESCE((SELECT SUM(amount) FROM balance_history b WHERE b.user_id = u.id), 0) AS suma FROM users u ORDER BY u.id`)) {
    const diff = (r.saldo || 0) - r.suma;
    out(`cuenta ${r.id}: saldo ${Number(r.saldo || 0).toFixed(2)} · suma historial ${r.suma.toFixed(2)} · diferencia ${diff.toFixed(2)}${Math.abs(diff) > 0.005 ? '  ← requiere movimiento "Ajuste"' : ''}`);
}

// 7. Contactos duplicados
out(`\n## 7. Contactos duplicados por (user_id, name)`);
const dupContacts = one(`SELECT COUNT(*) AS grupos, COALESCE(SUM(n), 0) AS filas FROM (SELECT COUNT(*) n FROM finance_contacts GROUP BY user_id, name HAVING COUNT(*) > 1)`);
out(`grupos: ${dupContacts.grupos} · filas involucradas: ${dupContacts.filas}`);

// 8. FK huérfanas
out(`\n## 8. FK huérfanas`);
const ORPHANS = [
    ['finance_contacts.user_id', 'SELECT COUNT(*) n FROM finance_contacts x WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = x.user_id)'],
    ['balance_history.user_id', 'SELECT COUNT(*) n FROM balance_history x WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = x.user_id)'],
    ['finance_categories.user_id', 'SELECT COUNT(*) n FROM finance_categories x WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = x.user_id)'],
    ['services.user_id', 'SELECT COUNT(*) n FROM services x WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = x.user_id)'],
    ['entertainment_categories.user_id', 'SELECT COUNT(*) n FROM entertainment_categories x WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = x.user_id)'],
    ['backlog.user_id', 'SELECT COUNT(*) n FROM backlog x WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = x.user_id)'],
    ['work_people.user_id', 'SELECT COUNT(*) n FROM work_people x WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = x.user_id)'],
    ['cards.user_id', 'SELECT COUNT(*) n FROM cards x WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = x.user_id)'],
    ['finance_transactions.contact_id', 'SELECT COUNT(*) n FROM finance_transactions x WHERE NOT EXISTS (SELECT 1 FROM finance_contacts c WHERE c.id = x.contact_id)'],
    ['entertainment_pauses.category_id', 'SELECT COUNT(*) n FROM entertainment_pauses x WHERE NOT EXISTS (SELECT 1 FROM entertainment_categories c WHERE c.id = x.category_id)'],
    ['entertainment_quotas_history.category_id', 'SELECT COUNT(*) n FROM entertainment_quotas_history x WHERE NOT EXISTS (SELECT 1 FROM entertainment_categories c WHERE c.id = x.category_id)'],
    ['series.category_id', 'SELECT COUNT(*) n FROM series x WHERE NOT EXISTS (SELECT 1 FROM entertainment_categories c WHERE c.id = x.category_id)'],
    ['seasons.series_id', 'SELECT COUNT(*) n FROM seasons x WHERE NOT EXISTS (SELECT 1 FROM series s WHERE s.id = x.series_id)'],
    ['watch_history.series_id', 'SELECT COUNT(*) n FROM watch_history x WHERE NOT EXISTS (SELECT 1 FROM series s WHERE s.id = x.series_id)'],
    ['reading_history.series_id', 'SELECT COUNT(*) n FROM reading_history x WHERE NOT EXISTS (SELECT 1 FROM series s WHERE s.id = x.series_id)'],
];
const orphanTotal = ORPHANS.reduce((acc, [name, sql]) => {
    const n = one(sql).n;
    if (n > 0) out(`${name}: ${n} huérfanas`);
    return acc + n;
}, 0);
out(`total huérfanas: ${orphanTotal} · PRAGMA foreign_key_check: ${all('PRAGMA foreign_key_check').length} violaciones`);

// 9. Historial: rango y filas sintéticas
out(`\n## 9. Rango de watched_at / read_at (epoch ms) y filas sintéticas`);
const SYNTHETIC_BEFORE = Date.UTC(2001, 0, 1); // el backfill usaba sort_order - 10000000 + n*1000 → valores cercanos a 0
for (const [t, c] of [['watch_history', 'watched_at'], ['reading_history', 'read_at']]) {
    const r = one(`SELECT COUNT(*) n, MIN(${c}) mn, MAX(${c}) mx, SUM(${c} < ?) sint FROM ${t}`, SYNTHETIC_BEFORE);
    const iso = (v) => (v === null || v === undefined ? '—' : new Date(Number(v)).toISOString());
    out(`${t}: ${r.n} filas · mín ${iso(r.mn)} · máx ${iso(r.mx)} · sintéticas (antes de 2001): ${r.sint || 0}`);
}

// 11. Formato de created_at
out(`\n## 11. created_at por tabla (exacto 'YYYY-MM-DD HH:MM:SS' / NULL / otro formato)`);
const SQLITE_TS = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
for (const t of listTables(db)) {
    const cols = all(`PRAGMA table_info("${t}")`).map((c) => c.name);
    if (!cols.includes('created_at')) {
        out(`${t}: (sin columna created_at)`);
        continue;
    }
    let ok = 0; let nul = 0; let other = 0;
    for (const { v } of all(`SELECT created_at AS v FROM "${t}"`)) {
        if (v === null) nul++;
        else if (typeof v === 'string' && SQLITE_TS.test(v)) ok++;
        else other++;
    }
    out(`${t}: formato SQLite ${ok} · NULL ${nul} · otro ${other}`);
}

// 12. Columnas JSON
out(`\n## 12. Columnas JSON (vacío/NULL · inválido · array · objeto · otro)`);
for (const [t, c] of [['work_people', 'cycle'], ['entertainment_categories', 'days_of_week'], ['entertainment_quotas_history', 'quotas']]) {
    const k = { vacio: 0, invalido: 0, array: 0, objeto: 0, otro: 0 };
    for (const { v } of all(`SELECT ${c} AS v FROM ${t}`)) {
        if (v === null || String(v).trim() === '') { k.vacio++; continue; }
        try {
            const parsed = JSON.parse(v);
            if (Array.isArray(parsed)) k.array++;
            else if (parsed !== null && typeof parsed === 'object') k.objeto++;
            else k.otro++;
        } catch {
            k.invalido++;
        }
    }
    out(`${t}.${c}: vacío/NULL ${k.vacio} · inválido ${k.invalido} · array ${k.array} · objeto ${k.objeto} · otro ${k.otro}`);
}

// 13. Fechas de calendario
out(`\n## 13. Fechas de calendario que no cumplen 'YYYY-MM-DD' (NULL aparte)`);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
for (const [t, c, nullMeaning] of [
    ['entertainment_categories', 'start_date', ''],
    ['work_people', 'start_date', ''],
    ['entertainment_pauses', 'pause_start', ''],
    ['entertainment_pauses', 'pause_end', ' (NULL = pausa vigente)'],
    ['entertainment_quotas_history', 'start_date', ''],
    ['entertainment_quotas_history', 'end_date', ' (NULL = cuota vigente)'],
]) {
    let bad = 0; let nul = 0; let n = 0;
    for (const { v } of all(`SELECT ${c} AS v FROM ${t}`)) {
        n++;
        if (v === null) nul++;
        else if (!(typeof v === 'string' && DATE_RE.test(v))) bad++;
    }
    out(`${t}.${c}: ${n} filas · no cumplen ${bad} · NULL ${nul}${nullMeaning}`);
}

db.close();
