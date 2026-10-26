import { newId, UUID_V4_RE } from '../ids';
import { nowIso } from '../clock';
import { maybeFail } from '../../services/devFlags';

// Migración 2 (Fase 1): UUID + user_id desnormalizado + columnas de sync
// (created_at, updated_at, deleted_at) + outbox, reconstruyendo las 16 tablas in-place.
//
// Estrategia (SQLite no permite cambiar la PK): renombrar las tablas viejas a
// legacy_<tabla> (se conservan hasta la Fase 6), crear las nuevas con su nombre final,
// generar un UUID por fila (_id_map), copiar uniendo _id_map y verificar todo.
// Corre dentro de UNA withExclusiveTransactionAsync (el runner); cualquier error ⇒
// rollback completo y user_version sigue en 1. La copia física previa la hace el runner.
//
// RENAME: con SQLite ≥ 3.26 (dispositivo: 3.50.3) y legacy_alter_table OFF, renombrar
// una tabla reescribe las FK de las demás que la referencian. Renombrando las 16 viejas,
// el conjunto legacy_* queda consistente entre sí; las nuevas se crean después con FK
// a los nombres finales.
// PRAGMA foreign_keys no tiene efecto dentro de la transacción (y la transacción
// exclusiva usa otra conexión): la integridad se verifica explícitamente al final.

type Db = {
    execAsync(sql: string): Promise<void>;
    runAsync(sql: string, params?: any[]): Promise<{ changes: number; lastInsertRowId: number }>;
    getAllAsync<T = any>(sql: string, params?: any[]): Promise<T[]>;
    getFirstAsync<T = any>(sql: string, params?: any[]): Promise<T | null>;
};
export type MigrationContext = {
    listDbFiles?: () => Promise<{ name: string; size: number }[]> | { name: string; size: number }[];
};

// Orden de padres a hijos.
export const MIGRATED_TABLES = [
    'users', 'finance_contacts', 'finance_transactions', 'balance_history', 'finance_categories',
    'services', 'entertainment_categories', 'entertainment_pauses', 'entertainment_quotas_history',
    'series', 'seasons', 'watch_history', 'reading_history', 'backlog', 'work_people', 'cards',
] as const;

const SYNC = `
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    deleted_at TEXT`;
const FK = (table: string) => `REFERENCES ${table}(id) DEFERRABLE INITIALLY DEFERRED`;

