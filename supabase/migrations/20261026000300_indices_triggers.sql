-- Fase 2 · 3/4 — Índices y triggers.
--
-- Índice del pull en cada tabla: (user_id, server_updated_at, id), que cubre
-- "where user_id = ? and (server_updated_at, id) > (?, ?) order by server_updated_at, id".
-- Más un índice por cada FK entre tablas de dominio (Postgres no los crea solo).
-- seasons(series_id) ya está cubierto por unique (series_id, season_number).

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
        execute format(
            'create index %I on public.%I (user_id, server_updated_at, id)',
            t || '_pull_idx', t);
        execute format(
            'create trigger set_server_updated_at before insert or update on public.%I '
            'for each row execute function public.set_server_updated_at()', t);
    end loop;
end;
$$;

create index finance_transactions_contact_idx on public.finance_transactions (contact_id, user_id);
create index entertainment_pauses_category_idx on public.entertainment_pauses (category_id, user_id);
create index entertainment_quotas_history_category_idx on public.entertainment_quotas_history (category_id, user_id);
create index series_category_idx on public.series (category_id, user_id);
create index watch_history_series_idx on public.watch_history (series_id, user_id);
create index reading_history_series_idx on public.reading_history (series_id, user_id);

commit;
