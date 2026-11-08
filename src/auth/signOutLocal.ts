// "Cerrar sesión" que funciona también sin red (Fase 6.5, H6 de la Fase 5). Solo se usa cuando
// el usuario lo pide; la app nunca cierra la sesión por su cuenta. No toca los datos locales.
//
// Por qué hace falta (auth-js 2.118.0, node_modules/@supabase/auth-js/dist/module/GoTrueClient.js):
// signOut → _signOut → _useSession → __loadSession. Con el access token vencido, __loadSession
// intenta renovarlo (_callRefreshToken); sin red falla con AuthRetryableFetchError y _signOut
// devuelve ese error SIN llamar a _removeSession: la sesión seguía guardada.
//
// Qué hace, solo con API pública y con el storage de la propia app:
//   1. auth.signOut({ scope: 'local' }). Si no hay error, listo (con red, o sin red con el token
//      vigente: auth-js borra la sesión aunque falle /logout).
//   2. Si falla, borra del storage de la app (LargeSecureStore) la clave de la sesión. La clave sale
//      de la configuración real del cliente (auth.storageKey: la que auth-js usa para leer y
//      escribir), nunca escrita a mano; también `<clave>-user`.
//   3. Vuelve a llamar a auth.signOut({ scope: 'local' }): sin sesión guardada, __loadSession
//      devuelve { session: null, error: null } sin red, y _signOut llama a _removeSession, que sube
//      _sessionRemovalEpoch (un refresco en vuelo no vuelve a guardar la sesión), borra los
//      verificadores PKCE y emite SIGNED_OUT.
//
// Única excepción aceptada a "la app nunca cierra la sesión sola" (decisión de la Fase 6.5): auth-js
// borra la sesión por su cuenta solo cuando el SERVIDOR rechaza definitivamente el refresh token
// (sesión revocada o usuario borrado) y el access token ya venció (_callRefreshToken, rama
// !isAuthRetryableFetchError). Nunca por falta de red ni por un token vencido.

export type SignOutAuth = {
    signOut(options: { scope: 'local' }): Promise<{ error: unknown }>;
};

export type SessionStorage = {
    getItem(key: string): Promise<string | null>;
    removeItem(key: string): Promise<void>;
};

// La clave de la sesión, tal como la configuró el cliente (GoTrueClient.storageKey). Es una
// propiedad de la instancia, no un valor escrito aquí; si no estuviera, no se borra nada a mano.
export function sessionStorageKeyOf(auth: unknown): string | null {
    const key = (auth as { storageKey?: unknown } | null)?.storageKey;
    return typeof key === 'string' && key.length > 0 ? key : null;
}

export type SignOutLocalResult = { forced: boolean; cleared: boolean };

const trySignOut = async (auth: SignOutAuth): Promise<unknown> => {
    try {
        const { error } = await auth.signOut({ scope: 'local' });
        return error ?? null;
    } catch (e) {
        return e ?? new Error('signOut falló');
    }
};

// Pasos 2–3: borra la sesión del storage de la app y deja que auth-js complete el cierre.
export async function forceLocalSignOut(auth: SignOutAuth, storage: SessionStorage): Promise<SignOutLocalResult> {
    const key = sessionStorageKeyOf(auth);
    if (!key) return { forced: false, cleared: false };
    await storage.removeItem(key);
    await storage.removeItem(`${key}-user`);
    await trySignOut(auth); // sin sesión guardada: no usa la red; _removeSession + SIGNED_OUT
    return { forced: true, cleared: (await storage.getItem(key)) === null };
}

export async function signOutLocally(auth: SignOutAuth, storage: SessionStorage): Promise<SignOutLocalResult> {
    const firstError = await trySignOut(auth);
    if (!firstError) {
        const key = sessionStorageKeyOf(auth);
        return { forced: false, cleared: key ? (await storage.getItem(key)) === null : true };
    }
    return forceLocalSignOut(auth, storage);
}
