import { getConnection, type Row } from '../db/connection';
import { nowIso } from '../clock';
import { ensureCategory } from './money';

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

// Instalación nueva (sin datos locales): crea la cuenta ya vinculada (id = auth.uid())
// y sus categorías por defecto (las categorías sí van a la outbox). Llamar dentro de `mutate`.
export async function createLinkedUser(uid: string, email: string): Promise<LocalUser> {
    const now = nowIso();
    await db().runAsync(
        'INSERT INTO users (id, username, email, linked_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        [uid, email, email, now, now, now]
    );
    for (const name of DEFAULT_CATEGORIES) await ensureCategory(uid, name);
    return { id: uid, username: email, email, linked_at: now };
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
