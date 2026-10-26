import { getConnection, type Row } from '../db/connection';
import { insertRow, updateRow, softDelete } from './rows';

// Tarjetas (no guarda número, CVV ni vencimiento).

const db = () => getConnection();

type CardInput = {
    name: string; type: string;
    cutoff_date?: number | null; payment_due_date?: number | null; limit_amount?: number | null;
};

const columns = (d: CardInput) => ({
    name: d.name,
    type: d.type,
    cutoff_date: d.cutoff_date || null,
    payment_due_date: d.payment_due_date || null,
    limit_amount: d.limit_amount === null || d.limit_amount === undefined ? null : d.limit_amount,
});

export async function addCard(userId: string, data: CardInput): Promise<string> {
    return insertRow('cards', userId, columns(data));
}

export async function getCards(userId: string): Promise<Row[]> {
    return db().getAllAsync<Row>(
        'SELECT * FROM cards WHERE user_id = ? AND deleted_at IS NULL ORDER BY type DESC, name ASC',
        [userId]
    );
}

export async function updateCard(id: string, data: CardInput): Promise<void> {
    await updateRow('cards', id, columns(data));
}

export async function deleteCard(id: string): Promise<void> {
    await softDelete('cards', id);
}
