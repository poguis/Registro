import * as WebBrowser from 'expo-web-browser';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Session } from '@supabase/supabase-js';
import { getSupabase } from './supabase';
import { LargeSecureStore } from './secureStorage';
import { getRedirectUrl, parseCallbackUrl } from './redirect';
import { readSessionState, type StoredSessionState } from './sessionState';
import { signOutLocally } from './signOutLocal';

// Login con Google: OAuth + PKCE de Supabase en Custom Tabs (expo-web-browser).
//   1. signInWithOAuth({ provider: 'google', options: { redirectTo, skipBrowserRedirect: true } })
//      → URL de autorización (supabase-js guarda el code_verifier en el storage cifrado).
//   2. WebBrowser.openAuthSessionAsync(url, redirectTo) → { type: 'success', url } al volver.
//   3. exchangeCodeForSession(code): el code dura 5 min y se usa una vez (doc PKCE de Supabase).
// Nunca toca SQLite: la vinculación de datos es aparte (accountFlow.ts).

export type SignInResult =
    | { status: 'success'; session: Session }
    | { status: 'cancel' }
    | { status: 'error'; message: string };

// auth-js guarda por cada login un slot `<storageKey>-flow-<id>-code-verifier`, un índice
// `<storageKey>-flows-code-verifier` y la clave clásica `<storageKey>-code-verifier`. Sin flowId
// (no usamos sb_flow_id), exchangeCodeForSession solo borra la clave clásica: los slots se
// acumulan (hasta 5). Al terminar cada intento (éxito, cancelación o error) no queda ningún
// flujo pendiente, así que se borran todos (cifrado en AsyncStorage + llave en SecureStore).
// Nunca toca la sesión (<storageKey> sin sufijo).
export const PKCE_VERIFIER_KEY_RE = /^sb-.+-code-verifier$/;

export async function clearPkceVerifiers(): Promise<number> {
    const keys = (await AsyncStorage.getAllKeys()).filter((k) => PKCE_VERIFIER_KEY_RE.test(k));
    for (const k of keys) await LargeSecureStore.removeItem(k);
    return keys.length;
}

export async function signInWithGoogle(): Promise<SignInResult> {
    const supabase = getSupabase();
    if (!supabase) {
        return { status: 'error', message: 'Falta configurar Supabase en esta compilación (.env).' };
    }
    try {
        return await runGoogleFlow(supabase);
    } finally {
        try {
            await clearPkceVerifiers();
        } catch (e) {
            console.error('No se pudieron limpiar los verificadores PKCE:', e);
        }
    }
}

async function runGoogleFlow(supabase: NonNullable<ReturnType<typeof getSupabase>>): Promise<SignInResult> {
    try {
        const redirectTo = getRedirectUrl();
        const { data, error } = await supabase.auth.signInWithOAuth({
            provider: 'google',
            options: { redirectTo, skipBrowserRedirect: true },
        });
        if (error || !data?.url) return { status: 'error', message: error?.message || 'No se obtuvo la URL de Google.' };

        const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
        if (result.type !== 'success') return { status: 'cancel' };

        const parsed = parseCallbackUrl(result.url, redirectTo);
        if ('error' in parsed) return { status: 'error', message: parsed.error };

        const exchanged = await supabase.auth.exchangeCodeForSession(parsed.code);
        if (exchanged.error || !exchanged.data.session) {
            return { status: 'error', message: exchanged.error?.message || 'No se pudo crear la sesión.' };
        }
        return { status: 'success', session: exchanged.data.session };
    } catch (e: any) {
        return { status: 'error', message: e?.message || 'Error de red al iniciar sesión.' };
    }
}

// Cierra la sesión de Google SOLO en este dispositivo, también sin red (signOutLocal.ts). No toca
// los datos locales. Solo se llama cuando el usuario lo pide (o al bloquear un login de otra
// cuenta, accountFlow.ts); la app nunca cierra la sesión por su cuenta.
export async function signOutGoogle(): Promise<void> {
    const supabase = getSupabase();
    if (!supabase) return;
    try {
        const r = await signOutLocally(supabase.auth, LargeSecureStore);
        if (!r.cleared) console.error('No se pudo borrar la sesión guardada.');
    } catch (e) {
        console.error('Error al cerrar sesión de Google:', e);
    }
}

// Sesión guardada (puede estar vencida o no existir; sin red no falla la app). `offline`: hay
// sesión guardada pero no se pudo renovar por falta de red (ver sessionState.ts).
export async function getStoredSession(): Promise<StoredSessionState> {
    const supabase = getSupabase();
    if (!supabase) return { session: null, offline: false };
    return readSessionState(supabase.auth);
}
