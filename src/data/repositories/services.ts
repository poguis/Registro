import { getConnection, type Row } from '../db/connection';
import { insertRow, updateRow, softDelete } from './rows';

// Servicios. total_value se ALMACENA como valor histórico (Internacional = base × 1,20;
// Local = base + adicional, según ServiciosScreen) y se escribe junto con
// original_value/additional_value en la misma operación.

const db = () => getConnection();

type ServiceInput = {
    name: string; type: string; status: string;
    originalValue: number; additionalValue?: number; totalValue: number;
};

const columns = (d: ServiceInput) => ({
    name: d.name,
    type: d.type,
    status: d.status,
    original_value: d.originalValue,
    additional_value: d.additionalValue || 0,
    total_value: d.totalValue,
});

export async function addService(userId: string, data: ServiceInput): Promise<string> {
    return insertRow('services', userId, columns(data));
}

export async function getServices(userId: string): Promise<Row[]> {
    return db().getAllAsync<Row>(
        'SELECT * FROM services WHERE user_id = ? AND deleted_at IS NULL ORDER BY status ASC, name ASC',
        [userId]
    );
}

export async function updateService(id: string, data: ServiceInput): Promise<void> {
    await updateRow('services', id, columns(data));
}

export async function deleteService(id: string): Promise<void> {
    await softDelete('services', id);
}

export async function toggleServiceStatus(id: string, currentStatus: string): Promise<string> {
    const newStatus = currentStatus === 'Activo' ? 'Inactivo' : 'Activo';
    await updateRow('services', id, { status: newStatus });
    return newStatus;
}
