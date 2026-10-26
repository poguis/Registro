import * as SQLite from 'expo-sqlite';
import { DB_NAME } from './dbConfig';
import { runMigrations, LATEST_VERSION } from './migrations';
import { createPhysicalCopy, listDbFilesNextTo } from './backup';
import { setConnection, mutate } from '../data/db/connection';
import * as users from '../data/repositories/users';
import * as money from '../data/repositories/money';
import * as debts from '../data/repositories/debts';
import * as services from '../data/repositories/services';
import * as cards from '../data/repositories/cards';
import * as entertainment from '../data/repositories/entertainment';
import * as series from '../data/repositories/series';
import * as history from '../data/repositories/history';
import * as backlog from '../data/repositories/backlog';
import * as work from '../data/repositories/work';

// Fachada de datos usada por las pantallas. Mantiene los nombres y las formas de
// retorno ({ success, ... }) de siempre y delega en los repositorios de src/data.
// Toda mutación corre con `mutate` (cola serializada + transacción): la fila y su
// entrada en la outbox se escriben juntas. Las lecturas filtran deleted_at IS NULL.

const ok = (extra = {}) => ({ success: true, ...extra });
const failed = (context, error) => {
    console.error(context, error);
    return { success: false, error: error.message };
};

class DatabaseService {
    constructor() {
        this.db = null;
        this.lastInitError = null;
        this.lastMigration = null;
        this._initPromise = null;
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

    async _open() {
        const conn = await SQLite.openDatabaseAsync(DB_NAME);
        // foreign_keys no tiene efecto dentro de una transacción: se fija al abrir.
        await conn.execAsync('PRAGMA foreign_keys = ON;');
        return conn;
    }

    async _openAndMigrate() {
        let conn = null;
        try {
            console.log('Starting SQLite initialization...');
            conn = await this._open();
            console.log('DB File opened:', DB_NAME);

            const databasePath = conn.databasePath;
            const result = await runMigrations(conn, {
                createPhysicalCopy,
                listDbFiles: () => listDbFilesNextTo(databasePath),
            });
            this.lastMigration = result;

            // La migración corre en otra conexión (transacción exclusiva): si se aplicó
            // alguna, se reabre la conexión de la app para que vea el esquema nuevo.
            if (result.applied.length > 0) {
                await conn.closeAsync();
                conn = await this._open();
            }
            const uv = await conn.getFirstAsync('PRAGMA user_version');
            const seriesCols = await conn.getAllAsync('PRAGMA table_info(series)');
            if (!uv || uv.user_version !== LATEST_VERSION || !seriesCols.some((c) => c.name === 'user_id')) {
                throw new Error(`La conexión no ve el esquema esperado (user_version ${uv ? uv.user_version : '?'}, se esperaba ${LATEST_VERSION}).`);
            }

            setConnection(conn);
            this.db = conn;
            this.lastInitError = null;
            console.log('Database initialized successfully');
            return true;
        } catch (error) {
            console.error('Database initialization failed:', error);
            this.lastInitError = error;
            this._initPromise = null; // permite reintentar
            setConnection(null);
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

    // --- USER & AUTH ---

    async registerUser(username, password) {
        if (!this.db) await this.init();
        try {
            const id = await mutate(() => users.registerUser(username, password));
            return ok({ id });
        } catch (error) {
            if (String(error.message).includes('UNIQUE constraint failed')) {
                return { success: false, error: 'El usuario ya existe' };
            }
            console.error('Error registering user:', error);
            return { success: false, error: 'Error al registrar usuario' };
        }
    }

    // Devuelve solo { id, username } (nunca la contraseña).
    async loginUser(username, password) {
        if (!this.db) await this.init();
        try {
            const user = await users.loginUser(username, password);
            return user ? ok({ user }) : { success: false, error: 'Credenciales inválidas' };
        } catch (error) {
            console.error('Error logging in:', error);
            return { success: false, error: 'Error al iniciar sesión' };
        }
    }

    // Resuelve la sesión guardada: id UUID vigente, o id entero anterior a la migración 2.
    async resolveSessionUser(storedId) {
        if (!this.db) await this.init();
        try {
            const numeric = typeof storedId === 'number' || /^\d+$/.test(String(storedId));
            const user = numeric ? await users.mapLegacyUserId(Number(storedId)) : await users.getUserById(String(storedId));
            return ok({ user });
        } catch (error) {
            return failed('Error resolving session user:', error);
        }
    }

    async getLatestMigrationSummary() {
        if (!this.db) await this.init();
        try {
            return ok({ summary: await users.getLatestMigrationSummary() });
        } catch (error) {
            return failed('Error reading migration log:', error);
        }
    }

    // --- MONEY MANAGEMENT ---

    // Edición manual del saldo: registra un movimiento "Ajuste" por la diferencia.
    async updateUserBalance(userId, newBalance) {
        if (!this.db) await this.init();
        try {
            const balance = await mutate(() => money.adjustBalanceTo(userId, newBalance));
            return ok({ balance });
        } catch (error) {
            return failed('Error adjusting balance:', error);
        }
    }

    // Saldo = suma de los movimientos no borrados.
    async getUserBalance(userId) {
        if (!this.db) await this.init();
        try {
            return ok({ balance: await money.getBalance(userId) });
        } catch (error) {
            return failed('Error reading balance:', error);
        }
    }

    // Movimiento de dinero completo en una sola transacción.
    async registerMoneyMovement(userId, movement) {
        if (!this.db) await this.init();
        try {
            const newBalance = await mutate(() => money.registerMoneyMovement(userId, movement));
            return ok({ newBalance });
        } catch (error) {
            return failed('Error registering money movement:', error);
        }
    }

    async addBalanceTransaction(userId, amount, category, description) {
        if (!this.db) await this.init();
        try {
            await mutate(() => money.addBalanceTransaction(userId, amount, category, description));
            return ok();
        } catch (error) {
            return failed('Error adding balance history:', error);
        }
    }

    async getBalanceHistory(userId, startDate = null, endDate = null) {
        if (!this.db) await this.init();
        try {
            return ok({ history: await money.getBalanceHistory(userId, startDate, endDate) });
        } catch (error) {
            return failed('Error reading balance history:', error);
        }
    }

    async getStatisticsData(userId, startDate = null, endDate = null) {
        if (!this.db) await this.init();
        try {
            return ok({ stats: await money.getStatisticsData(userId, startDate, endDate) });
        } catch (error) {
            return failed('Error fetching statistics:', error);
        }
    }

    async getCategoryHistory(userId, category, startDate = null, endDate = null) {
        if (!this.db) await this.init();
        try {
            return ok({ history: await money.getCategoryHistory(userId, category, startDate, endDate) });
        } catch (error) {
            return failed('Error reading category history:', error);
        }
    }

    async getDistinctCategories(userId) {
        if (!this.db) await this.init();
        try {
            return ok({ categories: await money.getDistinctCategories(userId) });
        } catch (error) {
            return failed('Error reading categories:', error);
        }
    }

    async addFinanceCategory(userId, name) {
        if (!this.db) await this.init();
        try {
            await mutate(() => money.ensureCategory(userId, name));
            return ok();
        } catch (error) {
            return failed('Error adding finance category:', error);
        }
    }

    // --- DEBTS & LOANS ---

    async getContacts(userId) {
        if (!this.db) await this.init();
        try {
            return ok({ contacts: await debts.getContacts(userId) });
        } catch (error) {
            return failed('Error reading contacts:', error);
        }
    }

    async addTransaction(userId, contactId, contactName, type, amount, description) {
        if (!this.db) await this.init();
        try {
            await mutate(() => debts.insertDebt(userId, contactId, contactName, type, amount, description));
            return ok();
        } catch (error) {
            return failed('Error adding transaction:', error);
        }
    }

    async deleteTransaction(transactionId) {
        if (!this.db) await this.init();
        try {
            await mutate(() => debts.deleteTransaction(transactionId));
            return ok();
        } catch (error) {
            return failed('Error deleting transaction:', error);
        }
    }

    async getFinanceData(userId, type) {
        if (!this.db) await this.init();
        try {
            return ok({ data: await debts.getFinanceData(userId, type) });
        } catch (error) {
            return failed('Error reading finance data:', error);
        }
    }

    // --- SERVICIOS ---

    async addService(userId, data) {
        if (!this.db) await this.init();
        try {
            const id = await mutate(() => services.addService(userId, data));
            return ok({ id });
        } catch (error) {
            return failed('Error adding service:', error);
        }
    }

    async getServices(userId) {
        if (!this.db) await this.init();
        try {
            return ok({ services: await services.getServices(userId) });
        } catch (error) {
            return failed('Error reading services:', error);
        }
    }

    async updateService(id, data) {
        if (!this.db) await this.init();
        try {
            await mutate(() => services.updateService(id, data));
            return ok();
        } catch (error) {
            return failed('Error updating service:', error);
        }
    }

    async deleteService(id) {
        if (!this.db) await this.init();
        try {
            await mutate(() => services.deleteService(id));
            return ok();
        } catch (error) {
            return failed('Error deleting service:', error);
        }
    }

    async toggleServiceStatus(id, currentStatus) {
        if (!this.db) await this.init();
        try {
            const newStatus = await mutate(() => services.toggleServiceStatus(id, currentStatus));
            return ok({ newStatus });
        } catch (error) {
            return failed('Error toggling service status:', error);
        }
    }

    // --- ENTERTAINMENT (Series/Anime/Lectura) ---

    async addEntertainmentCategory(userId, data) {
        if (!this.db) await this.init();
        try {
            const id = await mutate(() => entertainment.addEntertainmentCategory(userId, data));
            return ok({ id });
        } catch (error) {
            return failed('Error adding entertainment category:', error);
        }
    }

    async getEntertainmentCategories(userId) {
        if (!this.db) await this.init();
        try {
            return ok({ categories: await entertainment.getEntertainmentCategories(userId) });
        } catch (error) {
            return failed('Error reading entertainment categories:', error);
        }
    }

    async getCategoryPauses(categoryId) {
        if (!this.db) await this.init();
        try {
            return ok({ pauses: await entertainment.getCategoryPauses(categoryId) });
        } catch (error) {
            return failed('Error reading pauses:', error);
        }
    }

    async pauseCategory(categoryId, date) {
        if (!this.db) await this.init();
        try {
            await mutate(() => entertainment.pauseCategory(categoryId, date));
            return ok();
        } catch (error) {
            return failed('Error pausing category:', error);
        }
    }

    async resumeCategory(categoryId, date) {
        if (!this.db) await this.init();
        try {
            await mutate(() => entertainment.resumeCategory(categoryId, date));
            return ok();
        } catch (error) {
            return failed('Error resuming category:', error);
        }
    }

    async getQuotaHistory(categoryId) {
        if (!this.db) await this.init();
        try {
            return ok({ history: await entertainment.getQuotaHistory(categoryId) });
        } catch (error) {
            return failed('Error reading quota history:', error);
        }
    }

    async updateEntertainmentCategory(id, data) {
        if (!this.db) await this.init();
        try {
            await mutate(() => entertainment.updateEntertainmentCategory(id, data));
            return ok();
        } catch (error) {
            return failed('Error updating entertainment category:', error);
        }
    }

    // Borrado lógico con cascada a pausas, cuotas, series, temporadas e historial.
    async deleteEntertainmentCategory(id) {
        if (!this.db) await this.init();
        try {
            await mutate(() => entertainment.deleteEntertainmentCategory(id));
            return ok();
        } catch (error) {
            return failed('Error deleting entertainment category:', error);
        }
    }

    // --- SERIES ---

    async getSeriesByCategory(categoryId) {
        if (!this.db) await this.init();
        try {
            return ok({ series: await series.getSeriesByCategory(categoryId) });
        } catch (error) {
            return failed('Error reading series:', error);
        }
    }

    async getSeasonsBySeries(seriesId) {
        if (!this.db) await this.init();
        try {
            return ok({ seasons: await series.getSeasonsBySeries(seriesId) });
        } catch (error) {
            return failed('Error reading seasons:', error);
        }
    }

    async addSeriesWithSeasons(seriesData, seasonsData) {
        if (!this.db) await this.init();
        try {
            await mutate(() => series.addSeriesWithSeasons(seriesData, seasonsData));
            return ok();
        } catch (error) {
            return failed('Error adding series:', error);
        }
    }

    async updateSeriesWithSeasons(seriesId, seriesData, seasonsData) {
        if (!this.db) await this.init();
        try {
            const found = await mutate(() => series.updateSeriesWithSeasons(seriesId, seriesData, seasonsData));
            return found ? ok() : { success: false, error: 'Series not found' };
        } catch (error) {
            return failed('Error updating series:', error);
        }
    }

    async updateSeriesSortOrder(seriesId, newOrder) {
        if (!this.db) await this.init();
        try {
            await mutate(() => series.updateSeriesSortOrder(seriesId, newOrder));
            return ok();
        } catch (error) {
            return failed('Error updating sort order:', error);
        }
    }

    async updateSeriesProgress(seriesId, currentSeason, currentEpisode, status = null, customSortOrder = null, customLastWatchedAt = undefined, cycleOffset = undefined, interleaveOffset = undefined) {
        if (!this.db) await this.init();
        try {
            await mutate(() => series.updateSeriesProgress(seriesId, currentSeason, currentEpisode, status, customSortOrder, customLastWatchedAt, cycleOffset, interleaveOffset));
            return ok();
        } catch (error) {
            return failed('Error updating series progress:', error);
        }
    }

    // cycle_offset se escribe como valor absoluto (lee el actual dentro de la transacción).
    async restartSeries(seriesId, totalEpisodes) {
        if (!this.db) await this.init();
        try {
            await mutate(() => series.restartSeries(seriesId, totalEpisodes));
            return ok();
        } catch (error) {
            return failed('Error restarting series:', error);
        }
    }

    // Borrado lógico con cascada a temporadas e historial.
    async deleteSeries(id) {
        if (!this.db) await this.init();
        try {
            await mutate(() => series.deleteSeriesCascade(id));
            return ok();
        } catch (error) {
            return failed('Error deleting series:', error);
        }
    }

    async getFullWatchlist(userId, categoryId = null) {
        if (!this.db) await this.init();
        try {
            return ok({ data: await series.getFullWatchlist(userId, categoryId) });
        } catch (error) {
            return failed('Error reading watchlist:', error);
        }
    }

    // --- WATCH / READING HISTORY ---

    async addHistory(seriesId, season, episode, timestamp = Date.now()) {
        if (!this.db) await this.init();
        try {
            await mutate(() => history.addHistory(seriesId, season, episode, timestamp));
            return ok();
        } catch (error) {
            return failed('Error adding history:', error);
        }
    }

    async removeHistory(seriesId, season, episode) {
        if (!this.db) await this.init();
        try {
            await mutate(() => history.removeHistory(seriesId, season, episode));
            return ok();
        } catch (error) {
            return failed('Error removing history:', error);
        }
    }

    async getHistory(userId, categoryId = null) {
        if (!this.db) await this.init();
        try {
            return ok({ data: await history.getHistory(userId, categoryId) });
        } catch (error) {
            return failed('Error getHistory:', error);
        }
    }

    async addReadingHistory(seriesId, season, episode, timestamp = Date.now()) {
        if (!this.db) await this.init();
        try {
            await mutate(() => history.addReadingHistory(seriesId, season, episode, timestamp));
            return ok();
        } catch (error) {
            return failed('Error adding reading history:', error);
        }
    }

    async removeReadingHistory(seriesId, season, episode) {
        if (!this.db) await this.init();
        try {
            await mutate(() => history.removeReadingHistory(seriesId, season, episode));
            return ok();
        } catch (error) {
            return failed('Error removing reading history:', error);
        }
    }

    async getReadingHistory(userId, categoryId = null) {
        if (!this.db) await this.init();
        try {
            return ok({ data: await history.getReadingHistory(userId, categoryId) });
        } catch (error) {
            return failed('Error getReadingHistory:', error);
        }
    }

    // --- BACKLOG ---

    async addBacklogItem(userId, data) {
        if (!this.db) await this.init();
        try {
            await mutate(() => backlog.addBacklogItem(userId, data));
            return ok();
        } catch (error) {
            return failed('Error addBacklogItem:', error);
        }
    }

    async getBacklogItems(userId, type, status = null, sortBy = 'title', order = 'ASC', franchise = 'Todos') {
        if (!this.db) await this.init();
        try {
            return ok({ data: await backlog.getBacklogItems(userId, type, status, sortBy, order, franchise) });
        } catch (error) {
            return failed('Error getBacklogItems:', error);
        }
    }

    async getBacklogCounts(userId, type, franchise = 'Todos') {
        if (!this.db) await this.init();
        try {
            return ok({ counts: await backlog.getBacklogCounts(userId, type, franchise) });
        } catch (error) {
            return failed('Error getBacklogCounts:', error);
        }
    }

    async updateBacklogStatus(id, status) {
        if (!this.db) await this.init();
        try {
            await mutate(() => backlog.updateBacklogStatus(id, status));
            return ok();
        } catch (error) {
            return failed('Error updateBacklogStatus:', error);
        }
    }

    async updateBacklogItem(id, data) {
        if (!this.db) await this.init();
        try {
            await mutate(() => backlog.updateBacklogItem(id, data));
            return ok();
        } catch (error) {
            return failed('Error updateBacklogItem:', error);
        }
    }

    async deleteBacklogItem(id) {
        if (!this.db) await this.init();
        try {
            await mutate(() => backlog.deleteBacklogItem(id));
            return ok();
        } catch (error) {
            return failed('Error deleteBacklogItem:', error);
        }
    }

    // --- WORK PEOPLE ---

    async getWorkPeople(userId) {
        if (!this.db) await this.init();
        try {
            return ok({ data: await work.getWorkPeople(userId) });
        } catch (error) {
            return failed('Error getWorkPeople:', error);
        }
    }

    async addWorkPerson(userId, name, startDate, cycle) {
        if (!this.db) await this.init();
        try {
            const id = await mutate(() => work.addWorkPerson(userId, name, startDate, cycle));
            return ok({ id });
        } catch (error) {
            return failed('Error addWorkPerson:', error);
        }
    }

    async updateWorkPersonOrder(id, order) {
        if (!this.db) await this.init();
        try {
            await mutate(() => work.updateWorkPersonOrder(id, order));
            return ok();
        } catch (error) {
            return failed('Error updateWorkPersonOrder:', error);
        }
    }

    async updateWorkPerson(id, name, startDate, cycle) {
        if (!this.db) await this.init();
        try {
            await mutate(() => work.updateWorkPerson(id, name, startDate, cycle));
            return ok();
        } catch (error) {
            return failed('Error updateWorkPerson:', error);
        }
    }

    async deleteWorkPerson(id) {
        if (!this.db) await this.init();
        try {
            await mutate(() => work.deleteWorkPerson(id));
            return ok();
        } catch (error) {
            return failed('Error deleteWorkPerson:', error);
        }
    }

    // --- CARDS (Tarjetas) ---

    async addCard(userId, data) {
        if (!this.db) await this.init();
        try {
            const id = await mutate(() => cards.addCard(userId, data));
            return ok({ id });
        } catch (error) {
            return failed('Error adding card:', error);
        }
    }

    async getCards(userId) {
        if (!this.db) await this.init();
        try {
            return ok({ cards: await cards.getCards(userId) });
        } catch (error) {
            return failed('Error reading cards:', error);
        }
    }

    async updateCard(id, data) {
        if (!this.db) await this.init();
        try {
            await mutate(() => cards.updateCard(id, data));
            return ok();
        } catch (error) {
            return failed('Error updating card:', error);
        }
    }

    async deleteCard(id) {
        if (!this.db) await this.init();
        try {
            await mutate(() => cards.deleteCard(id));
            return ok();
        } catch (error) {
            return failed('Error deleting card:', error);
        }
    }
}

// Mutaciones de la fachada. Todas corren con `mutate` (cola serializada + transacción):
// la fila y su entrada en la outbox se escriben juntas. Regla: una mutación no llama a
// otra mutación de la fachada; la lógica compartida vive en los repositorios.
export const QUEUED_MUTATIONS = [
    'registerUser', 'updateUserBalance', 'registerMoneyMovement', 'addBalanceTransaction', 'addFinanceCategory',
    'addTransaction', 'deleteTransaction',
    'addService', 'updateService', 'deleteService', 'toggleServiceStatus',
    'addEntertainmentCategory', 'pauseCategory', 'resumeCategory', 'updateEntertainmentCategory', 'deleteEntertainmentCategory',
    'addSeriesWithSeasons', 'updateSeriesWithSeasons', 'updateSeriesSortOrder', 'updateSeriesProgress', 'restartSeries', 'deleteSeries',
    'addHistory', 'removeHistory', 'addReadingHistory', 'removeReadingHistory',
    'addBacklogItem', 'updateBacklogStatus', 'updateBacklogItem', 'deleteBacklogItem',
    'addWorkPerson', 'updateWorkPersonOrder', 'updateWorkPerson', 'deleteWorkPerson',
    'addCard', 'updateCard', 'deleteCard',
];
// Desde la Fase 1 todas las mutaciones son transaccionales (escriben fila + outbox).
export const TX_MUTATIONS = QUEUED_MUTATIONS;

// La clase se exporta solo para las pruebas en PC (scripts/probar-fase*.mjs).
export { DatabaseService };

export default new DatabaseService();
