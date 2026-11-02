import { AppState, type AppStateStatus } from 'react-native';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import Constants from 'expo-constants';
import { installCryptoShim } from './cryptoShim';
import { LargeSecureStore } from './secureStorage';
import { createFetchWithTimeout } from './fetchWithTimeout';

// Cliente de Supabase (Auth desde la Fase 3; datos desde la Fase 4). Usa SOLO la Project URL y
// la publishable key del proyecto de la variante, que app.config.js pone en extra.supabase
// (producción → proyecto real; dev → Registro Dev; la app no lee process.env, así cada APK
// lleva solo su proyecto). Si faltan, getSupabase() devuelve null: el login muestra un error,
// pero la app sigue abriendo los datos locales.
// Opciones según la guía oficial de Supabase para Expo React Native + PKCE:
//   storage cifrado, persistSession, detectSessionInUrl: false, flowType: 'pkce'.
// autoRefreshToken + AppState: la referencia de startAutoRefresh indica que en RN el refresco
// corre continuo, y recomienda arrancarlo/pararlo según el primer plano.

const projectConfig = (): { url: string | null; key: string | null } => {
    const p = Constants.expoConfig?.extra?.supabase;
    return { url: p?.url ?? null, key: p?.key ?? null };
};

let client: SupabaseClient | null = null;
let appStateSubscribed = false;

export const isSupabaseConfigured = () => {
    const { url, key } = projectConfig();
    return !!url && /^https:\/\//.test(url) && !!key && key.startsWith('sb_publishable_');
};

export function getSupabase(): SupabaseClient | null {
    if (client) return client;
    if (!isSupabaseConfigured()) return null;
    installCryptoShim();
    const { url, key } = projectConfig();
    client = createClient(url!, key!, {
        // Tope de 20 s por petición: una red colgada nunca deja una sincronización esperando.
        global: { fetch: createFetchWithTimeout() },
        auth: {
            storage: LargeSecureStore,
            autoRefreshToken: true,
            persistSession: true,
            detectSessionInUrl: false,
            flowType: 'pkce',
        },
    });
    if (!appStateSubscribed) {
        appStateSubscribed = true;
        const onChange = (state: AppStateStatus) => {
            if (!client) return;
            if (state === 'active') client.auth.startAutoRefresh();
            else client.auth.stopAutoRefresh();
        };
        AppState.addEventListener('change', onChange);
        onChange(AppState.currentState);
    }
    return client;
}
