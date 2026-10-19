import { maybeFail } from './devFlags';

// Migraciones de esquema versionadas con PRAGMA user_version.
// Reglas: cada migración corre en una transacción exclusiva y sube user_version
// solo si termina bien. Nunca se renombra el archivo .db ni se borran datos.
// Las migraciones con versión >= 2 exigen antes una copia física de la BD.

// Línea base: las 16 tablas tal como las creaba db.js, en orden de dependencias.
const BASE_TABLES = [
    ['users', `
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT UNIQUE NOT NULL,
          password TEXT NOT NULL,
          current_balance REAL DEFAULT 0
        );`],
    ['finance_contacts', `
        CREATE TABLE IF NOT EXISTS finance_contacts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          name TEXT NOT NULL,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );`],
    ['finance_transactions', `
        CREATE TABLE IF NOT EXISTS finance_transactions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          contact_id INTEGER NOT NULL,
          type TEXT NOT NULL CHECK(type IN ('debt', 'loan')),
          amount REAL NOT NULL,
          description TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (contact_id) REFERENCES finance_contacts(id) ON DELETE CASCADE
        );`],
    ['balance_history', `
        CREATE TABLE IF NOT EXISTS balance_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          amount REAL NOT NULL,
          category TEXT NOT NULL,
          description TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );`],
    ['finance_categories', `
        CREATE TABLE IF NOT EXISTS finance_categories (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          name TEXT NOT NULL,
          icon TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(user_id, name),
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );`],
    ['services', `
        CREATE TABLE IF NOT EXISTS services (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          name TEXT NOT NULL,
          type TEXT NOT NULL CHECK(type IN ('Local', 'Internacional')),
          status TEXT NOT NULL CHECK(status IN ('Activo', 'Inactivo')),
          original_value REAL NOT NULL,
          additional_value REAL DEFAULT 0,
          total_value REAL NOT NULL,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );`],
    ['entertainment_categories', `
        CREATE TABLE IF NOT EXISTS entertainment_categories (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          name TEXT NOT NULL,
          type TEXT CHECK(type IN ('video', 'reading')) NOT NULL,
          start_date TEXT,
          days_of_week TEXT, -- JSON string ["Monday", "Wednesday"]
          frequency INTEGER DEFAULT 0,
          series_count INTEGER DEFAULT 0,
          description TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );`],
    ['entertainment_pauses', `
        CREATE TABLE IF NOT EXISTS entertainment_pauses (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          category_id INTEGER NOT NULL,
          pause_start TEXT NOT NULL,
          pause_end TEXT,
          FOREIGN KEY (category_id) REFERENCES entertainment_categories(id) ON DELETE CASCADE
        );`],
    ['entertainment_quotas_history', `
        CREATE TABLE IF NOT EXISTS entertainment_quotas_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          category_id INTEGER NOT NULL,
          quotas TEXT NOT NULL, -- JSON string
          start_date TEXT NOT NULL,
          end_date TEXT,
          FOREIGN KEY (category_id) REFERENCES entertainment_categories(id) ON DELETE CASCADE
        );`],
    ['series', `
        CREATE TABLE IF NOT EXISTS series (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          category_id INTEGER NOT NULL,
          name TEXT NOT NULL,
          description TEXT,
          status TEXT DEFAULT 'Nueva', -- 'Nueva', 'Mirando', 'Terminada', 'Pausada'
          current_season INTEGER DEFAULT 1,
          current_episode INTEGER DEFAULT 1,
          initial_season INTEGER DEFAULT 1, -- New field
          initial_episode INTEGER DEFAULT 1, -- New field
          total_seasons INTEGER DEFAULT 0,
          sort_order INTEGER DEFAULT 0,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (category_id) REFERENCES entertainment_categories (id) ON DELETE CASCADE
        );`],
    ['seasons', `
        CREATE TABLE IF NOT EXISTS seasons (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          series_id INTEGER NOT NULL,
          season_number INTEGER NOT NULL,
          episode_count INTEGER DEFAULT 0,
          FOREIGN KEY (series_id) REFERENCES series (id) ON DELETE CASCADE
        );`],
    ['watch_history', `
        CREATE TABLE IF NOT EXISTS watch_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            series_id INTEGER NOT NULL,
            season_number INTEGER NOT NULL,
            episode_number INTEGER NOT NULL,
            watched_at INTEGER NOT NULL,
            FOREIGN KEY (series_id) REFERENCES series (id) ON DELETE CASCADE
        );`],
    ['reading_history', `
        CREATE TABLE IF NOT EXISTS reading_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            series_id INTEGER NOT NULL,
            season_number INTEGER NOT NULL,
            episode_number INTEGER NOT NULL,
            read_at INTEGER NOT NULL,
            FOREIGN KEY (series_id) REFERENCES series (id) ON DELETE CASCADE
        );`],
    ['backlog', `
        CREATE TABLE IF NOT EXISTS backlog (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            type TEXT NOT NULL, -- 'movie', 'series', 'anime', 'reading'
            title TEXT NOT NULL,
            status TEXT DEFAULT 'Pendiente', -- 'Pendiente', 'Mirando', 'Terminado'
            year INTEGER, -- For movies
            format TEXT, -- For series: '24 min', '40 min'
            start_year INTEGER, -- For series, anime, reading
            end_year INTEGER, -- For series, anime
            franchise TEXT DEFAULT 'Otros',
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );`],
    ['work_people', `
        CREATE TABLE IF NOT EXISTS work_people (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            start_date TEXT NOT NULL,
            cycle TEXT NOT NULL, -- JSON string
            sort_order INTEGER DEFAULT 0,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );`],
    ['cards', `
        CREATE TABLE IF NOT EXISTS cards (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            type TEXT NOT NULL CHECK(type IN ('debit', 'credit')),
            cutoff_date INTEGER,
            payment_due_date INTEGER,
            limit_amount REAL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );`],
];

