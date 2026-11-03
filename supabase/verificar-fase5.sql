-- Verificación de la Fase 5 (primer sync de los datos reales). SOLO LECTURA: no es una
-- migración y no escribe nada (sin INSERT, UPDATE, DELETE ni DDL).
-- Se ejecuta a mano en el SQL Editor del proyecto de PRODUCCIÓN ("Poguis").
-- Devuelve 16 filas sin contenido de dominio:
--   una por tabla sincronizada: total, vivos, borrados y usuarios distintos;
--   una final "TODAS": totales y ok = true si todas las filas pertenecen a UN único user_id.
with filas as (
              select 'finance_contacts' as tabla, user_id, deleted_at from public.finance_contacts
    union all select 'finance_transactions', user_id, deleted_at from public.finance_transactions
    union all select 'balance_history', user_id, deleted_at from public.balance_history
    union all select 'finance_categories', user_id, deleted_at from public.finance_categories
    union all select 'services', user_id, deleted_at from public.services
    union all select 'entertainment_categories', user_id, deleted_at from public.entertainment_categories
    union all select 'entertainment_pauses', user_id, deleted_at from public.entertainment_pauses
    union all select 'entertainment_quotas_history', user_id, deleted_at from public.entertainment_quotas_history
    union all select 'series', user_id, deleted_at from public.series
    union all select 'seasons', user_id, deleted_at from public.seasons
    union all select 'watch_history', user_id, deleted_at from public.watch_history
    union all select 'reading_history', user_id, deleted_at from public.reading_history
    union all select 'backlog', user_id, deleted_at from public.backlog
    union all select 'work_people', user_id, deleted_at from public.work_people
    union all select 'cards', user_id, deleted_at from public.cards
),
orden(tabla, n) as (values
    ('finance_contacts', 1), ('finance_transactions', 2), ('balance_history', 3), ('finance_categories', 4),
    ('services', 5), ('entertainment_categories', 6), ('entertainment_pauses', 7), ('entertainment_quotas_history', 8),
    ('series', 9), ('seasons', 10), ('watch_history', 11), ('reading_history', 12), ('backlog', 13),
    ('work_people', 14), ('cards', 15)
)
select tabla, total, vivos, borrados, usuarios_distintos, ok
from (
    select o.n,
           o.tabla,
           count(f.tabla) as total,
           count(f.tabla) filter (where f.deleted_at is null) as vivos,
           count(f.tabla) filter (where f.deleted_at is not null) as borrados,
           count(distinct f.user_id) as usuarios_distintos,
           count(distinct f.user_id) <= 1 as ok
    from orden o
    left join filas f on f.tabla = o.tabla
    group by o.n, o.tabla
    union all
    select 16,
           'TODAS',
           count(*),
           count(*) filter (where deleted_at is null),
           count(*) filter (where deleted_at is not null),
           count(distinct user_id),
           count(distinct user_id) = 1
    from filas
) r
order by n;
