import { getWatchedCountSinceStart } from '../services/backlogUtils';

// Motor puro de la cola de capítulos/tomos (Fase 7.3). Compartido por el Registro de capítulos
// (video) y el Registro de lectura. Sin React, SQLite, Alert ni db, y sin fechas: devuelve datos
// y decisiones, y la pantalla ejecuta los efectos (alertas, escrituras, recarga).
//
// Comportamiento IDÉNTICO al de las pantallas en d55b5e1 (ChapterRegistryScreen.js:85-133,
// ReadingRegistryScreen.js:58-105), incluidos sus defectos (R1–R14 de
// docs/ENTRETENIMIENTO-ACTUAL.md): se corrigen en la 7.4. Equivalencia: scripts/probar-fase7-3.mjs.

type Row = Record<string, any>;

// Única diferencia real entre las dos pantallas: una temporada con episode_count 0 (o sin
// número). Video toma el valor tal cual (0 → 1 capítulo y pasa a la siguiente temporada);
// lectura usa `|| 999`. Se conserva hasta decidirla en la 7.4 (R15).
export type QueueVariant = 'video' | 'reading';

export type QueueItem = {
    uniqueId: string; seriesId: string; seriesName: string; season: number; episode: number; status: 'pending';
    interleavedOrder?: number; sortOrder?: number;
};

const CLOSED = (status: string) => status === 'Terminado' || status === 'En espera' || status === 'Pausado';

// Capítulos pendientes de una serie, desde el puntero hasta el final (máx. 500).
// Terminado, En espera y Pausado no aportan capítulos.
export function episodesForSeries(series: Row, variant: QueueVariant): QueueItem[] {
    const episodes: QueueItem[] = [];
    const { current_season, current_episode, status, total_seasons } = series;
    if (CLOSED(status)) return [];
    let count = 0, s = current_season || 1, e = current_episode || 1;
    const maxSeason = total_seasons || (series.seasons?.length ? series.seasons[series.seasons.length - 1].season_number : 1);
    while (s <= maxSeason && count < 500) {
        const seasonObj = series.seasons.find((sea: Row) => sea.season_number === s);
        const maxEp = variant === 'video' ? (seasonObj ? seasonObj.episode_count : 999) : (seasonObj?.episode_count || 999);
        episodes.push({ uniqueId: `${series.s_id}-s${s}-e${e}`, seriesId: series.s_id, seriesName: series.s_name, season: s, episode: e, status: 'pending' });
        count++; e++;
        if (e > maxEp) { e = 1; s++; }
    }
    return episodes;
}

// Cola intercalada: una vuelta = 1 capítulo por serie. Orden = (progreso + interleave_offset +
// índice) × 1.000.000 + posición de la serie en la lista; desempata sort_order.
// `watchlist` es lo que devuelve db.getFullWatchlist.
export function buildQueue(watchlist: Row[], variant: QueueVariant): QueueItem[] {
    const all: QueueItem[] = [];
    watchlist.forEach((series, sIndex) => {
        const seriesEpisodes = episodesForSeries(series, variant);
        // Ambos offsets cuentan para el orden; solo cycle_offset cuenta para el atraso.
        const baseCount = getWatchedCountSinceStart(series) + (series.interleave_offset || 0);
        seriesEpisodes.forEach((ep, index) => {
            const BATCH_SIZE = 1000000;
            ep.interleavedOrder = ((baseCount + index) * BATCH_SIZE + sIndex);
            ep.sortOrder = series.sort_order || 0;
            all.push(ep);
        });
    });
    all.sort((a, b) => {
        if (a.interleavedOrder !== b.interleavedOrder) return (a.interleavedOrder as number) - (b.interleavedOrder as number);
        return (a.sortOrder as number) - (b.sortOrder as number);
    });
    return all;
}

export type MarkWatchedDecision =
    | { kind: 'noSeries' }
    | { kind: 'outOfOrder'; first: QueueItem }
    | { kind: 'advance'; next: { season: number; episode: number }; isFinal: boolean };

// Marcar visto un pendiente: solo el primero pendiente de SU serie; calcula el siguiente puntero
// y si era el último capítulo de la última temporada (la pantalla pregunta En espera/Terminado).
export function decideMarkWatched(item: QueueItem, queue: QueueItem[], rawSeries: Row[]): MarkWatchedDecision {
    const series = rawSeries.find((s) => s.s_id === item.seriesId);
    if (!series) return { kind: 'noSeries' };
    const first = queue.find((i) => i.seriesId === item.seriesId && i.status === 'pending');
    if (first && first.uniqueId !== item.uniqueId) return { kind: 'outOfOrder', first };

    const maxEpisodes = series.seasons.find((s: Row) => s.season_number === item.season)?.episode_count || 999;
    let nextS = item.season, nextE = item.episode + 1, isFinal = false;
    if (nextE > maxEpisodes) {
        if (item.season >= series.total_seasons) { isFinal = true; nextE = item.episode; nextS = item.season; }
        else { nextE = 1; nextS++; }
    }
    return { kind: 'advance', next: { season: nextS, episode: nextE }, isFinal };
}
