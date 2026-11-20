import { getAbsoluteEpisodeCount, getLocalDateString } from '../services/backlogUtils';
import { currentRound, episodesInRange, isBefore, nextEpisode, statusAfterUnmark, watchedCount, type EpisodeRef } from './queue';

// Decisiones puras del detalle de una categoría, compartidas por SeriesDetailScreen (video) y
// ReadingDetailScreen (lectura). Sin React, SQLite, Alert ni db; la fecha entra como parámetro.
// Los textos de las alertas siguen en cada pantalla.
//
// Fase 7.3: comportamiento idéntico a d55b5e1. Fase 7.4a (cambios a propósito):
// - ciclo (C2): una serie nueva o una pausada que se reanuda entra al final del ciclo actual;
// - la grilla "marca vistos hasta aquí" (adelante) o desmarca (atrás) con filas de historial (R7);
// - el límite de series activas: NULL/0 = sin límite, y editar nunca se bloquea (O1, R2).

type Row = Record<string, any>;

// Estados que ocupan un lugar en "Viendo" y cuentan para el límite (series_count).
export const ACTIVE_STATUSES = ['Nueva', 'Mirando', 'Pausado'];
const isActive = (s: Row) => s.status === 'Nueva' || s.status === 'Mirando' || s.status === 'Pausado';
const isClosed = (status: string) => status === 'En espera' || status === 'Terminado';

// Pestañas: "Viendo" = activas; el resto, por estado exacto.
export function filterSeriesByTab(list: Row[], tab: string): Row[] {
    if (tab === 'Viendo') return list.filter(isActive);
    return list.filter((s) => s.status === tab);
}

// ↑ / ↓ en "Viendo": devuelve la lista reordenada (la pantalla escribe sort_order = posición + 1)
// o null si no hay nada que hacer (otra pestaña, primera fila al subir, última al bajar).
export function reorderActive(filtered: Row[], index: number, direction: 'up' | 'down', tab: string): Row[] | null {
    if (direction === 'up') {
        if (tab !== 'Viendo' || index === 0) return null;
    } else if (tab !== 'Viendo' || index === filtered.length - 1) return null;
    const newList = [...filtered];
    const [movedItem] = newList.splice(index, 1);
    newList.splice(direction === 'up' ? index - 1 : index + 1, 0, movedItem);
    return newList;
}

export type SeriesFormError = 'nombre' | 'temporadaVacia' | 'unidades' | 'numeros' | 'temporadaRango' | 'capituloRango';

// Validación del formulario de serie/obra. La pantalla traduce el código a su texto.
// O4 (7.4a): cada temporada/parte necesita al menos 1 capítulo/tomo (una fila vacía, 0 o no
// numérica se rechaza); 'unidades' queda para una lista sin filas.
export function validateSeriesForm(form: { name: string; seasons: Row[]; status: string; currentSeason: any; currentEpisode: any }):
    { error: SeriesFormError } | { validSeasons: Row[] } {
    const { name, seasons, status, currentSeason, currentEpisode } = form;
    if (!name.trim()) return { error: 'nombre' };
    if (seasons.some((s) => !(parseInt(s.episodes) >= 1))) return { error: 'temporadaVacia' };
    const validSeasons = seasons.filter((s) => parseInt(s.episodes) > 0);
    if (validSeasons.length === 0) return { error: 'unidades' };
    if (status === 'Mirando') {
        const seasonNum = parseInt(currentSeason);
        const episodeNum = parseInt(currentEpisode);
        if (isNaN(seasonNum) || isNaN(episodeNum)) return { error: 'numeros' };
        if (seasonNum < 1 || seasonNum > validSeasons.length) return { error: 'temporadaRango' };
        const maxEpisodes = parseInt(validSeasons[seasonNum - 1].episodes);
        if (episodeNum < 1 || episodeNum > maxEpisodes) return { error: 'capituloRango' };
    }
    return { validSeasons };
}

// Límite de series activas de la categoría (O1): un entero ≥ 1. NULL, 0 o un valor no válido
// (categorías viejas) = sin límite hasta que se edite la categoría.
export function activeLimit(category: Row): number | null {
    const limit = category ? category.series_count : null;
    return Number.isInteger(limit) && limit >= 1 ? limit : null;
}

// ¿Guardar la serie supera el límite? Editar una serie existente nunca se bloquea.
export function isActiveLimitReached(args: { originalList: Row[]; status: string; isEditing: boolean; editingSeriesId?: any; category: Row }): boolean {
    const { originalList, status, isEditing, category } = args;
    if (isEditing) return false;
    const limit = activeLimit(category);
    if (limit === null) return false;
    const willBeActive = status === 'Nueva' || status === 'Mirando' || status === 'Pausado';
    return willBeActive && originalList.filter(isActive).length >= limit;
}

// Botón "Agregar": con el límite alcanzado, el aviso sale ANTES de abrir el formulario (O1).
export function canAddSeries(originalList: Row[], category: Row): { ok: true } | { ok: false; limit: number } {
    const limit = activeLimit(category);
    if (limit !== null && originalList.filter(isActive).length >= limit) return { ok: false, limit };
    return { ok: true };
}

