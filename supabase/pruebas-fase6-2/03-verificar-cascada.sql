-- SOLO Registro Dev. Nunca ejecutar en Poguis.
--
-- Fase 6.2 · 03 — Verificación de la cascada (no es migración). SOLO LECTURA: una sentencia
-- SELECT; solo conteos y tamaños (sin contenido de filas, emails ni uid en la salida).
--
-- Uso: pega el uid del usuario de prueba en la línea PEGAR_UID_AQUI y ejecuta (rol del
-- editor: postgres). Se corre tres veces (README): antes de sembrar, después de sembrar y
-- después de borrar el usuario de prueba.
--
-- Filas 1–15: una por tabla sincronizada.
--   prueba_filas                      filas del usuario de prueba (0 después del borrado)
--   otros_total / otros_vivos /
--   otros_borrados / otros_usuarios_distintos
--                                     los DEMÁS usuarios, en el formato de verificar-fase5:
--                                     deben ser idénticos antes y después
-- Fila 16 (TODAS): suma de las 15.
-- Filas 17–25 (columna "valor"): uid en auth.users (sí/no; "no" después del borrado),
--   usuarios en auth.users, grupos de server_updated_at repetidos del usuario de prueba en
--   watch_history / balance_history / backlog (informativo: el trigger usa clock_timestamp()
--   por fila; solo hay empates si el reloj tiene poca resolución; se espera ~0 en Supabase),
--   tamaño de la BD y de las dos tablas grandes.
-- Filas 24–25: filas modificadas desde el último ANALYZE en las dos tablas grandes. Antes del
--   02 deben ser pocas (≪ 50.000): el autoanalyze de Supabase ya actualizó las estadísticas y
--   el plan medido es el que verá la app. Si siguen altas, espera unos minutos y repite 03.

