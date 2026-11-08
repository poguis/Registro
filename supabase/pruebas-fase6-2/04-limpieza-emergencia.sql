-- SOLO Registro Dev. Nunca ejecutar en Poguis.
--
-- Fase 6.2 · 04 — LIMPIEZA DE EMERGENCIA (Plan B; no es migración).
--
-- ÚNICA EXCEPCIÓN a "sin DELETE" de la 6.2. Ejecutar SOLO si falló el paso 6 del README
-- (borrar el usuario de prueba desde Authentication → Users). El SQL Editor mostrará el aviso
-- de operación destructiva: es esperado; confirma solo si estás en Registro Dev y el paso 6
-- falló.
--
-- Uso: pega el uid del usuario de prueba en la línea PEGAR_UID_AQUI y ejecuta (rol del
-- editor: postgres). Después ejecuta 03-verificar-cascada.sql: deben quedar 0 filas del uid en
-- las 15 tablas y los demás usuarios idénticos. No toca auth.users.
--
-- Es UNA sola sentencia DO: atómica. Guardas, todas antes del primer DELETE (cualquier fallo
-- aborta sin borrar nada):
--   (a) el uid existe en auth.users;
--   (b) hay al menos 2 usuarios en auth.users;
--   (c) TODAS las filas del uid son sintéticas (las escribió 01-sembrar-volumen.sql):
--       - tablas con texto: el texto empieza por [F6.2] Y created_at = centinela
--         2000-06-02T00:00:00Z;
--       - entertainment_pauses, entertainment_quotas_history: created_at = centinela Y su
--         entertainment_categories padre es sintético (prefijo y centinela);
--       - seasons, watch_history, reading_history: created_at = centinela Y su series padre es
--         sintética (prefijo y centinela).
--       Tres señales independientes: el prefijo solo lo escribe 01; la app escribe nowIso()
--       desde 2026 (nunca el año 2000); la FK compuesta (parent_id, user_id) garantiza que el
--       padre existe y es del mismo uid.
-- Borrado de hijos a padres (las FK compuestas son diferidas; el orden evita depender de eso).
-- Solo conteos en la salida. Sin UPDATE, DROP, TRUNCATE ni ALTER.

do $$
declare
    v_uid uuid := 'PEGAR_UID_AQUI'; -- PEGAR_UID_AQUI: uid del usuario de prueba de Registro Dev
    v_c constant timestamptz := '2000-06-02 00:00:00+00'; -- centinela sintético de 01
    v_p constant text := '[F6.2]';
    v_n bigint;
    v_resumen text := '';
