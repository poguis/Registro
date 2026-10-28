-- Verificación de la Fase 2 (SOLO LECTURA). Correr en el SQL Editor de Supabase DESPUÉS de
-- aplicar las 4 migraciones de supabase/migrations/. No modifica nada.
-- Devuelve una fila por chequeo: chequeo | valor | esperado | ok. Todo debe salir ok = true.
-- (No va en supabase/migrations/: no es una migración.)

with
tablas(t) as (
    values ('finance_contacts'), ('finance_transactions'), ('balance_history'), ('finance_categories'),
           ('services'), ('entertainment_categories'), ('entertainment_pauses'),
           ('entertainment_quotas_history'), ('series'), ('seasons'), ('watch_history'),
           ('reading_history'), ('backlog'), ('work_people'), ('cards')
),
rel as (
    select c.oid, c.relname, c.relrowsecurity
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
),
pol as (
    select * from pg_policies where schemaname = 'public'
),
fn as (
    select p.*
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
),
fks as (
    select con.*
    from pg_constraint con
    join rel on rel.oid = con.conrelid
    where con.contype = 'f'
),
priv(p) as (
    values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')
),
chequeos(orden, chequeo, valor, esperado) as (
    select 1, 'tablas de public que son las 15 del esquema',
        (select count(*) from rel where relname in (select t from tablas))::text, '15'
    union all select 2, 'tablas de public fuera de las 15 (debe estar vacío)',
        coalesce((select string_agg(relname, ', ') from rel where relname not in (select t from tablas)), ''), ''
    union all select 3, 'tablas con RLS activada',
        (select count(*) from rel where relname in (select t from tablas) and relrowsecurity)::text, '15'
    union all select 4, 'políticas SELECT / INSERT / UPDATE',
        (select count(*) filter (where cmd = 'SELECT') || ' / ' || count(*) filter (where cmd = 'INSERT')
                || ' / ' || count(*) filter (where cmd = 'UPDATE') from pol), '15 / 15 / 15'
    union all select 5, 'políticas DELETE o ALL',
        (select count(*) from pol where cmd in ('DELETE', 'ALL'))::text, '0'
    union all select 6, 'políticas que no son "to authenticated"',
        (select count(*) from pol where roles <> '{authenticated}')::text, '0'
    union all select 7, 'políticas sin auth.uid() = user_id en USING / WITH CHECK',
        (select count(*) from pol
          where (cmd in ('SELECT', 'UPDATE') and coalesce(qual, '') not like '%auth.uid()%user_id%')
             or (cmd in ('INSERT', 'UPDATE') and coalesce(with_check, '') not like '%auth.uid()%user_id%'))::text, '0'
    union all select 8, 'authenticated: tablas con SELECT / INSERT / UPDATE',
        (select count(*) filter (where has_table_privilege('authenticated', 'public.' || t, 'SELECT'))
                || ' / ' || count(*) filter (where has_table_privilege('authenticated', 'public.' || t, 'INSERT'))
                || ' / ' || count(*) filter (where has_table_privilege('authenticated', 'public.' || t, 'UPDATE'))
           from tablas), '15 / 15 / 15'
    union all select 9, 'authenticated: DELETE, TRUNCATE, REFERENCES o TRIGGER en alguna tabla',
        (select count(*) from tablas, priv
          where p in ('DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER')
            and has_table_privilege('authenticated', 'public.' || t, p))::text, '0'
    union all select 10, 'anon: cualquier privilegio en alguna de las 15 tablas',
        (select count(*) from tablas, priv where has_table_privilege('anon', 'public.' || t, p))::text, '0'
    union all select 11, 'anon / PUBLIC: grants de columna en public',
        (select count(*) from information_schema.column_privileges
          where table_schema = 'public' and grantee in ('anon', 'PUBLIC'))::text, '0'
    union all select 12, 'PUBLIC: grants de tabla en public',
        (select count(*) from information_schema.role_table_grants
          where table_schema = 'public' and grantee = 'PUBLIC')::text, '0'
    union all select 13, 'triggers set_server_updated_at activos (BEFORE INSERT OR UPDATE)',
        (select count(*) from pg_trigger tg join rel on rel.oid = tg.tgrelid
          where tg.tgname = 'set_server_updated_at' and not tg.tgisinternal and tg.tgenabled = 'O'
            and (tg.tgtype & 2) = 2 and (tg.tgtype & 4) = 4 and (tg.tgtype & 16) = 16)::text, '15'
    union all select 14, 'funciones de public con security definer',
        (select count(*) from fn where prosecdef)::text, '0'
    union all select 15, 'set_server_updated_at: security invoker y search_path vacío',
        (select coalesce(string_agg(case when not prosecdef and proconfig = array['search_path=""'] then 'sí' else 'no' end, ','), 'falta')
           from fn where proname = 'set_server_updated_at'), 'sí'
    union all select 16, 'anon / authenticated pueden ejecutar set_server_updated_at',
        (select coalesce(string_agg(has_function_privilege('anon', oid, 'EXECUTE')::text || ' / '
                || has_function_privilege('authenticated', oid, 'EXECUTE')::text, ','), 'falta')
           from fn where proname = 'set_server_updated_at'), 'false / false'
    union all select 17, 'FK a auth.users con on delete cascade',
        (select count(*) from fks where confrelid = 'auth.users'::regclass and confdeltype = 'c')::text, '15'
    union all select 18, 'FK compuestas (parent_id, user_id) diferidas, sin on delete',
        (select count(*) from fks
          where confrelid <> 'auth.users'::regclass and array_length(conkey, 1) = 2
            and condeferrable and condeferred and confdeltype = 'a')::text, '7'
    union all select 19, 'índices de pull (user_id, server_updated_at, id)',
        (select count(*) from pg_indexes where schemaname = 'public' and indexname like '%\_pull\_idx')::text, '15'
    union all select 20, 'has_schema_privilege(''authenticated'', ''public'', ''USAGE'')',
        has_schema_privilege('authenticated', 'public', 'USAGE')::text, 'true'
    union all select 21, 'has_schema_privilege(''anon'', ''public'', ''USAGE'') (Supabase lo concede; la protección es por tabla)',
        has_schema_privilege('anon', 'public', 'USAGE')::text, 'true'
    union all select 22, 'versión de Postgres ≥ 15',
        (current_setting('server_version_num')::int >= 150000)::text, 'true'
)
select orden, chequeo, valor, esperado, valor = esperado as ok
from chequeos
order by orden;