with p as (
    select 'PEGAR_UID_AQUI'::uuid as uid -- PEGAR_UID_AQUI: uid del usuario de prueba de Registro Dev
),
t as (
    select 1 as orden, 'finance_contacts' as tabla,
           count(*) filter (where x.user_id = p.uid) as prueba_filas,
           count(*) filter (where x.user_id <> p.uid) as otros_total,
           count(*) filter (where x.user_id <> p.uid and x.deleted_at is null) as otros_vivos,
           count(*) filter (where x.user_id <> p.uid and x.deleted_at is not null) as otros_borrados,
           count(distinct x.user_id) filter (where x.user_id <> p.uid) as otros_usuarios_distintos
    from public.finance_contacts x, p
    union all
    select 2 as orden, 'finance_transactions' as tabla,
           count(*) filter (where x.user_id = p.uid) as prueba_filas,
           count(*) filter (where x.user_id <> p.uid) as otros_total,
           count(*) filter (where x.user_id <> p.uid and x.deleted_at is null) as otros_vivos,
           count(*) filter (where x.user_id <> p.uid and x.deleted_at is not null) as otros_borrados,
           count(distinct x.user_id) filter (where x.user_id <> p.uid) as otros_usuarios_distintos
    from public.finance_transactions x, p
    union all
    select 3 as orden, 'balance_history' as tabla,
           count(*) filter (where x.user_id = p.uid) as prueba_filas,
           count(*) filter (where x.user_id <> p.uid) as otros_total,
           count(*) filter (where x.user_id <> p.uid and x.deleted_at is null) as otros_vivos,
           count(*) filter (where x.user_id <> p.uid and x.deleted_at is not null) as otros_borrados,
           count(distinct x.user_id) filter (where x.user_id <> p.uid) as otros_usuarios_distintos
    from public.balance_history x, p
    union all
    select 4 as orden, 'finance_categories' as tabla,
           count(*) filter (where x.user_id = p.uid) as prueba_filas,
           count(*) filter (where x.user_id <> p.uid) as otros_total,
           count(*) filter (where x.user_id <> p.uid and x.deleted_at is null) as otros_vivos,
           count(*) filter (where x.user_id <> p.uid and x.deleted_at is not null) as otros_borrados,
           count(distinct x.user_id) filter (where x.user_id <> p.uid) as otros_usuarios_distintos
    from public.finance_categories x, p
    union all
    select 5 as orden, 'services' as tabla,
           count(*) filter (where x.user_id = p.uid) as prueba_filas,
           count(*) filter (where x.user_id <> p.uid) as otros_total,
           count(*) filter (where x.user_id <> p.uid and x.deleted_at is null) as otros_vivos,
           count(*) filter (where x.user_id <> p.uid and x.deleted_at is not null) as otros_borrados,
           count(distinct x.user_id) filter (where x.user_id <> p.uid) as otros_usuarios_distintos
    from public.services x, p
    union all
    select 6 as orden, 'entertainment_categories' as tabla,
           count(*) filter (where x.user_id = p.uid) as prueba_filas,
           count(*) filter (where x.user_id <> p.uid) as otros_total,
           count(*) filter (where x.user_id <> p.uid and x.deleted_at is null) as otros_vivos,
           count(*) filter (where x.user_id <> p.uid and x.deleted_at is not null) as otros_borrados,
           count(distinct x.user_id) filter (where x.user_id <> p.uid) as otros_usuarios_distintos
    from public.entertainment_categories x, p
    union all
    select 7 as orden, 'entertainment_pauses' as tabla,
           count(*) filter (where x.user_id = p.uid) as prueba_filas,
           count(*) filter (where x.user_id <> p.uid) as otros_total,
           count(*) filter (where x.user_id <> p.uid and x.deleted_at is null) as otros_vivos,
           count(*) filter (where x.user_id <> p.uid and x.deleted_at is not null) as otros_borrados,
           count(distinct x.user_id) filter (where x.user_id <> p.uid) as otros_usuarios_distintos
    from public.entertainment_pauses x, p
    union all
    select 8 as orden, 'entertainment_quotas_history' as tabla,
           count(*) filter (where x.user_id = p.uid) as prueba_filas,
           count(*) filter (where x.user_id <> p.uid) as otros_total,
           count(*) filter (where x.user_id <> p.uid and x.deleted_at is null) as otros_vivos,
           count(*) filter (where x.user_id <> p.uid and x.deleted_at is not null) as otros_borrados,
           count(distinct x.user_id) filter (where x.user_id <> p.uid) as otros_usuarios_distintos
    from public.entertainment_quotas_history x, p
    union all
    select 9 as orden, 'series' as tabla,
           count(*) filter (where x.user_id = p.uid) as prueba_filas,
           count(*) filter (where x.user_id <> p.uid) as otros_total,
           count(*) filter (where x.user_id <> p.uid and x.deleted_at is null) as otros_vivos,
           count(*) filter (where x.user_id <> p.uid and x.deleted_at is not null) as otros_borrados,
           count(distinct x.user_id) filter (where x.user_id <> p.uid) as otros_usuarios_distintos
    from public.series x, p
    union all
    select 10 as orden, 'seasons' as tabla,
           count(*) filter (where x.user_id = p.uid) as prueba_filas,
           count(*) filter (where x.user_id <> p.uid) as otros_total,
           count(*) filter (where x.user_id <> p.uid and x.deleted_at is null) as otros_vivos,
           count(*) filter (where x.user_id <> p.uid and x.deleted_at is not null) as otros_borrados,
           count(distinct x.user_id) filter (where x.user_id <> p.uid) as otros_usuarios_distintos
    from public.seasons x, p
    union all
    select 11 as orden, 'watch_history' as tabla,
           count(*) filter (where x.user_id = p.uid) as prueba_filas,
           count(*) filter (where x.user_id <> p.uid) as otros_total,
           count(*) filter (where x.user_id <> p.uid and x.deleted_at is null) as otros_vivos,
           count(*) filter (where x.user_id <> p.uid and x.deleted_at is not null) as otros_borrados,
           count(distinct x.user_id) filter (where x.user_id <> p.uid) as otros_usuarios_distintos
    from public.watch_history x, p
    union all
    select 12 as orden, 'reading_history' as tabla,
           count(*) filter (where x.user_id = p.uid) as prueba_filas,
           count(*) filter (where x.user_id <> p.uid) as otros_total,
           count(*) filter (where x.user_id <> p.uid and x.deleted_at is null) as otros_vivos,
           count(*) filter (where x.user_id <> p.uid and x.deleted_at is not null) as otros_borrados,
           count(distinct x.user_id) filter (where x.user_id <> p.uid) as otros_usuarios_distintos
    from public.reading_history x, p
    union all
    select 13 as orden, 'backlog' as tabla,
           count(*) filter (where x.user_id = p.uid) as prueba_filas,
           count(*) filter (where x.user_id <> p.uid) as otros_total,
           count(*) filter (where x.user_id <> p.uid and x.deleted_at is null) as otros_vivos,
           count(*) filter (where x.user_id <> p.uid and x.deleted_at is not null) as otros_borrados,
           count(distinct x.user_id) filter (where x.user_id <> p.uid) as otros_usuarios_distintos
    from public.backlog x, p
    union all
    select 14 as orden, 'work_people' as tabla,
           count(*) filter (where x.user_id = p.uid) as prueba_filas,
           count(*) filter (where x.user_id <> p.uid) as otros_total,
           count(*) filter (where x.user_id <> p.uid and x.deleted_at is null) as otros_vivos,
           count(*) filter (where x.user_id <> p.uid and x.deleted_at is not null) as otros_borrados,
           count(distinct x.user_id) filter (where x.user_id <> p.uid) as otros_usuarios_distintos
    from public.work_people x, p
    union all
    select 15 as orden, 'cards' as tabla,
           count(*) filter (where x.user_id = p.uid) as prueba_filas,
           count(*) filter (where x.user_id <> p.uid) as otros_total,
           count(*) filter (where x.user_id <> p.uid and x.deleted_at is null) as otros_vivos,
           count(*) filter (where x.user_id <> p.uid and x.deleted_at is not null) as otros_borrados,
           count(distinct x.user_id) filter (where x.user_id <> p.uid) as otros_usuarios_distintos
    from public.cards x, p
)
select orden, tabla, prueba_filas, otros_total, otros_vivos, otros_borrados, otros_usuarios_distintos, null::text as valor
from t
union all
select 16, 'TODAS', sum(prueba_filas), sum(otros_total), sum(otros_vivos), sum(otros_borrados),
       (select count(distinct u) from (
            select user_id as u from public.finance_contacts, p where user_id <> p.uid
            union
            select user_id as u from public.finance_transactions, p where user_id <> p.uid
            union
            select user_id as u from public.balance_history, p where user_id <> p.uid
            union
            select user_id as u from public.finance_categories, p where user_id <> p.uid
            union
            select user_id as u from public.services, p where user_id <> p.uid
            union
            select user_id as u from public.entertainment_categories, p where user_id <> p.uid
            union
            select user_id as u from public.entertainment_pauses, p where user_id <> p.uid
            union
            select user_id as u from public.entertainment_quotas_history, p where user_id <> p.uid
            union
            select user_id as u from public.series, p where user_id <> p.uid
            union
            select user_id as u from public.seasons, p where user_id <> p.uid
            union
            select user_id as u from public.watch_history, p where user_id <> p.uid
            union
            select user_id as u from public.reading_history, p where user_id <> p.uid
            union
            select user_id as u from public.backlog, p where user_id <> p.uid
            union
            select user_id as u from public.work_people, p where user_id <> p.uid
            union
            select user_id as u from public.cards, p where user_id <> p.uid
       ) o), null
