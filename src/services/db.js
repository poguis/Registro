import * as SQLite from 'expo-sqlite';

const dbName = 'app_registro_v3.db'; // Changed to v3 for schema update

class DatabaseService {
    constructor() {
        this.db = null;
    }

    async init() {
        if (this.db) return true;
        try {
            console.log('Starting SQLite initialization...');
            this.db = await SQLite.openDatabaseAsync(dbName);
            console.log('DB File opened:', dbName);

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

            // Create WATCH HISTORY table
            await this.db.execAsync(`
                CREATE TABLE IF NOT EXISTS watch_history (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    series_id INTEGER NOT NULL,
                    season_number INTEGER NOT NULL,
                    episode_number INTEGER NOT NULL,
                    watched_at INTEGER NOT NULL,
                    FOREIGN KEY (series_id) REFERENCES series (id) ON DELETE CASCADE
                );
            `);

            // Create READING HISTORY table
            await this.db.execAsync(`
                CREATE TABLE IF NOT EXISTS reading_history (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    series_id INTEGER NOT NULL,
                    season_number INTEGER NOT NULL,
                    episode_number INTEGER NOT NULL,
                    read_at INTEGER NOT NULL,
                    FOREIGN KEY (series_id) REFERENCES series (id) ON DELETE CASCADE
                );
            `);

            // Create BACKLOG table
            await this.db.execAsync(`
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
                    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
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

            // Check and backfill history if needed
            try {
                await this.checkAndBackfillHistory();
            } catch (e) {
                console.error('Non-critical: Error backfilling history:', e);
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
                    // Ajuste para el último capítulo solo si está CERRADA (Terminado/En espera).
                    // Si está MIRANDO, diff ya es correcto porque el puntero está en el siguiente.
                    if (s.status === 'Terminado' || s.status === 'En espera') diff += 1;

                    // INCLUIMOS cycle_offset:
                    // - Para series NUEVAS, es 0 (no afecta).
                    // - Para series REINICIADAS, contiene el historial de lo visto anteriormente.
                    const val = (diff > 0 ? diff : 0) + (s.cycle_offset || 0);
                    totalWatched += val;
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

            // --- ACOPLAMIENTO DE CICLOS ---
            // Buscamos el máximo de (capítulos_vistos + cycle_offset) en la categoría
            // para que la serie nueva se una al ritmo actual.
            const seriesInCategory = await this.db.getAllAsync(
                'SELECT id, current_season, current_episode, initial_season, initial_episode, cycle_offset FROM series WHERE category_id = ?',
                [category_id]
            );

            let maxCycle = 0;
            for (const s of seriesInCategory) {
                const seasons = await this.db.getAllAsync('SELECT * FROM seasons WHERE series_id = ?', [s.id]);
                const getAbs = (sn, en) => {
                    let c = 0;
                    for (let i = 1; i < sn; i++) {
                        const sea = seasons.find(se => se.season_number === i);
                        c += sea ? sea.episode_count : 0;
                    }
                    return c + (en - 1);
                };
                const watched = getAbs(s.current_season, s.current_episode) - getAbs(s.initial_season || 1, s.initial_episode || 1);
                const totalCycle = (watched > 0 ? watched : 0) + (s.cycle_offset || 0);
                if (totalCycle > maxCycle) maxCycle = totalCycle;
            }

            // 1. Insert Series
            const result = await this.db.runAsync(
                `INSERT INTO series (category_id, name, description, status, current_season, current_episode, initial_season, initial_episode, total_seasons, sort_order, cycle_offset) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [category_id, name, description, status, current_season, current_episode, current_season, current_episode, total_seasons, nextOrder, 0]
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
            let query = `UPDATE series SET name = ?, description = ?, total_seasons = ?`;
            let params = [name, description, total_seasons];

            if (status) {
                query += `, status = ?`;
                params.push(status);
            }
            if (seriesData.current_season !== undefined) {
                query += `, current_season = ?`;
                params.push(seriesData.current_season);
            }
            if (seriesData.current_episode !== undefined) {
                query += `, current_episode = ?`;
                params.push(seriesData.current_episode);
            }

            query += ` WHERE id = ?`;
            params.push(seriesId);

            await this.db.runAsync(query, params);

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

    async updateSeriesProgress(seriesId, currentSeason, currentEpisode, status = null, customSortOrder = null) {
        if (!this.db) await this.init();
        const newOrder = customSortOrder !== null ? customSortOrder : Date.now();
        try {
            if (status) {
                await this.db.runAsync(
                    `UPDATE series SET current_season = ?, current_episode = ?, status = ?, sort_order = ? WHERE id = ?`,
                    [currentSeason, currentEpisode, status, newOrder, seriesId]
                );
            } else {
                await this.db.runAsync(
                    `UPDATE series SET current_season = ?, current_episode = ?, sort_order = ? WHERE id = ?`,
                    [currentSeason, currentEpisode, newOrder, seriesId]
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
    async getFullWatchlist(categoryId = null) {
        if (!this.db) await this.init();
        // Fallback user ID for now if not passed, or use hardcoded 1
        const userId = 1;

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

    // --- WATCH HISTORY METHODS ---

    async checkAndBackfillHistory() {
        try {
            const result = await this.db.getFirstAsync('SELECT count(*) as c FROM watch_history');
            if (result && result.c > 0) return; // Already has data

            console.log('Backfilling watch history...');
            const allSeries = await this.db.getAllAsync('SELECT * FROM series');

            for (const s of allSeries) {
                const seasons = await this.db.getAllAsync('SELECT * FROM seasons WHERE series_id = ? ORDER BY season_number ASC', [s.id]);

                const isTerminado = s.status === 'Terminado' || s.status === 'En espera';
                const targetS = s.current_season;
                const targetE = s.current_episode;

                let currentS = s.initial_season || 1;
                let currentE = s.initial_episode || 1;

                // Para ordenar internamente los antiguos, usaremos sort_order menos un offset
                // Calculamos cuantos episodios hay en total para dar timestamps escalonados
                // Pero para simplificar, usaremos un loop counter.
                const baseTime = s.sort_order || Date.now();

                let loop = 0;
                while (loop < 5000) { // Safety break
                    if (currentS > targetS) break;
                    if (currentS === targetS) {
                        if (isTerminado) {
                            if (currentE > targetE) break;
                        } else {
                            if (currentE >= targetE) break;
                        }
                    }

                    // Insert record
                    // Timestamp: baseTime - (large_number) + loop * 1000
                    // Así los episodios finales quedan cerca del baseTime, y los iniciales más lejos en el pasado.
                    const timestamp = baseTime - 10000000 + (loop * 1000);

                    await this.db.runAsync(
                        'INSERT INTO watch_history (series_id, season_number, episode_number, watched_at) VALUES (?, ?, ?, ?)',
                        [s.id, currentS, currentE, timestamp]
                    );

                    // Next episode
                    const seasonObj = seasons.find(sea => sea.season_number === currentS);
                    const maxEp = seasonObj ? seasonObj.episode_count : 999;
                    currentE++;
                    if (currentE > maxEp) {
                        currentE = 1;
                        currentS++;
                    }
                    loop++;
                }
            }
            console.log('Backfill complete.');
        } catch (e) {
            console.error('Error backfilling history:', e);
        }
    }

    async addHistory(seriesId, season, episode, timestamp = Date.now()) {
        if (!this.db) await this.init();
        try {
            await this.db.runAsync(
                'INSERT INTO watch_history (series_id, season_number, episode_number, watched_at) VALUES (?, ?, ?, ?)',
                [seriesId, season, episode, timestamp]
            );
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async removeHistory(seriesId, season, episode) {
        if (!this.db) await this.init();
        try {
            await this.db.runAsync(
                `DELETE FROM watch_history 
                 WHERE id = (
                    SELECT id FROM watch_history 
                    WHERE series_id = ? AND season_number = ? AND episode_number = ? 
                    ORDER BY watched_at DESC 
                    LIMIT 1
                 )`,
                [seriesId, season, episode]
            );
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async getHistory(categoryId = null) {
        if (!this.db) await this.init();
        const userId = 1; // Fallback

        try {
            let query = `
                SELECT 
                    wh.*, 
                    s.name as s_name, 
                    s.status as s_status,
                    s.sort_order as s_sort_order
                FROM watch_history wh
                JOIN series s ON wh.series_id = s.id
                JOIN entertainment_categories ec ON s.category_id = ec.id
                WHERE ec.user_id = ?
            `;

            const params = [userId];
            if (categoryId) {
                query += " AND ec.id = ?";
                params.push(categoryId);
            }

            query += " ORDER BY wh.watched_at DESC";

            const rows = await this.db.getAllAsync(query, params);
            return { success: true, data: rows };
        } catch (error) {
            console.error('Error getHistory:', error);
            return { success: false, error: error.message };
        }
    }

    // --- READING HISTORY METHODS ---

    async addReadingHistory(seriesId, season, episode, timestamp = Date.now()) {
        if (!this.db) await this.init();
        try {
            await this.db.runAsync(
                'INSERT INTO reading_history (series_id, season_number, episode_number, read_at) VALUES (?, ?, ?, ?)',
                [seriesId, season, episode, timestamp]
            );
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async removeReadingHistory(seriesId, season, episode) {
        if (!this.db) await this.init();
        try {
            await this.db.runAsync(
                `DELETE FROM reading_history 
                 WHERE id = (
                    SELECT id FROM reading_history 
                    WHERE series_id = ? AND season_number = ? AND episode_number = ? 
                    ORDER BY read_at DESC 
                    LIMIT 1
                 )`,
                [seriesId, season, episode]
            );
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async getReadingHistory(categoryId = null) {
        if (!this.db) await this.init();
        const userId = 1;

        try {
            let query = `
                SELECT 
                    rh.*, 
                    s.name as s_name, 
                    s.status as s_status,
                    s.sort_order as s_sort_order
                FROM reading_history rh
                JOIN series s ON rh.series_id = s.id
                JOIN entertainment_categories ec ON s.category_id = ec.id
                WHERE ec.user_id = ?
            `;

            const params = [userId];
            if (categoryId) {
                query += " AND ec.id = ?";
                params.push(categoryId);
            }

            query += " ORDER BY rh.read_at DESC";

            const rows = await this.db.getAllAsync(query, params);
            return { success: true, data: rows };
        } catch (error) {
            console.error('Error getReadingHistory:', error);
            return { success: false, error: error.message };
        }
    }
    // --- BACKLOG METHODS ---

    async addBacklogItem(userId, data) {
        if (!this.db) await this.init();
        try {
            const { type, title, year, format, start_year, end_year } = data;
            await this.db.runAsync(
                `INSERT INTO backlog (user_id, type, title, year, format, start_year, end_year) 
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [userId, type, title, year, format, start_year, end_year]
            );
            return { success: true };
        } catch (error) {
            console.error('Error addBacklogItem:', error);
            return { success: false, error: error.message };
        }
    }

    async getBacklogItems(userId, type, status = null, sortBy = 'title', order = 'ASC') {
        if (!this.db) await this.init();
        try {
            // Determine the column to sort by for "year" based on type
            let sortCol = sortBy;
            if (sortBy === 'year_start') {
                if (type === 'movie') sortCol = 'year';
                else sortCol = 'start_year';
            }

            let query = `SELECT * FROM backlog WHERE user_id = ? AND type = ?`;
            const params = [userId, type];

            if (status) {
                query += ` AND status = ?`;
                params.push(status);
            }

            query += ` ORDER BY ${sortCol} ${order}`;

            const rows = await this.db.getAllAsync(query, params);
            return { success: true, data: rows };
        } catch (error) {
            console.error('Error getBacklogItems:', error);
            return { success: false, error: error.message };
        }
    }

    async updateBacklogStatus(id, status) {
        if (!this.db) await this.init();
        try {
            await this.db.runAsync(
                'UPDATE backlog SET status = ? WHERE id = ?',
                [status, id]
            );
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async deleteBacklogItem(id) {
        if (!this.db) await this.init();
        try {
            await this.db.runAsync('DELETE FROM backlog WHERE id = ?', [id]);
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }
}

export default new DatabaseService();
