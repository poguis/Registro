import { getConnection, type Row } from '../db/connection';
import { insertRow, updateRow, reviveRow, softDelete, softDeleteWhere, ownerOf } from './rows';

// Series (video y lectura) y sus temporadas.

const db = () => getConnection();

// Estados canónicos (DECISIONES.md). 'Terminada'/'Pausada' se mapean por si aparecieran.
export const SERIES_STATUSES = ['Nueva', 'Mirando', 'Pausado', 'En espera', 'Terminado'];
const LEGACY_STATUS: Record<string, string> = { Terminada: 'Terminado', Pausada: 'Pausado' };
export const normalizeSeriesStatus = (status: string): string => {
    const s = LEGACY_STATUS[status] || status;
    if (!SERIES_STATUSES.includes(s)) throw new Error(`Estado de serie no válido: ${status}`);
    return s;
};

type SeasonInput = { season_number: number; episode_count: number };

export async function getSeriesByCategory(categoryId: string): Promise<Row[]> {
    return db().getAllAsync<Row>(
        'SELECT * FROM series WHERE category_id = ? AND deleted_at IS NULL ORDER BY sort_order ASC, created_at DESC',
        [categoryId]
    );
}

export async function getSeasonsBySeries(seriesId: string): Promise<Row[]> {
    return db().getAllAsync<Row>(
        'SELECT * FROM seasons WHERE series_id = ? AND deleted_at IS NULL ORDER BY season_number ASC',
        [seriesId]
    );
}

// Upsert por (series_id, season_number): actualiza, revive (si estaba borrada) o crea;
// las temporadas que ya no vienen se borran lógicamente.
async function upsertSeasons(userId: string, seriesId: string, seasonsData: SeasonInput[]): Promise<void> {
    const incoming = new Set<number>();
    for (const season of seasonsData || []) {
        incoming.add(season.season_number);
        const existing = await db().getFirstAsync<Row>(
            'SELECT id, episode_count, deleted_at FROM seasons WHERE series_id = ? AND season_number = ?',
            [seriesId, season.season_number]
        );
        if (!existing) {
            await insertRow('seasons', userId, {
                series_id: seriesId, season_number: season.season_number, episode_count: season.episode_count,
            });
        } else if (existing.deleted_at) {
            await reviveRow('seasons', existing.id, { episode_count: season.episode_count });
        } else if (existing.episode_count !== season.episode_count) {
            await updateRow('seasons', existing.id, { episode_count: season.episode_count });
        }
    }
    const alive = await db().getAllAsync<Row>(
        'SELECT id, season_number FROM seasons WHERE series_id = ? AND deleted_at IS NULL',
        [seriesId]
    );
    for (const s of alive) if (!incoming.has(s.season_number)) await softDelete('seasons', s.id);
}

export async function addSeriesWithSeasons(seriesData: Row, seasonsData: SeasonInput[]): Promise<string> {
    const { category_id, name, description, status, current_season, current_episode, total_seasons } = seriesData;
    const userId = await ownerOf('entertainment_categories', category_id);
    const maxOrder = await db().getFirstAsync<Row>(
        'SELECT MAX(sort_order) AS maxOrder FROM series WHERE category_id = ? AND deleted_at IS NULL',
        [category_id]
    );
    const nextOrder = ((maxOrder && maxOrder.maxOrder) || 0) + 1;
    const seriesId = await insertRow('series', userId, {
        category_id, name, description,
        status: normalizeSeriesStatus(status || 'Nueva'),
        current_season, current_episode,
        initial_season: current_season, initial_episode: current_episode,
        total_seasons, sort_order: nextOrder,
        cycle_offset: seriesData.cycle_offset || 0,
        interleave_offset: seriesData.interleave_offset || 0,
        last_watched_at: 0,
    });
    await upsertSeasons(userId, seriesId, seasonsData);
    return seriesId;
}

