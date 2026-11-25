import { getConnection, type Row } from '../db/connection';
import { insertRow, updateRow, reviveRow, softDelete } from './rows';
import {
    TAG_SECTIONS, planCreate, planRename, planDelete, resolveTitleTags, tagKeysOf,
    type TagAction, type TagError, type TagRow, type TitleUpdate,
} from '../../entertainment/tags';

// Etiquetas de Pendiente (Fase 7.5b1, O11). El catálogo backlog_tags y backlog.tags se escriben
// SIEMPRE por rows.ts (columnas de sync + outbox), dentro de la transacción del llamador (las
// mutaciones de la fachada van por `mutate`). La lógica (normalizar, validar, planes) vive en
// src/entertainment/tags.ts; aquí solo se ejecutan las acciones que devuelve.

const db = () => getConnection();

const checkSection = (section: string) => {
    if (!(TAG_SECTIONS as readonly string[]).includes(section)) throw new Error(`Sección de etiqueta no válida: ${section}`);
};

// Etiquetas vivas del usuario, de todas las secciones (sugerencias "De otras secciones").
export async function getBacklogTags(userId: string): Promise<Row[]> {
    return db().getAllAsync<Row>(
        'SELECT id, section, name, name_key FROM backlog_tags WHERE user_id = ? AND deleted_at IS NULL ORDER BY section, name_key',
        [userId]
    );
}

// Todas las filas de la sección, también las borradas: la UNIQUE (user_id, section, name_key)
// incluye los tombstones, así que crear o renombrar a la clave de una borrada la revive (P-b).
// Única lectura de dominio sin `deleted_at IS NULL` en este archivo (excepción de probar-fase1).
async function sectionRowsWithTombstones(userId: string, section: string): Promise<TagRow[]> {
    return db().getAllAsync<TagRow>(
        'SELECT id, section, name, name_key, deleted_at FROM backlog_tags WHERE user_id = ? AND section = ?',
        [userId, section]
    );
}

// Títulos vivos de la sección con etiquetas (los que un renombrado o un borrado reescriben).
async function taggedTitles(userId: string, section: string): Promise<{ id: string; tags: string | null }[]> {
    return db().getAllAsync<{ id: string; tags: string | null }>(
        'SELECT id, tags FROM backlog WHERE user_id = ? AND type = ? AND deleted_at IS NULL AND tags IS NOT NULL',
        [userId, section]
    );
}

async function runActions(userId: string, section: string, actions: TagAction[]): Promise<string | null> {
    let firstId: string | null = null;
    for (const a of actions) {
        if (a.kind === 'insert') {
            const id = await insertRow('backlog_tags', userId, { section, name: a.name, name_key: a.key });
            firstId = firstId || id;
        } else if (a.kind === 'revive') {
            await reviveRow('backlog_tags', a.id, { name: a.name, name_key: a.name.toLowerCase() });
            firstId = firstId || a.id;
        } else if (a.kind === 'rename') {
            await updateRow('backlog_tags', a.id, { name: a.name, name_key: a.key });
            firstId = firstId || a.id;
        } else if (a.kind === 'delete') {
            await softDelete('backlog_tags', a.id);
        }
    }
    return firstId;
}

async function rewriteTitles(updates: TitleUpdate[]): Promise<void> {
    for (const u of updates) await updateRow('backlog', u.id, { tags: u.tags });
}

export type TagResult = { ok: true; id: string | null } | { ok: false; error: TagError };

// Crear desde la gestión (E6): se crea al confirmar; si la clave es de una borrada, se revive.
export async function createBacklogTag(userId: string, section: string, name: string): Promise<TagResult> {
    checkSection(section);
    const plan = planCreate(name, await sectionRowsWithTombstones(userId, section));
    if (!plan.ok) return plan;
    return { ok: true, id: await runActions(userId, section, [plan.action]) };
}

async function liveTag(id: string): Promise<Row | null> {
    return db().getFirstAsync<Row>('SELECT id, user_id, section, name, name_key FROM backlog_tags WHERE id = ? AND deleted_at IS NULL', [id]);
}

// Renombrar (E6): reescribe los títulos de la sección en la misma transacción (también si solo
// cambian mayúsculas). A un nombre vivo que ya existe → bloqueado.
export async function renameBacklogTag(id: string, newName: string): Promise<TagResult> {
    const tag = await liveTag(id);
    if (!tag) return { ok: true, id: null };
    const plan = planRename(tag as TagRow, newName, await sectionRowsWithTombstones(tag.user_id, tag.section), await taggedTitles(tag.user_id, tag.section));
    if (!plan.ok) return plan;
    if ('unchanged' in plan) return { ok: true, id };
    const kept = await runActions(tag.user_id, tag.section, plan.actions);
    await rewriteTitles(plan.titles);
    return { ok: true, id: kept };
}

// Borrar (E6): borrado lógico de la etiqueta y se quita de los títulos de la sección, en la misma
// transacción. Devuelve cuántos títulos cambiaron.
export async function deleteBacklogTag(id: string): Promise<number> {
    const tag = await liveTag(id);
    if (!tag) return 0;
    const plan = planDelete(tag as TagRow, await taggedTitles(tag.user_id, tag.section));
    await runActions(tag.user_id, tag.section, plan.actions);
    await rewriteTitles(plan.titles);
    return plan.count;
}

// Cuántos títulos vivos de la sección tienen cada etiqueta (por clave), para el texto de borrado.
export async function getTagUsage(userId: string, section: string): Promise<Record<string, number>> {
    checkSection(section);
    const usage: Record<string, number> = {};
    for (const t of await taggedTitles(userId, section)) {
        for (const k of new Set(tagKeysOf(t.tags))) usage[k] = (usage[k] || 0) + 1;
    }
    return usage;
}

// Guardar un título (P-a / P-d): cada nombre elegido toma el nombre del catálogo para su clave, o
// se crea (inexistente) o se revive (borrada) en el catálogo de la sección, dentro de la misma
// transacción que el título. Devuelve el valor de backlog.tags (forma canónica o null).
export async function ensureTagsForTitle(userId: string, section: string, selected: unknown): Promise<string | null> {
    checkSection(section);
    const plan = resolveTitleTags(selected, await sectionRowsWithTombstones(userId, section));
    if (!plan.ok) throw new Error(`Etiqueta no válida (${plan.error}): ${plan.name}`);
    await runActions(userId, section, plan.actions);
    return plan.names ? JSON.stringify(plan.names) : null;
}
