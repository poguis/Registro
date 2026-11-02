import { AppState, type AppStateStatus } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { getAppSyncConfig } from './config';
import { createSupabaseTransport } from './supabaseTransport';
import { createSyncRunner } from './runner';
import type { Transport } from './transport';

// Controlador de sincronización de la app. Single-flight con watchdog (runner.ts): una sola
// ejecución a la vez, los disparadores que llegan durante una sincronización se fusionan en UNA
// ejecución extra, y un ciclo que se cuelga se da por fallido a los 2 min. Disparadores
// (registrados solo aquí, en startSyncTriggers): abrir la app, volver a primer plano
// (AppState → 'active'), recuperar conexión (NetInfo: isConnected false → true) y el botón
// "Sincronizar ahora". Sin tareas en segundo plano.

type Listener = () => void;
const listeners = new Set<Listener>();
let transport: Transport | null = null;

const runner = createSyncRunner({
    config: getAppSyncConfig,
    transport: () => (transport ??= createSupabaseTransport()),
    onChange: () => listeners.forEach((l) => l()),
});

export const subscribe = (l: Listener) => { listeners.add(l); return () => { listeners.delete(l); }; };
export const getControllerState = () => runner.state();
export const requestSync = (reason: string) => runner.request(reason);

// Registra los disparadores automáticos. Devuelve la función para quitarlos.
export function startSyncTriggers(): () => void {
    if (!getAppSyncConfig().enabled) return () => {};
    requestSync('apertura');
    const appSub = AppState.addEventListener('change', (state: AppStateStatus) => {
        if (state === 'active') requestSync('primer-plano');
    });
    let wasConnected: boolean | null = null;
    const unsubscribeNet = NetInfo.addEventListener((state) => {
        const connected = state.isConnected === true;
        if (wasConnected === false && connected) requestSync('reconexion');
        wasConnected = connected;
    });
    return () => {
        appSub.remove();
        unsubscribeNet();
    };
}
