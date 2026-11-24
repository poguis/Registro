// Vínculo Pendiente ↔ Series/Lectura (Fase 7.5). Funciones puras: sin React, SQLite, hojas ni db,
// y sin leer el reloj. Devuelven datos y decisiones; los repositorios y las pantallas ejecutan
// los efectos (escrituras con outbox, hojas con sus textos).
//
// Modelo (claude/DISENO-ENTRETENIMIENTO.md, "Pendiente ↔ Series/Lectura"; DECISIONES D1–D9):
//   - series.backlog_id → backlog.id (la serie es la hija). Un título tiene como máximo una serie
//     viva vinculada (regla de la app); si dos dispositivos sin red vinculan el mismo título, la
//     regla de estado considera TODAS las series vivas vinculadas.
//   - backlog.status de un título vinculado se guarda y lo mueve la serie (punto único en
//     src/data/repositories/series.ts); la etiqueta detallada se lee de la serie.

type Row = Record<string, any>;

export const BACKLOG_STATUSES = ['Pendiente', 'Mirando', 'Terminado'] as const;
export const READING_SUBTYPES = ['book', 'comic', 'manga'] as const;
export type ReadingSubtype = typeof READING_SUBTYPES[number];

// Textos de la interfaz para el subtipo (la columna guarda el valor en inglés, como `type`).
export const SUBTYPE_LABELS: Record<ReadingSubtype, string> = { book: 'Libro', comic: 'Cómic', manga: 'Manga' };

// Estados de una serie que cuentan como "en curso" para Pendiente.
const IN_PROGRESS = ['Nueva', 'Mirando', 'Pausado', 'En espera'];

// Estado de Pendiente de un título según las series VIVAS vinculadas: alguna en curso → Mirando;
// todas terminadas → Terminado; sin series vivas → null (el título no se toca y se comporta como
// uno sin vínculo).
export function backlogStatusFor(seriesStatuses: string[]): 'Mirando' | 'Terminado' | null {
    if (!seriesStatuses || seriesStatuses.length === 0) return null;
    if (seriesStatuses.some((s) => IN_PROGRESS.includes(s))) return 'Mirando';
    return 'Terminado';
}

// Estado que le corresponde a un título según TODAS sus series vinculadas (Fase 7.5, corrección):
//   - con series vivas: backlogStatusFor (Mirando / Terminado);
//   - sin series vivas, con al menos una vinculada borrada y en Mirando: vuelve a Pendiente (D5
//     nueva: sin serie, el título queda en Pendiente sin vínculo). Cubre la edición del título en
//     otro dispositivo que sube la fila entera con el estado viejo y la serie borrada mientras su
//     título aún no había llegado;
//   - en otro caso, null (no se toca): un Terminado sin serie viva puede ser a mano (D6) y un
//     Mirando sin ninguna serie vinculada es anterior a la 7.5 (D6 los conserva).
export function titleStatusFor(args: { current: string | null | undefined; liveStatuses: string[]; deletedLinked: number }): 'Pendiente' | 'Mirando' | 'Terminado' | null {
    let next: 'Pendiente' | 'Mirando' | 'Terminado' | null = null;
    if (args.liveStatuses.length > 0) next = backlogStatusFor(args.liveStatuses);
    else if (args.deletedLinked > 0 && args.current === 'Mirando') next = 'Pendiente';
    return next && next !== args.current ? next : null;
}

// D6 (corrección): pasar a Terminado a mano un título de serie, anime o lectura SIN vínculo pide
// confirmación; de Terminado a Pendiente y las películas, no; un vinculado no cambia a mano.
export function needsFinishConfirm(item: Row): boolean {
    return !!item && item.type !== 'movie' && !isLinked(item) && nextManualStatus(item) === 'Terminado';
}

// Etiqueta del estado detallado que se muestra en Pendiente para un título vinculado.
export function linkLabel(args: { seriesStatus: string | null | undefined; categoryName: string | null | undefined }): string {
    const cat = String(args.categoryName ?? '').trim();
    const status = String(args.seriesStatus ?? '').trim();
    if (cat && status) return `En ${cat} · ${status}`;
    return cat ? `En ${cat}` : status;
}

// Tipos de Pendiente que se conectan con cada tipo de categoría: video ↔ serie y anime;
// lectura ↔ lectura. Las películas no se conectan con nada.
export function compatibleBacklogTypes(categoryType: string): string[] {
    if (categoryType === 'video') return ['series', 'anime'];
    if (categoryType === 'reading') return ['reading'];
    return [];
}
export const isCompatible = (backlogType: string, categoryType: string): boolean =>
    compatibleBacklogTypes(categoryType).includes(backlogType);

// ¿El título tiene una serie viva vinculada? Las filas de Pendiente traen `linked_series_id`
// (getBacklogItems / getBacklogCandidates); también se acepta un conteo.
export const isLinked = (item: Row): boolean =>
    !!item && (!!item.linked_series_id || Number(item.linked_series_count || 0) > 0);

// Candidatos del selector "De Pendiente": vivos, en estado Pendiente, de tipo compatible y sin
// serie viva vinculada.
export function selectorCandidates(items: Row[], categoryType: string): Row[] {
    return (items || []).filter((b) =>
        !b.deleted_at && b.status === 'Pendiente' && isCompatible(b.type, categoryType) && !isLinked(b));
}