// Esquema destino. user_id sin FK a users (en la Fase 3 se reescribe a auth.uid()).
const NEW_TABLES: Record<string, string> = {
    users: `CREATE TABLE users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL, -- se elimina en la Fase 3 (login con Google)
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    )`, // tabla local: no se sincroniza ni pasa por la outbox; sin current_balance (saldo = SUM(balance_history))
    finance_contacts: `CREATE TABLE finance_contacts (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
        name TEXT NOT NULL,${SYNC}
    )`,
    finance_transactions: `CREATE TABLE finance_transactions (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
        contact_id TEXT NOT NULL ${FK('finance_contacts')},
        type TEXT NOT NULL CHECK(type IN ('debt', 'loan')),
        amount REAL NOT NULL,
        description TEXT,${SYNC}
    )`,
    balance_history: `CREATE TABLE balance_history (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
        amount REAL NOT NULL,
        category TEXT NOT NULL,
        description TEXT,${SYNC}
    )`,
    finance_categories: `CREATE TABLE finance_categories (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        icon TEXT,${SYNC},
        UNIQUE(user_id, name)
    )`,
    services: `CREATE TABLE services (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('Local', 'Internacional')),
        status TEXT NOT NULL CHECK(status IN ('Activo', 'Inactivo')),
        original_value REAL NOT NULL,
        additional_value REAL DEFAULT 0,
        total_value REAL NOT NULL, -- valor histórico (Internacional = base × 1,20; Local = base + adicional)${SYNC}
    )`,
    entertainment_categories: `CREATE TABLE entertainment_categories (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        type TEXT CHECK(type IN ('video', 'reading')) NOT NULL,
        start_date TEXT, -- YYYY-MM-DD local
        days_of_week TEXT, -- JSON objeto {"Monday":1,...} (se acepta array legado al leer)
        frequency INTEGER DEFAULT 0,
        series_count INTEGER DEFAULT 0, -- límite de series activas (0 = sin límite)
        description TEXT,${SYNC}
    )`,
    entertainment_pauses: `CREATE TABLE entertainment_pauses (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
        category_id TEXT NOT NULL ${FK('entertainment_categories')},
        pause_start TEXT NOT NULL,
        pause_end TEXT, -- NULL = pausa vigente${SYNC}
    )`,
    entertainment_quotas_history: `CREATE TABLE entertainment_quotas_history (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
        category_id TEXT NOT NULL ${FK('entertainment_categories')},
        quotas TEXT NOT NULL, -- JSON objeto
        start_date TEXT NOT NULL,
        end_date TEXT, -- NULL = cuota vigente${SYNC}
    )`,
    series: `CREATE TABLE series (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
        category_id TEXT NOT NULL ${FK('entertainment_categories')},
        name TEXT NOT NULL,
        description TEXT,
        status TEXT DEFAULT 'Nueva', -- 'Nueva', 'Mirando', 'Pausado', 'En espera', 'Terminado'
        current_season INTEGER DEFAULT 1,
        current_episode INTEGER DEFAULT 1,
        initial_season INTEGER DEFAULT 1,
        initial_episode INTEGER DEFAULT 1,
        total_seasons INTEGER DEFAULT 0,
        sort_order INTEGER DEFAULT 0,
        cycle_offset INTEGER DEFAULT 0, -- valor absoluto
        interleave_offset INTEGER DEFAULT 0,
        last_watched_at INTEGER DEFAULT 0, -- epoch ms${SYNC}
    )`,
    seasons: `CREATE TABLE seasons (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
        series_id TEXT NOT NULL ${FK('series')},
        season_number INTEGER NOT NULL,
        episode_count INTEGER DEFAULT 0,${SYNC},
        UNIQUE(series_id, season_number)
    )`,
    watch_history: `CREATE TABLE watch_history (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
        series_id TEXT NOT NULL ${FK('series')},
        season_number INTEGER NOT NULL,
        episode_number INTEGER NOT NULL,
        watched_at INTEGER NOT NULL, -- epoch ms${SYNC}
    )`,
    reading_history: `CREATE TABLE reading_history (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
        series_id TEXT NOT NULL ${FK('series')},
        season_number INTEGER NOT NULL,
        episode_number INTEGER NOT NULL,
        read_at INTEGER NOT NULL, -- epoch ms${SYNC}
    )`,
    backlog: `CREATE TABLE backlog (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
        type TEXT NOT NULL, -- 'movie', 'series', 'anime', 'reading' (validado en el repositorio)
        title TEXT NOT NULL,
        status TEXT DEFAULT 'Pendiente', -- 'Pendiente', 'Mirando', 'Terminado' (validado en el repositorio)
        year INTEGER,
        format TEXT,
        start_year INTEGER,
        end_year INTEGER,
        franchise TEXT DEFAULT 'Otros',${SYNC}
    )`,
    work_people: `CREATE TABLE work_people (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        start_date TEXT NOT NULL,
        cycle TEXT NOT NULL, -- JSON array [{type, days}]
        sort_order INTEGER DEFAULT 0,${SYNC}
    )`,
    cards: `CREATE TABLE cards (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('debit', 'credit')),
        cutoff_date INTEGER,
        payment_due_date INTEGER,
        limit_amount REAL,${SYNC}
    )`,
};

const AUX_TABLES = [
    `CREATE TABLE outbox (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        table_name TEXT NOT NULL,
        row_id TEXT NOT NULL,
        op TEXT NOT NULL CHECK(op IN ('upsert', 'delete')),
        created_at TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        next_attempt_at TEXT
    )`,
    `CREATE INDEX idx_outbox_next ON outbox(next_attempt_at, id)`,
    `CREATE TABLE _id_map (
        table_name TEXT NOT NULL,
        old_id INTEGER NOT NULL,
        new_id TEXT NOT NULL UNIQUE,
        PRIMARY KEY (table_name, old_id)
    )`,
    `CREATE TABLE _migration_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        version INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        kind TEXT NOT NULL,
        payload TEXT NOT NULL
    )`,
];

