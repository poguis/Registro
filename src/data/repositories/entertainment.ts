import { getConnection, type Row } from '../db/connection';
import { insertRow, updateRow, softDelete, softDeleteWhere, ownerOf } from './rows';
import { deleteSeriesCascade } from './series';
import { getLocalDateString } from '../../services/backlogUtils';

// Categorías de entretenimiento (video/lectura), pausas e historial de cuotas.
// days_of_week y quotas: JSON objeto {"Monday":1,...}; al leer se acepta el array legado.

const db = () => getConnection();

const parseJson = (value: any, fallback: any) => {
    if (typeof value !== 'string') return value ?? fallback;
    try {
        return JSON.parse(value || 'null') ?? fallback;
    } catch {
        return fallback;
    }
};

type CategoryInput = {
    name: string; type: string; startDate: string | null; daysOfWeek: any;
    frequency: number; seriesCount: number | null; description: string | null;
};

export async function addEntertainmentCategory(userId: string, data: CategoryInput): Promise<string> {
    const daysString = JSON.stringify(data.daysOfWeek);
    const categoryId = await insertRow('entertainment_categories', userId, {
        name: data.name,
        type: data.type,
        start_date: data.startDate,
        days_of_week: daysString,
        frequency: data.frequency,
        series_count: data.seriesCount,
        description: data.description,
    });
    // Registro inicial de cuotas
    await insertRow('entertainment_quotas_history', userId, {
        category_id: categoryId,
        quotas: daysString,
        start_date: data.startDate || getLocalDateString(),
    });
    return categoryId;
}

// Agrupa filas por una columna conservando el orden de llegada.
const groupBy = (rows: Row[], key: string): Map<string, Row[]> => {
    const map = new Map<string, Row[]>();
    for (const row of rows) {
        const k = row[key];
        const list = map.get(k);
        if (list) list.push(row);
        else map.set(k, [row]);
    }
    return map;
};

// Categorías con su progreso agregado. Fase 6.5: consultas fijas (antes 1 + 3 por categoría
// + 1 por serie) con el mismo resultado. Mismos filtros que antes (los hijos por category_id /
// series_id y deleted_at IS NULL) y el mismo orden dentro de cada categoría: las cuotas por
// start_date (empates por rowid) y las pausas por rowid, el orden en que SQLite las devolvía.
// La columna de agrupación (category_id / series_id) se lee aparte y no se devuelve.
// Fase 7.4a: totalWatched = filas vivas de historial (watch_history + reading_history) de las
// series vivas de la categoría, TODAS (incluidas pausadas y cerradas, R1): 4 consultas fijas.
const CATEGORY_IDS = 'SELECT id FROM entertainment_categories WHERE user_id = ? AND deleted_at IS NULL';
const HISTORY_ROWS = `SELECT series_id FROM watch_history WHERE deleted_at IS NULL
                      UNION ALL SELECT series_id FROM reading_history WHERE deleted_at IS NULL`;

// Vistos de UNA categoría, leídos de la BD (una consulta). Lo usa el Registro para que la
// cabecera no dependa de una categoría vieja del estado de App.js.
export async function getCategoryWatchedTotal(categoryId: string): Promise<number> {
    const row = await db().getFirstAsync<Row>(
        `SELECT COUNT(*) AS n FROM (${HISTORY_ROWS}) h JOIN series s ON s.id = h.series_id
         WHERE s.category_id = ? AND s.deleted_at IS NULL`,
        [categoryId]
    );
    return row ? row.n : 0;
}

