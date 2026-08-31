-- ============================================================
-- Registro - Esquema de base de datos (SQLite)
-- Extraído de src/services/db.js (init() + migraciones ALTER TABLE)
-- Generado para análisis, no se ejecuta desde la app (la app crea
-- las tablas en runtime dentro de db.js).
-- ============================================================

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------
-- Usuarios y autenticación
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,              -- ⚠️ texto plano, sin hash (ver notas)
  current_balance REAL DEFAULT 0
);

-- ---------------------------------------------------------
-- Finanzas: deudas / préstamos
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS finance_contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS finance_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id INTEGER NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('debt', 'loan')),
  amount REAL NOT NULL,
  description TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (contact_id) REFERENCES finance_contacts(id) ON DELETE CASCADE
);

-- ---------------------------------------------------------
-- Finanzas: balance general (ledger) y categorías
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS balance_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  amount REAL NOT NULL,
  category TEXT NOT NULL,
  description TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS finance_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  icon TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, name),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ---------------------------------------------------------
-- Servicios (suscripciones, etc.)
-- ---------------------------------------------------------
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
);

-- ---------------------------------------------------------
-- Entretenimiento: categorías (series/anime/lectura) y su cuota
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS entertainment_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  type TEXT CHECK(type IN ('video', 'reading')) NOT NULL,
  start_date TEXT,
  days_of_week TEXT,                    -- JSON: ["Monday", "Wednesday"] (formato legado)
  frequency INTEGER DEFAULT 0,
  series_count INTEGER DEFAULT 0,
  description TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS entertainment_pauses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL,
  pause_start TEXT NOT NULL,
  pause_end TEXT,
  FOREIGN KEY (category_id) REFERENCES entertainment_categories(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS entertainment_quotas_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL,
  quotas TEXT NOT NULL,                 -- JSON: { "Monday": 1, ... }
  start_date TEXT NOT NULL,
  end_date TEXT,
  FOREIGN KEY (category_id) REFERENCES entertainment_categories(id) ON DELETE CASCADE
);

-- ---------------------------------------------------------
-- Series/Anime: series, temporadas e historial
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS series (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'Nueva',           -- 'Nueva' | 'Mirando' | 'Terminada' | 'Pausada'
  current_season INTEGER DEFAULT 1,
  current_episode INTEGER DEFAULT 1,
  initial_season INTEGER DEFAULT 1,
  initial_episode INTEGER DEFAULT 1,
  total_seasons INTEGER DEFAULT 0,
  sort_order INTEGER DEFAULT 0,
  cycle_offset INTEGER DEFAULT 0,         -- añadida por migración
  interleave_offset INTEGER DEFAULT 0,    -- añadida por migración
  last_watched_at INTEGER DEFAULT 0,      -- añadida por migración
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (category_id) REFERENCES entertainment_categories (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS seasons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  series_id INTEGER NOT NULL,
  season_number INTEGER NOT NULL,
  episode_count INTEGER DEFAULT 0,
  FOREIGN KEY (series_id) REFERENCES series (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS watch_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  series_id INTEGER NOT NULL,
  season_number INTEGER NOT NULL,
  episode_number INTEGER NOT NULL,
  watched_at INTEGER NOT NULL,            -- epoch ms
  FOREIGN KEY (series_id) REFERENCES series (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS reading_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  series_id INTEGER NOT NULL,
  season_number INTEGER NOT NULL,
  episode_number INTEGER NOT NULL,
  read_at INTEGER NOT NULL,               -- epoch ms
  FOREIGN KEY (series_id) REFERENCES series (id) ON DELETE CASCADE
);

-- ---------------------------------------------------------
-- Backlog (pendientes: películas, series, anime, lectura)
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS backlog (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  type TEXT NOT NULL,                     -- 'movie' | 'series' | 'anime' | 'reading'
  title TEXT NOT NULL,
  status TEXT DEFAULT 'Pendiente',        -- 'Pendiente' | 'Mirando' | 'Terminado'
  year INTEGER,                           -- para películas
  format TEXT,                            -- para series: '24 min', '40 min'
  start_year INTEGER,                     -- para series, anime, lectura
  end_year INTEGER,                       -- para series, anime
  franchise TEXT DEFAULT 'Otros',         -- añadida por migración
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ---------------------------------------------------------
-- Trabajo (personas / turnos)
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS work_people (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  start_date TEXT NOT NULL,
  cycle TEXT NOT NULL,                    -- JSON string
  sort_order INTEGER DEFAULT 0,           -- añadida por migración
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ---------------------------------------------------------
-- Tarjetas
-- ---------------------------------------------------------
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
);
