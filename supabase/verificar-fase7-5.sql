-- Verificación de la Fase 7.5 (migración 20261122000100_vinculo_pendiente.sql). SOLO LECTURA:
-- no es una migración y no escribe nada (un único SELECT, sin INSERT, UPDATE, DELETE ni DDL).
-- Se ejecuta a mano en el SQL Editor de cada proyecto (Registro Dev y luego Poguis) DESPUÉS de
-- aplicar la migración. Devuelve 15 filas (orden | chequeo | valor | esperado | ok), sin contenido
-- de dominio; todas deben salir ok = true.
with
col_subtype as (
    select data_type, is_nullable, column_default
    from information_schema.columns
    where table_schema = 'public' and table_name = 'backlog' and column_name = 'subtype'
),
col_backlog_id as (
    select data_type, is_nullable, column_default
    from information_schema.columns
    where table_schema = 'public' and table_name = 'series' and column_name = 'backlog_id'
),
tablas as (
    select c.oid, c.relname, c.relrowsecurity
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname in ('backlog', 'series')
),
-- Columnas de un constraint, en orden, como texto "a,b".
restricciones as (
    select con.conname, con.contype, con.condeferrable, con.condeferred, con.confdeltype, con.confupdtype,
           rel.relname as tabla, ref.relname as referida,
           pg_get_constraintdef(con.oid) as def,
           (select string_agg(a.attname, ',' order by k.ord) from unnest(con.conkey) with ordinality k(attnum, ord)
              join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.attnum) as cols,
           (select string_agg(a.attname, ',' order by k.ord) from unnest(con.confkey) with ordinality k(attnum, ord)
              join pg_attribute a on a.attrelid = con.confrelid and a.attnum = k.attnum) as refcols
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace n on n.oid = rel.relnamespace
    left join pg_class ref on ref.oid = con.confrelid
    where n.nspname = 'public' and con.conname in ('backlog_subtype_check', 'backlog_id_user_key', 'series_backlog_fkey')
),
indice as (
    select indexdef from pg_indexes where schemaname = 'public' and tablename = 'series' and indexname = 'series_backlog_idx'
),
priv_auth as (
    select table_name, string_agg(privilege_type, ',' order by privilege_type) as p
    from information_schema.role_table_grants
    where table_schema = 'public' and table_name in ('backlog', 'series') and grantee = 'authenticated'
    group by table_name
),
priv_otros as (
    select count(*) as n
    from information_schema.role_table_grants
    where table_schema = 'public' and table_name in ('backlog', 'series') and grantee in ('anon', 'PUBLIC')
),
priv_col_otros as (
    select count(*) as n
    from information_schema.column_privileges
    where table_schema = 'public'
      and ((table_name = 'backlog' and column_name = 'subtype') or (table_name = 'series' and column_name = 'backlog_id'))
      and grantee in ('anon', 'PUBLIC')
),
politicas as (
    select tablename,
           count(*) as n,
           count(*) filter (where cmd in ('DELETE', 'ALL')) as n_delete
    from pg_policies where schemaname = 'public' and tablename in ('backlog', 'series')
    group by tablename
),
filas(orden, chequeo, valor, esperado) as (values
    (1, 'backlog.subtype: existe, text, admite NULL',
        coalesce((select data_type || ' / ' || is_nullable from col_subtype), '(no existe)'), 'text / YES'),
    (2, 'backlog.subtype: sin default',
        coalesce((select coalesce(column_default, '(sin default)') from col_subtype), '(no existe)'), '(sin default)'),
    (3, 'backlog_subtype_check: NULL, o lectura con book / comic / manga',
        coalesce((select def from restricciones where conname = 'backlog_subtype_check'), '(no existe)'),
        'CHECK (((subtype IS NULL) OR ((type = ''reading''::text) AND (subtype = ANY (ARRAY[''book''::text, ''comic''::text, ''manga''::text])))))'),
    (4, 'backlog_id_user_key: UNIQUE (id, user_id) en backlog',
        coalesce((select contype::text || ' ' || tabla || '(' || cols || ')' from restricciones where conname = 'backlog_id_user_key'), '(no existe)'),
        'u backlog(id,user_id)'),
    (5, 'series.backlog_id: existe, uuid, admite NULL',
        coalesce((select data_type || ' / ' || is_nullable from col_backlog_id), '(no existe)'), 'uuid / YES'),
    (6, 'series.backlog_id: sin default',
        coalesce((select coalesce(column_default, '(sin default)') from col_backlog_id), '(no existe)'), '(sin default)'),
    (7, 'series_backlog_fkey: series(backlog_id,user_id) → backlog(id,user_id)',
        coalesce((select tabla || '(' || cols || ') → ' || referida || '(' || refcols || ')' from restricciones where conname = 'series_backlog_fkey'), '(no existe)'),
        'series(backlog_id,user_id) → backlog(id,user_id)'),
    (8, 'series_backlog_fkey: diferible, diferida, sin on delete ni on update',
        coalesce((select condeferrable::text || ' / ' || condeferred::text || ' / ' || confdeltype::text || ' / ' || confupdtype::text
                    from restricciones where conname = 'series_backlog_fkey'), '(no existe)'),
        'true / true / a / a'),
    (9, 'índice series_backlog_idx sobre (backlog_id, user_id)',
        coalesce((select case when indexdef like '%(backlog_id, user_id)' then '(backlog_id, user_id)' else indexdef end from indice), '(no existe)'),
        '(backlog_id, user_id)'),
    (10, 'RLS activo: backlog / series',
        coalesce((select relrowsecurity::text from tablas where relname = 'backlog'), '(no existe)') || ' / '
            || coalesce((select relrowsecurity::text from tablas where relname = 'series'), '(no existe)'),
        'true / true'),
    (11, 'authenticated: privilegios de tabla en backlog',
        coalesce((select p from priv_auth where table_name = 'backlog'), '(ninguno)'), 'INSERT,SELECT,UPDATE'),
    (12, 'authenticated: privilegios de tabla en series',
        coalesce((select p from priv_auth where table_name = 'series'), '(ninguno)'), 'INSERT,SELECT,UPDATE'),
    (13, 'anon y PUBLIC: privilegios de tabla en backlog y series', (select n::text from priv_otros), '0'),
    (14, 'anon y PUBLIC: privilegios sobre backlog.subtype y series.backlog_id', (select n::text from priv_col_otros), '0'),
    (15, 'políticas (total/DELETE): backlog · series',
        coalesce((select n::text || '/' || n_delete::text from politicas where tablename = 'backlog'), '0/0') || ' · '
            || coalesce((select n::text || '/' || n_delete::text from politicas where tablename = 'series'), '0/0'),
        '3/0 · 3/0')
)
select orden, chequeo, valor, esperado, valor = esperado as ok
from filas
order by orden;
