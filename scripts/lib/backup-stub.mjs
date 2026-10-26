// Stub de src/services/backup.js para las pruebas en PC: registra las llamadas
// a createPhysicalCopy (y permite simular que fallan) y lista los .db de verdad.
import { readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const backupCalls = [];
export const backupStub = { shouldFail: false };

export async function createPhysicalCopy(label) {
    backupCalls.push(label);
    if (backupStub.shouldFail) throw new Error('fallo simulado de la copia física');
    return { path: `stub/${label}.db`, uri: `file://stub/${label}.db`, size: 1 };
}

export function listDbFilesNextTo(databasePath) {
    const dir = dirname(databasePath);
    return readdirSync(dir)
        .filter((name) => /\.db(-wal|-shm|-journal)?$/i.test(name))
        .map((name) => ({ name, size: statSync(join(dir, name)).size }))
        .sort((a, b) => a.name.localeCompare(b.name));
}
