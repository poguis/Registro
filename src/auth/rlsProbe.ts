import { getSupabase } from './supabase';
import { getVariant } from './redirect';
import { newId } from '../data/ids';
import { nowIso } from '../data/clock';

// Prueba de RLS contra el Supabase REAL con la sesión de Google (SOLO variante dev).
// Cierra los pendientes de la Fase 2: JWT real, Data API y grants reales. Sobre `backlog`:
//   1. leer · 2. insertar una fila propia [prueba RLS] · 3. actualizarla
//   4. insertar con user_id ajeno (debe fallar) · 5. DELETE (debe fallar)
//   6. marcar la fila de prueba con deleted_at (queda como tombstone en el servidor).
// Reporta el status HTTP, el código de Postgres y el mensaje reales de cada paso.

export type ProbeStep = { step: string; expected: 'ok' | 'error'; status: number | null; code: string | null; message: string; pass: boolean };

export async function runRlsProbe(): Promise<ProbeStep[]> {
    if (getVariant() !== 'development') throw new Error('La prueba de RLS solo existe en la variante dev.');
    const supabase = getSupabase();
    if (!supabase) throw new Error('Supabase no está configurado (.env).');
    const { data: s } = await supabase.auth.getSession();
    const uid = s.session?.user.id;
    if (!uid) throw new Error('Inicia sesión con Google primero.');

    const steps: ProbeStep[] = [];
    const record = (step: string, expected: 'ok' | 'error', res: { error: any; status: number }, extra = '') => {
        const failed = !!res.error;
        steps.push({
            step, expected, status: res.status ?? null, code: res.error?.code ?? null,
            message: res.error ? String(res.error.message) : `ok${extra}`,
            pass: expected === 'ok' ? !failed : failed,
        });
        console.log('[RLS]', JSON.stringify(steps[steps.length - 1]));
    };
    const now = nowIso();
    const id = newId();

    const read = await supabase.from('backlog').select('id', { count: 'exact', head: true });
    record('1. leer backlog (solo filas propias)', 'ok', read, ` (${read.count ?? 0} fila(s) visibles)`);

    const ins = await supabase.from('backlog').insert({
        id, user_id: uid, type: 'movie', title: '[prueba RLS]', created_at: now, updated_at: now,
    });
    record('2. insertar fila propia', 'ok', ins);

    const upd = await supabase.from('backlog').update({ title: '[prueba RLS] editada', updated_at: nowIso() }).eq('id', id).select('id');
    record('3. actualizar fila propia', 'ok', { ...upd, error: upd.error || (upd.data?.length === 1 ? null : { code: null, message: '0 filas actualizadas' }) });

    const foreign = await supabase.from('backlog').insert({
        id: newId(), user_id: newId(), type: 'movie', title: '[prueba RLS] ajena', created_at: now, updated_at: now,
    });
    record('4. insertar con user_id ajeno', 'error', foreign);

    const del = await supabase.from('backlog').delete().eq('id', id).select('id');
    record('5. DELETE de la fila propia', 'error', { ...del, error: del.error || (del.data?.length ? null : { code: null, message: '0 filas borradas' }) });

    const tomb = await supabase.from('backlog').update({ deleted_at: nowIso(), updated_at: nowIso() }).eq('id', id).select('id');
    record('6. marcar la fila de prueba con deleted_at', 'ok', { ...tomb, error: tomb.error || (tomb.data?.length === 1 ? null : { code: null, message: '0 filas actualizadas' }) });

    return steps;
}
