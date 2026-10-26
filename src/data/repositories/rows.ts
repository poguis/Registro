import { getConnection, type Row } from '../db/connection';
import { enqueueChange } from '../outbox/outbox';
import { newId } from '../ids';
import { nowIso } from '../clock';

// Escrituras de dominio. Toda escritura pasa por aquí: fija las columnas de sync
// y registra el cambio en la outbox en la misma transacción.

const placeholders = (n: number) => new Array(n).fill('?').join(', ');

// Inserta una fila nueva y devuelve su id (UUID generado antes del INSERT).
export async function insertRow(table: string, userId: string, values: Row): Promise<string> {
    const now = nowIso();
    const row: Row = { id: newId(), user_id: userId, ...values, created_at: now, updated_at: now };
    const cols = Object.keys(row);
    await getConnection().runAsync(
        `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders(cols.length)})`,
        cols.map((c) => row[c])
    );
    await enqueueChange(table, row.id);
    return row.id;
}

// Actualiza columnas de una fila (no borrada) y fija updated_at. Devuelve si cambió algo.
export async function updateRow(table: string, id: string, values: Row): Promise<boolean> {
    const cols = Object.keys(values);
    const res = await getConnection().runAsync(
        `UPDATE ${table} SET ${[...cols, 'updated_at'].map((c) => `${c} = ?`).join(', ')} WHERE id = ? AND deleted_at IS NULL`,
        [...cols.map((c) => values[c]), nowIso(), id]
    );
    if (res.changes > 0) await enqueueChange(table, id);
    return res.changes > 0;
}

// Revive una fila borrada lógicamente (deleted_at = NULL) y aplica valores.
export async function reviveRow(table: string, id: string, values: Row = {}): Promise<void> {
    const cols = Object.keys(values);
    await getConnection().runAsync(
        `UPDATE ${table} SET ${[...cols, 'deleted_at', 'updated_at'].map((c) => `${c} = ?`).join(', ')} WHERE id = ?`,
        [...cols.map((c) => values[c]), null, nowIso(), id]
    );
    await enqueueChange(table, id);
}

// Borrado lógico. Devuelve si la fila estaba viva.
export async function softDelete(table: string, id: string): Promise<boolean> {
    const now = nowIso();
    const res = await getConnection().runAsync(
        `UPDATE ${table} SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`,
        [now, now, id]
    );
    if (res.changes > 0) await enqueueChange(table, id);
    return res.changes > 0;
}

// Borrado lógico de todas las filas vivas que cumplen una condición; cada una con su entrada en outbox.
export async function softDeleteWhere(table: string, where: string, params: any[]): Promise<number> {
    const rows = await getConnection().getAllAsync<Row>(
        `SELECT id FROM ${table} WHERE (${where}) AND deleted_at IS NULL`,
        params
    );
    for (const r of rows) await softDelete(table, r.id);
    return rows.length;
}

// Dueño (user_id) de una fila; lanza si no existe o está borrada.
export async function ownerOf(table: string, id: string): Promise<string> {
    const row = await getConnection().getFirstAsync<Row>(
        `SELECT user_id FROM ${table} WHERE id = ? AND deleted_at IS NULL`,
        [id]
    );
    if (!row) throw new Error(`No existe el registro en ${table}`);
    return row.user_id;
}
