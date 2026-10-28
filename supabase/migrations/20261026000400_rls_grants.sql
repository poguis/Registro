-- Fase 2 · 4/4 — RLS, políticas y grants.
--
-- RLS activada en las 15 tablas. Políticas solo para authenticated:
--   select / insert / update con (select auth.uid()) = user_id (update: USING y WITH CHECK,
--   así tampoco se puede pasar una fila propia a otro usuario).
-- Sin política de DELETE: el borrado es lógico (UPDATE de deleted_at).
-- select devuelve también las filas con deleted_at (el pull necesita los tombstones).
--
-- Grants explícitos por tabla (sin alter default privileges):
--   anon y public: nada (revoke all explícito).
--   authenticated: select, insert, update. Nunca delete.

begin;

do $$
declare
    t text;
begin
    foreach t in array array[
        'finance_contacts', 'finance_transactions', 'balance_history', 'finance_categories',
        'services', 'entertainment_categories', 'entertainment_pauses',
        'entertainment_quotas_history', 'series', 'seasons', 'watch_history',
        'reading_history', 'backlog', 'work_people', 'cards'
    ]
    loop
        execute format('alter table public.%I enable row level security', t);

        execute format(
            'create policy %I on public.%I for select to authenticated '
            'using ((select auth.uid()) = user_id)', t || '_select_own', t);
        execute format(
            'create policy %I on public.%I for insert to authenticated '
            'with check ((select auth.uid()) = user_id)', t || '_insert_own', t);
        execute format(
            'create policy %I on public.%I for update to authenticated '
            'using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)',
            t || '_update_own', t);

        execute format('revoke all on table public.%I from anon, authenticated, public', t);
        execute format('grant select, insert, update on table public.%I to authenticated', t);
    end loop;
end;
$$;

commit;