export async function getEntertainmentCategories(userId: string): Promise<Row[]> {
    const categories = await db().getAllAsync<Row>(
        'SELECT * FROM entertainment_categories WHERE user_id = ? AND deleted_at IS NULL ORDER BY created_at DESC',
        [userId]
    );
    if (categories.length === 0) return [];
    const quotasByCategory = groupBy(await db().getAllAsync<Row>(
        `SELECT category_id AS _group, quotas, start_date, end_date FROM entertainment_quotas_history
         WHERE category_id IN (${CATEGORY_IDS}) AND deleted_at IS NULL ORDER BY category_id, start_date ASC, rowid ASC`,
        [userId]
    ), '_group');
    const watchedByCategory = new Map<string, number>();
    for (const r of await db().getAllAsync<Row>(
        `SELECT s.category_id AS _group, COUNT(*) AS n FROM (${HISTORY_ROWS}) h JOIN series s ON s.id = h.series_id
         WHERE s.category_id IN (${CATEGORY_IDS}) AND s.deleted_at IS NULL GROUP BY s.category_id`,
        [userId]
    )) watchedByCategory.set(r._group, r.n);
    const pausesByCategory = groupBy(await db().getAllAsync<Row>(
        `SELECT category_id AS _group, pause_start, pause_end FROM entertainment_pauses
         WHERE category_id IN (${CATEGORY_IDS}) AND deleted_at IS NULL ORDER BY category_id, rowid ASC`,
        [userId]
    ), '_group');
    const strip = ({ _group, ...rest }: Row) => rest;

    return categories.map((cat) => {
        const quotasHistory = (quotasByCategory.get(cat.id) || []).map(strip);
        const totalWatched = watchedByCategory.get(cat.id) || 0;
        const pauses = (pausesByCategory.get(cat.id) || []).map(strip);
        return {
            ...cat,
            days_of_week: parseJson(cat.days_of_week, []),
            totalWatched,
            pauses,
            quotas_history: quotasHistory.map((qh) => ({ ...qh, quotas: parseJson(qh.quotas, {}) })),
            is_paused: pauses.some((p) => !p.pause_end),
        };
    });
}

export async function getCategoryPauses(categoryId: string): Promise<Row[]> {
    return db().getAllAsync<Row>(
        'SELECT * FROM entertainment_pauses WHERE category_id = ? AND deleted_at IS NULL ORDER BY pause_start ASC',
        [categoryId]
    );
}

export async function pauseCategory(categoryId: string, date: string): Promise<void> {
    const active = await db().getFirstAsync<Row>(
        'SELECT id FROM entertainment_pauses WHERE category_id = ? AND pause_end IS NULL AND deleted_at IS NULL',
        [categoryId]
    );
    if (active) return; // ya está pausada
    const userId = await ownerOf('entertainment_categories', categoryId);
    await insertRow('entertainment_pauses', userId, { category_id: categoryId, pause_start: date });
}

export async function resumeCategory(categoryId: string, date: string): Promise<void> {
    const open = await db().getAllAsync<Row>(
        'SELECT id FROM entertainment_pauses WHERE category_id = ? AND pause_end IS NULL AND deleted_at IS NULL',
        [categoryId]
    );
    for (const p of open) await updateRow('entertainment_pauses', p.id, { pause_end: date });
}

export async function getQuotaHistory(categoryId: string): Promise<Row[]> {
    const history = await db().getAllAsync<Row>(
        'SELECT * FROM entertainment_quotas_history WHERE category_id = ? AND deleted_at IS NULL ORDER BY start_date ASC',
        [categoryId]
    );
    return history.map((h) => ({ ...h, quotas: parseJson(h.quotas, {}) }));
}

export async function updateEntertainmentCategory(id: string, data: CategoryInput): Promise<void> {
    const daysString = JSON.stringify(data.daysOfWeek);
    const current = await db().getFirstAsync<Row>(
        'SELECT user_id, days_of_week FROM entertainment_categories WHERE id = ? AND deleted_at IS NULL',
        [id]
    );
    if (current && current.days_of_week !== daysString) {
        const today = getLocalDateString();
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        // 1. Cerrar la cuota vigente (end_date = ayer)
        const open = await db().getAllAsync<Row>(
            'SELECT id FROM entertainment_quotas_history WHERE category_id = ? AND end_date IS NULL AND deleted_at IS NULL',
            [id]
        );
        for (const q of open) await updateRow('entertainment_quotas_history', q.id, { end_date: getLocalDateString(yesterday) });
        // 2. Nueva cuota desde hoy
        await insertRow('entertainment_quotas_history', current.user_id, { category_id: id, quotas: daysString, start_date: today });
    }
    await updateRow('entertainment_categories', id, {
        name: data.name,
        type: data.type,
        start_date: data.startDate,
        days_of_week: daysString,
        frequency: data.frequency,
        series_count: data.seriesCount,
        description: data.description,
    });
}

// Borrado lógico de la categoría y, en cascada, de sus pausas, cuotas, series,
// temporadas e historial. Cada fila con su entrada en la outbox.
export async function deleteEntertainmentCategory(id: string): Promise<void> {
    const series = await db().getAllAsync<Row>(
        'SELECT id FROM series WHERE category_id = ? AND deleted_at IS NULL',
        [id]
    );
    for (const s of series) await deleteSeriesCascade(s.id);
    await softDeleteWhere('entertainment_pauses', 'category_id = ?', [id]);
    await softDeleteWhere('entertainment_quotas_history', 'category_id = ?', [id]);
    await softDelete('entertainment_categories', id);
}
