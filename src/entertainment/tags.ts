// Etiquetas de Pendiente (Fase 7.5b1, O11; decisiones E1–E9 en claude/DISENO-ENTRETENIMIENTO.md).
// Módulo puro: sin React, SQLite ni db. Devuelve datos y planes; el repositorio
// (src/data/repositories/tags.ts) ejecuta las acciones en una transacción y la pantalla muestra
// los textos.
//
// Modelo:
//   - Catálogo backlog_tags: una fila por (sección, clave). La sección es el tipo del título
//     (movie / series / anime / reading). name es el nombre que se muestra; name_key la clave de
//     unicidad (nombre normalizado + toLowerCase: sin distinguir mayúsculas, los acentos cuentan).
//     La UNIQUE (user_id, section, name_key) incluye los tombstones: crear o renombrar a la clave
//     de una etiqueta borrada revive esa fila (P-b).
//   - backlog.tags: los NOMBRES de las etiquetas del título, como JSON array, en forma canónica
//     (sin repetir por clave, ordenados por clave código por código; NULL si no hay ninguna). Todo
//     compara por clave: el filtro, el conteo, el renombrado y el borrado.

export const TAG_SECTIONS = ['movie', 'series', 'anime', 'reading'] as const;
export const TAG_SECTION_LABELS: Record<string, string> = { movie: 'Películas', series: 'Series', anime: 'Anime', reading: 'Lectura' };
export const TAG_MAX_LENGTH = 30;

export type TagRow = { id: string; section?: string; name: string; name_key: string; deleted_at?: string | null };
export type TagError = 'vacio' | 'largo' | 'duplicado';

// ---------------------------------------------------------------- nombre y clave
// E5: sin espacios al inicio ni al final y los internos (cualquier blanco) reducidos a uno.
export const normalizeTagName = (name: unknown): string => String(name ?? '').replace(/\s+/g, ' ').trim();
// Clave: la calcula SOLO la app (el servidor no la recalcula). toLowerCase conserva los acentos.
export const tagKey = (name: unknown): string => normalizeTagName(name).toLowerCase();
// Longitud en puntos de código (igual que char_length de Postgres).
export const tagLength = (name: string): number => Array.from(name).length;

const byCode = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const isLive = (r: TagRow) => !r.deleted_at;

// Validación del nombre contra las etiquetas VIVAS de la sección (exceptId: la que se renombra).
export function validateTagName(name: unknown, liveInSection: TagRow[], exceptId: string | null = null):
    { ok: true; name: string; key: string } | { ok: false; error: TagError } {
    const n = normalizeTagName(name);
    if (!n) return { ok: false, error: 'vacio' };
    if (tagLength(n) > TAG_MAX_LENGTH) return { ok: false, error: 'largo' };
    const key = n.toLowerCase();
    if (liveInSection.some((r) => isLive(r) && r.name_key === key && r.id !== exceptId)) return { ok: false, error: 'duplicado' };
    return { ok: true, name: n, key };
}

export const TAG_ERROR_TEXTS: Record<TagError, string> = {
    vacio: 'Escribe el nombre de la etiqueta.',
    largo: `El nombre puede tener hasta ${TAG_MAX_LENGTH} caracteres.`,
    duplicado: 'Ya existe una etiqueta con ese nombre en esta sección.',
};

// ---------------------------------------------------------------- forma canónica de backlog.tags
// Sin repetir por clave (queda el nombre menor código por código), ordenados por clave código por
// código (determinista en Hermes y en Node; no depende de ICU). Vacío → null.
export function canonicalTags(names: unknown): string[] | null {
    const list = Array.isArray(names) ? names : [];
    const entries = list
        .filter((x) => typeof x === 'string')
        .map((x) => normalizeTagName(x))
        .filter((x) => x.length > 0)
        .map((name) => ({ name, key: name.toLowerCase() }))
        .sort((a, b) => byCode(a.key, b.key) || byCode(a.name, b.name));
    const out: string[] = [];
    let last: string | null = null;
    for (const e of entries) {
        if (e.key === last) continue;
        out.push(e.name);
        last = e.key;
    }
    return out.length ? out : null;
}

// Texto local (TEXT con JSON) → lista. Tolerante: NULL, vacío o no válido → [].
export function parseTags(value: unknown): string[] {
    if (Array.isArray(value)) return value.filter((x) => typeof x === 'string');
    if (value === null || value === undefined || value === '') return [];
    try {
        const parsed = JSON.parse(String(value));
        return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : [];
    } catch {
        return [];
    }
}

// Estricto (mapeo de sync): solo NULL o un array de strings; si no, lanza.
export function parseTagsStrict(value: unknown): string[] | null {
    if (value === null || value === undefined) return null;
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    if (!Array.isArray(parsed) || parsed.some((x) => typeof x !== 'string')) throw new Error('tags: se esperaba un array de strings');
    return parsed;
}

