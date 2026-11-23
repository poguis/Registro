import { getConnection, type Row } from '../db/connection';
import { insertRow, updateRow } from './rows';
import { deleteTitleCascade, setLinkedSeriesName } from './series';
import { allowedManualStatuses, checkSubtype, compatibleBacklogTypes, selectorCandidates } from '../../entertainment/link';

// Pendientes (películas, series, anime, lectura).
// Enumerados canónicos (DECISIONES.md): se validan aquí; en Postgres son CHECK (Fase 2; el
// subtipo desde la 7.5).
// Fase 7.5: un título puede estar vinculado a una serie (series.backlog_id). Su estado lo mueve la
// serie (src/data/repositories/series.ts, reflectLinkedBacklogStatus); el borrado va en los dos
// lados (deleteTitleCascade) y el nombre se mantiene igual al de la serie (D4).

const db = () => getConnection();

// Serie viva vinculada (la más reciente si hubiera dos): id, estado y nombre de su categoría.
const LINKED = (alias: string) => `
    (SELECT s.id FROM series s WHERE s.backlog_id = ${alias}.id AND s.deleted_at IS NULL ORDER BY s.updated_at DESC, s.id LIMIT 1) AS linked_series_id,
    (SELECT s.status FROM series s WHERE s.backlog_id = ${alias}.id AND s.deleted_at IS NULL ORDER BY s.updated_at DESC, s.id LIMIT 1) AS linked_series_status,
    (SELECT c.name FROM series s JOIN entertainment_categories c ON c.id = s.category_id
      WHERE s.backlog_id = ${alias}.id AND s.deleted_at IS NULL ORDER BY s.updated_at DESC, s.id LIMIT 1) AS linked_category_name`;

const LINKED_B = LINKED('b');

const checkSubtypeOf = (type: string, subtype: string | null | undefined) => {
    if (!checkSubtype(type, subtype)) throw new Error(`Subtipo de lectura no válido: ${subtype}`);
};

// Título vivo con su vínculo (o null).
async function getItemWithLink(id: string): Promise<Row | null> {
    return db().getFirstAsync<Row>(`SELECT b.*, ${LINKED_B} FROM backlog b WHERE b.id = ? AND b.deleted_at IS NULL`, [id]);
}

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
    start_year?: number | null; end_year?: number | null; franchise?: string | null; subtype?: string | null;
};

export async function addBacklogItem(userId: string, data: BacklogInput): Promise<string> {
    checkType(data.type as string);
    checkSubtypeOf(data.type as string, data.subtype);
    return insertRow('backlog', userId, {
        type: data.type,
        title: data.title,
        status: 'Pendiente',
        year: data.year ?? null,
        format: data.format ?? null,
        start_year: data.start_year ?? null,
        end_year: data.end_year ?? null,
        franchise: data.franchise || 'Otros',
        subtype: data.subtype ?? null,
    });
}

// Fase 7.5: `subtype` filtra la pestaña de lectura ('Todos' = sin filtro); cada fila trae su
// vínculo (linked_series_id, linked_series_status, linked_category_name).
export async function getBacklogItems(
    userId: string, type: string, status: string | null = null,
    sortBy = 'title', order = 'ASC', franchise = 'Todos', subtype = 'Todos'
): Promise<Row[]> {
    const allowedSortBy = new Set(['title', 'year_start', 'created_at']);
    const safeSortBy = allowedSortBy.has(sortBy) ? sortBy : 'title';
    const safeOrder = order === 'DESC' ? 'DESC' : 'ASC';
    let sortCol = safeSortBy;
    if (safeSortBy === 'year_start') sortCol = type === 'movie' ? 'year' : 'start_year';

    let query = `SELECT b.*, ${LINKED_B} FROM backlog b WHERE b.user_id = ? AND b.type = ? AND b.deleted_at IS NULL`;
    const params: any[] = [userId, type];
    if (status && status !== 'Total') {
        query += ' AND b.status = ?';
        params.push(status);
    }
    if (franchise && franchise !== 'Todos') {
        query += ' AND b.franchise = ?';
        params.push(franchise);
    }
    if (subtype && subtype !== 'Todos') {
        query += ' AND b.subtype = ?';
        params.push(subtype);
    }
    return db().getAllAsync<Row>(`${query} ORDER BY b.${sortCol} ${safeOrder}`, params);
}