// Índices: FK, user_id, updated_at y (user_id, deleted_at).
const INDEXES: string[] = [];
const FK_COLUMNS: Record<string, string[]> = {
    finance_transactions: ['contact_id'],
    entertainment_pauses: ['category_id'],
    entertainment_quotas_history: ['category_id'],
    series: ['category_id'],
    seasons: ['series_id'],
    watch_history: ['series_id'],
    reading_history: ['series_id'],
};
for (const t of MIGRATED_TABLES) {
    if (t === 'users') continue;
    INDEXES.push(`CREATE INDEX idx_${t}_user ON ${t}(user_id, deleted_at)`);
    INDEXES.push(`CREATE INDEX idx_${t}_updated ON ${t}(updated_at)`);
    for (const c of FK_COLUMNS[t] || []) INDEXES.push(`CREATE INDEX idx_${t}_${c} ON ${t}(${c})`);
}

// created_at viejo 'YYYY-MM-DD HH:MM:SS' (UTC) → ISO; si faltara, la hora de la migración.
const iso = (expr: string) => `COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ', ${expr}), :now)`;
const fromEpochMs = (expr: string) => `COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ', ${expr} / 1000.0, 'unixepoch'), :now)`;
const map = (alias: string, table: string, oldIdExpr: string) =>
    `JOIN _id_map ${alias} ON ${alias}.table_name = '${table}' AND ${alias}.old_id = ${oldIdExpr}`;