// Lista → valor local de backlog.tags (forma canónica; null si no hay etiquetas).
export function serializeTags(names: unknown): string | null {
    const c = canonicalTags(names);
    return c ? JSON.stringify(c) : null;
}

// Orden para mostrar (pantalla): español, sin distinguir mayúsculas ni acentos; desempate por clave.
export function sortForDisplay(names: string[]): string[] {
    return [...names].sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }) || byCode(tagKey(a), tagKey(b)) || byCode(a, b));
}

export const tagKeysOf = (tags: unknown): string[] => parseTags(tags).map(tagKey);

// ---------------------------------------------------------------- catálogo y sugerencias
// Etiquetas vivas de la sección.
export const liveTagsOf = (catalog: TagRow[], section: string): TagRow[] =>
    catalog.filter((r) => isLive(r) && r.section === section);

// "De otras secciones" (E7): nombres vivos de otras secciones cuya clave no existe viva en la
// actual (ni está en `exclude`). Uno por clave (el nombre menor código por código), para mostrar.
export function suggestionsFromOtherSections(catalog: TagRow[], section: string, exclude: string[] = []): string[] {
    const here = new Set(liveTagsOf(catalog, section).map((r) => r.name_key));
    for (const n of exclude) here.add(tagKey(n));
    const best = new Map<string, string>();
    for (const r of catalog) {
        if (!isLive(r) || r.section === section || here.has(r.name_key)) continue;
        const prev = best.get(r.name_key);
        if (prev === undefined || byCode(r.name, prev) < 0) best.set(r.name_key, r.name);
    }
    return sortForDisplay([...best.values()]);
}

// Vista del campo del formulario: etiquetas de la sección (con su marca), las elegidas que no
// existen vivas en la sección (huérfanas, de otras secciones o nuevas) y las sugerencias.
export function formTagView(catalog: TagRow[], section: string, selected: string[]) {
    const selectedKeys = new Set(selected.map(tagKey));
    const live = liveTagsOf(catalog, section);
    const liveKeys = new Set(live.map((r) => r.name_key));
    const sectionTags = sortForDisplay(live.map((r) => r.name)).map((name) => ({ name, key: tagKey(name), selected: selectedKeys.has(tagKey(name)) }));
    const extra = sortForDisplay((canonicalTags(selected) || []).filter((n) => !liveKeys.has(tagKey(n))));
    const others = suggestionsFromOtherSections(catalog, section, selected);
    return { sectionTags, extra, others };
}

// Alternar una etiqueta en la selección del formulario (por clave).
export function toggleTag(selected: string[], name: string): string[] {
    const key = tagKey(name);
    return selected.some((n) => tagKey(n) === key) ? selected.filter((n) => tagKey(n) !== key) : [...selected, normalizeTagName(name)];
}

// ---------------------------------------------------------------- planes (crear / renombrar / borrar)
export type TagAction =
    | { kind: 'insert'; name: string; key: string }
    | { kind: 'revive'; id: string; name: string }
    | { kind: 'rename'; id: string; name: string; key: string }
    | { kind: 'delete'; id: string };

// Crear (gestión): contra TODAS las filas de la sección (vivas y borradas).
export function planCreate(name: unknown, sectionRows: TagRow[]):
    { ok: true; action: TagAction; name: string } | { ok: false; error: TagError } {
    const v = validateTagName(name, sectionRows.filter(isLive));
    if (!v.ok) return v;
    const dead = sectionRows.find((r) => !isLive(r) && r.name_key === v.key);
    return { ok: true, name: v.name, action: dead ? { kind: 'revive', id: dead.id, name: v.name } : { kind: 'insert', name: v.name, key: v.key } };
}

// Reescritura de las etiquetas de un título (por clave). Devuelve null si no cambia.
export function renameInTags(tags: unknown, oldKey: string, newName: string): string | null | undefined {
    const list = parseTags(tags);
    if (!list.some((n) => tagKey(n) === oldKey)) return undefined;
    return serializeTags(list.map((n) => (tagKey(n) === oldKey ? newName : n)));
}
export function removeFromTags(tags: unknown, key: string): string | null | undefined {
    const list = parseTags(tags);
    if (!list.some((n) => tagKey(n) === key)) return undefined;
    return serializeTags(list.filter((n) => tagKey(n) !== key));
}

type TitleRow = { id: string; tags: unknown };
export type TitleUpdate = { id: string; tags: string | null };