export type CandidateOrder = 'year' | 'created' | 'title';

// Orden del selector, con las mismas claves que el orden de Pendiente (backlog.ts: "Año" usa
// start_year fuera de películas; "Fecha" usa created_at; "Título" usa title):
//   - year: año de inicio ascendente, sin año al final;
//   - created: registro del más nuevo al más viejo;
//   - title: A–Z sin distinguir mayúsculas ni acentos.
// Desempates fijos (título, registro, id) para que el orden sea siempre el mismo.
const byTitle = (a: Row, b: Row) => String(a.title ?? '').localeCompare(String(b.title ?? ''), 'es', { sensitivity: 'base' });
const byCreatedDesc = (a: Row, b: Row) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? ''));
const byId = (a: Row, b: Row) => String(a.id ?? '').localeCompare(String(b.id ?? ''));
const yearOf = (r: Row): number | null => (r.start_year === null || r.start_year === undefined || r.start_year === '' ? null : Number(r.start_year));

export function sortCandidates(list: Row[], order: CandidateOrder): Row[] {
    const out = [...(list || [])];
    out.sort((a, b) => {
        if (order === 'year') {
            const ya = yearOf(a), yb = yearOf(b);
            if (ya === null && yb !== null) return 1;
            if (ya !== null && yb === null) return -1;
            if (ya !== null && yb !== null && ya !== yb) return ya - yb;
            return byTitle(a, b) || byCreatedDesc(a, b) || byId(a, b);
        }
        if (order === 'created') return byCreatedDesc(a, b) || byTitle(a, b) || byId(a, b);
        return byTitle(a, b) || byCreatedDesc(a, b) || byId(a, b);
    });
    return out;
}

// Estados que se pueden poner A MANO en Pendiente (D6):
//   - película: los tres, como hoy;
//   - título vinculado: ninguno (el estado lo mueve la serie);
//   - serie, anime o lectura sin vínculo: Pendiente o Terminado (visto fuera de la app), nunca Mirando.
export function allowedManualStatuses(item: Row): string[] {
    if (!item) return [];
    if (item.type === 'movie') return [...BACKLOG_STATUSES];
    if (isLinked(item)) return [];
    return ['Pendiente', 'Terminado'];
}

// Siguiente estado del botón de Pendiente: película → rota Pendiente → Mirando → Terminado →
// Pendiente (como hoy); sin vínculo → Pendiente ↔ Terminado (desde Mirando → Terminado);
// vinculado → null (la pantalla avisa que lo mueve la serie).
export function nextManualStatus(item: Row): string | null {
    if (!item) return null;
    if (item.type === 'movie') {
        const order = [...BACKLOG_STATUSES] as string[];
        const i = order.indexOf(item.status);
        return order[(i + 1) % order.length];
    }
    if (isLinked(item)) return null;
    return item.status === 'Terminado' ? 'Pendiente' : 'Terminado';
}

// Validación del formulario de Pendiente (alta y edición). Códigos; la pantalla pone el texto.
export type BacklogFormError = 'titulo' | 'subtipo';
export function validateBacklogForm(form: { type: string; title: string; subtype?: string | null }): { error: BacklogFormError } | { ok: true } {
    if (!String(form.title ?? '').trim()) return { error: 'titulo' };
    if (form.type === 'reading' && !READING_SUBTYPES.includes(form.subtype as ReadingSubtype)) return { error: 'subtipo' };
    return { ok: true };
}

// Validación del "Nuevo título" que se crea desde Series/Lectura (D8): título (el nombre de la
// serie), tipo serie/anime en video o subtipo en lectura, y año de inicio opcional (entero de 4 cifras).
export type NewTitleError = 'titulo' | 'tipo' | 'subtipo' | 'anio';
export type NewTitle = { type: string; subtype: ReadingSubtype | null; start_year: number | null };
export function validateNewTitle(args: { categoryType: string; title: string; type?: string | null; subtype?: string | null; startYear?: any }):
    { error: NewTitleError } | { newTitle: NewTitle } {
    if (!String(args.title ?? '').trim()) return { error: 'titulo' };
    let type: string;
    let subtype: ReadingSubtype | null = null;
    if (args.categoryType === 'reading') {
        if (!READING_SUBTYPES.includes(args.subtype as ReadingSubtype)) return { error: 'subtipo' };
        type = 'reading';
        subtype = args.subtype as ReadingSubtype;
    } else {
        if (args.type !== 'series' && args.type !== 'anime') return { error: 'tipo' };
        type = args.type;
    }
    const text = String(args.startYear ?? '').trim();
    let start_year: number | null = null;
    if (text) {
        if (!/^\d{4}$/.test(text)) return { error: 'anio' };
        start_year = parseInt(text, 10);
    }
    return { newTitle: { type, subtype, start_year } };
}

// Subtipo válido para un tipo de Pendiente: solo la lectura lleva subtipo (o NULL, la de antes).
export function checkSubtype(type: string, subtype: string | null | undefined): boolean {
    if (subtype === null || subtype === undefined) return true;
    return type === 'reading' && READING_SUBTYPES.includes(subtype as ReadingSubtype);
}