// Datos a guardar. Al crear (no al editar) agrega sort_order (activas + 1; el repositorio usa
// MAX + 1, R9) e interleave_offset = ciclo actual: la serie nueva (0 vistos) entra al final de
// la vuelta en curso (C2).
export function buildSeriesSave(args: {
    category: Row; name: string; description: string; status: string; currentSeason: any; currentEpisode: any;
    validSeasons: Row[]; isEditing: boolean; originalList: Row[];
}): { seriesData: Row; seasonsData: Row[] } {
    const { category, name, description, status, currentSeason, currentEpisode, validSeasons, isEditing, originalList } = args;
    const seriesData: Row = {
        category_id: category.id,
        name,
        description,
        status,
        current_season: parseInt(currentSeason),
        current_episode: parseInt(currentEpisode),
        total_seasons: validSeasons.length,
    };
    const seasonsData = validSeasons.map((s) => ({
        season_number: s.number,
        episode_count: parseInt(s.episodes),
    }));
    if (!isEditing) {
        seriesData.sort_order = originalList.filter(isActive).length + 1;
        seriesData.interleave_offset = currentRound(originalList) ?? 0;
    }
    return { seriesData, seasonsData };
}

// Filas de temporadas del formulario (numeradas desde 1).
export const appendSeasonRow = (seasons: Row[]): Row[] => [...seasons, { number: seasons.length + 1, episodes: '' }];
// null = no se puede quitar (debe quedar al menos una).
export const removeSeasonRow = (seasons: Row[]): Row[] | null => (seasons.length > 1 ? seasons.slice(0, -1) : null);

export type ChapterTapPlan =
    | { kind: 'forward'; episodes: EpisodeRef[]; pointer: EpisodeRef; isFinal: boolean; status: string }
    | { kind: 'backward'; episodes: EpisodeRef[]; pointer: EpisodeRef; status: string }
    | { kind: 'none' };

// Toque en la grilla de progreso (R7). "Siguiente" = el primer capítulo NO visto: el puntero en
// estado abierto; en En espera/Terminado, el capítulo después del puntero (el puntero es el
// último visto). Tocar el siguiente o uno posterior marca vistos desde el siguiente hasta el
// tocado (ambos incluidos); si el tocado es el último, la pantalla pregunta En espera /
// Terminado y el puntero queda en él. Tocar uno anterior desmarca desde el tocado hasta el
// anterior al siguiente; el puntero queda en el tocado y una serie cerrada vuelve a Mirando.
export function planChapterTap(series: Row, sNum: number, eNum: number): ChapterTapPlan {
    const pointer: EpisodeRef = { season: series.current_season || 1, episode: series.current_episode || 1 };
    const closed = isClosed(series.status);
    const next: EpisodeRef | null = closed ? nextEpisode(series, pointer.season, pointer.episode) : pointer;
    const tapped: EpisodeRef = { season: sNum, episode: eNum };
    if (next && !isBefore(tapped, next)) {
        const episodes = episodesInRange(series, next, tapped);
        if (episodes.length === 0) return { kind: 'none' };
        const after = nextEpisode(series, sNum, eNum);
        return after
            ? { kind: 'forward', episodes, pointer: after, isFinal: false, status: 'Mirando' }
            : { kind: 'forward', episodes, pointer: tapped, isFinal: true, status: 'Mirando' };
    }
    // Hacia atrás: hasta el anterior al siguiente (si no hay siguiente, hasta el puntero incluido).
    let episodes = episodesInRange(series, tapped, next || pointer);
    if (next && episodes.length && !isBefore(episodes[episodes.length - 1], next)) episodes = episodes.slice(0, -1);
    if (episodes.length === 0) return { kind: 'none' };
    return { kind: 'backward', episodes, pointer: tapped, status: statusAfterUnmark(series.status) || series.status };
}

// Valor que "Reiniciar" sigue escribiendo en cycle_offset (columna que ya no cuenta, 7.4a).
export function restartWatchedCount(series: Row): number {
    const currentAbsolute = getAbsoluteEpisodeCount(series, series.current_season, series.current_episode);
    const initialAbsolute = getAbsoluteEpisodeCount(series, series.initial_season || 1, series.initial_episode || 1);
    let watchedInThisCycle = Math.max(0, currentAbsolute - initialAbsolute);
    if (series.status === 'Terminado') watchedInThisCycle += 1;
    return watchedInThisCycle;
}

// Vistos de la lista (historial): la suma de todas las series, incluidas pausadas y cerradas (R1).
export const seriesWatchedTotal = (list: Row[]): number => list.reduce((a, s) => a + watchedCount(s), 0);

export type TogglePauseDecision =
    | { action: 'resume'; status: 'Mirando'; interleaveOffset: number }
    | { action: 'pause'; status: 'Pausado' }
    | { action: 'none' };

// ⏸/▶ de una serie. Al reanudar (E3, opción B tras la prueba de la 7.4a) entra en la vuelta en
// curso con su propio progreso, interleave_offset = r0 − vistos (puede ser negativo), y CONSERVA
// su sort_order: dentro de esa vuelta sale en la posición que siempre tuvo y no baja en "Viendo"
// (solo las series nuevas van al final). Si no hay otras series en la cola, el offset no cambia.
export function decideTogglePause(series: Row, originalList: Row[]): TogglePauseDecision {
    if (series.status === 'Pausado') {
        const others = originalList.filter((s) => s.id !== series.id);
        const r0 = currentRound(others);
        const interleaveOffset = r0 === null ? (series.interleave_offset || 0) : r0 - watchedCount(series);
        return { action: 'resume', status: 'Mirando', interleaveOffset };
    }
    if (series.status === 'Mirando' || series.status === 'Nueva') return { action: 'pause', status: 'Pausado' };
    return { action: 'none' };
}

// Pausa de la categoría: se pausa con fecha de hoy y se reanuda con fecha de ayer.
// `today` lo pasa la pantalla (aquí no se lee el reloj).
export function categoryPauseDates(today: Date): { pauseDate: string; resumeDate: string } {
    const yesterday = new Date(today.getTime());
    yesterday.setDate(yesterday.getDate() - 1);
    return { pauseDate: getLocalDateString(today), resumeDate: getLocalDateString(yesterday) };
}