// Copias: SELECT desde legacy_* uniendo _id_map. :now se sustituye por la hora de la migración.
const COPIES: Record<string, string> = {
    users: `INSERT INTO users (id, username, password, created_at, updated_at)
        SELECT m.new_id, o.username, o.password, :now, :now
        FROM legacy_users o ${map('m', 'users', 'o.id')}`,
    finance_contacts: `INSERT INTO finance_contacts (id, user_id, name, created_at, updated_at, deleted_at)
        SELECT m.new_id, mu.new_id, o.name, ${iso('o.created_at')}, ${iso('o.created_at')}, NULL
        FROM legacy_finance_contacts o ${map('m', 'finance_contacts', 'o.id')} ${map('mu', 'users', 'o.user_id')}`,
    finance_transactions: `INSERT INTO finance_transactions (id, user_id, contact_id, type, amount, description, created_at, updated_at, deleted_at)
        SELECT m.new_id, mu.new_id, mc.new_id, o.type, o.amount, o.description, ${iso('o.created_at')}, ${iso('o.created_at')}, NULL
        FROM legacy_finance_transactions o ${map('m', 'finance_transactions', 'o.id')}
        JOIN legacy_finance_contacts c ON c.id = o.contact_id
        ${map('mc', 'finance_contacts', 'o.contact_id')} ${map('mu', 'users', 'c.user_id')}`,
    balance_history: `INSERT INTO balance_history (id, user_id, amount, category, description, created_at, updated_at, deleted_at)
        SELECT m.new_id, mu.new_id, o.amount, o.category, o.description, ${iso('o.created_at')}, ${iso('o.created_at')}, NULL
        FROM legacy_balance_history o ${map('m', 'balance_history', 'o.id')} ${map('mu', 'users', 'o.user_id')}`,
    finance_categories: `INSERT INTO finance_categories (id, user_id, name, icon, created_at, updated_at, deleted_at)
        SELECT m.new_id, mu.new_id, o.name, o.icon, ${iso('o.created_at')}, ${iso('o.created_at')}, NULL
        FROM legacy_finance_categories o ${map('m', 'finance_categories', 'o.id')} ${map('mu', 'users', 'o.user_id')}`,
    services: `INSERT INTO services (id, user_id, name, type, status, original_value, additional_value, total_value, created_at, updated_at, deleted_at)
        SELECT m.new_id, mu.new_id, o.name, o.type, o.status, o.original_value, o.additional_value, o.total_value, ${iso('o.created_at')}, ${iso('o.created_at')}, NULL
        FROM legacy_services o ${map('m', 'services', 'o.id')} ${map('mu', 'users', 'o.user_id')}`,
    entertainment_categories: `INSERT INTO entertainment_categories (id, user_id, name, type, start_date, days_of_week, frequency, series_count, description, created_at, updated_at, deleted_at)
        SELECT m.new_id, mu.new_id, o.name, o.type, o.start_date, o.days_of_week, o.frequency, o.series_count, o.description, ${iso('o.created_at')}, ${iso('o.created_at')}, NULL
        FROM legacy_entertainment_categories o ${map('m', 'entertainment_categories', 'o.id')} ${map('mu', 'users', 'o.user_id')}`,
    entertainment_pauses: `INSERT INTO entertainment_pauses (id, user_id, category_id, pause_start, pause_end, created_at, updated_at, deleted_at)
        SELECT m.new_id, mu.new_id, mc.new_id, o.pause_start, o.pause_end, :now, :now, NULL
        FROM legacy_entertainment_pauses o ${map('m', 'entertainment_pauses', 'o.id')}
        JOIN legacy_entertainment_categories c ON c.id = o.category_id
        ${map('mc', 'entertainment_categories', 'o.category_id')} ${map('mu', 'users', 'c.user_id')}`,
    entertainment_quotas_history: `INSERT INTO entertainment_quotas_history (id, user_id, category_id, quotas, start_date, end_date, created_at, updated_at, deleted_at)
        SELECT m.new_id, mu.new_id, mc.new_id, o.quotas, o.start_date, o.end_date, :now, :now, NULL
        FROM legacy_entertainment_quotas_history o ${map('m', 'entertainment_quotas_history', 'o.id')}
        JOIN legacy_entertainment_categories c ON c.id = o.category_id
        ${map('mc', 'entertainment_categories', 'o.category_id')} ${map('mu', 'users', 'c.user_id')}`,
    series: `INSERT INTO series (id, user_id, category_id, name, description, status, current_season, current_episode, initial_season, initial_episode, total_seasons, sort_order, cycle_offset, interleave_offset, last_watched_at, created_at, updated_at, deleted_at)
        SELECT m.new_id, mu.new_id, mc.new_id, o.name, o.description, o.status, o.current_season, o.current_episode, o.initial_season, o.initial_episode, o.total_seasons, o.sort_order, o.cycle_offset, o.interleave_offset, o.last_watched_at, ${iso('o.created_at')}, ${iso('o.created_at')}, NULL
        FROM legacy_series o ${map('m', 'series', 'o.id')}
        JOIN legacy_entertainment_categories c ON c.id = o.category_id
        ${map('mc', 'entertainment_categories', 'o.category_id')} ${map('mu', 'users', 'c.user_id')}`,
    seasons: `INSERT INTO seasons (id, user_id, series_id, season_number, episode_count, created_at, updated_at, deleted_at)
        SELECT m.new_id, mu.new_id, ms.new_id, o.season_number, o.episode_count, :now, :now, NULL
        FROM legacy_seasons o ${map('m', 'seasons', 'o.id')}
        JOIN legacy_series s ON s.id = o.series_id
        JOIN legacy_entertainment_categories c ON c.id = s.category_id
        ${map('ms', 'series', 'o.series_id')} ${map('mu', 'users', 'c.user_id')}`,
    watch_history: `INSERT INTO watch_history (id, user_id, series_id, season_number, episode_number, watched_at, created_at, updated_at, deleted_at)
        SELECT m.new_id, mu.new_id, ms.new_id, o.season_number, o.episode_number, o.watched_at, ${fromEpochMs('o.watched_at')}, ${fromEpochMs('o.watched_at')}, NULL
        FROM legacy_watch_history o ${map('m', 'watch_history', 'o.id')}
        JOIN legacy_series s ON s.id = o.series_id
        JOIN legacy_entertainment_categories c ON c.id = s.category_id
        ${map('ms', 'series', 'o.series_id')} ${map('mu', 'users', 'c.user_id')}`,
    reading_history: `INSERT INTO reading_history (id, user_id, series_id, season_number, episode_number, read_at, created_at, updated_at, deleted_at)
        SELECT m.new_id, mu.new_id, ms.new_id, o.season_number, o.episode_number, o.read_at, ${fromEpochMs('o.read_at')}, ${fromEpochMs('o.read_at')}, NULL
        FROM legacy_reading_history o ${map('m', 'reading_history', 'o.id')}
        JOIN legacy_series s ON s.id = o.series_id
        JOIN legacy_entertainment_categories c ON c.id = s.category_id
        ${map('ms', 'series', 'o.series_id')} ${map('mu', 'users', 'c.user_id')}`,
    backlog: `INSERT INTO backlog (id, user_id, type, title, status, year, format, start_year, end_year, franchise, created_at, updated_at, deleted_at)
        SELECT m.new_id, mu.new_id, o.type, o.title, o.status, o.year, o.format, o.start_year, o.end_year, o.franchise, ${iso('o.created_at')}, ${iso('o.created_at')}, NULL
        FROM legacy_backlog o ${map('m', 'backlog', 'o.id')} ${map('mu', 'users', 'o.user_id')}`,
    work_people: `INSERT INTO work_people (id, user_id, name, start_date, cycle, sort_order, created_at, updated_at, deleted_at)
        SELECT m.new_id, mu.new_id, o.name, o.start_date, o.cycle, o.sort_order, ${iso('o.created_at')}, ${iso('o.created_at')}, NULL
        FROM legacy_work_people o ${map('m', 'work_people', 'o.id')} ${map('mu', 'users', 'o.user_id')}`,
    cards: `INSERT INTO cards (id, user_id, name, type, cutoff_date, payment_due_date, limit_amount, created_at, updated_at, deleted_at)
        SELECT m.new_id, mu.new_id, o.name, o.type, o.cutoff_date, o.payment_due_date, o.limit_amount, ${iso('o.created_at')}, ${iso('o.created_at')}, NULL
        FROM legacy_cards o ${map('m', 'cards', 'o.id')} ${map('mu', 'users', 'o.user_id')}`,
};

