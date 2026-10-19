import * as SQLite from 'expo-sqlite';
import { DB_NAME } from './dbConfig';
import { runMigrations } from './migrations';
import { createPhysicalCopy } from './backup';
import { maybeFail } from './devFlags';

const getLocalDateString = (date = new Date()) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

class DatabaseService {
    constructor() {
        this.db = null;
        this.lastInitError = null;
        this._initPromise = null;
        // Cola serializada: todas las mutaciones esperan a que termine la anterior.
        this._writeQueue = Promise.resolve();
    }

    // Abre la BD y aplica las migraciones pendientes. Una sola ejecución a la vez:
    // las llamadas concurrentes esperan la misma promesa. this.db solo queda
    // asignado cuando el esquema está completo; si algo falla, devuelve false
    // y deja el error en this.lastInitError (la BD queda como estaba).
    async init() {
        if (this.db) return true;
        if (!this._initPromise) {
            this._initPromise = this._openAndMigrate();
        }
        return this._initPromise;
    }

    async _openAndMigrate() {
        let conn = null;
        try {
            console.log('Starting SQLite initialization...');
            conn = await SQLite.openDatabaseAsync(DB_NAME);
            // foreign_keys no tiene efecto dentro de una transacción: se fija antes.
            await conn.execAsync('PRAGMA foreign_keys = ON;');
            console.log('DB File opened:', DB_NAME);

            await runMigrations(conn, { createPhysicalCopy });

            this.db = conn;
            this.lastInitError = null;
            console.log('Database initialized successfully');
            return true;
        } catch (error) {
            console.error('Database initialization failed:', error);
            this.lastInitError = error;
            this._initPromise = null; // permite reintentar
            if (conn) {
                try {
                    await conn.closeAsync();
                } catch (closeError) {
                    console.error('Error closing database after failed init:', closeError);
                }
            }
            return false;
        }
    }

    // Encola una mutación para que nunca se solapen dos escrituras de la app.
    _enqueue(task) {
        const run = this._writeQueue.then(task);
        this._writeQueue = run.catch(() => { });
        return run;
    }

    // Transacción NO exclusiva de expo-sqlite. Debe llamarse dentro de una
    // mutación encolada (ver QUEUED_MUTATIONS al final del archivo).
    async _tx(task) {
        let result;
        await this.db.withTransactionAsync(async () => {
            result = await task();
        });
        return result;
    }

    // --- USER & AUTH ---

    async registerUser(username, password) {
        if (!this.db) await this.init();
        try {
            // Usuario + categorías por defecto en una sola transacción.
            const userId = await this._tx(async () => {
                const result = await this.db.runAsync(
                    'INSERT INTO users (username, password, current_balance) VALUES (?, ?, 0)',
                    [username, password]
                );
                maybeFail('DEV_FAIL_TX', 'registerUser');
                await this._seedDefaultCategoriesTx(result.lastInsertRowId);
                return result.lastInsertRowId;
            });
            return { success: true, id: userId };
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
            // Contacto (si hace falta) + transacción en una sola transacción.
            await this._tx(() => this._insertDebtTx(userId, contactId, contactName, type, amount, description));
            return { success: true };
        } catch (error) {
            console.error('Error adding transaction:', error);
            return { success: false, error: error.message };
        }
    }

