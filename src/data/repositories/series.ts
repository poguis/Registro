import { getConnection, type Row } from '../db/connection';
import { insertRow, updateRow, reviveRow, softDelete, softDeleteWhere, ownerOf } from './rows';
import { addHistoryRows, removeLatestHistoryRows, type HistoryKind } from './history';
import { backlogStatusFor, isCompatible, checkSubtype, type NewTitle } from '../../entertainment/link';

// Series (video y lectura) y sus temporadas.

const db = () => getConnection();

// ---------------------------------------------------------------- punto único (Fase 7.5)
// Toda escritura de la tabla series pasa por insertSeriesRow / updateSeriesRow (y el borrado por
// deleteSeriesRows). Si cambia el estado (o nace una serie vinculada), el título de Pendiente
// vinculado se recalcula en la MISMA transacción (reflectLinkedBacklogStatus). scripts/probar-fase7-5
// lo comprueba de forma estática: ninguna otra función escribe series ni el status/title/borrado
// de backlog.

// Estado de Pendiente del título según sus series VIVAS vinculadas (backlogStatusFor). Escribe solo
// si cambia (sin entrada de outbox de más). Un título borrado o que aún no llegó por la sync no se
// toca; tampoco uno sin series vivas (se comporta como sin vínculo). Devuelve si escribió.
export async function reflectLinkedBacklogStatus(backlogId: string | null | undefined): Promise<boolean> {
    if (!backlogId) return false;
    const title = await db().getFirstAsync<Row>('SELECT id, status FROM backlog WHERE id = ? AND deleted_at IS NULL', [backlogId]);
    if (!title) return false;
    const live = await db().getAllAsync<Row>('SELECT status FROM series WHERE backlog_id = ? AND deleted_at IS NULL', [backlogId]);
    const next = backlogStatusFor(live.map((s) => s.status));
    if (!next || next === title.status) return false;
    return updateRow('backlog', backlogId, { status: next });
}

// D4: el nombre de la serie y el título de Pendiente vinculado se mantienen iguales.
export async function setLinkedBacklogTitle(backlogId: string | null | undefined, title: string): Promise<boolean> {
    if (!backlogId) return false;
    const row = await db().getFirstAsync<Row>('SELECT title FROM backlog WHERE id = ? AND deleted_at IS NULL', [backlogId]);
    if (!row || row.title === title) return false;
    return updateRow('backlog', backlogId, { title });
}

// Título nuevo creado desde Series/Lectura (D8): nace en Pendiente y la serie lo pasa a Mirando
// (o Terminado) al insertarse (insertSeriesRow → reflectLinkedBacklogStatus).
async function insertLinkedBacklogTitle(userId: string, title: string, newTitle: NewTitle): Promise<string> {
    if (!checkSubtype(newTitle.type, newTitle.subtype)) throw new Error('Subtipo de lectura no válido');
    return insertRow('backlog', userId, {
        type: newTitle.type, title, status: 'Pendiente', year: null, format: '24 min',
        start_year: newTitle.start_year ?? null, end_year: null, franchise: 'Otros', subtype: newTitle.subtype ?? null,
    });
}

async function insertSeriesRow(userId: string, values: Row): Promise<string> {
    const id = await insertRow('series', userId, values);
    if (values.backlog_id) await reflectLinkedBacklogStatus(values.backlog_id);
    return id;
}

export async function updateSeriesRow(seriesId: string, values: Row): Promise<boolean> {
    const changed = await updateRow('series', seriesId, values);
    if (changed && Object.prototype.hasOwnProperty.call(values, 'status')) {
        const row = await db().getFirstAsync<Row>('SELECT backlog_id FROM series WHERE id = ? AND deleted_at IS NULL', [seriesId]);
        if (row && row.backlog_id) await reflectLinkedBacklogStatus(row.backlog_id);
    }
    return changed;
}

// Borrado lógico de una serie con sus temporadas e historial (cada fila a la outbox). No toca el
// título: lo deciden deleteSeriesCascade y deleteTitleCascade.
async function deleteSeriesRows(seriesId: string): Promise<void> {
    await softDeleteWhere('seasons', 'series_id = ?', [seriesId]);
    await softDeleteWhere('watch_history', 'series_id = ?', [seriesId]);
    await softDeleteWhere('reading_history', 'series_id = ?', [seriesId]);
    await softDelete('series', seriesId);
}

async function softDeleteLinkedTitle(backlogId: string): Promise<void> {
    await softDelete('backlog', backlogId);
}

// Borrar un título vinculado desde Pendiente: sus series vivas (con temporadas e historial) y el
// título, sin recursión (deleteSeriesRows no vuelve a tocar el título).
export async function deleteTitleCascade(backlogId: string): Promise<void> {
    const live = await db().getAllAsync<Row>('SELECT id FROM series WHERE backlog_id = ? AND deleted_at IS NULL', [backlogId]);
    for (const s of live) await deleteSeriesRows(s.id);
    await softDeleteLinkedTitle(backlogId);
}