// Renombrar: solo mayúsculas → mismo id, nombre nuevo y títulos reescritos; a la clave de una viva
// → bloqueado; a la clave de una borrada → se revive esa (con el nombre nuevo), se borra la que se
// renombra y los títulos pasan al nombre nuevo; si no, cambia nombre y clave. `titles`: los
// títulos VIVOS de la sección.
export function planRename(tag: TagRow, newName: unknown, sectionRows: TagRow[], titles: TitleRow[]):
    { ok: true; actions: TagAction[]; titles: TitleUpdate[]; name: string } | { ok: false; error: TagError } | { ok: true; actions: []; titles: []; name: string; unchanged: true } {
    const v = validateTagName(newName, sectionRows.filter(isLive), tag.id);
    if (!v.ok) return v;
    if (v.name === tag.name) return { ok: true, actions: [], titles: [], name: v.name, unchanged: true };
    const rewrite = titles
        .map((t) => ({ id: t.id, tags: renameInTags(t.tags, tag.name_key, v.name) }))
        .filter((u): u is TitleUpdate => u.tags !== undefined);
    if (v.key === tag.name_key) {
        return { ok: true, actions: [{ kind: 'rename', id: tag.id, name: v.name, key: v.key }], titles: rewrite, name: v.name };
    }
    const dead = sectionRows.find((r) => !isLive(r) && r.name_key === v.key);
    if (dead) {
        return { ok: true, actions: [{ kind: 'revive', id: dead.id, name: v.name }, { kind: 'delete', id: tag.id }], titles: rewrite, name: v.name };
    }
    return { ok: true, actions: [{ kind: 'rename', id: tag.id, name: v.name, key: v.key }], titles: rewrite, name: v.name };
}

// Borrar: la etiqueta (lógico) y quitarla de los títulos de la sección, en la misma transacción.
export function planDelete(tag: TagRow, titles: TitleRow[]): { actions: TagAction[]; titles: TitleUpdate[]; count: number } {
    const rewrite = titles
        .map((t) => ({ id: t.id, tags: removeFromTags(t.tags, tag.name_key) }))
        .filter((u): u is TitleUpdate => u.tags !== undefined);
    return { actions: [{ kind: 'delete', id: tag.id }], titles: rewrite, count: rewrite.length };
}

// Texto de la confirmación de borrado (E6).
export function deleteTagText(count: number): string {
    if (count <= 0) return 'No está en ningún título.';
    if (count === 1) return 'Se quitará de 1 título.';
    return `Se quitará de ${count} títulos.`;
}

// ---------------------------------------------------------------- guardar un título (P-a / P-d)
// Cada nombre elegido se reemplaza por el del catálogo para su clave (vivo) o se crea (borrado →
// se revive; inexistente → se inserta) en el catálogo, en la misma transacción que el título.
export function resolveTitleTags(selected: unknown, sectionRows: TagRow[]):
    { ok: true; names: string[] | null; actions: TagAction[] } | { ok: false; error: TagError; name: string } {
    const list = Array.isArray(selected) ? selected.filter((x) => typeof x === 'string') : [];
    const seen = new Set<string>();
    const names: string[] = [];
    const actions: TagAction[] = [];
    for (const raw of list) {
        const n = normalizeTagName(raw);
        if (!n) continue;
        const key = n.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        const live = sectionRows.find((r) => isLive(r) && r.name_key === key);
        if (live) { names.push(live.name); continue; }
        if (tagLength(n) > TAG_MAX_LENGTH) return { ok: false, error: 'largo', name: n };
        const dead = sectionRows.find((r) => !isLive(r) && r.name_key === key);
        actions.push(dead ? { kind: 'revive', id: dead.id, name: n } : { kind: 'insert', name: n, key });
        names.push(n);
    }
    return { ok: true, names: canonicalTags(names), actions };
}

// ---------------------------------------------------------------- filtro y conteo (E8)
export type TagFilter = { keys?: string[]; none?: boolean } | null | undefined;

export const isTagFilterActive = (f: TagFilter): boolean => !!f && (!!f.none || (f.keys || []).length > 0);

// "Sin etiquetas": los títulos sin ninguna (excluye los demás). Con claves: los que tienen TODAS.
export function filterByTags<T extends { tags?: unknown }>(items: T[], filter: TagFilter): T[] {
    if (!isTagFilterActive(filter)) return items;
    if (filter!.none) return items.filter((it) => parseTags(it.tags).length === 0);
    const wanted = (filter!.keys || []).map(tagKey);
    return items.filter((it) => {
        const have = new Set(tagKeysOf(it.tags));
        return wanted.every((k) => have.has(k));
    });
}

export function countTitlesWithTag(items: { tags?: unknown }[], nameOrKey: string): number {
    const key = tagKey(nameOrKey);
    return items.filter((it) => tagKeysOf(it.tags).includes(key)).length;
}
