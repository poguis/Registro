import { getConnection, type Row } from '../db/connection';
import { nowIso } from '../clock';
import { ensureCategory } from './money';
import { insertRow } from './rows';

// Usuarios: tabla LOCAL (no se sincroniza ni pasa por la outbox).
// Desde la Fase 3 no hay contraseña: la identidad es la cuenta de Google. Al vincular,
// users.id pasa a ser el auth.uid() (ver src/data/db/linkAccount.ts).

const db = () => getConnection();
export const DEFAULT_CATEGORIES = ['Comida', 'Transporte', 'Sueldo', 'Venta', 'Salud', 'Hogar'];

export type SessionUser = { id: string; username: string };
export type LocalUser = SessionUser & { email: string | null; linked_at: string | null };

export async function getLocalUsers(): Promise<LocalUser[]> {
    return db().getAllAsync<LocalUser>('SELECT id, username, email, linked_at FROM users ORDER BY created_at');
}

// Marca de "siembra pendiente" (Fase 6.6) en sync_meta (clave/valor, migración 4: sin esquema
// nuevo). Valor = uid del usuario creado; al sembrar pasa a NULL y se escribe SEEDED_AT.
export const DEFAULT_CATEGORIES_PENDING = 'default_categories_pending';
export const DEFAULT_CATEGORIES_SEEDED_AT = 'default_categories_seeded_at';

const setSyncMeta = (key: string, value: string | null) => db().runAsync(
    'INSERT INTO sync_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, value]);

// Instalación nueva (sin datos locales): crea la cuenta ya vinculada (id = auth.uid())
// y sus categorías por defecto (las categorías sí van a la outbox). Llamar dentro de `mutate`.
// Fase 6.6 (H2 de la Fase 5): con la sync encendida (deferDefaultCategories) y una BD SIN
// usuarios, NO siembra aquí: deja la marca y la sync siembra solo las que falten después del
// primer pull completo de finance_categories (seedPendingDefaultCategories). Así nunca se sube
// el contenido del dispositivo nuevo sobre las categorías del servidor ni revive una borrada.
// Con la sync apagada siembra como siempre.
export async function createLinkedUser(uid: string, email: string, opts: { deferDefaultCategories?: boolean } = {}): Promise<LocalUser> {
    const now = nowIso();
    const before = (await db().getAllAsync<Row>('SELECT id, username FROM users')).length;
    await db().runAsync(
        'INSERT INTO users (id, username, email, linked_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        [uid, email, email, now, now, now]
    );
    if (opts.deferDefaultCategories && before === 0) {
        await setSyncMeta(DEFAULT_CATEGORIES_PENDING, uid);
    } else {
        for (const name of DEFAULT_CATEGORIES) await ensureCategory(uid, name);
    }
    return { id: uid, username: email, email, linked_at: now };
}

// Siembra diferida (Fase 6.6). La llama el motor de sync SOLO tras un pull completo de
// finance_categories, dentro de `mutate` (cola + transacción). Si la marca no es exactamente
// `uid`, no hace nada (ni toca la marca). Crea solo los nombres por defecto que NO tengan
// ninguna fila del usuario, ni viva ni borrada: una categoría por defecto borrada en el servidor
// no se vuelve a sembrar (no usa ensureCategory, que revive). Las creaciones van a la outbox como
// cualquier creación local (insertRow). En la misma transacción limpia la marca: un cierre a mitad
// deshace todo y el ciclo siguiente lo repite; la comprobación por nombre impide duplicados.
export async function seedPendingDefaultCategories(uid: string): Promise<number> {
    const mark = await db().getFirstAsync<Row>('SELECT value FROM sync_meta WHERE key = ?', [DEFAULT_CATEGORIES_PENDING]);
    if (!mark || mark.value !== uid) return 0;
    let seeded = 0;
    for (const name of DEFAULT_CATEGORIES) {
        // Busca también las borradas (como ensureCategory), pero nunca las revive.
        const exists = await db().getFirstAsync<Row>('SELECT id, deleted_at FROM finance_categories WHERE user_id = ? AND name = ?', [uid, name]);
        if (!exists) {
            await insertRow('finance_categories', uid, { name });
            seeded++;
        }
    }
    await setSyncMeta(DEFAULT_CATEGORIES_PENDING, null);
    await setSyncMeta(DEFAULT_CATEGORIES_SEEDED_AT, nowIso());
    return seeded;
}

export async function getUserById(id: string): Promise<SessionUser | null> {
    return db().getFirstAsync<SessionUser>('SELECT id, username FROM users WHERE id = ?', [id]);
}

// Sesión antigua con id entero: busca el UUID nuevo en _id_map (migración 2).
export async function mapLegacyUserId(oldId: number): Promise<SessionUser | null> {
    const row = await db().getFirstAsync<Row>(
        "SELECT u.id, u.username FROM _id_map m JOIN users u ON u.id = m.new_id WHERE m.table_name = 'users' AND m.old_id = ?",
        [oldId]
    );
    return row ? { id: row.id, username: row.username } : null;
}

// Resumen de la migración 2 (el que App.js muestra al terminarla).
export async function getLatestMigrationSummary(): Promise<Row | null> {
    const row = await db().getFirstAsync<Row>(
        "SELECT payload FROM _migration_log WHERE kind = 'summary' AND version = 2 ORDER BY id DESC LIMIT 1"
    );
    return row ? JSON.parse(row.payload) : null;
}
