import { nowIso } from '../clock';
import { maybeFail } from '../../services/devFlags';
import { MIGRATED_TABLES } from './migration2';

// Migración 3 (Fase 3): retiro del login con contraseña.
//   - users se reconstruye SIN password y con email / linked_at (vinculación con Google).
//     Sin UNIQUE(username): con Google la identidad es el id (= auth.uid() al vincular).
//   - legacy_users.password se vacía ('' porque la columna es NOT NULL).
//   - secure_delete ON: el texto viejo no queda en páginas libres del archivo.
// Corre dentro de UNA withExclusiveTransactionAsync (el runner) después de la copia física
// previa; cualquier error ⇒ rollback y user_version sigue en 2. Las tablas de dominio no se tocan.
//
// Las copias físicas previas (respaldos/) conservan la contraseña: ver DECISIONES (Fase 6).

type Db = {
    execAsync(sql: string): Promise<void>;
    runAsync(sql: string, params?: any[]): Promise<{ changes: number; lastInsertRowId: number }>;
    getAllAsync<T = any>(sql: string, params?: any[]): Promise<T[]>;
    getFirstAsync<T = any>(sql: string, params?: any[]): Promise<T | null>;
};

export const DOMAIN_TABLES = MIGRATED_TABLES.filter((t) => t !== 'users');

export const USERS_V3 = `CREATE TABLE users_v3 (
    id TEXT PRIMARY KEY, -- UUID local; al vincular pasa a ser el auth.uid() de Google
    username TEXT NOT NULL, -- nombre visible (cuentas nuevas: el email)
    email TEXT, -- email de Google; NULL hasta vincular
    linked_at TEXT, -- ISO-8601 UTC; NULL = sin vincular
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
)`; // tabla local: no se sincroniza ni pasa por la outbox

const countOf = async (txn: Db, table: string) =>
    (await txn.getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`))!.n;

export async function migration3(txn: Db, log: string[]) {
    const fail = (msg: string): never => { throw new Error(msg); };
    const startedAt = nowIso();
    await txn.execAsync('PRAGMA secure_delete = ON');

    // 1. Estado previo
    const cols = await txn.getAllAsync<{ name: string }>('PRAGMA table_info(users)');
    if (!cols.some((c) => c.name === 'password')) fail('Chequeo previo: users ya no tiene password (¿esquema inesperado?).');
    const usersBefore = await txn.getAllAsync<{ id: string; username: string }>('SELECT id, username FROM users ORDER BY id');
    const before: Record<string, number> = {};
    for (const t of DOMAIN_TABLES) before[t] = await countOf(txn, t);
    const legacyUsers = await countOf(txn, 'legacy_users');
    log.push(`chequeos previos OK (${usersBefore.length} usuario(s))`);

    // 2. users sin password
    await txn.execAsync(USERS_V3);
    await txn.execAsync(`INSERT INTO users_v3 (id, username, email, linked_at, created_at, updated_at)
        SELECT id, username, NULL, NULL, created_at, updated_at FROM users`);
    await txn.execAsync('DROP TABLE users');
    await txn.execAsync('ALTER TABLE users_v3 RENAME TO users');
    log.push('users reconstruida sin password');

    // 3. legacy_users.password vacío
    const cleared = await txn.runAsync("UPDATE legacy_users SET password = '' WHERE password IS NOT NULL AND password <> ''");
    log.push(`legacy_users: ${cleared.changes} contraseña(s) vaciada(s)`);

    // 4. Verificaciones
    const colsAfter = await txn.getAllAsync<{ name: string }>('PRAGMA table_info(users)');
    if (colsAfter.some((c) => c.name === 'password')) fail('Verificación: users todavía tiene la columna password.');
    for (const c of ['id', 'username', 'email', 'linked_at', 'created_at', 'updated_at']) {
        if (!colsAfter.some((x) => x.name === c)) fail(`Verificación: falta users.${c}.`);
    }
    const usersAfter = await txn.getAllAsync<{ id: string; username: string }>('SELECT id, username FROM users ORDER BY id');
    if (JSON.stringify(usersAfter) !== JSON.stringify(usersBefore)) fail('Verificación: los usuarios no coinciden tras reconstruir users.');
    const visible = (await txn.getFirstAsync<{ n: number }>("SELECT COUNT(*) AS n FROM legacy_users WHERE password IS NOT NULL AND password <> ''"))!.n;
    if (visible !== 0) fail(`Verificación: quedan ${visible} contraseña(s) en legacy_users.`);
    if (await countOf(txn, 'legacy_users') !== legacyUsers) fail('Verificación: cambió el número de filas de legacy_users.');
    const after: Record<string, number> = {};
    for (const t of DOMAIN_TABLES) {
        after[t] = await countOf(txn, t);
        if (after[t] !== before[t]) fail(`Verificación: ${t} tenía ${before[t]} filas y ahora ${after[t]}.`);
    }
    log.push('verificaciones OK');

    // 5. Registro
    await txn.runAsync(
        'INSERT INTO _migration_log (version, created_at, kind, payload) VALUES (?, ?, ?, ?)',
        [3, nowIso(), 'summary', JSON.stringify({
            version: 3, startedAt, finishedAt: nowIso(), users: usersAfter.length,
            legacyPasswordsCleared: cleared.changes, before, after,
        })]
    );
    maybeFail('DEV_FAIL_MIGRATION', 'migración 3, antes de fijar user_version');
    log.push('resumen guardado en _migration_log');
}
