import { AppState, type AppStateStatus } from 'react-native';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { installCryptoShim } from './cryptoShim';
import { LargeSecureStore } from './secureStorage';

// Cliente de Supabase (solo Auth en la Fase 3). Usa SOLO la Project URL y la publishable key
// (EXPO_PUBLIC_*, en .env, ignorado por git). Si faltan, getSupabase() devuelve null: el login
// muestra un error, pero la app sigue abriendo los datos locales.
// Opciones según la guía oficial de Supabase para Expo React Native + PKCE:
//   storage cifrado, persistSession, detectSessionInUrl: false, flowType: 'pkce'.
// autoRefreshToken + AppState: la referencia de startAutoRefresh indica que en RN el refresco
// corre continuo, y recomienda arrancarlo/pararlo según el primer plano.

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

let client: SupabaseClient | null = null;
let appStateSubscribed = false;

export const isSupabaseConfigured = () =>
    !!SUPABASE_URL && /^https:\/\//.test(SUPABASE_URL) && !!SUPABASE_KEY && SUPABASE_KEY.startsWith('sb_publishable_');

export function getSupabase(): SupabaseClient | null {
    if (client) return client;
    if (!isSupabaseConfigured()) return null;
    installCryptoShim();
    client = createClient(SUPABASE_URL!, SUPABASE_KEY!, {
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
