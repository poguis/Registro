import type { SyncOutcome } from './engine';

// Texto del indicador de sincronización (Fase 6.5). Función pura: sin React, sin SQLite y sin
// red; la UI (SyncStatus.js) solo la llama y scripts/probar-fase6-5.mjs la prueba con una tabla.
//
// Prioridad (la primera regla que aplica gana):
//   1. Sin red según NetInfo (connected === false) → "Sin conexión" [— N cambio(s) pendiente(s)].
//      Va primero para que, sin red y con el token vencido, nunca se pida iniciar sesión (H1, Fase 5).
//   2. Ciclo en curso → "Sincronizando…".
//   3. Ciclo omitido → "Inicia sesión…" / "Vincula tu cuenta…" (textos de siempre).
//   4. Ciclo cortado por el watchdog → aviso de siempre (+ pendientes con plural correcto).
//   5. Ciclo "offline" aunque NetInfo diga que hay red (p. ej. el enfriamiento de 60 s de auth-js
//      tras un refresco fallido) → "Sin conexión" [— N …].
//   6. Hay pendientes (con red) → "Sincronizando…": nunca "Sincronizado" con cambios sin subir.
//   7. Último ciclo correcto → "Sincronizado hace X".
//   8. Nada de lo anterior → "Aún no sincronizado".
// connected === null (antes del primer aviso de NetInfo) no se trata como "sin red".
// Las filas bloqueadas (errores) se muestran aparte en la UI y no cambian el texto.

export type SyncStatusKind = 'offline' | 'syncing' | 'signin' | 'link' | 'timeout' | 'ok' | 'idle';

export type SyncStatusInput = {
    connected: boolean | null;
    pending: number;
    syncing: boolean;
    outcome: SyncOutcome | null;
    lastSuccessAt: string | null;
    nowMs: number;
};

// "1 cambio pendiente" / "N cambios pendientes".
export const pendingLabel = (n: number) => `${n} ${n === 1 ? 'cambio pendiente' : 'cambios pendientes'}`;

export const ago = (iso: string, nowMs: number) => {
    const s = Math.max(0, Math.round((nowMs - Date.parse(iso)) / 1000));
    if (s < 60) return 'hace un momento';
    if (s < 3600) return `hace ${Math.round(s / 60)} min`;
    if (s < 86400) return `hace ${Math.round(s / 3600)} h`;
    return `hace ${Math.round(s / 86400)} d`;
};

const offlineText = (pending: number) => (pending > 0 ? `Sin conexión — ${pendingLabel(pending)}` : 'Sin conexión');

export function describeSyncStatus(input: SyncStatusInput): { text: string; kind: SyncStatusKind } {
    const { connected, pending, syncing, outcome, lastSuccessAt, nowMs } = input;
    if (connected === false) return { text: offlineText(pending), kind: 'offline' };
    if (syncing) return { text: 'Sincronizando…', kind: 'syncing' };
    if (outcome && outcome.status === 'skipped') {
        return outcome.reason === 'not-linked'
            ? { text: 'Vincula tu cuenta para sincronizar', kind: 'link' }
            : { text: 'Inicia sesión con Google para sincronizar', kind: 'signin' };
    }
    if (outcome && outcome.status === 'timeout') {
        return { text: `La sincronización tardó demasiado; se reintentará${pending > 0 ? ` · ${pendingLabel(pending)}` : ''}`, kind: 'timeout' };
    }
    if (outcome && outcome.status === 'offline') return { text: offlineText(pending), kind: 'offline' };
    if (pending > 0) return { text: 'Sincronizando…', kind: 'syncing' };
    if (lastSuccessAt) return { text: `Sincronizado ${ago(lastSuccessAt, nowMs)}`, kind: 'ok' };
    return { text: 'Aún no sincronizado', kind: 'idle' };
}
