// Contrato entre el motor de sync y el servidor. Implementaciones:
//   - SupabaseTransport (supabase-js, la app);
//   - PgliteTransport (scripts/lib/pglite-transport.mjs, pruebas: SQL equivalente con
//     SET ROLE authenticated y los claims del usuario → RLS, triggers y CHECK reales).
// Las filas remotas tienen la forma JSON de PostgREST: timestamptz como texto con µs y zona,
// numeric como número, jsonb como objeto.

export type RemoteRow = Record<string, any>;

// network: sin red, 408, 429, 5xx (transitorio, con backoff)
// auth:    401 / JWT vencido (se detiene el ciclo sin culpar a ninguna entrada)
// conflict: 23505 (clave única → fusión por clave natural)
// fk:      23503 (padre inexistente en el servidor → se sube el padre si existe localmente)
// permanent: 23514, 42501, 22xxx, 23502, PGRST204, demás 4xx (entrada bloqueada)
export type ErrorKind = 'network' | 'auth' | 'conflict' | 'fk' | 'permanent';
export type RemoteError = { kind: ErrorKind; code: string | null; status: number | null; message: string };

export interface Transport {
    session(): Promise<{ uid: string } | null>;
    upsert(table: string, rows: RemoteRow[]): Promise<{ error: RemoteError | null }>;
    // Página ordenada por (server_updated_at, id). Primera página: server_updated_at >= since
    // (o todo si since es null); siguientes: después de `after` (keyset con desempate por id).
    pullPage(table: string, opts: { since: string | null; after: { ts: string; id: string } | null; limit: number }):
        Promise<{ rows: RemoteRow[]; error: RemoteError | null }>;
    findByNaturalKey(table: string, key: Record<string, any>): Promise<{ row: RemoteRow | null; error: RemoteError | null }>;
}

export function classifyError(code: string | null | undefined, status: number | null | undefined, message: string): ErrorKind {
    const c = code || '';
    if (c === 'PGRST301' || c === 'PGRST303' || status === 401 || /jwt expired|invalid jwt/i.test(message)) return 'auth';
    if (!c && (!status || status === 0)) return 'network';
    if (/network request failed|failed to fetch|fetch failed|network error|timeout|aborted/i.test(message)) return 'network';
    if (status === 408 || status === 429 || (typeof status === 'number' && status >= 500)) return 'network';
    if (c === '23505') return 'conflict';
    if (c === '23503') return 'fk';
    return 'permanent';
}

export const remoteError = (code: string | null | undefined, status: number | null | undefined, message: string): RemoteError =>
    ({ kind: classifyError(code, status, message), code: code || null, status: status ?? null, message });
