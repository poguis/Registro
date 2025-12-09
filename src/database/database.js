import * as SQLite from 'expo-sqlite';

/**
 * Database Manager - MVC Pattern
 * Gestiona la conexión y operaciones de la base de datos SQLite
 */
class Database {
  constructor() {
    this.db = null;
    this.isInitialized = false;
  }

  /**
   * Inicializa la base de datos y ejecuta las migraciones
   */
  async init() {
    if (this.isInitialized) {
      return this.db;
    }

    try {
      // Abre o crea la base de datos
      this.db = await SQLite.openDatabaseAsync('registro.db');
      
      // Ejecuta las migraciones
      await this.runMigrations();
      
      this.isInitialized = true;
      console.log('✅ Base de datos inicializada correctamente');
      return this.db;
    } catch (error) {
      console.error('❌ Error al inicializar la base de datos:', error);
      throw error;
    }
  }

  /**
   * Ejecuta las migraciones de la base de datos
   */
  async runMigrations() {
    const migrations = [
      // Tabla de usuarios
      `CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        password TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )`,
      
      // Tabla de finanzas (con user_id)
      `CREATE TABLE IF NOT EXISTS finances (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('income', 'expense')),
        amount REAL NOT NULL,
        category TEXT NOT NULL,
        description TEXT,
        date TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )`,
      
      // Tabla de series/anime (con user_id)
      `CREATE TABLE IF NOT EXISTS media (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('series', 'anime', 'movie')),
        status TEXT NOT NULL CHECK(status IN ('watching', 'completed', 'on_hold', 'dropped', 'plan_to_watch')),
        current_episode INTEGER DEFAULT 0,
        total_episodes INTEGER,
        rating INTEGER CHECK(rating >= 0 AND rating <= 10),
        notes TEXT,
        start_date TEXT,
        finish_date TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )`,
      
      // Tabla de pendientes (con user_id)
      `CREATE TABLE IF NOT EXISTS pendientes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL CHECK(status IN ('pending', 'in_progress', 'completed')),
        priority TEXT CHECK(priority IN ('low', 'medium', 'high')),
        due_date TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )`,
      
      // Índices para mejorar el rendimiento
      `CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)`,
      `CREATE INDEX IF NOT EXISTS idx_finances_user_id ON finances(user_id)`,
      `CREATE INDEX IF NOT EXISTS idx_finances_date ON finances(date)`,
      `CREATE INDEX IF NOT EXISTS idx_media_user_id ON media(user_id)`,
      `CREATE INDEX IF NOT EXISTS idx_media_status ON media(status)`,
      `CREATE INDEX IF NOT EXISTS idx_pendientes_user_id ON pendientes(user_id)`,
      `CREATE INDEX IF NOT EXISTS idx_pendientes_status ON pendientes(status)`,
    ];

    for (const migration of migrations) {
      await this.db.execAsync(migration);
    }
  }

  /**
   * Obtiene la instancia de la base de datos
   */
  getDatabase() {
    if (!this.isInitialized) {
      throw new Error('La base de datos no ha sido inicializada. Llama a init() primero.');
    }
    return this.db;
  }

  /**
   * Cierra la conexión a la base de datos
   */
  async close() {
    if (this.db) {
      await this.db.closeAsync();
      this.isInitialized = false;
      console.log('✅ Base de datos cerrada');
    }
  }
}

// Exporta una instancia singleton
export default new Database();