from t
union all
select 17, 'uid en auth.users', null, null, null, null, null,
       case when exists (select 1 from auth.users a, p where a.id = p.uid) then 'sí' else 'no' end
union all
select 18, 'usuarios en auth.users', null, null, null, null, null, (select count(*) from auth.users)::text
union all
select 19, 'grupos server_updated_at repetidos (prueba): watch_history', null, null, null, null, null, (select count(*) from (select 1 from public.watch_history x, p where x.user_id = p.uid group by x.server_updated_at having count(*) > 1) g)::text
union all
select 20, 'grupos server_updated_at repetidos (prueba): balance_history', null, null, null, null, null, (select count(*) from (select 1 from public.balance_history x, p where x.user_id = p.uid group by x.server_updated_at having count(*) > 1) g)::text
union all
select 21, 'grupos server_updated_at repetidos (prueba): backlog', null, null, null, null, null, (select count(*) from (select 1 from public.backlog x, p where x.user_id = p.uid group by x.server_updated_at having count(*) > 1) g)::text
union all
select 22, 'tamaño de la BD', null, null, null, null, null, pg_size_pretty(pg_database_size(current_database()))
union all
select 23, 'tamaño watch_history + balance_history (con índices)', null, null, null, null, null,
       pg_size_pretty(pg_total_relation_size('public.watch_history') + pg_total_relation_size('public.balance_history'))
union all
select 24, 'filas modificadas desde el último ANALYZE: watch_history', null, null, null, null, null,
       (select n_mod_since_analyze::text from pg_stat_user_tables where relid = 'public.watch_history'::regclass)
union all
select 25, 'filas modificadas desde el último ANALYZE: balance_history', null, null, null, null, null,
       (select n_mod_since_analyze::text from pg_stat_user_tables where relid = 'public.balance_history'::regclass)
order by orden;
