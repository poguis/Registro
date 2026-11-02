// fetch con tope de tiempo por petición para supabase-js. Se pasa como
// createClient(url, key, { global: { fetch } }) — opción `global.fetch` ("A custom `fetch`
// implementation", .d.ts de @supabase/supabase-js instalado). Si el servidor no responde en
// REQUEST_TIMEOUT_MS, la petición se aborta (AbortController); postgrest-js lo devuelve como
// error sin código y status 0, que el motor de sync clasifica como transitorio (sin red).
// Respeta además una señal de aborto que traiga la petición.

export const REQUEST_TIMEOUT_MS = 20_000;

type FetchFn = (input: any, init?: any) => Promise<any>;

export function createFetchWithTimeout(timeoutMs: number = REQUEST_TIMEOUT_MS, baseFetch: FetchFn = (i, o) => fetch(i, o)): FetchFn {
    return (input, init = {}) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        const outer: AbortSignal | undefined = init.signal;
        if (outer) {
            if (outer.aborted) controller.abort();
            else outer.addEventListener('abort', () => controller.abort(), { once: true });
        }
        return baseFetch(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
    };
}
