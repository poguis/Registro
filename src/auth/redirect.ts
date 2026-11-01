import Constants from 'expo-constants';

// URL de retorno de OAuth: EXACTAMENTE `<scheme>://auth/callback`, con el scheme de la
// variante (app.config.js). Debe estar en Auth → URL Configuration → Redirect URLs de
// Supabase; si no coincide, Supabase vuelve a la Site URL y el login falla en silencio.
export const CALLBACK_PATH = 'auth/callback';

export const redirectUrlFor = (scheme: string) => `${scheme}://${CALLBACK_PATH}`;

export function getRedirectUrl(): string {
    const scheme = Constants.expoConfig?.scheme;
    const s = Array.isArray(scheme) ? scheme[0] : scheme;
    if (!s) throw new Error('La app no tiene scheme configurado (app.config.js).');
    return redirectUrlFor(s);
}

export const getVariant = (): 'production' | 'development' =>
    Constants.expoConfig?.extra?.variant === 'development' ? 'development' : 'production';

// Lee el resultado del callback: ?code=… (PKCE) o ?error=…&error_description=…
// (Supabase puede ponerlos en la query o en el fragmento).
export function parseCallbackUrl(url: string, expectedRedirect: string):
    { code: string } | { error: string } {
    if (!url.startsWith(expectedRedirect)) return { error: 'El retorno no coincide con la URL esperada.' };
    const rest = url.slice(expectedRedirect.length);
    const params: Record<string, string> = {};
    for (const part of rest.replace(/^[?#]/, '').split(/[&#?]/)) {
        if (!part) continue;
        const i = part.indexOf('=');
        const k = decodeURIComponent((i < 0 ? part : part.slice(0, i)).replace(/\+/g, ' '));
        const v = i < 0 ? '' : decodeURIComponent(part.slice(i + 1).replace(/\+/g, ' '));
        if (!(k in params)) params[k] = v;
    }
    if (params.error || params.error_code) {
        return { error: params.error_description || params.error || params.error_code };
    }
    if (params.code) return { code: params.code };
    return { error: 'El retorno no trae código de autorización.' };
}
