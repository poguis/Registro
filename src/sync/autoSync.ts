// Disparadores automáticos sin dependencias de React Native (los conecta controller.ts y los
// prueba scripts/probar-fase4.mjs). Sin tareas en segundo plano: solo temporizadores de JS
// mientras la app está abierta.
// - Tras cada cambio local (una transacción que encoló algo en la outbox): un ciclo con
//   antirrebote (3 s por defecto), solo con conexión. Varios cambios seguidos → un solo ciclo.
//   Sin conexión no hace nada: el cambio sube al reconectar.
// - Periódico: un ciclo cada 2 min por defecto, solo en primer plano y con conexión. El siguiente
//   se programa cuando termina el anterior, y si ya hay una sync en curso se salta ese turno, así
//   que un ciclo lento nunca acumula otros.
// Ninguno reinicia el backoff de errores (sus motivos no están en RESET_BACKOFF_REASONS).

export type AutoSync = {
    onLocalChange(): void;
    setForeground(active: boolean): void;
    stop(): void;
};

export function createAutoSync(opts: {
    request: (reason: string) => Promise<void> | null;
    isConnected: () => boolean;
    isBusy: () => boolean;
    debounceMs: number;
    periodMs: number;
}): AutoSync {
    let debounce: ReturnType<typeof setTimeout> | null = null;
    let periodic: ReturnType<typeof setTimeout> | null = null;
    let generation = 0; // invalida la cadena periódica anterior al pausar/reanudar

    const clearDebounce = () => { if (debounce) { clearTimeout(debounce); debounce = null; } };
    const clearPeriodic = () => { generation++; if (periodic) { clearTimeout(periodic); periodic = null; } };

    const schedulePeriodic = (gen: number) => {
        periodic = setTimeout(async () => {
            periodic = null;
            if (gen !== generation) return;
            if (opts.isConnected() && !opts.isBusy()) {
                try { await opts.request('periodico'); } catch { /* el runner ya lo registra */ }
            }
            if (gen === generation) schedulePeriodic(gen);
        }, opts.periodMs);
    };

    return {
        onLocalChange() {
            if (!opts.isConnected()) return;
            clearDebounce();
            debounce = setTimeout(() => {
                debounce = null;
                if (opts.isConnected()) opts.request('cambio-local');
            }, opts.debounceMs);
        },
        setForeground(active) {
            clearPeriodic();
            if (active) schedulePeriodic(generation);
        },
        stop() {
            clearDebounce();
            clearPeriodic();
        },
    };
}
