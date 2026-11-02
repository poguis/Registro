import { getSupabase } from '../auth/supabase';
import { remoteError, type Transport, type RemoteError } from './transport';

// Transporte con supabase-js (PostgREST). APIs según los .d.ts instalados de postgrest-js:
//   .upsert(values, { onConflict }) — con un array hace upsert masivo; por defecto no devuelve filas.
//   .or(filters) usa la sintaxis cruda de PostgREST; los valores con caracteres especiales
//   (el timestamp lleva '+' y ':') van entre comillas dobles.
// Cualquier excepción (sin red, timeout) se trata como error de red: transitorio.

const fromPostgrest = (error: any, status: number | null): RemoteError =>
    remoteError(error?.code ?? null, status, String(error?.message || error || 'error'));
const thrown = (e: any): RemoteError => remoteError(null, 0, String(e?.message || e || 'error de red'));

export function createSupabaseTransport(): Transport {
    return {
        async session() {
            const supabase = getSupabase();
            if (!supabase) return null;
            const { data } = await supabase.auth.getSession();
            return data.session ? { uid: data.session.user.id } : null;
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
                let q = supabase.from(table).select('*');
                if (after) {
                    q = q.or(`server_updated_at.gt."${after.ts}",and(server_updated_at.eq."${after.ts}",id.gt.${after.id})`);
                } else if (since) {
                    q = q.gte('server_updated_at', since);
                }
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
