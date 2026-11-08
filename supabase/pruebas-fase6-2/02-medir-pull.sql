-- SOLO Registro Dev. Nunca ejecutar en Poguis.
--
-- Fase 6.2 · 02 — Medición del pull con RLS (no es migración; solo lectura).
--
-- PASO 1 (este archivo): pega el uid del usuario de prueba en la línea PEGAR_UID_AQUI y
-- ejecútalo con el rol del editor en "postgres". Es UN solo SELECT de solo lectura: calcula
-- los cursores reales del usuario de prueba y devuelve 9 filas (watch_history,
-- balance_history y backlog × primera / intermedia / última página), cada una con un bloque
-- listo para pegar con los literales ya puestos.
--
-- PASO 2: pega cada bloque (columna "bloque") en una pestaña nueva, con el rol del editor en
-- "postgres" (NO uses el selector "authenticated" del editor: el bloque ya cambia de rol), y
-- ejecútalo. Guarda el plan de cada uno (9 ejecuciones).
--
-- Qué hace cada bloque y por qué no deja cambios persistentes:
--   select set_config('request.jwt.claims', '{"sub": …, "role": "authenticated"}', true);
--   set local role authenticated;
--   explain (analyze, buffers) <consulta del pull>;
-- Las sentencias de un mismo envío corren en una transacción implícita: set_config(…, true)
-- y "set local" mueren con ella. EXPLAIN ANALYZE de un SELECT no escribe nada.
--
-- La consulta repite la del transporte de la app (src/sync/supabaseTransport.ts, pullPage):
--   primera página:  sin filtro            order by server_updated_at, id limit 500
--   siguientes:      (server_updated_at > ts or (server_updated_at = ts and id > id))
--                    order by server_updated_at, id limit 500
-- Sin filtro por user_id: lo pone la RLS. PostgREST la envuelve en un CTE con json_agg, que
-- no cambia el plan del recorrido.
--
-- Comprobación obligatoria en cada plan: debe aparecer un InitPlan con auth.uid() y la
-- condición "user_id = (InitPlan …)". Si no aparece, no se aplicó la RLS y esa medición no vale.
--
-- Páginas: primera = sin cursor (dispositivo nuevo); intermedia = cursor en la fila N/2;
-- última = cursor en la fila N−499 (quedan 499 filas: la página es la última).

with p as (
    select 'PEGAR_UID_AQUI'::uuid as uid -- PEGAR_UID_AQUI: uid del usuario de prueba de Registro Dev
),
filas as (
    select 'watch_history' as tabla, 1 as t_orden, x.server_updated_at as ts, x.id,
           row_number() over (order by x.server_updated_at, x.id) as rn, count(*) over () as n
    from public.watch_history x, p where x.user_id = p.uid
    union all
    select 'balance_history', 2, x.server_updated_at, x.id,
           row_number() over (order by x.server_updated_at, x.id), count(*) over ()
    from public.balance_history x, p where x.user_id = p.uid
    union all
    select 'backlog', 3, x.server_updated_at, x.id,
           row_number() over (order by x.server_updated_at, x.id), count(*) over ()
    from public.backlog x, p where x.user_id = p.uid
),
tablas as (
    select * from (values ('watch_history', 1), ('balance_history', 2), ('backlog', 3)) as v(tabla, t_orden)
),
paginas as (
    select * from (values (1, 'primera'), (2, 'intermedia'), (3, 'última')) as v(p_orden, pagina)
),
totales as (
    select t.tabla, t.t_orden, coalesce(max(f.n), 0) as n
    from tablas t left join filas f on f.tabla = t.tabla
    group by t.tabla, t.t_orden
),
cursores as (
    select tt.tabla, tt.t_orden, tt.n, pg.p_orden, pg.pagina, f.ts, f.id
    from totales tt
    cross join paginas pg
    left join filas f on f.tabla = tt.tabla
        and f.rn = case pg.p_orden when 2 then greatest(tt.n / 2, 1) when 3 then greatest(tt.n - 499, 1) end
)
select
    (c.t_orden - 1) * 3 + c.p_orden as orden,
    c.tabla,
    c.pagina,
    c.n as filas_del_usuario,
    case
        when c.n = 0 then '-- el usuario de prueba no tiene filas en ' || c.tabla
        else
            format('select set_config(%L, %L, true);', 'request.jwt.claims',
                   json_build_object('sub', p.uid, 'role', 'authenticated')::text)
            || E'\n' || 'set local role authenticated;'
            || E'\n' || format('explain (analyze, buffers) select * from public.%I', c.tabla)
            || case when c.p_orden = 1 then ''
                    else format(' where (server_updated_at > %L::timestamptz or (server_updated_at = %L::timestamptz and id > %L::uuid))',
                                c.ts::text, c.ts::text, c.id::text)
               end
            || ' order by server_updated_at, id limit 500;'
    end as bloque
from cursores c, p
order by orden;
