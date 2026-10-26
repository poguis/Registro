import { getConnection, getCurrentTx } from '../db/connection';
import { nowIso } from '../clock';

// Registra un cambio local para sincronizar (Fase 4). Debe llamarse dentro de la
// MISMA transacción que la escritura de la fila. Guarda solo (tabla, id): el push
// leerá el estado actual de la fila y hará upsert idempotente por id. Un borrado
// lógico es un upsert con deleted_at; op 'delete' queda reservado.
// Una sola entrada por registro y operación (dedupe dentro de la transacción).
export async function enqueueChange(tableName: string, rowId: string, op: 'upsert' | 'delete' = 'upsert'): Promise<void> {
    const state = getCurrentTx();
    const key = `${tableName}:${rowId}`;
    if (state.touched.has(key)) return;
    state.touched.add(key);
    await getConnection().runAsync(
        'INSERT INTO outbox (table_name, row_id, op, created_at, attempts) VALUES (?, ?, ?, ?, 0)',
        [tableName, rowId, op, nowIso()]
    );
}
