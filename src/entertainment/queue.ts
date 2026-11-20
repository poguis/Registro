// Motor puro de la cola de capítulos/tomos. Compartido por el Registro de capítulos (video) y el
// Registro de lectura. Sin React, SQLite, Alert ni db, y sin fechas: devuelve datos y decisiones,
// y la pantalla ejecuta los efectos (alertas, escrituras, recarga).
//
// Fase 7.3: comportamiento idéntico a d55b5e1. Fase 7.4a (cambios a propósito, ver
// claude/DISENO-ENTRETENIMIENTO.md y scripts/probar-fase7-4a.mjs):
// - los vistos de una serie son sus filas vivas de historial (`watched_count`, que trae la fachada);
// - una temporada con 0 capítulos (o sin número) se salta, igual en video y en lectura (R15);
// - una temporada que FALTA entre las guardadas (el formulario descarta las vacías y conserva la
//   numeración: T1, T3) también se salta, y la serie termina en la temporada de número más alto
//   (hueco, hallazgo de la 7.4a); los 999 capítulos quedan solo para una serie sin temporadas;
// - "último capítulo" = no hay siguiente (saltando temporadas vacías o que faltan).

type Row = Record<string, any>;

export type QueueItem = {
    uniqueId: string; seriesId: string; seriesName: string; season: number; episode: number; status: 'pending';
    interleavedOrder?: number; sortOrder?: number;
};
export type EpisodeRef = { season: number; episode: number };

const CLOSED = (status: string) => status === 'Terminado' || status === 'En espera' || status === 'Pausado';

// Vistos de una serie = filas vivas de watch_history / reading_history (columna calculada
// `watched_count` de getSeriesByCategory / getFullWatchlist).
export const watchedCount = (series: Row): number => series.watched_count || 0;

// Capítulos de una temporada: 0 si no tiene o si falta entre las guardadas (se salta); 999 solo si
// la serie no tiene ninguna fila de temporadas (como antes).
const hasSeasonRows = (series: Row): boolean => Array.isArray(series.seasons) && series.seasons.length > 0;
const episodesInSeason = (series: Row, s: number): number => {
    if (!hasSeasonRows(series)) return 999;
    const seasonObj = series.seasons.find((sea: Row) => sea.season_number === s);
    return seasonObj ? (seasonObj.episode_count || 0) : 0;
};
// Última temporada: la de número más alto entre las guardadas; sin filas, total_seasons (o 1).
const maxSeasonOf = (series: Row): number =>
    hasSeasonRows(series) ? Math.max(...series.seasons.map((sea: Row) => sea.season_number || 0)) : (series.total_seasons || 1);

// Primer capítulo válido en (s, e) o después, saltando temporadas vacías; null si no hay.
function firstValidFrom(series: Row, s: number, e: number): EpisodeRef | null {
    const maxSeason = maxSeasonOf(series);
    while (s <= maxSeason) {
        const n = episodesInSeason(series, s);
        if (e <= n) return { season: s, episode: e };
        s++; e = 1;
    }
    return null;
}

// Siguiente capítulo después de (s, e); null si (s, e) es el último.
export const nextEpisode = (series: Row, s: number, e: number): EpisodeRef | null => firstValidFrom(series, s, e + 1);

export const isBefore = (a: EpisodeRef, b: EpisodeRef) => a.season < b.season || (a.season === b.season && a.episode < b.episode);

// Capítulos desde `from` hasta `to`, ambos incluidos, saltando temporadas vacías (máx. 2000).
export function episodesInRange(series: Row, from: EpisodeRef, to: EpisodeRef): EpisodeRef[] {
    const out: EpisodeRef[] = [];
    let cur = firstValidFrom(series, from.season, from.episode);
    while (cur && !isBefore(to, cur) && out.length < 2000) {
        out.push(cur);
        cur = nextEpisode(series, cur.season, cur.episode);
    }
    return out;
}

