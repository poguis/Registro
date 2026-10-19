// Stub de src/services/backup.js para las pruebas en PC: registra las llamadas
// a createPhysicalCopy y permite simular que fallan.
export const backupCalls = [];
export const backupStub = { shouldFail: false };

export async function createPhysicalCopy(label) {
    backupCalls.push(label);
    if (backupStub.shouldFail) throw new Error('fallo simulado de la copia física');
    return { path: `stub/${label}.db`, uri: `file://stub/${label}.db`, size: 1 };
}
