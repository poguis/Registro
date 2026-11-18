import { getAbsoluteEpisodeCount, getLocalDateString, getWatchedCountSinceStart } from '../services/backlogUtils';

// Decisiones puras del detalle de una categoría (Fase 7.3), compartidas por SeriesDetailScreen
// (video) y ReadingDetailScreen (lectura). Sin React, SQLite, Alert ni db; la fecha entra como
// parámetro. Los textos de las alertas siguen en cada pantalla.
//
// Comportamiento IDÉNTICO al de d55b5e1 (SeriesDetailScreen.js:116-386 y su copia de lectura),
// incluidos los defectos R1–R14 de docs/ENTRETENIMIENTO-ACTUAL.md (se corrigen en la 7.4).
// Equivalencia: scripts/probar-fase7-3.mjs.

type Row = Record<string, any>;

// Estados que ocupan un lugar en "Viendo" y cuentan para el límite (series_count).
export const ACTIVE_STATUSES = ['Nueva', 'Mirando', 'Pausado'];
const isActive = (s: Row) => s.status === 'Nueva' || s.status === 'Mirando' || s.status === 'Pausado';

// Progreso usado para intercalar: vistos desde el inicio + interleave_offset.
const interleaveProgress = (s: Row) => getWatchedCountSinceStart(s) + (s.interleave_offset || 0);
const maxInterleaveOf = (list: Row[]) => {
    let maxInterleave = 0;
    list.forEach((s) => {
        const progress = interleaveProgress(s);
        if (progress > maxInterleave) maxInterleave = progress;
    });
    return maxInterleave;
};

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

export type SeriesFormError = 'nombre' | 'unidades' | 'numeros' | 'temporadaRango' | 'capituloRango';

// Validación del formulario de serie/obra. La pantalla traduce el código a su texto.
export function validateSeriesForm(form: { name: string; seasons: Row[]; status: string; currentSeason: any; currentEpisode: any }):
    { error: SeriesFormError } | { validSeasons: Row[] } {
    const { name, seasons, status, currentSeason, currentEpisode } = form;
    if (!name.trim()) return { error: 'nombre' };
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

// Límite de series activas (series_count de la categoría). NULL/undefined = sin límite.
// Hoy un 0 bloquea toda serie nueva (R2), igual que antes.
export function isActiveLimitReached(args: { originalList: Row[]; status: string; isEditing: boolean; editingSeriesId: any; category: Row }): boolean {
    const { originalList, status, isEditing, editingSeriesId, category } = args;
    const activeSeriesItems = originalList.filter(isActive);
    const activeCount = activeSeriesItems.length;
    const isCurrentlyActive = isEditing && activeSeriesItems.some((s) => s.id === editingSeriesId);
    const willBeActive = status === 'Nueva' || status === 'Mirando' || status === 'Pausado';
    if (willBeActive && (!isCurrentlyActive || !isEditing)) {
        if (category.series_count !== null && category.series_count !== undefined) {
            if (activeCount >= category.series_count) return true;
        }
    }
    return false;
}

// Datos a guardar. Al crear (no al editar) agrega sort_order (activas + 1; el repositorio lo
// ignora y usa MAX + 1, R9) e interleave_offset (máximo progreso de las activas).
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
        const activeSeriesItems = originalList.filter(isActive);
        seriesData.sort_order = activeSeriesItems.length + 1;
        seriesData.interleave_offset = maxInterleaveOf(activeSeriesItems);
    }
    return { seriesData, seasonsData };
}

// Filas de temporadas del formulario (numeradas desde 1).
export const appendSeasonRow = (seasons: Row[]): Row[] => [...seasons, { number: seasons.length + 1, episodes: '' }];
// null = no se puede quitar (debe quedar al menos una).
export const removeSeasonRow = (seasons: Row[]): Row[] | null => (seasons.length > 1 ? seasons.slice(0, -1) : null);

// Toque en la grilla de progreso: si es el último capítulo posible (la pantalla pregunta En
// espera/Terminado) y qué estado usar si no lo es.
export function decideChapterTap(series: Row, sNum: number, eNum: number): { isLastPossible: boolean; nonFinalStatus: string } {
    const lastSeason = series.seasons.find((s: Row) => s.season_number === series.total_seasons);
    const isLastPossible = (sNum === series.total_seasons && eNum === (lastSeason?.episode_count || 0));
    let nonFinalStatus = series.status;
    if (series.status === 'En espera' || series.status === 'Terminado' || series.status === 'Pausado') nonFinalStatus = 'Mirando';
    return { isLastPossible, nonFinalStatus };
}

// Estado que se guarda al mover el puntero: una serie Nueva pasa a Mirando si el puntero
// queda más allá de T1E1.
export const resolveProgressStatus = (series: Row, sNum: number, eNum: number, newStatus: string): string =>
    ((series.status === 'Nueva' && (sNum > 1 || eNum > 1)) ? 'Mirando' : newStatus);

// Capítulos de la vuelta actual que "Reiniciar" suma a cycle_offset (+1 solo si está Terminado;
// desde En espera pierde 1, R6).
export function restartWatchedCount(series: Row): number {
    const currentAbsolute = getAbsoluteEpisodeCount(series, series.current_season, series.current_episode);
    const initialAbsolute = getAbsoluteEpisodeCount(series, series.initial_season || 1, series.initial_episode || 1);
    let watchedInThisCycle = Math.max(0, currentAbsolute - initialAbsolute);
    if (series.status === 'Terminado') watchedInThisCycle += 1;
    return watchedInThisCycle;
}

export type TogglePauseDecision =
    | { action: 'resume'; status: 'Mirando'; interleaveOffset: number }
    | { action: 'pause'; status: 'Pausado' }
    | { action: 'none' };

// ⏸/▶ de una serie. Al reanudar, interleave_offset sube hasta igualar a la activa más avanzada.
export function decideTogglePause(series: Row, originalList: Row[]): TogglePauseDecision {
    if (series.status === 'Pausado') {
        const activeItems = originalList.filter((s) => isActive(s) && s.id !== series.id);
        const maxInterleave = maxInterleaveOf(activeItems);
        const myInterleave = interleaveProgress(series);
        const additionalInterleave = Math.max(0, maxInterleave - myInterleave);
        return { action: 'resume', status: 'Mirando', interleaveOffset: (series.interleave_offset || 0) + additionalInterleave };
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
