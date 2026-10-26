import { getConnection, type Row } from '../db/connection';
import { insertRow, reviveRow } from './rows';
import { insertDebt, type LinkedDebt } from './debts';

// Dinero: saldo (calculado), movimientos (balance_history) y categorías.
// Las funciones que escriben se llaman dentro de `mutate` (cola + transacción).

const db = () => getConnection();
const BALANCE_TOLERANCE = 0.005;
export const ADJUSTMENT_CATEGORY = 'Ajuste';

// Saldo = suma de los movimientos no borrados (ya no existe current_balance).
export async function getBalance(userId: string): Promise<number> {
    const r = await db().getFirstAsync<Row>(
        'SELECT COALESCE(SUM(amount), 0) AS s FROM balance_history WHERE user_id = ? AND deleted_at IS NULL',
        [userId]
    );
    return r ? r.s : 0;
}

// Crea la categoría o revive la fila si estaba borrada (UNIQUE(user_id, name)).
export async function ensureCategory(userId: string, name: string): Promise<void> {
    const row = await db().getFirstAsync<Row>(
        'SELECT id, deleted_at FROM finance_categories WHERE user_id = ? AND name = ?',
        [userId, name]
    );
    if (!row) {
        await insertRow('finance_categories', userId, { name });
    } else if (row.deleted_at) {
        await reviveRow('finance_categories', row.id);
    }
}

export async function addBalanceTransaction(userId: string, amount: number, category: string, description: string | null): Promise<string> {
    return insertRow('balance_history', userId, { amount, category, description });
}

// Movimiento de dinero completo: deuda/préstamo vinculado (opcional) + historial.
// Devuelve el saldo resultante (calculado).
export async function registerMoneyMovement(
    userId: string,
    { amount, category, description, linked = null }: { amount: number; category: string; description: string | null; linked?: LinkedDebt | null }
): Promise<number> {
    if (linked) {
        await insertDebt(userId, linked.contactId, linked.contactName, linked.type, linked.amount, linked.description);
    }
    await addBalanceTransaction(userId, amount, category, description);
    return getBalance(userId);
}

// Edición manual del saldo: registra un movimiento "Ajuste" por la diferencia.
export async function adjustBalanceTo(userId: string, newBalance: number): Promise<number> {
    const current = await getBalance(userId);
    const diff = Math.round((newBalance - current) * 100) / 100;
    if (Math.abs(diff) > BALANCE_TOLERANCE) {
        await ensureCategory(userId, ADJUSTMENT_CATEGORY);
        await addBalanceTransaction(userId, diff, ADJUSTMENT_CATEGORY, 'Ajuste manual de saldo');
    }
    return getBalance(userId);
}

const range = (query: string, params: any[], startDate: string | null, endDate: string | null) => {
    if (startDate) {
        query += ' AND created_at >= ?';
        params.push(startDate);
    }
    if (endDate) {
        query += ' AND created_at <= ?';
        params.push(endDate);
    }
    return query;
};

export async function getBalanceHistory(userId: string, startDate: string | null = null, endDate: string | null = null): Promise<Row[]> {
    const params: any[] = [userId];
    const query = range('SELECT * FROM balance_history WHERE user_id = ? AND deleted_at IS NULL', params, startDate, endDate);
    return db().getAllAsync<Row>(`${query} ORDER BY created_at DESC`, params);
}

export async function getStatisticsData(userId: string, startDate: string | null = null, endDate: string | null = null): Promise<Row[]> {
    const params: any[] = [userId];
    const query = range(`
        SELECT category,
            SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) AS income,
            SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END) AS expense,
            COUNT(*) AS count
        FROM balance_history
        WHERE user_id = ? AND deleted_at IS NULL`, params, startDate, endDate);
    return db().getAllAsync<Row>(`${query} GROUP BY category ORDER BY expense DESC`, params);
}

export async function getCategoryHistory(userId: string, category: string, startDate: string | null = null, endDate: string | null = null): Promise<Row[]> {
    const params: any[] = [userId, category];
    const query = range('SELECT * FROM balance_history WHERE user_id = ? AND category = ? AND deleted_at IS NULL', params, startDate, endDate);
    return db().getAllAsync<Row>(`${query} ORDER BY created_at DESC`, params);
}

// Categorías de la tabla + categorías usadas en el historial (legado).
export async function getDistinctCategories(userId: string): Promise<string[]> {
    const fromTable = await db().getAllAsync<Row>(
        'SELECT name FROM finance_categories WHERE user_id = ? AND deleted_at IS NULL ORDER BY name ASC',
        [userId]
    );
    const fromHistory = await db().getAllAsync<Row>(
        'SELECT DISTINCT category FROM balance_history WHERE user_id = ? AND deleted_at IS NULL ORDER BY category ASC',
        [userId]
    );
    return Array.from(new Set([...fromTable.map((r) => r.name), ...fromHistory.map((r) => r.category)]));
}