// Devuelve false si la serie no existe.
export async function updateSeriesWithSeasons(seriesId: string, seriesData: Row, seasonsData: SeasonInput[]): Promise<boolean> {
    const current = await db().getFirstAsync<Row>('SELECT * FROM series WHERE id = ? AND deleted_at IS NULL', [seriesId]);
    if (!current) return false;
    const values: Row = {
        name: seriesData.name,
        description: seriesData.description,
        total_seasons: seriesData.total_seasons,
    };
    if (seriesData.status) values.status = normalizeSeriesStatus(seriesData.status);
    if (seriesData.current_season !== undefined) values.current_season = seriesData.current_season;
    if (seriesData.current_episode !== undefined) values.current_episode = seriesData.current_episode;
    await updateRow('series', seriesId, values);
    await upsertSeasons(current.user_id, seriesId, seasonsData);
    return true;
}

export async function updateSeriesSortOrder(seriesId: string, newOrder: number): Promise<void> {
    await updateRow('series', seriesId, { sort_order: newOrder });
}

export async function updateSeriesProgress(
    seriesId: string, currentSeason: number, currentEpisode: number, status: string | null = null,
    customSortOrder: number | null = null, customLastWatchedAt?: number, cycleOffset?: number, interleaveOffset?: number
): Promise<void> {
    const values: Row = {
        current_season: currentSeason,
        current_episode: currentEpisode,
        last_watched_at: customLastWatchedAt !== undefined ? customLastWatchedAt : Date.now(),
    };
    if (status) values.status = normalizeSeriesStatus(status);
    if (customSortOrder !== null) values.sort_order = customSortOrder;
    if (cycleOffset !== undefined) values.cycle_offset = cycleOffset;
    if (interleaveOffset !== undefined) values.interleave_offset = interleaveOffset;
    await updateRow('series', seriesId, values);
}

// Reinicia la serie: cycle_offset se escribe como valor ABSOLUTO (idempotente ante reintentos).
export async function restartSeries(seriesId: string, totalEpisodes: number): Promise<void> {
    const current = await db().getFirstAsync<Row>(
        'SELECT cycle_offset FROM series WHERE id = ? AND deleted_at IS NULL',
        [seriesId]
    );
    if (!current) throw new Error('Serie no encontrada');
    await updateRow('series', seriesId, {
        cycle_offset: (current.cycle_offset || 0) + totalEpisodes,
        current_season: 1,
        current_episode: 1,
        status: 'Mirando',
    });
}

// Borrado lógico de la serie con sus temporadas e historial (cada fila a la outbox).
export async function deleteSeriesCascade(seriesId: string): Promise<void> {
    await softDeleteWhere('seasons', 'series_id = ?', [seriesId]);
    await softDeleteWhere('watch_history', 'series_id = ?', [seriesId]);
    await softDeleteWhere('reading_history', 'series_id = ?', [seriesId]);
    await softDelete('series', seriesId);
}

export async function getFullWatchlist(userId: string, categoryId: string | null = null): Promise<Row[]> {
    let query = `
        SELECT
            series.id AS s_id, series.name AS s_name, series.status,
            series.current_season, series.current_episode, series.initial_season, series.initial_episode,
            series.total_seasons, series.sort_order, series.cycle_offset, series.interleave_offset, series.last_watched_at,
            entertainment_categories.id AS c_id, entertainment_categories.start_date,
            entertainment_categories.frequency, entertainment_categories.days_of_week, entertainment_categories.type
        FROM series
        INNER JOIN entertainment_categories ON series.category_id = entertainment_categories.id
        WHERE entertainment_categories.user_id = ?
          AND series.deleted_at IS NULL AND entertainment_categories.deleted_at IS NULL`;
    const params: any[] = [userId];
    if (categoryId) {
        query += ' AND entertainment_categories.id = ?';
        params.push(categoryId);
    }
    query += " AND (series.status = 'Nueva' OR series.status = 'Mirando' OR series.status = 'En espera' OR series.status = 'Terminado')";
    query += ' ORDER BY series.sort_order ASC, series.last_watched_at ASC, series.created_at DESC';

    const rows = await db().getAllAsync<Row>(query, params);
    const data: Row[] = [];
    for (const s of rows) {
        const seasons = await getSeasonsBySeries(s.s_id);
        let days: any = [];
        try {
            days = typeof s.days_of_week === 'string' ? JSON.parse(s.days_of_week) : s.days_of_week;
        } catch {
            days = [];
        }
        data.push({ ...s, seasons, days_of_week: days });
    }
    return data;
}
