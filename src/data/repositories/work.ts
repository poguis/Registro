import { getConnection, type Row } from '../db/connection';
import { insertRow, updateRow, softDelete } from './rows';

// Trabajo: personas y sus ciclos de turnos (cycle = JSON array [{type, days}]).

const db = () => getConnection();

export async function getWorkPeople(userId: string): Promise<Row[]> {
    return db().getAllAsync<Row>(
        'SELECT * FROM work_people WHERE user_id = ? AND deleted_at IS NULL ORDER BY sort_order ASC, created_at DESC',
        [userId]
    );
}

export async function addWorkPerson(userId: string, name: string, startDate: string, cycle: string): Promise<string> {
    const max = await db().getFirstAsync<Row>(
        'SELECT MAX(sort_order) AS m FROM work_people WHERE user_id = ? AND deleted_at IS NULL',
        [userId]
    );
    const nextOrder = ((max && max.m) || 0) + 1;
    return insertRow('work_people', userId, { name, start_date: startDate, cycle, sort_order: nextOrder });
}

export async function updateWorkPersonOrder(id: string, order: number): Promise<void> {
    await updateRow('work_people', id, { sort_order: order });
}

export async function updateWorkPerson(id: string, name: string, startDate: string, cycle: string): Promise<void> {
    await updateRow('work_people', id, { name, start_date: startDate, cycle });
}

export async function deleteWorkPerson(id: string): Promise<void> {
    await softDelete('work_people', id);
}
