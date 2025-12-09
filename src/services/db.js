import * as SQLite from 'expo-sqlite';

const dbName = 'app_registro.db';

class DatabaseService {
    constructor() {
        this.db = null;
    }

    async init() {
        try {
            this.db = await SQLite.openDatabaseAsync(dbName);

            // Create Users table
            await this.db.execAsync(`
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT UNIQUE NOT NULL,
          password TEXT NOT NULL
        );
      `);

            console.log('Database initialized successfully');
            return true;
        } catch (error) {
            console.error('Database initialization failed:', error);
            return false;
        }
    }

    async registerUser(username, password) {
        if (!this.db) await this.init();

        try {
            const result = await this.db.runAsync(
                'INSERT INTO users (username, password) VALUES (?, ?)',
                [username, password]
            );
            return { success: true, id: result.lastInsertRowId };
        } catch (error) {
            console.error('Registration error:', error);
            if (error.message.includes('UNIQUE constraint failed')) {
                return { success: false, error: 'El usuario ya existe' };
            }
            return { success: false, error: 'Error al registrar usuario' };
        }
    }

    async loginUser(username, password) {
        if (!this.db) await this.init();

        try {
            const user = await this.db.getFirstAsync(
                'SELECT * FROM users WHERE username = ? AND password = ?',
                [username, password]
            );

            if (user) {
                return { success: true, user };
            } else {
                return { success: false, error: 'Credenciales inválidas' };
            }
        } catch (error) {
            console.error('Login error:', error);
            return { success: false, error: 'Error al iniciar sesión' };
        }
    }
}

export default new DatabaseService();