begin
    -- ------------------------------------------------------------ guardas (a) y (b)
    if not exists (select 1 from auth.users where id = v_uid) then
        raise exception 'F6.2 limpieza guarda (a): el uid no existe en auth.users; no se borró nada';
    end if;
    if (select count(*) from auth.users) < 2 then
        raise exception 'F6.2 limpieza guarda (b): hay menos de 2 usuarios en auth.users; no se borró nada';
    end if;

    -- ------------------------------------------------------------ guarda (c): todo es sintético
    -- Tablas con texto: prefijo + centinela.
    if exists (select 1 from public.finance_contacts where user_id = v_uid
               and (coalesce(left(name, 6), '') <> v_p or created_at is distinct from v_c)) then
        raise exception 'F6.2 limpieza guarda (c): finance_contacts tiene filas no sintéticas; no se borró nada';
    end if;
    if exists (select 1 from public.finance_transactions where user_id = v_uid
               and (coalesce(left(description, 6), '') <> v_p or created_at is distinct from v_c)) then
        raise exception 'F6.2 limpieza guarda (c): finance_transactions tiene filas no sintéticas; no se borró nada';
    end if;
    if exists (select 1 from public.balance_history where user_id = v_uid
               and (coalesce(left(category, 6), '') <> v_p or created_at is distinct from v_c)) then
        raise exception 'F6.2 limpieza guarda (c): balance_history tiene filas no sintéticas; no se borró nada';
    end if;
    if exists (select 1 from public.finance_categories where user_id = v_uid
               and (coalesce(left(name, 6), '') <> v_p or created_at is distinct from v_c)) then
        raise exception 'F6.2 limpieza guarda (c): finance_categories tiene filas no sintéticas; no se borró nada';
    end if;
    if exists (select 1 from public.services where user_id = v_uid
               and (coalesce(left(name, 6), '') <> v_p or created_at is distinct from v_c)) then
        raise exception 'F6.2 limpieza guarda (c): services tiene filas no sintéticas; no se borró nada';
    end if;
    if exists (select 1 from public.entertainment_categories where user_id = v_uid
               and (coalesce(left(name, 6), '') <> v_p or created_at is distinct from v_c)) then
        raise exception 'F6.2 limpieza guarda (c): entertainment_categories tiene filas no sintéticas; no se borró nada';
    end if;
    if exists (select 1 from public.series where user_id = v_uid
               and (coalesce(left(name, 6), '') <> v_p or created_at is distinct from v_c)) then
        raise exception 'F6.2 limpieza guarda (c): series tiene filas no sintéticas; no se borró nada';
    end if;
    if exists (select 1 from public.backlog where user_id = v_uid
               and (coalesce(left(title, 6), '') <> v_p or created_at is distinct from v_c)) then
        raise exception 'F6.2 limpieza guarda (c): backlog tiene filas no sintéticas; no se borró nada';
    end if;
    if exists (select 1 from public.work_people where user_id = v_uid
               and (coalesce(left(name, 6), '') <> v_p or created_at is distinct from v_c)) then
        raise exception 'F6.2 limpieza guarda (c): work_people tiene filas no sintéticas; no se borró nada';
    end if;
    if exists (select 1 from public.cards where user_id = v_uid
               and (coalesce(left(name, 6), '') <> v_p or created_at is distinct from v_c)) then
        raise exception 'F6.2 limpieza guarda (c): cards tiene filas no sintéticas; no se borró nada';
    end if;
    -- Tablas sin texto: centinela + padre sintético (por la FK compuesta).
    if exists (select 1 from public.entertainment_pauses x where x.user_id = v_uid
               and (x.created_at is distinct from v_c or not exists (
                    select 1 from public.entertainment_categories e
                    where e.id = x.category_id and e.user_id = x.user_id
                      and left(e.name, 6) = v_p and e.created_at = v_c))) then
        raise exception 'F6.2 limpieza guarda (c): entertainment_pauses tiene filas no sintéticas; no se borró nada';
    end if;
    if exists (select 1 from public.entertainment_quotas_history x where x.user_id = v_uid
               and (x.created_at is distinct from v_c or not exists (
                    select 1 from public.entertainment_categories e
                    where e.id = x.category_id and e.user_id = x.user_id
                      and left(e.name, 6) = v_p and e.created_at = v_c))) then
        raise exception 'F6.2 limpieza guarda (c): entertainment_quotas_history tiene filas no sintéticas; no se borró nada';
    end if;
    if exists (select 1 from public.seasons x where x.user_id = v_uid
               and (x.created_at is distinct from v_c or not exists (
                    select 1 from public.series s
                    where s.id = x.series_id and s.user_id = x.user_id
                      and left(s.name, 6) = v_p and s.created_at = v_c))) then
        raise exception 'F6.2 limpieza guarda (c): seasons tiene filas no sintéticas; no se borró nada';
    end if;
    if exists (select 1 from public.watch_history x where x.user_id = v_uid
               and (x.created_at is distinct from v_c or not exists (
                    select 1 from public.series s
                    where s.id = x.series_id and s.user_id = x.user_id
                      and left(s.name, 6) = v_p and s.created_at = v_c))) then
        raise exception 'F6.2 limpieza guarda (c): watch_history tiene filas no sintéticas; no se borró nada';
    end if;
    if exists (select 1 from public.reading_history x where x.user_id = v_uid
               and (x.created_at is distinct from v_c or not exists (
                    select 1 from public.series s
                    where s.id = x.series_id and s.user_id = x.user_id
                      and left(s.name, 6) = v_p and s.created_at = v_c))) then
        raise exception 'F6.2 limpieza guarda (c): reading_history tiene filas no sintéticas; no se borró nada';
    end if;

    -- ------------------------------------------------------------ borrado, de hijos a padres
    delete from public.finance_transactions where user_id = v_uid;
    get diagnostics v_n = row_count; v_resumen := v_resumen || ' finance_transactions=' || v_n;
    delete from public.entertainment_pauses where user_id = v_uid;
    get diagnostics v_n = row_count; v_resumen := v_resumen || ' entertainment_pauses=' || v_n;
    delete from public.entertainment_quotas_history where user_id = v_uid;
    get diagnostics v_n = row_count; v_resumen := v_resumen || ' entertainment_quotas_history=' || v_n;
    delete from public.seasons where user_id = v_uid;
    get diagnostics v_n = row_count; v_resumen := v_resumen || ' seasons=' || v_n;
    delete from public.watch_history where user_id = v_uid;
    get diagnostics v_n = row_count; v_resumen := v_resumen || ' watch_history=' || v_n;
    delete from public.reading_history where user_id = v_uid;
    get diagnostics v_n = row_count; v_resumen := v_resumen || ' reading_history=' || v_n;
    delete from public.series where user_id = v_uid;
    get diagnostics v_n = row_count; v_resumen := v_resumen || ' series=' || v_n;
    delete from public.entertainment_categories where user_id = v_uid;
    get diagnostics v_n = row_count; v_resumen := v_resumen || ' entertainment_categories=' || v_n;
    delete from public.finance_contacts where user_id = v_uid;
    get diagnostics v_n = row_count; v_resumen := v_resumen || ' finance_contacts=' || v_n;
    delete from public.balance_history where user_id = v_uid;
    get diagnostics v_n = row_count; v_resumen := v_resumen || ' balance_history=' || v_n;
    delete from public.finance_categories where user_id = v_uid;
    get diagnostics v_n = row_count; v_resumen := v_resumen || ' finance_categories=' || v_n;
    delete from public.services where user_id = v_uid;
    get diagnostics v_n = row_count; v_resumen := v_resumen || ' services=' || v_n;
    delete from public.backlog where user_id = v_uid;
    get diagnostics v_n = row_count; v_resumen := v_resumen || ' backlog=' || v_n;
    delete from public.work_people where user_id = v_uid;
    get diagnostics v_n = row_count; v_resumen := v_resumen || ' work_people=' || v_n;
    delete from public.cards where user_id = v_uid;
    get diagnostics v_n = row_count; v_resumen := v_resumen || ' cards=' || v_n;

    raise notice 'F6.2 limpieza: filas borradas:%', v_resumen;
end;
$$;
