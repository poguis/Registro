import { getConnection, type Row } from '../db/connection';
import { insertRow, softDelete } from './rows';

// Deudas y préstamos: contactos y sus transacciones.

const db = () => getConnection();

export type LinkedDebt = {
    contactId: string | null;
    contactName: string;
    type: 'debt' | 'loan';
    amount: number;
    description: string | null;
};

export async function getContacts(userId: string): Promise<Row[]> {
    return db().getAllAsync<Row>(
        'SELECT * FROM finance_contacts WHERE user_id = ? AND deleted_at IS NULL ORDER BY name ASC',
        [userId]
    );
}

// Crea el contacto si no viene id (o reutiliza uno vivo con el mismo nombre) e inserta
// la deuda/préstamo. Devuelve el id del contacto.
export async function insertDebt(
    userId: string, contactId: string | null, contactName: string,
    type: 'debt' | 'loan', amount: number, description: string | null
): Promise<string> {
    let finalContactId = contactId;
    if (!finalContactId) {
        const existing = await db().getFirstAsync<Row>(
            'SELECT id FROM finance_contacts WHERE user_id = ? AND name = ? AND deleted_at IS NULL',
            [userId, contactName]
        );
        finalContactId = existing ? existing.id : await insertRow('finance_contacts', userId, { name: contactName });
    }
    await insertRow('finance_transactions', userId, { contact_id: finalContactId, type, amount, description });
    return finalContactId as string;
}

export async function deleteTransaction(transactionId: string): Promise<void> {
    await softDelete('finance_transactions', transactionId);
}

// Contactos con transacciones vivas de ese tipo, con sus transacciones y el total.
export async function getFinanceData(userId: string, type: string): Promise<Row[]> {
    const contacts = await db().getAllAsync<Row>(
        `SELECT DISTINCT c.*
         FROM finance_contacts c
         JOIN finance_transactions t ON c.id = t.contact_id
         WHERE c.user_id = ? AND t.type = ? AND c.deleted_at IS NULL AND t.deleted_at IS NULL`,
        [userId, type]
    );
    const result: Row[] = [];
    for (const contact of contacts) {
        const transactions = await db().getAllAsync<Row>(
            `SELECT * FROM finance_transactions
             WHERE contact_id = ? AND type = ? AND deleted_at IS NULL
             ORDER BY created_at DESC`,
            [contact.id, type]
        );
        const total = transactions.reduce((sum, t) => sum + t.amount, 0);
        result.push({ ...contact, transactions, total });
    }
    return result;
}