// Capítulos pendientes de una serie, desde el puntero hasta el final (máx. 500).
// Terminado, En espera y Pausado no aportan capítulos. Mismo recorrido que en la 7.3 (el puntero
// se toma tal cual); lo único nuevo es que una temporada con 0 capítulos se salta (R15).
export function episodesForSeries(series: Row): QueueItem[] {
    const episodes: QueueItem[] = [];
    if (CLOSED(series.status)) return [];
    let count = 0, s = series.current_season || 1, e = series.current_episode || 1;
    const maxSeason = maxSeasonOf(series);
    while (s <= maxSeason && count < 500) {
        const maxEp = episodesInSeason(series, s);
        if (maxEp === 0) { s++; e = 1; continue; }
        episodes.push({ uniqueId: `${series.s_id}-s${s}-e${e}`, seriesId: series.s_id, seriesName: series.s_name, season: s, episode: e, status: 'pending' });
        count++; e++;
        if (e > maxEp) { e = 1; s++; }
    }
    return episodes;
}

// Progreso de orden: vistos + interleave_offset (el offset solo ordena; puede ser negativo).
export const orderProgress = (series: Row): number => watchedCount(series) + (series.interleave_offset || 0);

// Cola intercalada: una vuelta = 1 capítulo por serie. El k-ésimo pendiente de una serie va en la
// vuelta progreso + k; dentro de una vuelta se ordena por la posición de la serie en la lista
// (getFullWatchlist ordena por sort_order) y desempata sort_order.
export function buildQueue(watchlist: Row[]): QueueItem[] {
    const all: QueueItem[] = [];
    watchlist.forEach((series, sIndex) => {
        const seriesEpisodes = episodesForSeries(series);
        const baseCount = orderProgress(series);
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

// Ciclo actual (r0): la vuelta del primero de la cola = el menor progreso de orden entre las
// series que están en la cola (Nueva o Mirando con al menos un pendiente). null si no hay
// ninguna. Acepta series con `seasons` y `watched_count` (detalle o getFullWatchlist).
export function currentRound(seriesList: Row[]): number | null {
    let r0: number | null = null;
    for (const s of seriesList) {
        if (s.status !== 'Nueva' && s.status !== 'Mirando') continue;
        if (episodesForSeries({ ...s, s_id: s.s_id ?? s.id }).length === 0) continue;
        const p = orderProgress(s);
        if (r0 === null || p < r0) r0 = p;
    }
    return r0;
}

export type MarkWatchedDecision =
    | { kind: 'noSeries' }
    | { kind: 'outOfOrder'; first: QueueItem }
    | { kind: 'advance'; next: { season: number; episode: number }; isFinal: boolean };

// Marcar visto un pendiente: solo el primero pendiente de SU serie; calcula el siguiente puntero
// y si era el último capítulo (la pantalla pregunta En espera/Terminado). En el último, el
// puntero se queda en él. Misma regla que en la 7.3 para series sin temporadas vacías ni huecos;
// lo nuevo (7.4a) es que el siguiente salta las temporadas con 0 capítulos o que faltan, y es el
// final cuando no hay siguiente (R15 y hueco).
export function decideMarkWatched(item: QueueItem, queue: QueueItem[], rawSeries: Row[]): MarkWatchedDecision {
    const series = rawSeries.find((s) => s.s_id === item.seriesId);
    if (!series) return { kind: 'noSeries' };
    const first = queue.find((i) => i.seriesId === item.seriesId && i.status === 'pending');
    if (first && first.uniqueId !== item.uniqueId) return { kind: 'outOfOrder', first };

    const next = nextEpisode(series, item.season, item.episode);
    if (!next) return { kind: 'advance', next: { season: item.season, episode: item.episode }, isFinal: true };
    return { kind: 'advance', next, isFinal: false };
}

// Estado al desmarcar un capítulo (R8): una serie cerrada vuelve a Mirando; null = sin cambio.
export const statusAfterUnmark = (status: string): string | null =>
    (status === 'En espera' || status === 'Terminado' ? 'Mirando' : null);
