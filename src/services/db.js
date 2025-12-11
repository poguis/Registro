import * as SQLite from 'expo-sqlite';

const dbName = 'app_registro_v2.db'; // Changed name to force fresh DB for new schema

class DatabaseService {
    constructor() {
        this.db = null;
    }

    async init() {
        try {
            this.db = await SQLite.openDatabaseAsync(dbName);

            // Users
            await this.db.execAsync(`
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT UNIQUE NOT NULL,
          password TEXT NOT NULL,
          current_balance REAL DEFAULT 0
        );
      `);

            // Contacts (Just the people)
            await this.db.execAsync(`
        CREATE TABLE IF NOT EXISTS finance_contacts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          name TEXT NOT NULL,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
      `);

            // Transactions (The actual debts/loans)
            await this.db.execAsync(`
        CREATE TABLE IF NOT EXISTS finance_transactions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          contact_id INTEGER NOT NULL,
          type TEXT NOT NULL CHECK(type IN ('debt', 'loan')),
          amount REAL NOT NULL,
          description TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (contact_id) REFERENCES finance_contacts(id) ON DELETE CASCADE
        );
      `);

            console.log('Database v2 initialized successfully');
            return true;
        } catch (error) {
            console.error('Database initialization failed:', error);
            return false;
        }
    }

    // --- USER & AUTH ---

    async registerUser(username, password) {
        if (!this.db) await this.init();
        try {
            const result = await this.db.runAsync(
                'INSERT INTO users (username, password, current_balance) VALUES (?, ?, 0)',
                [username, password]
            );
            return { success: true, id: result.lastInsertRowId };
        } catch (error) {
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
            return user ? { success: true, user } : { success: false, error: 'Credenciales inválidas' };
        } catch (error) {
            return { success: false, error: 'Error al iniciar sesión' };
        }
    }

    // --- MONEY MANAGEMENT ---

    async updateUserBalance(userId, newBalance) {
        if (!this.db) await this.init();
        try {
            await this.db.runAsync(
                'UPDATE users SET current_balance = ? WHERE id = ?',
                [newBalance, userId]
            );
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async getUserBalance(userId) {
        if (!this.db) await this.init();
        try {
            const result = await this.db.getFirstAsync(
                'SELECT current_balance FROM users WHERE id = ?',
                [userId]
            );
            return { success: true, balance: result?.current_balance || 0 };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    // --- DEBTS & LOANS (Refactored) ---

    async getContacts(userId) {
        if (!this.db) await this.init();
        try {
            const contacts = await this.db.getAllAsync(
                'SELECT * FROM finance_contacts WHERE user_id = ? ORDER BY name ASC',
                [userId]
            );
            return { success: true, contacts };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    // Create transactions. Can create contact implicitly if name provided.
    async addTransaction(userId, contactId, contactName, type, amount, description) {
        if (!this.db) await this.init();
        try {
            let finalContactId = contactId;

            // If no ID, create contact first
            if (!finalContactId) {
                // Double check existence by name to avoid duplicates
                const existing = await this.db.getFirstAsync(
                    'SELECT id FROM finance_contacts WHERE user_id = ? AND name = ?',
                    [userId, contactName]
                );

                if (existing) {
                    finalContactId = existing.id;
                } else {
                    const res = await this.db.runAsync(
                        'INSERT INTO finance_contacts (user_id, name) VALUES (?, ?)',
                        [userId, contactName]
                    );
                    finalContactId = res.lastInsertRowId;
                }
            }

            await this.db.runAsync(
                'INSERT INTO finance_transactions (contact_id, type, amount, description) VALUES (?, ?, ?, ?)',
                [finalContactId, type, amount, description]
            );

            return { success: true };
        } catch (error) {
            console.error('Error adding transaction:', error);
            return { success: false, error: error.message };
        }
    }

    async deleteTransaction(transactionId) {
        if (!this.db) await this.init();
        try {
            await this.db.runAsync('DELETE FROM finance_transactions WHERE id = ?', [transactionId]);
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    // Get full rich data: Contacts with their transactions and calculated totals
    async getFinanceData(userId, type) {
        if (!this.db) await this.init();
        try {
            // 1. Get contacts that have transactions
            // We left join to ensure we get transactions
            const contacts = await this.db.getAllAsync(
                `SELECT DISTINCT c.* 
         FROM finance_contacts c
         JOIN finance_transactions t ON c.id = t.contact_id
         WHERE c.user_id = ? AND t.type = ?`,
                [userId, type]
            );

            const result = [];

            for (const contact of contacts) {
                // 2. Get transactions for this contact/type
                const transactions = await this.db.getAllAsync(
                    `SELECT * FROM finance_transactions 
           WHERE contact_id = ? AND type = ? 
           ORDER BY created_at DESC`,
                    [contact.id, type]
                );

                // 3. Calculate total
                const total = transactions.reduce((sum, t) => sum + t.amount, 0);

                result.push({
                    ...contact,
                    transactions,
                    total
                });
            }

            return { success: true, data: result };
        } catch (error) {
            console.error(error);
            return { success: false, error: error.message };
        }
    }
}

export default new DatabaseService();
