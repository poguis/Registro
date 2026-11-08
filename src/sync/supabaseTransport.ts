import { getSupabase } from '../auth/supabase';
import { readSessionState } from '../auth/sessionState';
import { remoteError, type Transport, type RemoteError } from './transport';

// Transporte con supabase-js (PostgREST). APIs según los .d.ts instalados de postgrest-js:
//   .upsert(values, { onConflict }) — con un array hace upsert masivo; por defecto no devuelve filas.
//   .or(filters) usa la sintaxis cruda de PostgREST; los valores con caracteres especiales
//   (el timestamp lleva '+' y ':') van entre comillas dobles.
// Cualquier excepción (sin red, timeout) se trata como error de red: transitorio.

const fromPostgrest = (error: any, status: number | null): RemoteError =>
    remoteError(error?.code ?? null, status, String(error?.message || error || 'error'));
const thrown = (e: any): RemoteError => remoteError(null, 0, String(e?.message || e || 'error de red'));

// Filtro del pull (keyset por (server_updated_at, id)). Con cursor, además del OR de siempre, un
// filtro REDUNDANTE `server_updated_at >= cursor.ts` (Fase 6.5, hallazgo H1 de la 6.2): toda fila
// que cumple el OR lo cumple, así que devuelve exactamente las mismas filas, pero Postgres puede
// usarlo como rango del índice *_pull_idx en vez de recorrer y descartar todas las filas del
// usuario anteriores al cursor (docs/FASE6-PRUEBAS-SERVIDOR.md, secciones 8–9). El OR, el orden y
// el límite no cambian. Sin cursor pero con `since` (primera página de un ciclo incremental), el
// gte de siempre.
type PullFilterable<Q> = { gte(column: string, value: string): Q; or(filters: string): Q };
export function applyPullFilter<Q extends PullFilterable<Q>>(q: Q, { since, after }: { since: string | null; after: { ts: string; id: string } | null }): Q {
    if (after) {
        return q.gte('server_updated_at', after.ts)
            .or(`server_updated_at.gt."${after.ts}",and(server_updated_at.eq."${after.ts}",id.gt.${after.id})`);
    }
    if (since) return q.gte('server_updated_at', since);
    return q;
}

export function createSupabaseTransport(): Transport {
    return {
        async session() {
            const supabase = getSupabase();
            if (!supabase) return null;
            const s = await readSessionState(supabase.auth);
            if (s.session) return { uid: s.session.user.id };
            return s.offline ? { offline: true } : null;
        },
        async upsert(table, rows) {
            const supabase = getSupabase();
            if (!supabase) return { error: remoteError(null, 401, 'Supabase no configurado') };
            try {
                const { error, status } = await supabase.from(table).upsert(rows, { onConflict: 'id' });
                return { error: error ? fromPostgrest(error, status) : null };
            } catch (e) {
                return { error: thrown(e) };
            }
        },
        async pullPage(table, { since, after, limit }) {
            const supabase = getSupabase();
            if (!supabase) return { rows: [], error: remoteError(null, 401, 'Supabase no configurado') };
            try {
                const q = applyPullFilter(supabase.from(table).select('*'), { since, after });
                const { data, error, status } = await q
                    .order('server_updated_at', { ascending: true })
                    .order('id', { ascending: true })
                    .limit(limit);
                return { rows: data || [], error: error ? fromPostgrest(error, status) : null };
            } catch (e) {
                return { rows: [], error: thrown(e) };
            }
        },
        async findByNaturalKey(table, key) {
            const supabase = getSupabase();
            if (!supabase) return { row: null, error: remoteError(null, 401, 'Supabase no configurado') };
            try {
                let q = supabase.from(table).select('*');
                for (const [k, v] of Object.entries(key)) q = q.eq(k, v);
                const { data, error, status } = await q.limit(1);
                return { row: data && data.length ? data[0] : null, error: error ? fromPostgrest(error, status) : null };
            } catch (e) {
                return { row: null, error: thrown(e) };
            }
        },
    };
}