// FK de las tablas viejas (para el chequeo previo de huérfanas).
const LEGACY_FKS: [string, string, string][] = [
    ['finance_contacts', 'user_id', 'users'], ['balance_history', 'user_id', 'users'],
    ['finance_categories', 'user_id', 'users'], ['services', 'user_id', 'users'],
    ['entertainment_categories', 'user_id', 'users'], ['backlog', 'user_id', 'users'],
    ['work_people', 'user_id', 'users'], ['cards', 'user_id', 'users'],
    ['finance_transactions', 'contact_id', 'finance_contacts'],
    ['entertainment_pauses', 'category_id', 'entertainment_categories'],
    ['entertainment_quotas_history', 'category_id', 'entertainment_categories'],
    ['series', 'category_id', 'entertainment_categories'],
    ['seasons', 'series_id', 'series'], ['watch_history', 'series_id', 'series'],
    ['reading_history', 'series_id', 'series'],
];
// FK de las tablas nuevas: (tabla, columna, padre). user_id se verifica aparte (por JOIN).
const NEW_FKS: [string, string, string][] = LEGACY_FKS.filter(([, c]) => c !== 'user_id');

const BALANCE_TOLERANCE = 0.005;

const fail = (msg: string): never => {
    throw new Error(msg);
};

export async function migration2(txn: Db, log: string[], ctx: MigrationContext = {}): Promise<void> {
    const startedAt = nowIso();
    const t0 = Date.now();
    const bind = (sql: string) => sql.replace(/:now/g, `'${startedAt}'`);
    const count = async (table: string, where = '') =>
        (await txn.getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table} ${where}`))!.n;

    // 1. Chequeos previos sobre las tablas originales
    for (const [t, c, p] of LEGACY_FKS) {
        const n = await count(t, `x WHERE NOT EXISTS (SELECT 1 FROM ${p} y WHERE y.id = x.${c})`);
        if (n > 0) fail(`Datos inconsistentes antes de migrar: ${n} fila(s) de ${t}.${c} sin ${p}. No se modificó nada.`);
    }
    const fkBefore = await txn.getAllAsync('PRAGMA foreign_key_check');
    if (fkBefore.length > 0) fail(`PRAGMA foreign_key_check devolvió ${fkBefore.length} violación(es) antes de migrar. No se modificó nada.`);

    const before: Record<string, number> = {};
    for (const t of MIGRATED_TABLES) before[t] = await count(t);
    const legacyBalances = await txn.getAllAsync<{ id: number; current_balance: number | null; suma: number }>(
        `SELECT u.id, u.current_balance, COALESCE((SELECT SUM(amount) FROM balance_history b WHERE b.user_id = u.id), 0) AS suma FROM users u`
    );
    // Duplicados de seasons por (series_id, season_number): se conserva el id mayor.
    const seasonDups = await txn.getAllAsync<{ series_id: number; season_number: number; keep_id: number; n: number }>(
        `SELECT series_id, season_number, MAX(id) AS keep_id, COUNT(*) AS n FROM seasons GROUP BY series_id, season_number HAVING COUNT(*) > 1`
    );
    log.push(`chequeos previos OK (${Object.values(before).reduce((a, b) => a + b, 0)} filas, ${seasonDups.length} duplicado(s) de temporadas)`);

    // 2. Renombrar las 16 tablas a legacy_*
    for (const t of MIGRATED_TABLES) await txn.execAsync(`ALTER TABLE ${t} RENAME TO legacy_${t}`);
    log.push('tablas renombradas a legacy_*');

    // 3. Crear las tablas nuevas + auxiliares + índices
    for (const t of MIGRATED_TABLES) await txn.execAsync(NEW_TABLES[t]);
    for (const sql of [...AUX_TABLES, ...INDEXES]) await txn.execAsync(sql);
    log.push('tablas nuevas creadas');

    // 4. _id_map: un UUID por fila de cada tabla
    const dupLoserIds = new Set<number>();
    for (const d of seasonDups) {
        const losers = await txn.getAllAsync<{ id: number }>(
            'SELECT id FROM legacy_seasons WHERE series_id = ? AND season_number = ? AND id <> ?',
            [d.series_id, d.season_number, d.keep_id]
        );
        losers.forEach((l) => dupLoserIds.add(l.id));
    }
    let mapped = 0;
    for (const t of MIGRATED_TABLES) {
        const ids = await txn.getAllAsync<{ id: number }>(`SELECT id FROM legacy_${t} ORDER BY id`);
        for (const { id } of ids) {
            if (t === 'seasons' && dupLoserIds.has(id)) continue; // duplicado descartado (queda en legacy_seasons)
            await txn.runAsync('INSERT INTO _id_map (table_name, old_id, new_id) VALUES (?, ?, ?)', [t, id, newId()]);
            mapped++;
        }
    }
    log.push(`_id_map: ${mapped} UUID generados`);

    // 5. Copiar datos
    for (const t of MIGRATED_TABLES) await txn.execAsync(bind(COPIES[t]));
    log.push('datos copiados');

    // 6. Saldo: si current_balance ≠ SUM(balance_history), un movimiento "Ajuste" por la diferencia
    const adjustments: { user_old_id: number; amount: number }[] = [];
    for (const b of legacyBalances) {
        const diff = (b.current_balance || 0) - b.suma;
        if (Math.abs(diff) <= BALANCE_TOLERANCE) continue;
        const userMap = await txn.getFirstAsync<{ new_id: string }>(
            "SELECT new_id FROM _id_map WHERE table_name = 'users' AND old_id = ?", [b.id]
        );
        const amount = Math.round(diff * 100) / 100;
        await txn.runAsync(
            'INSERT INTO balance_history (id, user_id, amount, category, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [newId(), userMap!.new_id, amount, 'Ajuste', 'Ajuste de saldo por migración (Fase 1)', startedAt, startedAt]
        );
        adjustments.push({ user_old_id: b.id, amount });
    }
    log.push(`ajustes de saldo: ${adjustments.length}`);

    // 7. Verificaciones (cualquier fallo ⇒ rollback)
    const after: Record<string, number> = {};
    for (const t of MIGRATED_TABLES) after[t] = await count(t, t === 'users' ? '' : 'WHERE deleted_at IS NULL');
    for (const t of MIGRATED_TABLES) {
        const legacyN = await count(`legacy_${t}`);
        let expected = legacyN;
        if (t === 'balance_history') expected += adjustments.length;
        if (t === 'seasons') expected -= dupLoserIds.size;
        if (after[t] !== expected) fail(`Verificación: ${t} tiene ${after[t]} filas y se esperaban ${expected}.`);
    }
    const mapCount = await count('_id_map');
    if (mapCount !== mapped) fail(`Verificación: _id_map tiene ${mapCount} filas y se esperaban ${mapped}.`);
    const allNewIds = await txn.getAllAsync<{ new_id: string }>('SELECT new_id FROM _id_map');
    const badIds = allNewIds.filter((r) => !UUID_V4_RE.test(r.new_id)).length;
    if (badIds > 0) fail(`Verificación: ${badIds} id(s) nuevos no son UUID v4.`);
    for (const [t, c, p] of NEW_FKS) {
        const n = await count(t, `x WHERE NOT EXISTS (SELECT 1 FROM ${p} y WHERE y.id = x.${c})`);
        if (n > 0) fail(`Verificación: ${n} fila(s) de ${t}.${c} sin ${p}.`);
    }
    for (const t of MIGRATED_TABLES) {
        if (t === 'users') continue;
        const n = await count(t, 'x WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = x.user_id)');
        if (n > 0) fail(`Verificación: ${n} fila(s) de ${t} con user_id inexistente.`);
    }
    const fkAfter = await txn.getAllAsync('PRAGMA foreign_key_check');
    if (fkAfter.length > 0) fail(`Verificación: PRAGMA foreign_key_check devolvió ${fkAfter.length} violación(es).`);
    // user_id desnormalizado = dueño por la cadena de padres
    const OWNER_CHECKS: [string, string][] = [
        ['finance_transactions', 'JOIN finance_contacts p ON p.id = x.contact_id'],
        ['entertainment_pauses', 'JOIN entertainment_categories p ON p.id = x.category_id'],
        ['entertainment_quotas_history', 'JOIN entertainment_categories p ON p.id = x.category_id'],
        ['series', 'JOIN entertainment_categories p ON p.id = x.category_id'],
        ['seasons', 'JOIN series p ON p.id = x.series_id'],
        ['watch_history', 'JOIN series p ON p.id = x.series_id'],
        ['reading_history', 'JOIN series p ON p.id = x.series_id'],
    ];
    for (const [t, join] of OWNER_CHECKS) {
        const n = (await txn.getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t} x ${join} WHERE x.user_id <> p.user_id`))!.n;
        if (n > 0) fail(`Verificación: ${n} fila(s) de ${t} con user_id distinto al de su padre.`);
    }
    // Saldo calculado después = current_balance antes
    for (const b of legacyBalances) {
        const r = await txn.getFirstAsync<{ s: number }>(
            `SELECT COALESCE(SUM(h.amount), 0) AS s FROM balance_history h
             JOIN _id_map m ON m.table_name = 'users' AND m.new_id = h.user_id
             WHERE m.old_id = ? AND h.deleted_at IS NULL`, [b.id]
        );
        if (Math.abs(r!.s - (b.current_balance || 0)) > BALANCE_TOLERANCE) {
            fail(`Verificación: el saldo calculado de la cuenta ${b.id} (${r!.s}) no coincide con el anterior (${b.current_balance}).`);
        }
    }
    log.push('verificaciones OK');

    // 8. Registro de la migración
    let dbFiles: { name: string; size: number }[] = [];
    try {
        dbFiles = ctx.listDbFiles ? await ctx.listDbFiles() : [];
    } catch (error: any) {
        dbFiles = [{ name: `(no se pudo listar: ${error.message})`, size: -1 }];
    }
    const payload = {
        version: 2,
        startedAt,
        finishedAt: nowIso(),
        durationMs: Date.now() - t0,
        before,
        after,
        balanceAdjustments: adjustments,
        seasonDuplicatesDiscarded: dupLoserIds.size,
        uuidsGenerated: mapped,
        dbFilesInSqliteDir: dbFiles,
    };
    await txn.runAsync(
        'INSERT INTO _migration_log (version, created_at, kind, payload) VALUES (?, ?, ?, ?)',
        [2, nowIso(), 'summary', JSON.stringify(payload)]
    );
    maybeFail('DEV_FAIL_MIGRATION', 'migración 2, antes de fijar user_version');
    log.push('resumen guardado en _migration_log');
}
