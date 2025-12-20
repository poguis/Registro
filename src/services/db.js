import * as SQLite from 'expo-sqlite';

const dbName = 'app_registro_v3.db'; // Changed to v3 for schema update

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

            // Balance History (Full Ledger)
            await this.db.execAsync(`
        CREATE TABLE IF NOT EXISTS balance_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          amount REAL NOT NULL,
          category TEXT NOT NULL,
          description TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
      `);

            // Entertainment Categories (Series/Anime/Reading)
            await this.db.execAsync(`
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
        );
      `);

            // Create SERIES table
            await this.db.execAsync(`
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
        );
      `);

            // Create SEASONS table
            await this.db.execAsync(`
        CREATE TABLE IF NOT EXISTS seasons (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          series_id INTEGER NOT NULL,
          season_number INTEGER NOT NULL,
          episode_count INTEGER DEFAULT 0,
          FOREIGN KEY (series_id) REFERENCES series (id) ON DELETE CASCADE
        );
      `);

            // Migrations for missing columns
            const migrations = [
                `ALTER TABLE series ADD COLUMN cycle_offset INTEGER DEFAULT 0;`,
                `ALTER TABLE series ADD COLUMN sort_order INTEGER DEFAULT 0;`,
                `ALTER TABLE series ADD COLUMN initial_season INTEGER DEFAULT 1;`,
                `ALTER TABLE series ADD COLUMN initial_episode INTEGER DEFAULT 1;`
            ];

            for (const m of migrations) {
                try {
                    await this.db.execAsync(m);
                } catch (e) {
                    // Column already exists or other non-critical error
                }
            }

            console.log('Database v3 initialized successfully');
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

    // --- BALANCE HISTORY Methods ---

    async addBalanceTransaction(userId, amount, category, description) {
        if (!this.db) await this.init();
        try {
            await this.db.runAsync(
                'INSERT INTO balance_history (user_id, amount, category, description) VALUES (?, ?, ?, ?)',
                [userId, amount, category, description]
            );
            return { success: true };
        } catch (error) {
            console.error('Error adding balance history:', error);
            return { success: false, error: error.message };
        }
    }

    async getBalanceHistory(userId) {
        if (!this.db) await this.init();
        try {
            // Get all records ordered by date DESC
            const history = await this.db.getAllAsync(
                `SELECT * FROM balance_history WHERE user_id = ? ORDER BY created_at DESC`,
                [userId]
            );
            return { success: true, history };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async getDistinctCategories(userId) {
        if (!this.db) await this.init();
        try {
            const result = await this.db.getAllAsync(
                `SELECT DISTINCT category FROM balance_history WHERE user_id = ? ORDER BY category ASC`,
                [userId]
            );
            // Returns array of objects: [{category: 'Food'}, {category: 'Salary'}]
            const categories = result.map(r => r.category);
            return { success: true, categories };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    // --- ENTERTAINMENT (Series/Anime/Lectura) ---

    async addEntertainmentCategory(userId, data) {
        if (!this.db) await this.init();
        try {
            const { name, type, startDate, daysOfWeek, frequency, seriesCount, description } = data;
            const daysString = JSON.stringify(daysOfWeek);

            await this.db.runAsync(
                `INSERT INTO entertainment_categories 
                (user_id, name, type, start_date, days_of_week, frequency, series_count, description) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [userId, name, type, startDate, daysString, frequency, seriesCount, description]
            );

            return { success: true };
        } catch (error) {
            console.error('Error adding entertainment category:', error);
            return { success: false, error: error.message };
        }
    }

    async getEntertainmentCategories(userId) {
        if (!this.db) await this.init();
        try {
            // Check if created_at exists, fall back to id for safety if needed, but assuming row 349 is correct.
            const categories = await this.db.getAllAsync(
                `SELECT * FROM entertainment_categories WHERE user_id = ? ORDER BY id DESC`,
                [userId]
            );

            // Calculate aggregated progress for each category
            const enrichedCategories = await Promise.all(categories.map(async (cat) => {
                const seriesList = await this.db.getAllAsync(
                    `SELECT id, current_season, current_episode, initial_season, initial_episode, status, cycle_offset FROM series WHERE category_id = ?`,
                    [cat.id]
                );

                let totalWatched = 0;
                for (const s of seriesList) {
                    const seasons = await this.db.getAllAsync(
                        `SELECT season_number, episode_count FROM seasons WHERE series_id = ?`,
                        [s.id]
                    );

                    const getAbs = (seasonNum, episodeNum) => {
                        let count = 0;
                        for (let i = 1; i < seasonNum; i++) {
                            const sea = seasons.find(se => se.season_number === i);
                            count += sea ? sea.episode_count : 0;
                        }
                        // Restamos 1 porque el puntero indica el SIGUIENTE a ver (T1E1 = 0 vistos)
                        return count + (episodeNum - 1);
                    };

                    const currentAbs = getAbs(s.current_season, s.current_episode);
                    const initS = s.initial_season || 1;
                    const initE = s.initial_episode || 1;
                    const initialAbs = getAbs(initS, initE);

                    let diff = currentAbs - initialAbs;

                    // Si está terminado, el último capítulo debe contar
                    if (s.status === 'Terminado') {
                        diff += 1;
                    }

                    const cycleBonus = s.cycle_offset || 0;
                    totalWatched += (diff + cycleBonus > 0 ? diff + cycleBonus : 0);
                }

                return {
                    ...cat,
                    days_of_week: typeof cat.days_of_week === 'string' ? JSON.parse(cat.days_of_week || '[]') : cat.days_of_week,
                    totalWatched
                };
            }));

            return { success: true, categories: enrichedCategories };
        } catch (error) {
            console.error(error);
            return { success: false, error: error.message };
        }
    }

    async updateEntertainmentCategory(id, data) {
        if (!this.db) await this.init();
        try {
            const { name, type, startDate, daysOfWeek, frequency, seriesCount, description } = data;
            const daysString = JSON.stringify(daysOfWeek);

            await this.db.runAsync(
                `UPDATE entertainment_categories 
                SET name = ?, type = ?, start_date = ?, days_of_week = ?, frequency = ?, series_count = ?, description = ?
                WHERE id = ?`,
                [name, type, startDate, daysString, frequency, seriesCount, description, id]
            );
            return { success: true };
        } catch (error) {
            console.error('Error updating entertainment category:', error);
            return { success: false, error: error.message };
        }
    }

    async deleteEntertainmentCategory(id) {
        if (!this.db) await this.init();
        try {
            await this.db.runAsync('DELETE FROM entertainment_categories WHERE id = ?', [id]);
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    // --- SERIES METHODS ---

    async getSeriesByCategory(categoryId) {
        if (!this.db) await this.init();
        try {
            const series = await this.db.getAllAsync(
                'SELECT * FROM series WHERE category_id = ? ORDER BY sort_order ASC, id DESC',
                [categoryId]
            );
            return { success: true, series };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async getSeasonsBySeries(seriesId) {
        if (!this.db) await this.init();
        try {
            const seasons = await this.db.getAllAsync(
                'SELECT * FROM seasons WHERE series_id = ? ORDER BY season_number ASC',
                [seriesId]
            );
            return { success: true, seasons };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async addSeriesWithSeasons(seriesData, seasonsData) {
        if (!this.db) await this.init();
        try {
            const { category_id, name, description, status, current_season, current_episode, total_seasons } = seriesData;

            // Get max sort_order to put it at the end
            const maxOrderRes = await this.db.getFirstAsync(
                'SELECT MAX(sort_order) as maxOrder FROM series WHERE category_id = ?',
                [category_id]
            );
            const nextOrder = (maxOrderRes?.maxOrder || 0) + 1;

            // 1. Insert Series
            const result = await this.db.runAsync(
                `INSERT INTO series (category_id, name, description, status, current_season, current_episode, initial_season, initial_episode, total_seasons, sort_order, cycle_offset) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
                [category_id, name, description, status, current_season, current_episode, current_season, current_episode, total_seasons, nextOrder]
            );
            const seriesId = result.lastInsertRowId;

            // 2. Insert Seasons
            if (seasonsData && seasonsData.length > 0) {
                for (const season of seasonsData) {
                    await this.db.runAsync(
                        `INSERT INTO seasons (series_id, season_number, episode_count) VALUES (?, ?, ?)`,
                        [seriesId, season.season_number, season.episode_count]
                    );
                }
            }

            return { success: true };
        } catch (error) {
            console.error('Error adding series:', error);
            return { success: false, error: error.message };
        }
    }

    async updateSeriesWithSeasons(seriesId, seriesData, seasonsData) {
        if (!this.db) await this.init();
        try {
            const { name, description, total_seasons, status } = seriesData;

            // 1. Update Series
            if (status) {
                await this.db.runAsync(
                    `UPDATE series SET name = ?, description = ?, total_seasons = ?, status = ? WHERE id = ?`,
                    [name, description, total_seasons, status, seriesId]
                );
            } else {
                await this.db.runAsync(
                    `UPDATE series SET name = ?, description = ?, total_seasons = ? WHERE id = ?`,
                    [name, description, total_seasons, seriesId]
                );
            }

            // 2. Update/Insert Seasons (Simple approach: delete and re-insert)
            await this.db.runAsync(`DELETE FROM seasons WHERE series_id = ?`, [seriesId]);
            if (seasonsData && seasonsData.length > 0) {
                for (const season of seasonsData) {
                    await this.db.runAsync(
                        `INSERT INTO seasons (series_id, season_number, episode_count) VALUES (?, ?, ?)`,
                        [seriesId, season.season_number, season.episode_count]
                    );
                }
            }
            return { success: true };
        } catch (error) {
            console.error('Error updating series:', error);
            return { success: false, error: error.message };
        }
    }

    async updateSeriesSortOrder(seriesId, newOrder) {
        if (!this.db) await this.init();
        try {
            await this.db.runAsync('UPDATE series SET sort_order = ? WHERE id = ?', [newOrder, seriesId]);
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async updateSeriesProgress(seriesId, currentSeason, currentEpisode, status = null) {
        if (!this.db) await this.init();
        try {
            if (status) {
                await this.db.runAsync(
                    `UPDATE series SET current_season = ?, current_episode = ?, status = ? WHERE id = ?`,
                    [currentSeason, currentEpisode, status, seriesId]
                );
            } else {
                await this.db.runAsync(
                    `UPDATE series SET current_season = ?, current_episode = ? WHERE id = ?`,
                    [currentSeason, currentEpisode, seriesId]
                );
            }
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async restartSeries(seriesId, totalEpisodes) {
        if (!this.db) await this.init();
        try {
            await this.db.runAsync(
                `UPDATE series SET cycle_offset = cycle_offset + ?, current_season = 1, current_episode = 1, status = 'Mirando' WHERE id = ?`,
                [totalEpisodes, seriesId]
            );
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async deleteSeries(id) {
        if (!this.db) await this.init();
        try {
            await this.db.runAsync('DELETE FROM series WHERE id = ?', [id]);
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }
    async getFullWatchlist(userId, categoryId = null) {
        if (!this.db) await this.init();
        try {
            let query = `
                SELECT 
                    series.id AS s_id, 
                    series.name AS s_name, 
                    series.status, 
                    series.current_season, 
                    series.current_episode, 
                    series.initial_season, 
                    series.initial_episode, 
                    series.total_seasons, 
                    series.sort_order, 
                    series.cycle_offset,
                    entertainment_categories.id AS c_id, 
                    entertainment_categories.start_date, 
                    entertainment_categories.frequency, 
                    entertainment_categories.days_of_week, 
                    entertainment_categories.type
                FROM series
                INNER JOIN entertainment_categories ON series.category_id = entertainment_categories.id
                WHERE entertainment_categories.user_id = ?
            `;

            const params = [userId];
            if (categoryId) {
                query += " AND entertainment_categories.id = ?";
                params.push(categoryId);
            }

            // Filtro de estados simplificado
            query += " AND (series.status = 'Nueva' OR series.status = 'Mirando' OR series.status = 'En espera' OR series.status = 'Terminado')";
            query += " ORDER BY series.sort_order ASC, series.id DESC";

            const seriesRows = await this.db.getAllAsync(query, params);

            const data = [];
            for (const s of seriesRows) {
                const seasons = await this.db.getAllAsync(
                    'SELECT * FROM seasons WHERE series_id = ? ORDER BY season_number ASC',
                    [s.s_id]
                );

                // Parse days_of_week
                let days = [];
                try {
                    days = typeof s.days_of_week === 'string' ? JSON.parse(s.days_of_week) : s.days_of_week;
                } catch (e) { }

                data.push({ ...s, seasons, days_of_week: days });
            }

            return { success: true, data };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }
}

export default new DatabaseService();
