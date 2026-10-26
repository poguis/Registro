import { getConnection, type Row } from '../db/connection';
import { insertRow, updateRow, softDelete } from './rows';

// Pendientes (películas, series, anime, lectura).
// Enumerados canónicos (DECISIONES.md): se validan aquí; en Postgres serán CHECK (Fase 2).

const db = () => getConnection();

export const BACKLOG_TYPES = ['movie', 'series', 'anime', 'reading'];
export const BACKLOG_STATUSES = ['Pendiente', 'Mirando', 'Terminado'];

const checkType = (type: string) => {
    if (!BACKLOG_TYPES.includes(type)) throw new Error(`Tipo de pendiente no válido: ${type}`);
};
const checkStatus = (status: string) => {
    if (!BACKLOG_STATUSES.includes(status)) throw new Error(`Estado de pendiente no válido: ${status}`);
};

type BacklogInput = {
    type?: string; title: string; year?: number | null; format?: string | null;
    start_year?: number | null; end_year?: number | null; franchise?: string | null;
};

export async function addBacklogItem(userId: string, data: BacklogInput): Promise<string> {
    checkType(data.type as string);
    return insertRow('backlog', userId, {
        type: data.type,
        title: data.title,
        status: 'Pendiente',
        year: data.year ?? null,
        format: data.format ?? null,
        start_year: data.start_year ?? null,
        end_year: data.end_year ?? null,
        franchise: data.franchise || 'Otros',
    });
}

export async function getBacklogItems(
    userId: string, type: string, status: string | null = null,
    sortBy = 'title', order = 'ASC', franchise = 'Todos'
): Promise<Row[]> {
    const allowedSortBy = new Set(['title', 'year_start', 'created_at']);
    const safeSortBy = allowedSortBy.has(sortBy) ? sortBy : 'title';
    const safeOrder = order === 'DESC' ? 'DESC' : 'ASC';
    let sortCol = safeSortBy;
    if (safeSortBy === 'year_start') sortCol = type === 'movie' ? 'year' : 'start_year';

    let query = 'SELECT * FROM backlog WHERE user_id = ? AND type = ? AND deleted_at IS NULL';
    const params: any[] = [userId, type];
    if (status && status !== 'Total') {
        query += ' AND status = ?';
        params.push(status);
    }
    if (franchise && franchise !== 'Todos') {
        query += ' AND franchise = ?';
        params.push(franchise);
    }
    return db().getAllAsync<Row>(`${query} ORDER BY ${sortCol} ${safeOrder}`, params);
}

export async function getBacklogCounts(userId: string, type: string, franchise = 'Todos'): Promise<Record<string, number>> {
    const counts: Record<string, number> = { Pendiente: 0, Mirando: 0, Terminado: 0, Total: 0 };
    let query = 'SELECT status, COUNT(*) AS count FROM backlog WHERE user_id = ? AND type = ? AND deleted_at IS NULL';
    const params: any[] = [userId, type];
    if (franchise && franchise !== 'Todos') {
        query += ' AND franchise = ?';
        params.push(franchise);
    }
    const rows = await db().getAllAsync<Row>(`${query} GROUP BY status`, params);
    let total = 0;
    for (const row of rows) {
        if (Object.prototype.hasOwnProperty.call(counts, row.status)) counts[row.status] = row.count;
        total += row.count;
    }
    counts.Total = total;
    return counts;
}

export async function updateBacklogStatus(id: string, status: string): Promise<void> {
    checkStatus(status);
    await updateRow('backlog', id, { status });
}

export async function updateBacklogItem(id: string, data: BacklogInput): Promise<void> {
    await updateRow('backlog', id, {
        title: data.title,
        year: data.year ?? null,
        format: data.format ?? null,
        start_year: data.start_year ?? null,
        end_year: data.end_year ?? null,
        franchise: data.franchise || 'Otros',
    });
}

export async function deleteBacklogItem(id: string): Promise<void> {
    await softDelete('backlog', id);
}
