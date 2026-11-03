import { useCallback, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { getSupabase, isSupabaseConfigured } from './supabase';
import { signInWithGoogle, signOutGoogle, getStoredSession, type SignInResult } from './googleAuth';

// Estado de la sesión de Google para la UI (la UI nunca importa supabase-js directamente).
// La sesión puede faltar o estar vencida: eso NO bloquea la app (solo la sincronización).
export function useAuth() {
    const [session, setSession] = useState<Session | null>(null);
    // Sesión guardada que no se pudo renovar por falta de red: no se pide "Inicia sesión".
    const [sessionOffline, setSessionOffline] = useState(false);
    const [signingIn, setSigningIn] = useState(false);

    useEffect(() => {
        const supabase = getSupabase();
        if (!supabase) return;
        let active = true;
        getStoredSession().then((s) => { if (active) { setSession(s.session); setSessionOffline(s.offline); } });
        const { data } = supabase.auth.onAuthStateChange((_event, s) => {
            if (!active) return;
            setSession(s);
            if (s) setSessionOffline(false);
        });
        return () => {
            active = false;
            data.subscription.unsubscribe();
        };
    }, []);

    const signIn = useCallback(async (): Promise<SignInResult> => {
        setSigningIn(true);
        try {
            const r = await signInWithGoogle();
            if (r.status === 'success') { setSession(r.session); setSessionOffline(false); }
            return r;
        } finally {
            setSigningIn(false);
        }
    }, []);

    const signOut = useCallback(async () => {
        await signOutGoogle();
        setSession(null);
        setSessionOffline(false);
    }, []);

    return {
        configured: isSupabaseConfigured(),
        session,
        sessionOffline,
        email: session?.user.email ?? null,
        uid: session?.user.id ?? null,
        signingIn,
        signIn,
        signOut,
    };
}