// Columnas que el código anterior agregaba con ALTER TABLE en cada arranque.
const BASE_COLUMNS = {
    series: [
        ['cycle_offset', 'INTEGER DEFAULT 0'],
        ['interleave_offset', 'INTEGER DEFAULT 0'],
        ['sort_order', 'INTEGER DEFAULT 0'],
        ['initial_season', 'INTEGER DEFAULT 1'],
        ['initial_episode', 'INTEGER DEFAULT 1'],
        ['last_watched_at', 'INTEGER DEFAULT 0'],
    ],
    work_people: [
        ['sort_order', 'INTEGER DEFAULT 0'],
    ],
    backlog: [
        ['franchise', "TEXT DEFAULT 'Otros'"],
    ],
};

export const TABLE_NAMES = BASE_TABLES.map(([name]) => name);

export const MIGRATIONS = [
    {
        version: 1,
        description: 'Línea base: crea las tablas que falten y agrega las columnas que falten (solo aditiva)',
        up: async (txn, log) => {
            for (const [name, sql] of BASE_TABLES) {
                await txn.execAsync(sql);
                log.push(`tabla ${name}: OK`);
            }
            for (const [table, columns] of Object.entries(BASE_COLUMNS)) {
                const info = await txn.getAllAsync(`PRAGMA table_info(${table})`);
                const existing = new Set(info.map(c => c.name));
                for (const [column, definition] of columns) {
                    if (!existing.has(column)) {
                        await txn.execAsync(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`);
                        log.push(`columna ${table}.${column}: agregada`);
                    }
                }
            }
            maybeFail('DEV_FAIL_MIGRATION', 'migración 1, antes de fijar user_version');
        },
    },
];

export const LATEST_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

// Ejecuta las migraciones pendientes sobre la conexión `db`.
// `createPhysicalCopy(label)` se usa como respaldo obligatorio antes de las migraciones >= 2.
// Lanza un error si algo falla; en ese caso user_version queda como estaba.
export async function runMigrations(db, { createPhysicalCopy }) {
    const row = await db.getFirstAsync('PRAGMA user_version');
    const current = row ? row.user_version : 0;

    if (current > LATEST_VERSION) {
        throw new Error(`La base de datos es de una versión más nueva de la app (user_version ${current}, esta app conoce hasta ${LATEST_VERSION}).`);
    }

    const pending = MIGRATIONS.filter(m => m.version > current);
    if (pending.length === 0) {
        console.log(`[migraciones] Sin migraciones pendientes (user_version = ${current})`);
        return { from: current, to: current, applied: [] };
    }

    const applied = [];
    for (const migration of pending) {
        if (migration.version >= 2) {
            try {
                await createPhysicalCopy(`pre-migracion-v${migration.version}`);
            } catch (error) {
                throw new Error(`No se pudo crear el respaldo previo a la migración ${migration.version}; no se modificó nada. (${error.message})`);
            }
        }

        const log = [];
        try {
            await db.withExclusiveTransactionAsync(async (txn) => {
                await migration.up(txn, log);
                await txn.execAsync(`PRAGMA user_version = ${migration.version}`);
            });
        } catch (error) {
            console.error(`[migraciones] Falló la migración ${migration.version} (${migration.description}). Pasos completados antes del error:`, log, error);
            throw new Error(`Falló la migración ${migration.version}: ${error.message}`);
        }
        console.log(`[migraciones] Migración ${migration.version} aplicada:`, log);
        applied.push(migration.version);
    }

    return { from: current, to: pending[pending.length - 1].version, applied };
}
