import { syncWithWatchdog, SYNC_CYCLE_TIMEOUT_MS, type SyncOutcome } from './engine';
import type { SyncConfig } from './config';
import type { Transport } from './transport';

// Single-flight con watchdog, sin dependencias de React Native (lo usa controller.ts y lo
// prueba scripts/probar-fase4.mjs). Una sola sincronización a la vez: lo que se pida durante
// una ejecución se fusiona en UNA ejecución extra al terminar. Cada ciclo tiene un tope
// (syncWithWatchdog): si se cuelga, se da por fallido y el single-flight se libera.

export type SyncRunner = {
    request(reason: string): Promise<void> | null;
    state(): { syncing: boolean; lastOutcome: SyncOutcome | null };
};

export function createSyncRunner(opts: {
    config: () => SyncConfig;
    transport: () => Transport;
    timeoutMs?: number;
    onChange?: () => void;
}): SyncRunner {
    let running: Promise<void> | null = null;
    let again = false;
    let syncing = false;
    let lastOutcome: SyncOutcome | null = null;
    const notify = () => { try { opts.onChange?.(); } catch { /* la UI no debe romper la sync */ } };

    return {
        request(_reason) {
            const cfg = opts.config();
            if (!cfg.enabled) return null;
            if (running) { again = true; return running; }
            running = (async () => {
                do {
                    again = false;
                    syncing = true;
                    notify();
                    try {
                        lastOutcome = await syncWithWatchdog(cfg, opts.transport(), opts.timeoutMs ?? SYNC_CYCLE_TIMEOUT_MS);
                    } catch (e) {
                        console.error('Error inesperado en la sincronización:', e);
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
