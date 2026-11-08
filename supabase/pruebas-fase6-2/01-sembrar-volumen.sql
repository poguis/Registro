-- SOLO Registro Dev. Nunca ejecutar en Poguis.
--
-- Fase 6.2 · 01 — Siembra sintética de volumen para UN usuario de prueba (no es migración).
--
-- Uso: pega el uid del usuario de prueba en la línea marcada PEGAR_UID_AQUI y ejecuta el
-- archivo entero en el SQL Editor de Registro Dev (rol del editor: postgres).
-- Si no se pega el uid, el cast a uuid falla y no se escribe nada.
--
-- Es UNA sola sentencia DO: atómica. Cualquier guarda o error revierte todo, sin dejar filas.
-- Guardas (antes del primer INSERT):
--   (1) el uid existe en auth.users (en Poguis no existe; además la FK lo impediría);
--   (2) el uid no tiene ninguna fila en ninguna de las 15 tablas (protege a usuarios reales);
--   (3) hay al menos 2 usuarios en auth.users (en Poguis hay uno solo).
--
-- Marca sintética doble (la que exige 04-limpieza-emergencia.sql):
--   - todo texto obligatorio empieza por [F6.2];
--   - todas las filas llevan created_at = updated_at = 2000-06-02T00:00:00Z (centinela: la app
--     nació en 2026 y escribe nowIso(); created_at no interviene en el pull).
-- server_updated_at lo asigna el trigger (clock_timestamp() por fila): este archivo no puede
-- forzar valores repetidos. Solo aparecen si el reloj del servidor tiene poca resolución (en
-- PGlite sí; en Supabase se espera ~0, y 03 lo informa). El desempate por id con bloques de
-- empates que cruzan las páginas se prueba en PGlite (probar-fase6-2).
--
-- Volumen a escala 1 (~122.000 filas; ~35–45 MB): watch_history 50.000, balance_history
-- 50.000, reading_history 10.000, finance_transactions 5.000, seasons 2.000 (4 por serie),
-- backlog 2.000, series 500, entertainment_pauses 100, entertainment_quotas_history 100,
-- finance_contacts 50, services 30, finance_categories 20, work_people 20,
-- entertainment_categories 10, cards 10. ~5 % de cada tabla con deleted_at (tombstones).
-- Si el editor corta por tiempo, se revierte entero: baja la escala (línea ESCALA) y repite.
--
-- Sin DELETE, UPDATE, DROP, TRUNCATE ni ALTER.

do $$
declare
    v_uid uuid := 'PEGAR_UID_AQUI'; -- PEGAR_UID_AQUI: uid del usuario de prueba de Registro Dev
    v_escala numeric := 1; -- ESCALA: 1 = volumen completo; 0.5 o 0.25 si el editor corta por tiempo
    v_c constant timestamptz := '2000-06-02 00:00:00+00'; -- centinela sintético
    v_t text;
    v_hay boolean;
    n_contactos int; n_movimientos int; n_saldo int; n_categorias int; n_servicios int;
    n_cat_ent int; n_pausas int; n_cuotas int; n_series int; n_vistos int; n_leidos int;
    n_backlog int; n_personas int; n_tarjetas int;
    a_contactos uuid[]; a_cat_ent uuid[]; a_series uuid[];
