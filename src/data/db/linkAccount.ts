import type { SQLiteDatabase } from 'expo-sqlite';
import { nowIso } from '../clock';
import { maybeFail } from '../../services/devFlags';
import { DOMAIN_TABLES } from './migration3';

// Vinculación de los datos locales con la cuenta de Google (Fase 3). Operación única:
//   - copia física previa (si falla, no se toca nada);
//   - en UNA withExclusiveTransactionAsync: users.id → uid (con email y linked_at) y
//     user_id → uid en las 15 tablas de dominio;
//   - verifica conteos idénticos y 0 filas con user_id ≠ uid; resumen en _migration_log;
//   - NO encola nada en la outbox (el primer sync de la Fase 5 sube todo) y no cambia updated_at.
// Una cuenta por dispositivo: con varias cuentas locales, o datos ya vinculados a otro uid,
// se bloquea sin cambios.

export type LinkStatus = 'linked' | 'already' | 'other-account' | 'multiple-accounts' | 'no-accounts';
export type LinkResult = {
    status: LinkStatus;
    linkedEmail?: string | null;
    counts?: Record<string, number>;
    backupPath?: string;
};
type LocalUser = { id: string; email: string | null; linked_at: string | null };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Lo que pasaría al vincular con `uid`, sin escribir nada.
export function classify(users: LocalUser[], uid: string): LinkResult | null {
    if (users.length === 0) return { status: 'no-accounts' };
    if (users.length > 1) return { status: 'multiple-accounts' };
    const [u] = users;
    if (u.linked_at) {
        return u.id === uid ? { status: 'already', linkedEmail: u.email } : { status: 'other-account', linkedEmail: u.email };
    }
    return null; // se puede vincular
}

const readUsers = (db: SQLiteDatabase) =>
    db.getAllAsync<LocalUser>('SELECT id, email, linked_at FROM users ORDER BY created_at');

export async function linkLocalAccount(
    conn: SQLiteDatabase,
    { uid, email }: { uid: string; email: string },
    { createPhysicalCopy }: { createPhysicalCopy: (label: string) => Promise<{ path: string }> },
): Promise<LinkResult> {
    if (!UUID_RE.test(uid)) throw new Error('uid de Google no válido');
    const pre = classify(await readUsers(conn), uid);
    if (pre) return pre;

    let backupPath: string;
    try {
        backupPath = (await createPhysicalCopy('pre-vinculacion')).path;
    } catch (error: any) {
        throw new Error(`No se pudo crear la copia previa a la vinculación; no se modificó nada. (${error.message})`);
    }

    let result: LinkResult | null = null;
    await conn.withExclusiveTransactionAsync(async (txn) => {
        // Se vuelve a clasificar dentro de la transacción (nada pudo cambiar entre medio).
        const users = await readUsers(txn);
        const again = classify(users, uid);
        if (again) { result = again; return; }
        const localId = users[0].id;
        const linkedAt = nowIso();

        const before: Record<string, number> = {};
        for (const t of DOMAIN_TABLES) {
            before[t] = (await txn.getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t}`))!.n;
        }
        await txn.runAsync('UPDATE users SET id = ?, email = ?, linked_at = ?, updated_at = ? WHERE id = ?',
            [uid, email, linkedAt, linkedAt, localId]);
        for (const t of DOMAIN_TABLES) {
            await txn.runAsync(`UPDATE ${t} SET user_id = ? WHERE user_id = ?`, [uid, localId]);
        }

        // Verificaciones
        for (const t of DOMAIN_TABLES) {
            const n = (await txn.getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t}`))!.n;
            if (n !== before[t]) throw new Error(`Verificación: ${t} tenía ${before[t]} filas y ahora ${n}.`);
            const foreign = (await txn.getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t} WHERE user_id <> ?`, [uid]))!.n;
            if (foreign !== 0) throw new Error(`Verificación: ${t} tiene ${foreign} fila(s) con otro user_id.`);
        }
        const u = await txn.getAllAsync<LocalUser>('SELECT id, email, linked_at FROM users');
        if (u.length !== 1 || u[0].id !== uid || !u[0].linked_at) throw new Error('Verificación: users no quedó vinculado.');

        // El email no se guarda en el registro (solo en users).
        await txn.runAsync(
            'INSERT INTO _migration_log (version, created_at, kind, payload) VALUES (?, ?, ?, ?)',
            [3, linkedAt, 'link', JSON.stringify({ from: localId, to: uid, linkedAt, counts: before })]
        );
        maybeFail('DEV_FAIL_LINK', 'vinculación, antes de confirmar');
        result = { status: 'linked', counts: before, backupPath };
    });
    return result!;
}
