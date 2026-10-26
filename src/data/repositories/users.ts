import { getConnection, type Row } from '../db/connection';
import { newId } from '../ids';
import { nowIso } from '../clock';
import { ensureCategory } from './money';

// Usuarios: tabla LOCAL (no se sincroniza ni pasa por la outbox).
// El login con contraseña se retira en la Fase 3 (Google).

const db = () => getConnection();
const DEFAULT_CATEGORIES = ['Comida', 'Transporte', 'Sueldo', 'Venta', 'Salud', 'Hogar'];

export type SessionUser = { id: string; username: string };

// Crea la cuenta y sus categorías por defecto (las categorías sí van a la outbox).
export async function registerUser(username: string, password: string): Promise<string> {
    const id = newId();
    const now = nowIso();
    await db().runAsync(
        'INSERT INTO users (id, username, password, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        [id, username, password, now, now]
    );
    for (const name of DEFAULT_CATEGORIES) await ensureCategory(id, name);
    return id;
}

// Devuelve solo { id, username }: nunca la contraseña.
export async function loginUser(username: string, password: string): Promise<SessionUser | null> {
    return db().getFirstAsync<SessionUser>(
        'SELECT id, username FROM users WHERE username = ? AND password = ?',
        [username, password]
    );
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

// Resumen de la última migración registrada (para mostrarlo en la app).
export async function getLatestMigrationSummary(): Promise<Row | null> {
    const row = await db().getFirstAsync<Row>(
        "SELECT payload FROM _migration_log WHERE kind = 'summary' ORDER BY id DESC LIMIT 1"
    );
    return row ? JSON.parse(row.payload) : null;
}
