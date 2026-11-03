import { isAuthRetryableFetchError, type Session } from '@supabase/supabase-js';

// Estado de la sesión guardada, distinguiendo "sin red" de "sin sesión" (Fase 5).
// auth-js 2.118 (GoTrueClient.__loadSession): si el access token guardado está vencido intenta
// renovarlo; sin red falla con AuthRetryableFetchError y getSession() devuelve session: null,
// aunque la sesión sigue guardada y se renovará sola al volver la red (autoRefreshToken).
// Sin sesión guardada no intenta renovar y devuelve { session: null, error: null }.
// Por eso `offline` solo es true cuando HAY sesión guardada y el fallo es de red: la UI no pide
// "Inicia sesión" sin conexión, y sin sesión guardada la sigue pidiendo.
// Sin lock en React Native: supabase-js no pasa `lock` y auth-js coordina sin él (un solo
// refresco en vuelo compartido por getSession() y el autorefresco).

export type StoredSessionState = { session: Session | null; offline: boolean };

type AuthLike = { getSession(): Promise<{ data: { session: Session | null }; error: unknown }> };

export async function readSessionState(auth: AuthLike): Promise<StoredSessionState> {
    try {
        const { data, error } = await auth.getSession();
        if (data.session) return { session: data.session, offline: false };
        return { session: null, offline: !!error && isAuthRetryableFetchError(error) };
    } catch (e) {
        return { session: null, offline: isAuthRetryableFetchError(e) };
    }
}

// Aviso cuando el token se renueva (solo TOKEN_REFRESHED: ni SIGNED_IN ni INITIAL_SESSION, que
// el login y el arranque ya cubren con sus propios ciclos). Lo usa la sync para reintentar un
// ciclo que terminó sin conexión o con la sesión vencida: tras un refresco fallido,
// auth-js devuelve el mismo fallo durante REFRESH_FAILURE_COOLDOWN_MS (60 s) a quien pida la
// sesión, así que el ciclo de reconexión puede llegar antes de que se renueve.
type AuthEvents = { onAuthStateChange(cb: (event: string, session: Session | null) => void): { data: { subscription: { unsubscribe(): void } } } };

export function subscribeSessionRestored(auth: AuthEvents, fn: () => void): () => void {
    const { data } = auth.onAuthStateChange((event, session) => {
        if (session && event === 'TOKEN_REFRESHED') {
            // Fuera del callback de auth-js: no se piden sesiones desde dentro de su aviso.
            setTimeout(() => { try { fn(); } catch { /* el aviso nunca rompe la sesión */ } }, 0);
        }
    });
    return () => data.subscription.unsubscribe();
}
