import { syncWithWatchdog, resetNetworkBackoff, takeLocalDataChanged, SYNC_CYCLE_TIMEOUT_MS, type SyncOutcome } from './engine';
import type { SyncConfig } from './config';
import type { Transport } from './transport';

// Single-flight con watchdog, sin dependencias de React Native (lo usa controller.ts y lo
// prueba scripts/probar-fase4.mjs). Una sola sincronización a la vez: lo que se pida durante
// una ejecución se fusiona en UNA ejecución extra al terminar. Cada ciclo tiene un tope
// (syncWithWatchdog): si se cuelga, se da por fallido y el single-flight se libera.
// Al reconectar ('reconexion') o con "Sincronizar ahora" ('boton'), antes del ciclo se reinicia
// el backoff de las entradas que fallaron por red (resetNetworkBackoff): si no, un cambio que
// falló sin conexión esperaría su backoff aunque la red ya volvió.
// Al terminar cada ciclo, si la sync escribió datos locales (pull aplicado o fusión de ids), avisa
// con onDataChanged para que las pantallas abiertas recarguen.
// `prepare` (Fase 5: ensureInitialUpload) corre antes de CADA ciclo, también sin red: así la
// primera subida queda encolada antes del primer ciclo, sea cual sea el disparador que llegue
// primero, y tras vincular la cuenta. Si falla, se registra y el ciclo sigue (se reintenta en el
// siguiente). 'sesion' = el token se renovó (hubo red para hacerlo).
export const RESET_BACKOFF_REASONS = new Set(['reconexion', 'boton', 'sesion']);

// ¿Reintentar al renovarse el token? Solo si el último ciclo no pudo sincronizar por falta de red
// o de sesión. Nunca con la cuenta sin vincular ni con otra cuenta (renovar no lo arregla); con la
// sync apagada ni siquiera se registra (startSyncTriggers) y request() no hace nada.
export const shouldSyncOnSessionRestored = (last: SyncOutcome | null) =>
    !!last && (last.status === 'offline'
        || (last.status === 'skipped' && (last.reason === 'no-session' || last.reason === 'session-expired')));

export type SyncRunner = {
    request(reason: string): Promise<void> | null;
    state(): { syncing: boolean; lastOutcome: SyncOutcome | null };
};

export function createSyncRunner(opts: {
    config: () => SyncConfig;
    transport: () => Transport;
    timeoutMs?: number;
    prepare?: () => Promise<unknown>;
    onChange?: () => void;
    onDataChanged?: () => void;
}): SyncRunner {
    let running: Promise<void> | null = null;
    let again = false;
    let syncing = false;
    let lastOutcome: SyncOutcome | null = null;
    let resetBackoff = false;
    const notify = () => { try { opts.onChange?.(); } catch { /* la UI no debe romper la sync */ } };

    return {
        request(reason) {
            const cfg = opts.config();
            if (!cfg.enabled) return null;
            if (RESET_BACKOFF_REASONS.has(reason)) resetBackoff = true;
            if (running) { again = true; return running; }
            running = (async () => {
                do {
                    again = false;
                    syncing = true;
                    notify();
                    if (opts.prepare) {
                        try {
                            await opts.prepare();
                        } catch (e) {
                            console.error('No se pudo preparar la primera subida:', e);
                        }
                    }
                    try {
                        if (resetBackoff) {
                            resetBackoff = false;
                            await resetNetworkBackoff();
                        }
                        lastOutcome = await syncWithWatchdog(cfg, opts.transport(), opts.timeoutMs ?? SYNC_CYCLE_TIMEOUT_MS);
                    } catch (e) {
                        console.error('Error inesperado en la sincronización:', e);
                    }
                    if (takeLocalDataChanged()) {
                        try { opts.onDataChanged?.(); } catch { /* la UI no debe romper la sync */ }
                    }
                } while (again);
            })().finally(() => {
                syncing = false;
                running = null;
                notify();
            });
            return running;
        },
        state: () => ({ syncing, lastOutcome }),
    };
}
