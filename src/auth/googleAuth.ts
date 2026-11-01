import * as WebBrowser from 'expo-web-browser';
import type { Session } from '@supabase/supabase-js';
import { getSupabase } from './supabase';
import { getRedirectUrl, parseCallbackUrl } from './redirect';

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

export async function signInWithGoogle(): Promise<SignInResult> {
    const supabase = getSupabase();
    if (!supabase) {
        return { status: 'error', message: 'Falta configurar Supabase en esta compilación (.env).' };
    }
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

// Cierra la sesión de Google SOLO en este dispositivo. No toca los datos locales.
export async function signOutGoogle(): Promise<void> {
    const supabase = getSupabase();
    if (!supabase) return;
    try {
        await supabase.auth.signOut({ scope: 'local' });
    } catch (e) {
        console.error('Error al cerrar sesión de Google:', e);
    }
}

// Sesión guardada (puede estar vencida o no existir; sin red no falla la app).
export async function getStoredSession(): Promise<Session | null> {
    const supabase = getSupabase();
    if (!supabase) return null;
    try {
        const { data } = await supabase.auth.getSession();
        return data.session;
    } catch {
        return null;
    }
}
