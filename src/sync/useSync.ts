import { useCallback, useEffect, useState } from 'react';
import { getAppSyncConfig } from './config';
import { getControllerState, requestSync, subscribe } from './controller';
import { getSyncStatus, unblockAll, type SyncStatus } from './engine';
import type { SyncOutcome } from './engine';

// Estado de sincronización para la UI (no bloqueante). La UI no importa el motor ni
// supabase-js: usa este hook.
export function useSync() {
    const enabled = getAppSyncConfig().enabled;
    const [status, setStatus] = useState<SyncStatus | null>(null);
    const [syncing, setSyncing] = useState(false);
    const [outcome, setOutcome] = useState<SyncOutcome | null>(null);

    const refresh = useCallback(async () => {
        try {
            setStatus(await getSyncStatus());
        } catch {
            // la BD puede no estar lista todavía
        }
        const s = getControllerState();
        setSyncing(s.syncing);
        setOutcome(s.lastOutcome);
    }, []);

    useEffect(() => {
        if (!enabled) return undefined;
        refresh();
        const unsub = subscribe(refresh);
        const timer = setInterval(refresh, 30_000); // "hace X" y conteos al día
        return () => { unsub(); clearInterval(timer); };
    }, [enabled, refresh]);

    const syncNow = useCallback(() => { requestSync('boton'); }, []);
    const retryBlocked = useCallback(async () => {
        await unblockAll();
        await refresh();
        requestSync('reintentar');
    }, [refresh]);

    return { enabled, status, syncing, outcome, syncNow, retryBlocked };
}
