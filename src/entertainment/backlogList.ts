// Lista de Pendiente (Fase 7.5b2a, O12): filtros, búsqueda, año y orden. Funciones puras: sin
// React, SQLite, hojas ni db, y sin leer el reloj. La pantalla lee UNA vez todas las filas vivas
// de la sección (db.getBacklogItems con estado 'Total', sin filtros) y este módulo arma las 4
// páginas del paginador (Pendiente / Mirando / Terminado / Total) con sus contadores. Lo
// reutiliza el selector "De Pendiente" en la 7.5b2b.
//
// Decisiones (claude/DISENO-ENTRETENIMIENTO.md, Decisiones de la 7.5b2):
//   - F6 (ajustada): el año de un título depende de su tipo: películas `year ?? start_year`;
//     series, anime y lectura `start_year ?? year`. El filtro de año y los años disponibles usan
//     esa misma función; los años salen de la sección completa (P4).
//   - F8.3 / P2: orden por Registro (created_at), Año o Título, ascendente o descendente; por
//     defecto Registro descendente (el de antes). Año sin valor SIEMPRE al final. Desempates
//     explícitos y siempre ascendentes: año o registro → título (localeCompare('es')) → id;
//     título → id.
//   - F9 / P11: la búsqueda compara sin mayúsculas ni acentos (NFD sin marcas), como subcadena
//     del título recortado ("n" encuentra "ñ"). Las etiquetas siguen comparando por clave (E5).
//   - P3: los contadores de las pestañas reflejan todos los filtros (también búsqueda y año).
//   - P6: el contador de filtros cuenta grupos (subtipo, etiquetas, año), de 0 a 3; ni la
//     búsqueda ni el orden.

import { filterByTags, isTagFilterActive, type TagFilter } from './tags';

type Row = Record<string, any>;

export const STATUS_TABS = ['Pendiente', 'Mirando', 'Terminado', 'Total'] as const;
export type StatusTab = typeof STATUS_TABS[number];

export const ORDER_FIELDS = ['created_at', 'year', 'title'] as const;
export type OrderField = typeof ORDER_FIELDS[number];
export type OrderDir = 'asc' | 'desc';
export type Order = { field: OrderField; dir: OrderDir };
export const DEFAULT_ORDER: Order = { field: 'created_at', dir: 'desc' };

// null = todos los años; un número = ese año; 'none' = "Sin año".
export type YearFilter = null | number | 'none';
export type ListFilters = { subtype: string; tags: TagFilter; year: YearFilter; search: string };
export const EMPTY_FILTERS: ListFilters = { subtype: 'Todos', tags: { keys: [], none: false }, year: null, search: '' };

export const EMPTY_TEXT_FILTERED = 'No hay títulos con estos filtros.';
export const EMPTY_TEXT = 'No hay títulos.';

const asYear = (v: unknown): number | null => {
    if (v === null || v === undefined || v === '') return null;
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : null;
};

// F6 (ajustada): el año principal según el tipo y, si falta, la otra columna.
export function effectiveYear(item: Row): number | null {
    const year = asYear(item.year);
    const start = asYear(item.start_year);
    if (item.type === 'movie') return year ?? start;
    return start ?? year;
}

const byTitle = (a: Row, b: Row): number => String(a.title ?? '').localeCompare(String(b.title ?? ''), 'es');
const byId = (a: Row, b: Row): number => {
    const x = String(a.id ?? ''), y = String(b.id ?? '');
    return x < y ? -1 : x > y ? 1 : 0;
};
// Comparación por unidades de código (como BINARY de SQLite) para las fechas ISO.
const byCode = (x: string, y: string): number => (x < y ? -1 : x > y ? 1 : 0);

export function compareItems(a: Row, b: Row, order: Order = DEFAULT_ORDER): number {
    const sign = order.dir === 'desc' ? -1 : 1;
    let c = 0;
    if (order.field === 'title') {
        c = sign * byTitle(a, b);
        return c !== 0 ? c : byId(a, b);
    }
    if (order.field === 'year') {
        const ya = effectiveYear(a), yb = effectiveYear(b);
        if (ya === null && yb !== null) return 1; // sin año, siempre al final
        if (ya !== null && yb === null) return -1;
        if (ya !== null && yb !== null && ya !== yb) c = sign * (ya < yb ? -1 : 1);
    } else {
        c = sign * byCode(String(a.created_at ?? ''), String(b.created_at ?? ''));
    }
    if (c !== 0) return c;
    const t = byTitle(a, b);
    return t !== 0 ? t : byId(a, b);
}

export function sortItems<T extends Row>(items: T[], order: Order = DEFAULT_ORDER): T[] {
    return [...items].sort((a, b) => compareItems(a, b, order));
}

// P4: años de la SECCIÓN completa (todos los estados), de mayor a menor; hasNone si algún título
// no tiene año.
export function availableYears(sectionItems: Row[]): { years: number[]; hasNone: boolean } {
    const set = new Set<number>();
    let hasNone = false;
    for (const it of sectionItems) {
        const y = effectiveYear(it);
        if (y === null) hasNone = true; else set.add(y);
    }
    return { years: [...set].sort((a, b) => b - a), hasNone };
}

export function matchesYear(item: Row, f: YearFilter): boolean {
    if (f === null || f === undefined) return true;
    const y = effectiveYear(item);
    return f === 'none' ? y === null : y === f;
}

// F9: sin marcas diacríticas, en minúsculas, con los espacios reducidos a uno.
export function normalizeSearch(s: unknown): string {
    return String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

export function matchesSearch(item: Row, query: unknown): boolean {
    const q = normalizeSearch(query);
    if (q === '') return true;
    return normalizeSearch(item.title).includes(q);
}

const subtypeActive = (s: unknown): boolean => !!s && s !== 'Todos';

// P6: grupos activos (subtipo, etiquetas, año); la búsqueda y el orden no cuentan.
export function activeFilterCount(f: ListFilters): number {
    return (subtypeActive(f.subtype) ? 1 : 0) + (isTagFilterActive(f.tags) ? 1 : 0) + (f.year !== null && f.year !== undefined ? 1 : 0);
}

// Texto de una página sin títulos: con algún filtro o búsqueda, el que lo explica.
export function emptyText(f: ListFilters): string {
    return activeFilterCount(f) > 0 || normalizeSearch(f.search) !== '' ? EMPTY_TEXT_FILTERED : EMPTY_TEXT;
}

// Estado (Total = todos), subtipo ('Todos' = sin filtro; "Sin subtipo" solo con Todos),
// etiquetas (filterByTags, E8), año y búsqueda.
export function filterItems<T extends Row>(items: T[], status: string, f: ListFilters): T[] {
    let out = items.filter((it) => (status === 'Total' || it.status === status)
        && (!subtypeActive(f.subtype) || it.subtype === f.subtype));
    out = filterByTags(out, f.tags);
    return out.filter((it) => matchesYear(it, f.year) && matchesSearch(it, f.search));
}

// Las 4 páginas ordenadas y sus contadores (P3: el largo de cada página).
export function buildPages<T extends Row>(items: T[], f: ListFilters, order: Order = DEFAULT_ORDER):
    { pages: Record<StatusTab, T[]>; counts: Record<StatusTab, number> } {
    const sorted = sortItems(items, order);
    const pages = {} as Record<StatusTab, T[]>;
    const counts = {} as Record<StatusTab, number>;
    for (const tab of STATUS_TABS) {
        pages[tab] = filterItems(sorted, tab, f);
        counts[tab] = pages[tab].length;
    }
    return { pages, counts };
}
