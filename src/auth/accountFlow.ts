import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Session } from '@supabase/supabase-js';
import dbFacade from '../services/db';
import { classify } from '../data/db/linkAccount';
import { signOutGoogle } from './googleAuth';

// Qué hacer con los datos locales después de un login con Google. Una cuenta Google por
// dispositivo: si los datos ya son de otra cuenta, o hay varias cuentas locales, se cierra
// la sesión de Google y no se toca nada.

// La fachada es JS: sus respuestas { success, ... } se tratan como any.
const db: any = dbFacade;

export const LEGACY_SESSION_KEY = '@user_session';

export type AppUser = { id: string; username: string; email: string | null; linked: boolean };

export type AfterLogin =
    | { kind: 'ready'; user: AppUser } // ya vinculado a esta cuenta, o instalación nueva
    | { kind: 'confirm-link'; email: string; localUser: AppUser } // pedir confirmación
    | { kind: 'blocked'; reason: 'other-account' | 'multiple-accounts'; linkedEmail?: string | null }
    | { kind: 'error'; message: string };

const toAppUser = (u: { id: string; username: string; email: string | null; linked_at: string | null }): AppUser =>
    ({ id: u.id, username: u.username, email: u.email, linked: !!u.linked_at });

export async function afterGoogleLogin(session: Session): Promise<AfterLogin> {
    const uid = session.user.id;
    const email = session.user.email || '';
    const res = await db.getLocalUsers();
    if (!res.success) return { kind: 'error', message: res.error };
    const users = res.users;

    if (users.length === 0) {
        const created = await db.createLinkedUser(uid, email);
        return created.success ? { kind: 'ready', user: toAppUser(created.user) } : { kind: 'error', message: created.error };
    }
    const c = classify(users, uid);
    if (c && c.status === 'already') return { kind: 'ready', user: toAppUser(users[0]) };
    if (c && (c.status === 'other-account' || c.status === 'multiple-accounts')) {
        await signOutGoogle();
        return { kind: 'blocked', reason: c.status, linkedEmail: c.linkedEmail };
    }
    return { kind: 'confirm-link', email, localUser: toAppUser(users[0]) };
}

// Vinculación confirmada por el usuario (necesita la sesión de Google vigente).
export async function confirmLink(session: Session): Promise<{ ok: true; user: AppUser } | { ok: false; message: string }> {
    const res = await db.linkAccount(session.user.id, session.user.email || '');
    if (!res.success) return { ok: false, message: res.error };
    const { status } = res.result;
    if (status !== 'linked' && status !== 'already') {
        await signOutGoogle();
        return { ok: false, message: status === 'multiple-accounts'
            ? 'Hay varias cuentas locales; la vinculación necesita una sola.'
            : 'Estos datos pertenecen a otra cuenta de Google.' };
    }
    await AsyncStorage.removeItem(LEGACY_SESSION_KEY);
    const after = await db.getLocalUsers();
    return after.success && after.users.length === 1
        ? { ok: true, user: toAppUser(after.users[0]) }
        : { ok: false, message: 'No se pudo leer la cuenta vinculada.' };
}

// Identidad local al abrir la app (sin red, sin Supabase). Nunca bloquea si hay datos.
export type StartupIdentity =
    | { kind: 'needs-login' } // sin datos locales: exige Google
    | { kind: 'open'; user: AppUser }
    | { kind: 'choose'; users: AppUser[] }; // varias cuentas sin vincular (solo BD de prueba)

export async function resolveStartupIdentity(): Promise<StartupIdentity> {
    const res = await db.getLocalUsers();
    const users = res.success ? res.users : [];
    if (users.length === 0) return { kind: 'needs-login' };
    const linked = users.find((u: any) => u.linked_at);
    if (linked) return { kind: 'open', user: toAppUser(linked) };

    // Sin vincular: sesión antigua (@user_session, id entero o UUID) o la única cuenta.
    const stored = await AsyncStorage.getItem(LEGACY_SESSION_KEY);
    if (stored) {
        try {
            const data = JSON.parse(stored);
            const resolved = data && data.id ? await db.resolveSessionUser(data.id) : null;
            const match = resolved && resolved.success && resolved.user
                ? users.find((u: any) => u.id === resolved.user.id) : null;
            if (match) {
                await AsyncStorage.setItem(LEGACY_SESSION_KEY, JSON.stringify({ id: match.id, username: match.username }));
                return { kind: 'open', user: toAppUser(match) };
            }
        } catch {
            // sesión corrupta: se ignora
        }
        await AsyncStorage.removeItem(LEGACY_SESSION_KEY);
    }
    if (users.length === 1) return { kind: 'open', user: toAppUser(users[0]) };
    return { kind: 'choose', users: users.map(toAppUser) };
}

// Elegir una cuenta local sin vincular (solo cuando hay varias).
export async function chooseLocalUser(user: AppUser): Promise<void> {
    await AsyncStorage.setItem(LEGACY_SESSION_KEY, JSON.stringify({ id: user.id, username: user.username }));
}