begin
    -- ------------------------------------------------------------ guardas
    if not exists (select 1 from auth.users where id = v_uid) then
        raise exception 'F6.2 guarda 1: el uid no existe en auth.users; no se escribió nada';
    end if;
    foreach v_t in array array[
        'finance_contacts', 'finance_transactions', 'balance_history', 'finance_categories',
        'services', 'entertainment_categories', 'entertainment_pauses',
        'entertainment_quotas_history', 'series', 'seasons', 'watch_history',
        'reading_history', 'backlog', 'work_people', 'cards'
    ] loop
        execute format('select exists (select 1 from public.%I where user_id = $1)', v_t) into v_hay using v_uid;
        if v_hay then
            raise exception 'F6.2 guarda 2: el uid ya tiene filas en %; no se escribió nada', v_t;
        end if;
    end loop;
    if (select count(*) from auth.users) < 2 then
        raise exception 'F6.2 guarda 3: hay menos de 2 usuarios en auth.users; no se escribió nada';
    end if;
    if v_escala is null or v_escala <= 0 or v_escala > 1 then
        raise exception 'F6.2: la escala debe estar en (0, 1]';
    end if;

    -- ------------------------------------------------------------ cantidades
    n_vistos      := greatest(1, round(50000 * v_escala))::int;
    n_saldo       := greatest(1, round(50000 * v_escala))::int;
    n_leidos      := greatest(1, round(10000 * v_escala))::int;
    n_movimientos := greatest(1, round(5000 * v_escala))::int;
    n_backlog     := greatest(1, round(2000 * v_escala))::int;
    n_series      := greatest(1, round(500 * v_escala))::int; -- seasons = 4 × series
    n_pausas      := greatest(1, round(100 * v_escala))::int;
    n_cuotas      := greatest(1, round(100 * v_escala))::int;
    n_contactos   := greatest(1, round(50 * v_escala))::int;
    n_servicios   := greatest(1, round(30 * v_escala))::int;
    n_categorias  := greatest(1, round(20 * v_escala))::int;
    n_personas    := greatest(1, round(20 * v_escala))::int;
    n_cat_ent     := greatest(2, round(10 * v_escala))::int;
    n_tarjetas    := greatest(2, round(10 * v_escala))::int;

    -- ------------------------------------------------------------ finanzas
    insert into public.finance_contacts (id, user_id, name, created_at, updated_at, deleted_at)
    select gen_random_uuid(), v_uid, '[F6.2] contacto ' || g, v_c, v_c,
           case when g % 20 = 0 then v_c end
    from generate_series(1, n_contactos) g;
    select array_agg(id order by id) into a_contactos from public.finance_contacts where user_id = v_uid;

    insert into public.finance_transactions (id, user_id, contact_id, type, amount, description, created_at, updated_at, deleted_at)
    select gen_random_uuid(), v_uid, a_contactos[1 + g % n_contactos],
           case when g % 2 = 0 then 'debt' else 'loan' end,
           (g % 100000) / 100.0, '[F6.2] movimiento ' || g, v_c, v_c,
           case when g % 20 = 0 then v_c end
    from generate_series(1, n_movimientos) g;

    insert into public.balance_history (id, user_id, amount, category, description, created_at, updated_at, deleted_at)
    select gen_random_uuid(), v_uid, ((g % 20000) - 10000) / 100.0,
           '[F6.2] categoría ' || (g % 20), '[F6.2] saldo ' || g, v_c, v_c,
           case when g % 20 = 0 then v_c end
    from generate_series(1, n_saldo) g;

    insert into public.finance_categories (id, user_id, name, icon, created_at, updated_at, deleted_at)
    select gen_random_uuid(), v_uid, '[F6.2] categoría ' || g, null, v_c, v_c,
           case when g % 20 = 0 then v_c end
    from generate_series(1, n_categorias) g;

    -- ------------------------------------------------------------ servicios
    insert into public.services (id, user_id, name, type, status, original_value, additional_value, total_value, created_at, updated_at, deleted_at)
    select gen_random_uuid(), v_uid, '[F6.2] servicio ' || g,
           case when g % 2 = 0 then 'Local' else 'Internacional' end,
           case when g % 3 = 0 then 'Inactivo' else 'Activo' end,
           10.00, 0, case when g % 2 = 0 then 10.00 else 12.00 end, v_c, v_c,
           case when g % 20 = 0 then v_c end
    from generate_series(1, n_servicios) g;

    -- ------------------------------------------------------------ entretenimiento
    insert into public.entertainment_categories (id, user_id, name, type, start_date, days_of_week, frequency, series_count, description, created_at, updated_at, deleted_at)
    select gen_random_uuid(), v_uid, '[F6.2] categoría ' || g,
           case when g % 2 = 0 then 'video' else 'reading' end,
           date '2000-06-02',
           '{"Monday": 1, "Tuesday": 1, "Wednesday": 1, "Thursday": 1, "Friday": 1, "Saturday": 0, "Sunday": 0}'::jsonb,
           0, 0, '[F6.2] descripción', v_c, v_c, null
    from generate_series(1, n_cat_ent) g;
    select array_agg(id order by id) into a_cat_ent from public.entertainment_categories where user_id = v_uid;

    insert into public.entertainment_pauses (id, user_id, category_id, pause_start, pause_end, created_at, updated_at, deleted_at)
    select gen_random_uuid(), v_uid, a_cat_ent[1 + g % n_cat_ent],
           date '2000-06-02' + g, date '2000-06-02' + g + 1, v_c, v_c,
           case when g % 20 = 0 then v_c end
    from generate_series(1, n_pausas) g;

    insert into public.entertainment_quotas_history (id, user_id, category_id, quotas, start_date, end_date, created_at, updated_at, deleted_at)
    select gen_random_uuid(), v_uid, a_cat_ent[1 + g % n_cat_ent],
           '{"Monday": 2, "Tuesday": 2, "Wednesday": 2, "Thursday": 2, "Friday": 2, "Saturday": 0, "Sunday": 0}'::jsonb,
           date '2000-06-02' + g, null, v_c, v_c,
           case when g % 20 = 0 then v_c end
    from generate_series(1, n_cuotas) g;

    insert into public.series (id, user_id, category_id, name, description, status, last_watched_at, created_at, updated_at, deleted_at)
    select gen_random_uuid(), v_uid, a_cat_ent[1 + g % n_cat_ent], '[F6.2] serie ' || g, null,
           (array['Nueva', 'Mirando', 'Pausado', 'En espera', 'Terminado'])[1 + g % 5],
           null, v_c, v_c, case when g % 20 = 0 then v_c end
    from generate_series(1, n_series) g;
    select array_agg(id order by id) into a_series from public.series where user_id = v_uid;

    insert into public.seasons (id, user_id, series_id, season_number, episode_count, created_at, updated_at, deleted_at)
    select gen_random_uuid(), v_uid, s.id, k, 10, v_c, v_c, null
    from unnest(a_series) as s(id) cross join generate_series(1, 4) as k;

    insert into public.watch_history (id, user_id, series_id, season_number, episode_number, watched_at, created_at, updated_at, deleted_at)
    select gen_random_uuid(), v_uid, a_series[1 + g % n_series], 1 + g % 4, g,
           v_c + g * interval '1 minute', v_c, v_c,
           case when g % 20 = 0 then v_c end
    from generate_series(1, n_vistos) g;

    insert into public.reading_history (id, user_id, series_id, season_number, episode_number, read_at, created_at, updated_at, deleted_at)
    select gen_random_uuid(), v_uid, a_series[1 + g % n_series], 1 + g % 4, g,
           v_c + g * interval '1 minute', v_c, v_c,
           case when g % 20 = 0 then v_c end
    from generate_series(1, n_leidos) g;

    -- ------------------------------------------------------------ pendientes, trabajo, tarjetas
    insert into public.backlog (id, user_id, type, title, status, year, format, start_year, end_year, franchise, created_at, updated_at, deleted_at)
    select gen_random_uuid(), v_uid,
           (array['movie', 'series', 'anime', 'reading'])[1 + g % 4], '[F6.2] pendiente ' || g,
           (array['Pendiente', 'Mirando', 'Terminado'])[1 + g % 3], 2000, null, null, null,
           '[F6.2] franquicia', v_c, v_c, case when g % 20 = 0 then v_c end
    from generate_series(1, n_backlog) g;

    insert into public.work_people (id, user_id, name, start_date, cycle, sort_order, created_at, updated_at, deleted_at)
    select gen_random_uuid(), v_uid, '[F6.2] persona ' || g, date '2000-06-02',
           '[{"type": "Trabajo", "days": 5}, {"type": "Descanso", "days": 2}]'::jsonb, g, v_c, v_c,
           case when g % 20 = 0 then v_c end
    from generate_series(1, n_personas) g;

    insert into public.cards (id, user_id, name, type, cutoff_date, payment_due_date, limit_amount, created_at, updated_at, deleted_at)
    select gen_random_uuid(), v_uid, '[F6.2] tarjeta ' || g,
           case when g % 2 = 0 then 'debit' else 'credit' end,
           case when g % 2 = 0 then null else 1 + g % 28 end,
           case when g % 2 = 0 then null else 1 + (g + 10) % 28 end,
           case when g % 2 = 0 then null else 1000.00 end, v_c, v_c, null
    from generate_series(1, n_tarjetas) g;

    raise notice 'F6.2: siembra completa (escala %): % filas', v_escala,
        n_contactos + n_movimientos + n_saldo + n_categorias + n_servicios + n_cat_ent + n_pausas
        + n_cuotas + n_series + 4 * n_series + n_vistos + n_leidos + n_backlog + n_personas + n_tarjetas;
end;
$$;
