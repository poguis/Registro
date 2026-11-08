import { AppState, type AppStateStatus } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { getAppSyncConfig } from './config';
import { createSupabaseTransport } from './supabaseTransport';
import { createSyncRunner, shouldSyncOnSessionRestored } from './runner';
import { ensureInitialUpload } from './engine';
import { getSupabase } from '../auth/supabase';
import { subscribeSessionRestored } from '../auth/sessionState';
import { createAutoSync } from './autoSync';
import { setOutboxCommitListener } from '../data/db/connection';
import type { Transport } from './transport';

// Controlador de sincronización de la app. Single-flight con watchdog (runner.ts): una sola
// ejecución a la vez, los disparadores que llegan durante una sincronización se fusionan en UNA
// ejecución extra, y un ciclo que se cuelga se da por fallido a los 2 min. Disparadores
// (registrados solo aquí, en startSyncTriggers): abrir la app, volver a primer plano
// (AppState → 'active'), recuperar conexión (NetInfo: isConnected false → true), el botón
// "Sincronizar ahora", cada cambio local con conexión (antirrebote de 3 s) y uno periódico cada
// 2 min en primer plano con conexión (autoSync.ts) y la renovación del token (TOKEN_REFRESHED)
// tras un ciclo sin conexión o sin sesión, por requestSync (single-flight y backoff). Sin tareas
// en segundo plano.
// Antes de cada ciclo, la primera subida (ensureInitialUpload, Fase 5): una sola vez por
// dispositivo, sin red ni sesión.

// Conectividad (Fase 6.5): el indicador usa el mismo aviso de NetInfo que los disparadores
// (sin una segunda suscripción). null hasta el primer aviso. Los listeners de la UI también se
// avisan cuando cambia la conectividad y tras cada commit que encola en la outbox: solo releen
// el estado local (getSyncStatus), nunca disparan un ciclo ni llaman a la red.

type Listener = () => void;
const listeners = new Set<Listener>();
const dataListeners = new Set<Listener>(); // pantallas abiertas que recargan si la sync cambió datos
let transport: Transport | null = null;
let connectivity: boolean | null = null;
const notifyUi = () => listeners.forEach((l) => { try { l(); } catch { /* la UI nunca rompe la sync */ } });

const runner = createSyncRunner({
    config: getAppSyncConfig,
    transport: () => (transport ??= createSupabaseTransport()),
    prepare: () => ensureInitialUpload(getAppSyncConfig()),
    onChange: () => listeners.forEach((l) => l()),
    onDataChanged: () => dataListeners.forEach((l) => l()),
});

export const subscribe = (l: Listener) => { listeners.add(l); return () => { listeners.delete(l); }; };
export const subscribeDataChanged = (l: Listener) => { dataListeners.add(l); return () => { dataListeners.delete(l); }; };
export const getControllerState = () => runner.state();
export const getConnectivity = () => connectivity;
export const requestSync = (reason: string) => runner.request(reason);

// Registra los disparadores automáticos. Devuelve la función para quitarlos.
export function startSyncTriggers(): () => void {
    const cfg = getAppSyncConfig();
    if (!cfg.enabled) return () => {};
    let connected: boolean | null = null; // null hasta el primer aviso de NetInfo
    const auto = createAutoSync({
        request: requestSync,
        isConnected: () => connected === true,
        isBusy: () => runner.state().syncing,
        debounceMs: cfg.changeDebounceMs,
        periodMs: cfg.periodicMs,
    });
    setOutboxCommitListener(() => {
        auto.onLocalChange();
        notifyUi(); // el conteo de pendientes cambió: la UI lo relee (sin red ni ciclo)
    });
    requestSync('apertura');
    auto.setForeground(AppState.currentState === 'active');
    const appSub = AppState.addEventListener('change', (state: AppStateStatus) => {
        if (state === 'active') requestSync('primer-plano');
        auto.setForeground(state === 'active');
    });
    const unsubscribeNet = NetInfo.addEventListener((state) => {
        const now = state.isConnected === true;
        if (connected === false && now) requestSync('reconexion');
        const changed = connected !== now;
        connected = now;
        connectivity = now;
        if (changed) notifyUi();
    });
    const supabase = getSupabase();
    const unsubscribeAuth = supabase
        ? subscribeSessionRestored(supabase.auth, () => {
            if (shouldSyncOnSessionRestored(runner.state().lastOutcome)) requestSync('sesion');
        })
        : () => {};
    return () => {
        unsubscribeAuth();
        setOutboxCommitListener(null);
        auto.stop();
        appSub.remove();
        unsubscribeNet();
        connectivity = null;
    };
}