export async function getBacklogCounts(userId: string, type: string, franchise = 'Todos', subtype = 'Todos'): Promise<Record<string, number>> {
    const counts: Record<string, number> = { Pendiente: 0, Mirando: 0, Terminado: 0, Total: 0 };
    let query = 'SELECT status, COUNT(*) AS count FROM backlog WHERE user_id = ? AND type = ? AND deleted_at IS NULL';
    const params: any[] = [userId, type];
    if (franchise && franchise !== 'Todos') {
        query += ' AND franchise = ?';
        params.push(franchise);
    }
    if (subtype && subtype !== 'Todos') {
        query += ' AND subtype = ?';
        params.push(subtype);
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

// Candidatos del selector "De Pendiente" de una categoría (video: serie y anime; lectura: lectura):
// vivos, en Pendiente y sin serie viva vinculada (selectorCandidates). El orden lo elige la pantalla
// (sortCandidates).
export async function getBacklogCandidates(userId: string, categoryType: string): Promise<Row[]> {
    const types = compatibleBacklogTypes(categoryType);
    if (types.length === 0) return [];
    const rows = await db().getAllAsync<Row>(
        `SELECT b.*, ${LINKED_B} FROM backlog b
         WHERE b.user_id = ? AND b.deleted_at IS NULL AND b.status = 'Pendiente' AND b.type IN (${types.map(() => '?').join(', ')})`,
        [userId, ...types]
    );
    return selectorCandidates(rows, categoryType);
}

// Estado a mano (D6): película, los tres; sin vínculo (serie, anime, lectura), Pendiente o
// Terminado; vinculado, ninguno (lo mueve la serie).
export async function updateBacklogStatus(id: string, status: string): Promise<void> {
    checkStatus(status);
    const item = await getItemWithLink(id);
    if (!item) return;
    if (!allowedManualStatuses(item).includes(status)) {
        throw new Error(item.linked_series_id
            ? 'El estado de un título vinculado lo cambia su serie'
            : `Estado no permitido a mano para este título: ${status}`);
    }
    await updateRow('backlog', id, { status });
}

// Edición del título. D4: si está vinculado y cambió el título, el nombre de la serie se actualiza
// en la misma transacción. El tipo no se edita; el subtipo sí (solo lectura).
export async function updateBacklogItem(id: string, data: BacklogInput): Promise<void> {
    const item = await getItemWithLink(id);
    if (!item) return;
    checkSubtypeOf(item.type, data.subtype);
    await updateRow('backlog', id, {
        title: data.title,
        year: data.year ?? null,
        format: data.format ?? null,
        start_year: data.start_year ?? null,
        end_year: data.end_year ?? null,
        franchise: data.franchise || 'Otros',
        subtype: data.subtype ?? null,
    });
    if (item.linked_series_id && data.title !== item.title) await setLinkedSeriesName(id, data.title);
}

// Borrado en los dos lados: el título y, si está vinculado, su serie con temporadas e historial.
export async function deleteBacklogItem(id: string): Promise<void> {
    await deleteTitleCascade(id);
}

// Títulos de Pendiente vinculados a series vivas de una categoría (texto de D5 al borrarla).
export async function countLinkedTitlesInCategory(categoryId: string): Promise<number> {
    const row = await db().getFirstAsync<Row>(
        `SELECT COUNT(DISTINCT s.backlog_id) AS n FROM series s JOIN backlog b ON b.id = s.backlog_id AND b.deleted_at IS NULL
         WHERE s.category_id = ? AND s.deleted_at IS NULL`,
        [categoryId]
    );
    return row ? row.n : 0;
}