    // Uso interno, dentro de una transacción ya abierta: crea el contacto si no
    // hay ID (o reutiliza uno con el mismo nombre) e inserta la deuda/préstamo.
    async _insertDebtTx(userId, contactId, contactName, type, amount, description) {
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
                maybeFail('DEV_FAIL_TX', 'addTransaction: tras crear el contacto');
            }
        }

        await this.db.runAsync(
            'INSERT INTO finance_transactions (contact_id, type, amount, description) VALUES (?, ?, ?, ?)',
            [finalContactId, type, amount, description]
        );
        return finalContactId;
    }

    // Movimiento de dinero completo en una sola transacción (antes eran 3 llamadas
    // sueltas desde DineroScreen): deuda/préstamo vinculado (opcional),
    // registro en balance_history y saldo nuevo.
    // `linked` = null o { contactId, contactName, type, amount, description }.
    // El saldo se lee de la BD y se escribe como valor absoluto (actual + amount).
    async registerMoneyMovement(userId, { amount, category, description, linked = null }) {
        if (!this.db) await this.init();
        try {
            const newBalance = await this._tx(async () => {
                if (linked) {
                    await this._insertDebtTx(userId, linked.contactId, linked.contactName, linked.type, linked.amount, linked.description);
                }
                await this.db.runAsync(
                    'INSERT INTO balance_history (user_id, amount, category, description) VALUES (?, ?, ?, ?)',
                    [userId, amount, category, description]
                );
                maybeFail('DEV_FAIL_TX', 'registerMoneyMovement: tras balance_history');
                const row = await this.db.getFirstAsync('SELECT current_balance FROM users WHERE id = ?', [userId]);
                if (!row) throw new Error('Usuario no encontrado');
                const balance = (row.current_balance || 0) + amount;
                await this.db.runAsync('UPDATE users SET current_balance = ? WHERE id = ?', [balance, userId]);
                return balance;
            });
            return { success: true, newBalance };
        } catch (error) {
            console.error('Error registering money movement:', error);
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

    async getBalanceHistory(userId, startDate = null, endDate = null) {
        if (!this.db) await this.init();
        try {
            let query = `SELECT * FROM balance_history WHERE user_id = ?`;
            const params = [userId];

            if (startDate) {
                query += ` AND created_at >= ?`;
                params.push(startDate);
            }
            if (endDate) {
                query += ` AND created_at <= ?`;
                params.push(endDate);
            }

            query += ` ORDER BY created_at DESC`;

            const history = await this.db.getAllAsync(query, params);
            return { success: true, history };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async getStatisticsData(userId, startDate = null, endDate = null) {
        if (!this.db) await this.init();
        try {
            let query = `
                SELECT 
                    category,
                    SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) as income,
                    SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END) as expense,
                    COUNT(*) as count
                FROM balance_history 
                WHERE user_id = ?
            `;
            const params = [userId];

            if (startDate) {
                query += ` AND created_at >= ?`;
                params.push(startDate);
            }
            if (endDate) {
                query += ` AND created_at <= ?`;
                params.push(endDate);
            }

            query += ` GROUP BY category ORDER BY expense DESC`;

            const stats = await this.db.getAllAsync(query, params);
            return { success: true, stats };
        } catch (error) {
            console.error('Error fetching statistics:', error);
            return { success: false, error: error.message };
        }
    }

    async getCategoryHistory(userId, category, startDate = null, endDate = null) {
        if (!this.db) await this.init();
        try {
            let query = `SELECT * FROM balance_history WHERE user_id = ? AND category = ?`;
            const params = [userId, category];

            if (startDate) {
                query += ` AND created_at >= ?`;
                params.push(startDate);
            }
            if (endDate) {
                query += ` AND created_at <= ?`;
                params.push(endDate);
            }

            query += ` ORDER BY created_at DESC`;

            const history = await this.db.getAllAsync(query, params);
            return { success: true, history };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async getDistinctCategories(userId) {
        if (!this.db) await this.init();
        try {
            // First, get categories from the specific categories table
            const catResult = await this.db.getAllAsync(
                `SELECT name FROM finance_categories WHERE user_id = ? ORDER BY name ASC`,
                [userId]
            );

            // Also get from history just in case there are legacy categories
            const histResult = await this.db.getAllAsync(
                `SELECT DISTINCT category FROM balance_history WHERE user_id = ? ORDER BY category ASC`,
                [userId]
            );

            const tableCats = catResult.map(r => r.name);
            const historyCats = histResult.map(r => r.category);

            const categories = Array.from(new Set([...tableCats, ...historyCats]));
            return { success: true, categories };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async addFinanceCategory(userId, name) {
        if (!this.db) await this.init();
        try {
            await this.db.runAsync(
                'INSERT INTO finance_categories (user_id, name) VALUES (?, ?)',
                [userId, name]
            );
            return { success: true };
        } catch (error) {
            if (error.message.includes('UNIQUE constraint failed')) {
                return { success: true }; // Already exists
            }
            return { success: false, error: error.message };
        }
    }

    // Uso interno: se llama dentro de la transacción de registerUser
    // (no usar addFinanceCategory aquí: está encolada y bloquearía la cola).
    async _seedDefaultCategoriesTx(userId) {
        const defaults = ['Comida', 'Transporte', 'Sueldo', 'Venta', 'Salud', 'Hogar'];
        for (const cat of defaults) {
            await this.db.runAsync(
                'INSERT OR IGNORE INTO finance_categories (user_id, name) VALUES (?, ?)',
                [userId, cat]
            );
        }
    }

    // --- ENTERTAINMENT (Series/Anime/Lectura) ---

    // --- SERVICIOS ---

    async addService(userId, data) {
        if (!this.db) await this.init();
        try {
            const { name, type, status, originalValue, additionalValue, totalValue } = data;
            const result = await this.db.runAsync(
                `INSERT INTO services 
                (user_id, name, type, status, original_value, additional_value, total_value) 
                VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [userId, name, type, status, originalValue, additionalValue || 0, totalValue]
            );
            return { success: true, id: result.lastInsertRowId };
        } catch (error) {
            console.error('Error adding service:', error);
            return { success: false, error: error.message };
        }
    }

    async getServices(userId) {
        if (!this.db) await this.init();
        try {
            const services = await this.db.getAllAsync(
                'SELECT * FROM services WHERE user_id = ? ORDER BY status ASC, name ASC',
                [userId]
            );
            return { success: true, services };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async updateService(id, data) {
        if (!this.db) await this.init();
        try {
            const { name, type, status, originalValue, additionalValue, totalValue } = data;
            await this.db.runAsync(
                `UPDATE services 
                SET name = ?, type = ?, status = ?, original_value = ?, additional_value = ?, total_value = ?
                WHERE id = ?`,
                [name, type, status, originalValue, additionalValue || 0, totalValue, id]
            );
            return { success: true };
        } catch (error) {
            console.error('Error updating service:', error);
            return { success: false, error: error.message };
        }
    }

    async deleteService(id) {
        if (!this.db) await this.init();
        try {
            await this.db.runAsync('DELETE FROM services WHERE id = ?', [id]);
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async toggleServiceStatus(id, currentStatus) {
        if (!this.db) await this.init();
        try {
            const newStatus = currentStatus === 'Activo' ? 'Inactivo' : 'Activo';
            await this.db.runAsync(
                `UPDATE services SET status = ? WHERE id = ?`,
                [newStatus, id]
            );
            return { success: true, newStatus };
        } catch (error) {
            console.error('Error toggling service status:', error);
            return { success: false, error: error.message };
        }
    }

    async addEntertainmentCategory(userId, data) {
        if (!this.db) await this.init();
        try {
            const { name, type, startDate, daysOfWeek, frequency, seriesCount, description } = data;
            const daysString = JSON.stringify(daysOfWeek);

            // Categoría + registro inicial de cuotas en una sola transacción.
            const categoryId = await this._tx(async () => {
                const result = await this.db.runAsync(
                    `INSERT INTO entertainment_categories
                    (user_id, name, type, start_date, days_of_week, frequency, series_count, description)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                    [userId, name, type, startDate, daysString, frequency, seriesCount, description]
                );
                maybeFail('DEV_FAIL_TX', 'addEntertainmentCategory');

                const newId = result.lastInsertRowId;
                if (newId) {
                    // Initial quota record
                    await this.db.runAsync(
                        'INSERT INTO entertainment_quotas_history (category_id, quotas, start_date) VALUES (?, ?, ?)',
                        [newId, daysString, startDate || getLocalDateString()]
                    );
                }
                return newId;
            });

            return { success: true, id: categoryId };
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
                const quotasHistory = await this.db.getAllAsync(
                    'SELECT quotas, start_date, end_date FROM entertainment_quotas_history WHERE category_id = ? ORDER BY start_date ASC',
                    [cat.id]
                );
                
                const parsesQuotasHistory = quotasHistory.map(qh => ({
                    ...qh,
                    quotas: JSON.parse(qh.quotas)
                }));

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

                const pauses = await this.db.getAllAsync(
                    'SELECT pause_start, pause_end FROM entertainment_pauses WHERE category_id = ?',
                    [cat.id]
                );

                return {
                    ...cat,
                    days_of_week: typeof cat.days_of_week === 'string' ? JSON.parse(cat.days_of_week || '[]') : cat.days_of_week,
                    totalWatched,
                    pauses,
                    quotas_history: parsesQuotasHistory,
                    is_paused: pauses.some(p => !p.pause_end)
                };
            }));

            return { success: true, categories: enrichedCategories };
        } catch (error) {
            console.error(error);
            return { success: false, error: error.message };
        }
    }

    async getCategoryPauses(categoryId) {
        if (!this.db) await this.init();
        try {
            const pauses = await this.db.getAllAsync(
                'SELECT * FROM entertainment_pauses WHERE category_id = ? ORDER BY pause_start ASC',
                [categoryId]
            );
            return { success: true, pauses };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async pauseCategory(categoryId, date) {
        if (!this.db) await this.init();
        try {
            // Check if already paused
            const activePause = await this.db.getFirstAsync(
                'SELECT id FROM entertainment_pauses WHERE category_id = ? AND pause_end IS NULL',
                [categoryId]
            );
            if (activePause) return { success: true }; // Already paused

            await this.db.runAsync(
                'INSERT INTO entertainment_pauses (category_id, pause_start) VALUES (?, ?)',
                [categoryId, date]
            );
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async resumeCategory(categoryId, date) {
        if (!this.db) await this.init();
        try {
            await this.db.runAsync(
                'UPDATE entertainment_pauses SET pause_end = ? WHERE category_id = ? AND pause_end IS NULL',
                [date, categoryId]
            );
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async getQuotaHistory(categoryId) {
        if (!this.db) await this.init();
        try {
            const history = await this.db.getAllAsync(
                'SELECT * FROM entertainment_quotas_history WHERE category_id = ? ORDER BY start_date ASC',
                [categoryId]
            );
            return { success: true, history: history.map(h => ({ ...h, quotas: JSON.parse(h.quotas) })) };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async updateEntertainmentCategory(id, data) {
        if (!this.db) await this.init();
        try {
            const { name, type, startDate, daysOfWeek, frequency, seriesCount, description } = data;
            const daysString = JSON.stringify(daysOfWeek);

            // Historial de cuotas + categoría en una sola transacción.
            await this._tx(async () => {
                // Check if daysOfWeek (quotas) changed
                const currentCat = await this.db.getFirstAsync(
                    'SELECT days_of_week FROM entertainment_categories WHERE id = ?',
                    [id]
                );

                if (currentCat && currentCat.days_of_week !== daysString) {
                    const today = getLocalDateString();
                    const yesterday = new Date();
                    yesterday.setDate(yesterday.getDate() - 1);
                    const yesterdayStr = getLocalDateString(yesterday);

                    // 1. Close current history record (end_date = yesterday)
                    await this.db.runAsync(
                        'UPDATE entertainment_quotas_history SET end_date = ? WHERE category_id = ? AND end_date IS NULL',
                        [yesterdayStr, id]
                    );
                    maybeFail('DEV_FAIL_TX', 'updateEntertainmentCategory: tras cerrar la cuota vigente');

                    // 2. Insert new history record (start_date = today)
                    await this.db.runAsync(
                        'INSERT INTO entertainment_quotas_history (category_id, quotas, start_date) VALUES (?, ?, ?)',
                        [id, daysString, today]
                    );
                }

                await this.db.runAsync(
                    `UPDATE entertainment_categories
                    SET name = ?, type = ?, start_date = ?, days_of_week = ?, frequency = ?, series_count = ?, description = ?
                    WHERE id = ?`,
                    [name, type, startDate, daysString, frequency, seriesCount, description, id]
                );
                maybeFail('DEV_FAIL_TX', 'updateEntertainmentCategory: tras actualizar la categoría');
            });
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

            // Serie + temporadas en una sola transacción.
            await this._tx(async () => {
                // Get max sort_order to put it at the end
                const maxOrderRes = await this.db.getFirstAsync(
                    'SELECT MAX(sort_order) as maxOrder FROM series WHERE category_id = ?',
                    [category_id]
                );
                const nextOrder = (maxOrderRes?.maxOrder || 0) + 1;

                // ACOPLAMIENTO ELIMINADO: Ya no se suma el `maxCycle` al `cycle_offset` de las nuevas
                // series, dado que el total general de la categoría se calcula sumando TODAS
                // las series por separado. Añadir un maxCycle aquí causaba duplicación de historial.

                // 1. Insert Series
                const result = await this.db.runAsync(
                    `INSERT INTO series (category_id, name, description, status, current_season, current_episode, initial_season, initial_episode, total_seasons, sort_order, cycle_offset, interleave_offset, last_watched_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [category_id, name, description, status, current_season, current_episode, current_season, current_episode, total_seasons, nextOrder, seriesData.cycle_offset || 0, seriesData.interleave_offset || 0, 0]
                );
                const seriesId = result.lastInsertRowId;
                maybeFail('DEV_FAIL_TX', 'addSeriesWithSeasons: tras insertar la serie');

                // 2. Insert Seasons
                if (seasonsData && seasonsData.length > 0) {
                    for (const season of seasonsData) {
                        await this.db.runAsync(
                            `INSERT INTO seasons (series_id, season_number, episode_count) VALUES (?, ?, ?)`,
                            [seriesId, season.season_number, season.episode_count]
                        );
                    }
                }
            });

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

            // Serie + temporadas en una sola transacción.
            const found = await this._tx(async () => {
                // 0. Fetch current series state to check for status change
                const currentSeries = await this.db.getFirstAsync('SELECT * FROM series WHERE id = ?', [seriesId]);
                if (!currentSeries) return false;

                let newOffset = currentSeries.cycle_offset;

                // ACOPLAMIENTO ELIMINADO: Anteriormente, al cambiar de estado a 'Mirando',
                // la serie intentaba igualar su `cycle_offset` al `maxCycle` de la categoría.
                // Dado que el total progresivo suma todas las series de la categoría, sumar el maxCycle
                // causaba conteos duplicados cada vez que se activaba una serie.

                // 1. Update Series
                let query = `UPDATE series SET name = ?, description = ?, total_seasons = ?, cycle_offset = ?, interleave_offset = ?`;
                let params = [name, description, total_seasons, newOffset, currentSeries.interleave_offset];

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
                // (el upsert por (series_id, season_number) llega en la Fase 1)
                await this.db.runAsync(`DELETE FROM seasons WHERE series_id = ?`, [seriesId]);
                maybeFail('DEV_FAIL_TX', 'updateSeriesWithSeasons: tras borrar las temporadas');
                if (seasonsData && seasonsData.length > 0) {
                    for (const season of seasonsData) {
                        await this.db.runAsync(
                            `INSERT INTO seasons (series_id, season_number, episode_count) VALUES (?, ?, ?)`,
                            [seriesId, season.season_number, season.episode_count]
                        );
                    }
                }
                return true;
            });
            if (!found) return { success: false, error: 'Series not found' };
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

    async updateSeriesProgress(seriesId, currentSeason, currentEpisode, status = null, customSortOrder = null, customLastWatchedAt = undefined, cycleOffset = undefined, interleaveOffset = undefined) {
        if (!this.db) await this.init();
        try {
            const timestamp = customLastWatchedAt !== undefined ? customLastWatchedAt : Date.now();
            let query = 'UPDATE series SET current_season = ?, current_episode = ?, last_watched_at = ?';
            let params = [currentSeason, currentEpisode, timestamp];

            if (status) {
                query += ', status = ?';
                params.push(status);
            }

            if (customSortOrder !== null) {
                query += ', sort_order = ?';
                params.push(customSortOrder);
            }

            if (cycleOffset !== undefined) {
                query += ', cycle_offset = ?';
                params.push(cycleOffset);
            }

            if (interleaveOffset !== undefined) {
                query += ', interleave_offset = ?';
                params.push(interleaveOffset);
            }

            query += ' WHERE id = ?';
            params.push(seriesId);

            await this.db.runAsync(query, params);
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
                    series.interleave_offset,
                    series.last_watched_at,
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

            // SORT BY sort_order ASC, then last_watched_at
            // Now that frontend handles 'Cycle' rotation, we can respect manual sort order
            // which allows users to prioritize series within the same cycle.
            query += " ORDER BY series.sort_order ASC, series.last_watched_at ASC, series.id DESC";

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

    async getHistory(userId, categoryId = null) {
        if (!this.db) await this.init();

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

    async getReadingHistory(userId, categoryId = null) {
        if (!this.db) await this.init();

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
            const { type, title, year, format, start_year, end_year, franchise } = data;
            await this.db.runAsync(
                `INSERT INTO backlog (user_id, type, title, year, format, start_year, end_year, franchise) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [userId, type, title, year, format, start_year, end_year, franchise || 'Otros']
            );
            return { success: true };
        } catch (error) {
            console.error('Error addBacklogItem:', error);
            return { success: false, error: error.message };
        }
    }

    async getBacklogItems(userId, type, status = null, sortBy = 'title', order = 'ASC', franchise = 'Todos') {
        if (!this.db) await this.init();
        try {
            const allowedSortBy = new Set(['title', 'year_start', 'created_at']);
            const safeSortBy = allowedSortBy.has(sortBy) ? sortBy : 'title';
            const safeOrder = order === 'DESC' ? 'DESC' : 'ASC';

            // Determine the column to sort by for "year" based on type
            let sortCol = safeSortBy;
            if (safeSortBy === 'year_start') {
                sortCol = type === 'movie' ? 'year' : 'start_year';
            }

            let query = `SELECT * FROM backlog WHERE user_id = ? AND type = ?`;
            const params = [userId, type];

            if (status && status !== 'Total') {
                query += ` AND status = ?`;
                params.push(status);
            }

            if (franchise && franchise !== 'Todos') {
                query += ` AND franchise = ?`;
                params.push(franchise);
            }

            query += ` ORDER BY ${sortCol} ${safeOrder}`;

            const rows = await this.db.getAllAsync(query, params);
            return { success: true, data: rows };
        } catch (error) {
            console.error('Error getBacklogItems:', error);
            return { success: false, error: error.message };
        }
    }

    async getBacklogCounts(userId, type, franchise = 'Todos') {
        if (!this.db) await this.init();
        try {
            const counts = {
                'Pendiente': 0,
                'Mirando': 0,
                'Terminado': 0,
                'Total': 0
            };

            let query = 'SELECT status, COUNT(*) as count FROM backlog WHERE user_id = ? AND type = ?';
            const params = [userId, type];

            if (franchise && franchise !== 'Todos') {
                query += ' AND franchise = ?';
                params.push(franchise);
            }

            query += ' GROUP BY status';

            const rows = await this.db.getAllAsync(query, params);

            let total = 0;
            rows.forEach(row => {
                if (counts.hasOwnProperty(row.status)) {
                    counts[row.status] = row.count;
                }
                total += row.count;
            });
            counts['Total'] = total;

            return { success: true, counts };
        } catch (error) {
            console.error('Error getBacklogCounts:', error);
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

    async updateBacklogItem(id, data) {
        if (!this.db) await this.init();
        try {
            const { title, year, format, start_year, end_year, franchise } = data;
            await this.db.runAsync(
                `UPDATE backlog 
                 SET title = ?, year = ?, format = ?, start_year = ?, end_year = ?, franchise = ? 
                 WHERE id = ?`,
                [title, year, format, start_year, end_year, franchise || 'Otros', id]
            );
            return { success: true };
        } catch (error) {
            console.error('Error updateBacklogItem:', error);
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

    // Work People Methods
    async getWorkPeople(userId) {
        if (!this.db) await this.init();
        try {
            const result = await this.db.getAllAsync(
                'SELECT * FROM work_people WHERE user_id = ? ORDER BY sort_order ASC, created_at DESC',
                [userId]
            );
            return { success: true, data: result };
        } catch (error) {
            console.error('Error getWorkPeople:', error);
            return { success: false, error: error.message };
        }
    }

    async addWorkPerson(userId, name, startDate, cycle) {
        if (!this.db) await this.init();
        try {
            // Get max sort_order
            const max = await this.db.getFirstAsync('SELECT MAX(sort_order) as m FROM work_people WHERE user_id = ?', [userId]);
            const nextOrder = (max?.m || 0) + 1;

            const result = await this.db.runAsync(
                'INSERT INTO work_people (user_id, name, start_date, cycle, sort_order) VALUES (?, ?, ?, ?, ?)',
                [userId, name, startDate, cycle, nextOrder]
            );
            return { success: true, id: result.lastInsertRowId };
        } catch (error) {
            console.error('Error addWorkPerson:', error);
            return { success: false, error: error.message };
        }
    }

    async updateWorkPersonOrder(id, order) {
        if (!this.db) await this.init();
        try {
            await this.db.runAsync('UPDATE work_people SET sort_order = ? WHERE id = ?', [order, id]);
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async updateWorkPerson(id, name, startDate, cycle) {
        if (!this.db) await this.init();
        try {
            await this.db.runAsync(
                'UPDATE work_people SET name = ?, start_date = ?, cycle = ? WHERE id = ?',
                [name, startDate, cycle, id]
            );
            return { success: true };
        } catch (error) {
            console.error('Error updateWorkPerson:', error);
            return { success: false, error: error.message };
        }
    }

    async deleteWorkPerson(id) {
        if (!this.db) await this.init();
        try {
            await this.db.runAsync('DELETE FROM work_people WHERE id = ?', [id]);
            return { success: true };
        } catch (error) {
            console.error('Error deleteWorkPerson:', error);
            return { success: false, error: error.message };
        }
    }

    // --- CARDS (Tarjetas) ---
    async addCard(userId, data) {
        if (!this.db) await this.init();
        try {
            const { name, type, cutoff_date, payment_due_date, limit_amount } = data;
            const result = await this.db.runAsync(
                `INSERT INTO cards (user_id, name, type, cutoff_date, payment_due_date, limit_amount) VALUES (?, ?, ?, ?, ?, ?)`,
                [userId, name, type, cutoff_date || null, payment_due_date || null, limit_amount === null ? null : limit_amount]
            );
            return { success: true, id: result.lastInsertRowId };
        } catch (error) {
            console.error('Error adding card:', error);
            return { success: false, error: error.message };
        }
    }

    async getCards(userId) {
        if (!this.db) await this.init();
        try {
            const cards = await this.db.getAllAsync(
                'SELECT * FROM cards WHERE user_id = ? ORDER BY type DESC, name ASC',
                [userId]
            );
            return { success: true, cards };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async updateCard(id, data) {
        if (!this.db) await this.init();
        try {
            const { name, type, cutoff_date, payment_due_date, limit_amount } = data;
            await this.db.runAsync(
                `UPDATE cards SET name = ?, type = ?, cutoff_date = ?, payment_due_date = ?, limit_amount = ? WHERE id = ?`,
                [name, type, cutoff_date || null, payment_due_date || null, limit_amount === null ? null : limit_amount, id]
            );
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async deleteCard(id) {
        if (!this.db) await this.init();
        try {
            await this.db.runAsync('DELETE FROM cards WHERE id = ?', [id]);
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }
}

// Todas las mutaciones pasan por la cola serializada (_enqueue): nunca corren dos
// escrituras de la app a la vez, ni una escritura dentro de la transacción de otra.
// Las multipaso (TX_MUTATIONS) además usan _tx (withTransactionAsync) por dentro.
// Regla: una mutación encolada NO debe llamar a otra mutación encolada (bloquearía la cola);
// para reutilizar lógica se usan helpers internos con prefijo _ (p. ej. _insertDebtTx).
export const TX_MUTATIONS = [
    'registerUser',
    'addTransaction',
    'registerMoneyMovement',
    'addEntertainmentCategory',
    'updateEntertainmentCategory',
    'addSeriesWithSeasons',
    'updateSeriesWithSeasons',
];

export const QUEUED_MUTATIONS = [
    ...TX_MUTATIONS,
    'updateUserBalance',
    'deleteTransaction',
    'addBalanceTransaction',
    'addFinanceCategory',
    'addService',
    'updateService',
    'deleteService',
    'toggleServiceStatus',
    'pauseCategory',
    'resumeCategory',
    'deleteEntertainmentCategory',
    'updateSeriesSortOrder',
    'updateSeriesProgress',
    'restartSeries',
    'deleteSeries',
    'addHistory',
    'removeHistory',
    'addReadingHistory',
    'removeReadingHistory',
    'addBacklogItem',
    'updateBacklogStatus',
    'updateBacklogItem',
    'deleteBacklogItem',
    'addWorkPerson',
    'updateWorkPersonOrder',
    'updateWorkPerson',
    'deleteWorkPerson',
    'addCard',
    'updateCard',
    'deleteCard',
];

for (const name of QUEUED_MUTATIONS) {
    const original = DatabaseService.prototype[name];
    if (typeof original !== 'function') {
        throw new Error(`db.js: la mutación encolada ${name} no existe`);
    }
    DatabaseService.prototype[name] = function (...args) {
        return this._enqueue(() => original.apply(this, args));
    };
}

// La clase se exporta solo para las pruebas en PC (scripts/probar-fase0.mjs).
export { DatabaseService };

export default new DatabaseService();