// Nombre de la serie viva vinculada a un título (D4, editar el título en Pendiente).
export async function setLinkedSeriesName(backlogId: string, name: string): Promise<number> {
    const live = await db().getAllAsync<Row>('SELECT id, name FROM series WHERE backlog_id = ? AND deleted_at IS NULL', [backlogId]);
    let n = 0;
    for (const s of live) if (s.name !== name && await updateSeriesRow(s.id, { name })) n++;
    return n;
}

// Reconciliación tras la sync (D2): con "gana la última escritura" por fila, un título vinculado
// puede quedar con el estado viejo (p. ej. otro dispositivo editó el título y subió la fila entera
// mientras este cambiaba la serie). Recalcula todos los títulos con series vivas vinculadas y
// escribe solo los desalineados. Devuelve cuántos corrigió (0 = no escribió nada).
export async function reconcileLinkedTitles(userId: string): Promise<number> {
    const ids = await db().getAllAsync<Row>(
        'SELECT DISTINCT backlog_id FROM series WHERE user_id = ? AND backlog_id IS NOT NULL AND deleted_at IS NULL',
        [userId]
    );
    let n = 0;
    for (const r of ids) if (await reflectLinkedBacklogStatus(r.backlog_id)) n++;
    return n;
}

// Fase 7.4a: el historial es la fuente de verdad del progreso. `watched_count` = filas vivas de
// watch_history + reading_history de la serie; va como subconsulta dentro de la misma consulta
// (cantidad fija de consultas, sin N+1).
const WATCHED_COUNT = (alias: string) => `(
            (SELECT COUNT(*) FROM watch_history wh WHERE wh.series_id = ${alias}.id AND wh.deleted_at IS NULL)
          + (SELECT COUNT(*) FROM reading_history rh WHERE rh.series_id = ${alias}.id AND rh.deleted_at IS NULL)
        )`;
const WATCHED_COUNT_S = WATCHED_COUNT('s');
const WATCHED_COUNT_SERIES = WATCHED_COUNT('series');

// Estados canónicos (DECISIONES.md). 'Terminada'/'Pausada' se mapean por si aparecieran.
export const SERIES_STATUSES = ['Nueva', 'Mirando', 'Pausado', 'En espera', 'Terminado'];
const LEGACY_STATUS: Record<string, string> = { Terminada: 'Terminado', Pausada: 'Pausado' };
export const normalizeSeriesStatus = (status: string): string => {
    const s = LEGACY_STATUS[status] || status;
    if (!SERIES_STATUSES.includes(s)) throw new Error(`Estado de serie no válido: ${status}`);
    return s;
};

type SeasonInput = { season_number: number; episode_count: number };

