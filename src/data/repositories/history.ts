import { getConnection, type Row } from '../db/connection';
import { insertRow, softDelete, ownerOf } from './rows';

// Historial de capítulos vistos (watch_history) y leídos (reading_history).
// watched_at / read_at siguen en epoch ms (INTEGER).

const db = () => getConnection();

type Kind = { table: 'watch_history' | 'reading_history'; tsColumn: 'watched_at' | 'read_at' };
const WATCH: Kind = { table: 'watch_history', tsColumn: 'watched_at' };
const READ: Kind = { table: 'reading_history', tsColumn: 'read_at' };

async function add(kind: Kind, seriesId: string, season: number, episode: number, timestamp: number): Promise<string> {
    const userId = await ownerOf('series', seriesId);
    return insertRow(kind.table, userId, {
        series_id: seriesId, season_number: season, episode_number: episode, [kind.tsColumn]: timestamp,
    });
}

// Borrado lógico de la fila NO borrada más reciente de ese capítulo.
async function remove(kind: Kind, seriesId: string, season: number, episode: number): Promise<void> {
    const row = await db().getFirstAsync<Row>(
        `SELECT id FROM ${kind.table}
         WHERE series_id = ? AND season_number = ? AND episode_number = ? AND deleted_at IS NULL
         ORDER BY ${kind.tsColumn} DESC LIMIT 1`,
        [seriesId, season, episode]
    );
    if (row) await softDelete(kind.table, row.id);
}

async function list(kind: Kind, userId: string, categoryId: string | null): Promise<Row[]> {
    let query = `
        SELECT h.*, s.name AS s_name, s.status AS s_status, s.sort_order AS s_sort_order
        FROM ${kind.table} h
        JOIN series s ON h.series_id = s.id
        JOIN entertainment_categories ec ON s.category_id = ec.id
        WHERE ec.user_id = ? AND h.deleted_at IS NULL AND s.deleted_at IS NULL AND ec.deleted_at IS NULL`;
    const params: any[] = [userId];
    if (categoryId) {
        query += ' AND ec.id = ?';
        params.push(categoryId);
    }
    return db().getAllAsync<Row>(`${query} ORDER BY h.${kind.tsColumn} DESC`, params);
}

// Fase 7.4a: lotes para la grilla ("marcar vistos hasta aquí" / desmarcar). Corren dentro de la
// transacción del llamador (series.markEpisodesWatched / unmarkEpisodes): cada fila con su
// entrada en la outbox (rows.ts).
export type HistoryKind = 'watch' | 'read';
type Ep = { season: number; episode: number };
const kindOf = (kind: HistoryKind): Kind => (kind === 'read' ? READ : WATCH);

export async function addHistoryRows(kind: HistoryKind, seriesId: string, episodes: Ep[], timestamp: number): Promise<number> {
    const k = kindOf(kind);
    const userId = await ownerOf('series', seriesId);
    for (const ep of episodes) {
        await insertRow(k.table, userId, { series_id: seriesId, season_number: ep.season, episode_number: ep.episode, [k.tsColumn]: timestamp });
    }
    return episodes.length;
}

// Borrado lógico de la fila más reciente de cada capítulo (si no hay ninguna, se salta).
export async function removeLatestHistoryRows(kind: HistoryKind, seriesId: string, episodes: Ep[]): Promise<number> {
    const k = kindOf(kind);
    let removed = 0;
    for (const ep of episodes) {
        const row = await db().getFirstAsync<Row>(
            `SELECT id FROM ${k.table}
             WHERE series_id = ? AND season_number = ? AND episode_number = ? AND deleted_at IS NULL
             ORDER BY ${k.tsColumn} DESC LIMIT 1`,
            [seriesId, ep.season, ep.episode]
        );
        if (row) { await softDelete(k.table, row.id); removed++; }
    }
    return removed;
}

export const addHistory = (seriesId: string, season: number, episode: number, timestamp = Date.now()) =>
    add(WATCH, seriesId, season, episode, timestamp);
export const removeHistory = (seriesId: string, season: number, episode: number) =>
    remove(WATCH, seriesId, season, episode);
export const getHistory = (userId: string, categoryId: string | null = null) => list(WATCH, userId, categoryId);

export const addReadingHistory = (seriesId: string, season: number, episode: number, timestamp = Date.now()) =>
    add(READ, seriesId, season, episode, timestamp);
export const removeReadingHistory = (seriesId: string, season: number, episode: number) =>
    remove(READ, seriesId, season, episode);
export const getReadingHistory = (userId: string, categoryId: string | null = null) => list(READ, userId, categoryId);
