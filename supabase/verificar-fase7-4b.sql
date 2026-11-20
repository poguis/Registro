-- Verificación de la Fase 7.4b (migración 20261121000100_frecuencia_cuotas.sql). SOLO LECTURA:
-- no es una migración y no escribe nada (un único SELECT, sin INSERT, UPDATE, DELETE ni DDL).
-- Se ejecuta a mano en el SQL Editor de cada proyecto (Registro Dev y luego Poguis) DESPUÉS de
-- aplicar la migración. Devuelve 9 filas (orden | chequeo | valor | esperado | ok), sin contenido
-- de dominio; todas deben salir ok = true.
with
col as (
    select data_type, is_nullable, column_default
    from information_schema.columns
    where table_schema = 'public' and table_name = 'entertainment_quotas_history' and column_name = 'frequency'
),
tabla as (
    select c.oid, c.relrowsecurity
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'entertainment_quotas_history'
),
priv_auth as (
    select string_agg(privilege_type, ',' order by privilege_type) as p
    from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'entertainment_quotas_history' and grantee = 'authenticated'
),
priv_otros as (
    select count(*) as n
    from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'entertainment_quotas_history' and grantee in ('anon', 'PUBLIC')
),
priv_col_otros as (
    select count(*) as n
    from information_schema.column_privileges
    where table_schema = 'public' and table_name = 'entertainment_quotas_history' and column_name = 'frequency'
      and grantee in ('anon', 'PUBLIC')
),
politicas as (
    select count(*) as n from pg_policies where schemaname = 'public' and tablename = 'entertainment_quotas_history'
),
politica_delete as (
    select count(*) as n from pg_policies
    where schemaname = 'public' and tablename = 'entertainment_quotas_history' and cmd in ('DELETE', 'ALL')
),
filas(orden, chequeo, valor, esperado) as (values
    (1, 'columna frequency existe', (select count(*)::text from col), '1'),
    (2, 'frequency es integer', coalesce((select data_type from col), '(no existe)'), 'integer'),
    (3, 'frequency admite NULL', coalesce((select is_nullable from col), '(no existe)'), 'YES'),
    (4, 'frequency sin default', coalesce((select coalesce(column_default, '(sin default)') from col), '(no existe)'), '(sin default)'),
    (5, 'RLS activo en la tabla', coalesce((select relrowsecurity::text from tabla), '(no existe)'), 'true'),
    (6, 'authenticated: privilegios de tabla', coalesce((select p from priv_auth), '(ninguno)'), 'INSERT,SELECT,UPDATE'),
    (7, 'anon y PUBLIC: privilegios de tabla', (select n::text from priv_otros), '0'),
    (8, 'anon y PUBLIC: privilegios sobre la columna frequency', (select n::text from priv_col_otros), '0'),
    (9, 'políticas: 3 (select/insert/update), ninguna de DELETE', (select n::text from politicas) || '/' || (select n::text from politica_delete), '3/0')
)
select orden, chequeo, valor, esperado, valor = esperado as ok
from filas
order by orden;