// Fase 7.5: linked_title_alive = 1 si la serie está vinculada y su título de Pendiente ya está vivo en
// el celular (un título que todavía no llegó por la sync no cuenta: la serie se ve sin vínculo).
export async function getSeriesByCategory(categoryId: string): Promise<Row[]> {
    return db().getAllAsync<Row>(
        `SELECT s.*, ${WATCHED_COUNT_S} AS watched_count,
                (s.backlog_id IS NOT NULL AND EXISTS (SELECT 1 FROM backlog b WHERE b.id = s.backlog_id AND b.deleted_at IS NULL)) AS linked_title_alive
         FROM series s WHERE s.category_id = ? AND s.deleted_at IS NULL ORDER BY s.sort_order ASC, s.created_at DESC`,
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

// Fase 7.5: `link` opcional. { backlogId }: vincular un título existente de Pendiente (vivo, en
// Pendiente, de tipo compatible y sin serie viva vinculada; si el nombre se editó en el formulario,
// el título se actualiza igual, D4). { newTitle }: crear el título nuevo en Pendiente (D8). Sin
// `link`: serie sin vínculo, como en la 1.3.9. Todo en la transacción del llamador.
export type SeriesLink = { backlogId: string } | { newTitle: NewTitle } | null | undefined;

export async function addSeriesWithSeasons(seriesData: Row, seasonsData: SeasonInput[], link: SeriesLink = null): Promise<string> {
    const { category_id, name, description, status, current_season, current_episode, total_seasons } = seriesData;
    const userId = await ownerOf('entertainment_categories', category_id);
    let backlogId: string | null = null;
    if (link && 'backlogId' in link && link.backlogId) {
        const category = await db().getFirstAsync<Row>('SELECT type FROM entertainment_categories WHERE id = ? AND deleted_at IS NULL', [category_id]);
        const title = await db().getFirstAsync<Row>('SELECT id, type, status, title FROM backlog WHERE id = ? AND deleted_at IS NULL', [link.backlogId]);
        const taken = title
            ? await db().getFirstAsync<Row>('SELECT id FROM series WHERE backlog_id = ? AND deleted_at IS NULL', [link.backlogId])
            : null;
        if (!title || title.status !== 'Pendiente' || !category || !isCompatible(title.type, category.type) || taken) {
            throw new Error('El título ya no está disponible en Pendiente');
        }
        backlogId = title.id;
        await setLinkedBacklogTitle(backlogId, name);
    } else if (link && 'newTitle' in link && link.newTitle) {
        backlogId = await insertLinkedBacklogTitle(userId, name, link.newTitle);
    }
    const maxOrder = await db().getFirstAsync<Row>(
        'SELECT MAX(sort_order) AS maxOrder FROM series WHERE category_id = ? AND deleted_at IS NULL',
        [category_id]
    );
    const nextOrder = ((maxOrder && maxOrder.maxOrder) || 0) + 1;
    const seriesId = await insertSeriesRow(userId, {
        category_id, name, description,
        status: normalizeSeriesStatus(status || 'Nueva'),
        current_season, current_episode,
        initial_season: current_season, initial_episode: current_episode,
        total_seasons, sort_order: nextOrder,
        cycle_offset: seriesData.cycle_offset || 0,
        interleave_offset: seriesData.interleave_offset || 0,
        last_watched_at: 0,
        backlog_id: backlogId,
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
    await updateSeriesRow(seriesId, values);
    if (current.backlog_id && seriesData.name !== current.name) await setLinkedBacklogTitle(current.backlog_id, seriesData.name);
    await upsertSeasons(current.user_id, seriesId, seasonsData);
    return true;
}

export async function updateSeriesSortOrder(seriesId: string, newOrder: number): Promise<void> {
    await updateSeriesRow(seriesId, { sort_order: newOrder });
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
    await updateSeriesRow(seriesId, values);
}

// Grilla, hacia adelante (Fase 7.4a, R7): una fila de historial por capítulo y el puntero/estado,
// en la transacción del llamador (la fachada lo envuelve en UNA mutate).
export async function markEpisodesWatched(
    seriesId: string, kind: HistoryKind, episodes: { season: number; episode: number }[], timestamp: number,
    progress: { season: number; episode: number; status: string }
): Promise<void> {
    await addHistoryRows(kind, seriesId, episodes, timestamp);
    await updateSeriesProgress(seriesId, progress.season, progress.episode, progress.status, null, timestamp);
}

// Grilla, hacia atrás: borra lógicamente la fila más reciente de cada capítulo y fija el
// puntero/estado (last_watched_at = 0, como al desmarcar en el Registro).
export async function unmarkEpisodes(
    seriesId: string, kind: HistoryKind, episodes: { season: number; episode: number }[],
    progress: { season: number; episode: number; status: string }
): Promise<void> {
    await removeLatestHistoryRows(kind, seriesId, episodes);
    await updateSeriesProgress(seriesId, progress.season, progress.episode, progress.status, null, 0);
}

// Reinicia la serie: cycle_offset se escribe como valor ABSOLUTO (idempotente ante reintentos).
// Desde la 7.4a cycle_offset ya no cuenta (los vistos salen del historial).
export async function restartSeries(seriesId: string, totalEpisodes: number): Promise<void> {
    const current = await db().getFirstAsync<Row>(
        'SELECT cycle_offset FROM series WHERE id = ? AND deleted_at IS NULL',
        [seriesId]
    );
    if (!current) throw new Error('Serie no encontrada');
    await updateSeriesRow(seriesId, {
        cycle_offset: (current.cycle_offset || 0) + totalEpisodes,
        current_season: 1,
        current_episode: 1,
        status: 'Mirando',
    });
}

// Borrado lógico de la serie con sus temporadas e historial (cada fila a la outbox) y, si está
// vinculada, también su título de Pendiente (Fase 7.5: se borra en los dos lados; también al borrar
// la categoría, D5).
export async function deleteSeriesCascade(seriesId: string): Promise<void> {
    const row = await db().getFirstAsync<Row>('SELECT backlog_id FROM series WHERE id = ? AND deleted_at IS NULL', [seriesId]);
    await deleteSeriesRows(seriesId);
    if (row && row.backlog_id) await softDeleteLinkedTitle(row.backlog_id);
}

export async function getFullWatchlist(userId: string, categoryId: string | null = null): Promise<Row[]> {
    let query = `
        SELECT
            series.id AS s_id, series.name AS s_name, series.status,
            series.current_season, series.current_episode, series.initial_season, series.initial_episode,
            series.total_seasons, series.sort_order, series.cycle_offset, series.interleave_offset, series.last_watched_at,
            ${WATCHED_COUNT_SERIES} AS watched_count,
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
