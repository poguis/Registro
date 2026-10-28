-- Fase 2 · 2/4 — Las 15 tablas sincronizables (esquema local: src/data/db/migration2.ts).
--
-- Columnas comunes:
--   id                uuid PK, lo genera el cliente (UUID v4).
--   user_id           dueño; FK a auth.users con on delete cascade (borrar la cuenta
--                     borra sus datos; es el único borrado físico).
--   created_at        lo envía el cliente.
--   updated_at        lo envía el cliente; el servidor no lo modifica.
--   deleted_at        borrado lógico (tombstone); NULL = vivo.
--   server_updated_at lo asigna el trigger (archivo 3/4); cursor del pull.
--
-- FK entre tablas de dominio: compuestas (parent_id, user_id) → padre(id, user_id),
-- deferrable initially deferred y sin on delete (el borrado es lógico). Las FK no
-- pasan por RLS: la FK compuesta impide colgar filas de un padre de otro usuario.
-- La nulabilidad y los valores por defecto repiten los del SQLite local.
-- Montos en numeric(14,2): 12 dígitos enteros y centavos.

begin;

-- ---------------------------------------------------------------- Finanzas
create table public.finance_contacts (
    id uuid primary key,
    user_id uuid not null references auth.users (id) on delete cascade,
    name text not null,
    created_at timestamptz not null,
    updated_at timestamptz not null,
    deleted_at timestamptz,
    server_updated_at timestamptz not null,
    constraint finance_contacts_id_user_key unique (id, user_id)
);

create table public.finance_transactions (
    id uuid primary key,
    user_id uuid not null references auth.users (id) on delete cascade,
    contact_id uuid not null,
    type text not null,
    amount numeric(14, 2) not null,
    description text,
    created_at timestamptz not null,
    updated_at timestamptz not null,
    deleted_at timestamptz,
    server_updated_at timestamptz not null,
    constraint finance_transactions_type_check check (type in ('debt', 'loan')),
    constraint finance_transactions_contact_fkey foreign key (contact_id, user_id)
        references public.finance_contacts (id, user_id) deferrable initially deferred
);

create table public.balance_history (
    id uuid primary key,
    user_id uuid not null references auth.users (id) on delete cascade,
    amount numeric(14, 2) not null,
    category text not null,
    description text,
    created_at timestamptz not null,
    updated_at timestamptz not null,
    deleted_at timestamptz,
    server_updated_at timestamptz not null
);

create table public.finance_categories (
    id uuid primary key,
    user_id uuid not null references auth.users (id) on delete cascade,
    name text not null,
    icon text,
    created_at timestamptz not null,
    updated_at timestamptz not null,
    deleted_at timestamptz,
    server_updated_at timestamptz not null,
    constraint finance_categories_user_name_key unique (user_id, name)
);

-- ---------------------------------------------------------------- Servicios
create table public.services (
    id uuid primary key,
    user_id uuid not null references auth.users (id) on delete cascade,
    name text not null,
    type text not null,
    status text not null,
    original_value numeric(14, 2) not null,
    additional_value numeric(14, 2) default 0,
    total_value numeric(14, 2) not null,
    created_at timestamptz not null,
    updated_at timestamptz not null,
    deleted_at timestamptz,
    server_updated_at timestamptz not null,
    constraint services_type_check check (type in ('Local', 'Internacional')),
    constraint services_status_check check (status in ('Activo', 'Inactivo'))
);

comment on column public.services.total_value is
    'Valor histórico almacenado: Internacional = base × 1,20; Local = base + adicional.';

-- ---------------------------------------------------------------- Entretenimiento
create table public.entertainment_categories (
    id uuid primary key,
    user_id uuid not null references auth.users (id) on delete cascade,
    name text not null,
    type text not null,
    start_date date,
    days_of_week jsonb,
    frequency integer default 0,
    series_count integer default 0,
    description text,
    created_at timestamptz not null,
    updated_at timestamptz not null,
    deleted_at timestamptz,
    server_updated_at timestamptz not null,
    constraint entertainment_categories_id_user_key unique (id, user_id),
    constraint entertainment_categories_type_check check (type in ('video', 'reading')),
    constraint entertainment_categories_days_of_week_check
        check (days_of_week is null or jsonb_typeof(days_of_week) = 'object')
);

comment on column public.entertainment_categories.series_count is
    'Límite de series activas (Nueva, Mirando, Pausado) de la categoría; 0 o NULL = sin límite. No es un conteo.';
comment on column public.entertainment_categories.days_of_week is
    'Cuota por día: objeto {"Monday": n, ...}. La forma array legada se convierte a objeto antes del push.';
comment on column public.entertainment_categories.frequency is
    'n > 0: n por día; n < 0: 1 cada |n| días; 0: sin frecuencia.';

create table public.entertainment_pauses (
    id uuid primary key,
    user_id uuid not null references auth.users (id) on delete cascade,
    category_id uuid not null,
    pause_start date not null,
    pause_end date,
    created_at timestamptz not null,
    updated_at timestamptz not null,
    deleted_at timestamptz,
    server_updated_at timestamptz not null,
    constraint entertainment_pauses_category_fkey foreign key (category_id, user_id)
        references public.entertainment_categories (id, user_id) deferrable initially deferred
);

comment on column public.entertainment_pauses.pause_end is 'NULL = pausa vigente.';

create table public.entertainment_quotas_history (
    id uuid primary key,
    user_id uuid not null references auth.users (id) on delete cascade,
    category_id uuid not null,
    quotas jsonb not null,
    start_date date not null,
    end_date date,
    created_at timestamptz not null,
    updated_at timestamptz not null,
    deleted_at timestamptz,
    server_updated_at timestamptz not null,
    constraint entertainment_quotas_history_quotas_check check (jsonb_typeof(quotas) = 'object'),
    constraint entertainment_quotas_history_category_fkey foreign key (category_id, user_id)
        references public.entertainment_categories (id, user_id) deferrable initially deferred
);

comment on column public.entertainment_quotas_history.end_date is 'NULL = cuota vigente.';

create table public.series (
    id uuid primary key,
    user_id uuid not null references auth.users (id) on delete cascade,
    category_id uuid not null,
    name text not null,
    description text,
    status text default 'Nueva',
    current_season integer default 1,
    current_episode integer default 1,
    initial_season integer default 1,
    initial_episode integer default 1,
    total_seasons integer default 0,
    sort_order integer default 0,
    cycle_offset integer default 0,
    interleave_offset integer default 0,
    last_watched_at timestamptz,
    created_at timestamptz not null,
    updated_at timestamptz not null,
    deleted_at timestamptz,
    server_updated_at timestamptz not null,
    constraint series_id_user_key unique (id, user_id),
    constraint series_status_check
        check (status in ('Nueva', 'Mirando', 'Pausado', 'En espera', 'Terminado')),
    constraint series_category_fkey foreign key (category_id, user_id)
        references public.entertainment_categories (id, user_id) deferrable initially deferred
);

comment on column public.series.cycle_offset is 'Valor absoluto (no incremento).';
comment on column public.series.last_watched_at is 'NULL = nunca vista (en SQLite local es 0).';

create table public.seasons (
    id uuid primary key,
    user_id uuid not null references auth.users (id) on delete cascade,
    series_id uuid not null,
    season_number integer not null,
    episode_count integer default 0,
    created_at timestamptz not null,
    updated_at timestamptz not null,
    deleted_at timestamptz,
    server_updated_at timestamptz not null,
    constraint seasons_series_season_key unique (series_id, season_number),
    constraint seasons_series_fkey foreign key (series_id, user_id)
        references public.series (id, user_id) deferrable initially deferred
);

create table public.watch_history (
    id uuid primary key,
    user_id uuid not null references auth.users (id) on delete cascade,
    series_id uuid not null,
    season_number integer not null,
    episode_number integer not null,
    watched_at timestamptz not null,
    created_at timestamptz not null,
    updated_at timestamptz not null,
    deleted_at timestamptz,
    server_updated_at timestamptz not null,
    constraint watch_history_series_fkey foreign key (series_id, user_id)
        references public.series (id, user_id) deferrable initially deferred
);

create table public.reading_history (
    id uuid primary key,
    user_id uuid not null references auth.users (id) on delete cascade,
    series_id uuid not null,
    season_number integer not null,
    episode_number integer not null,
    read_at timestamptz not null,
    created_at timestamptz not null,
    updated_at timestamptz not null,
    deleted_at timestamptz,
    server_updated_at timestamptz not null,
    constraint reading_history_series_fkey foreign key (series_id, user_id)
        references public.series (id, user_id) deferrable initially deferred
);

-- ---------------------------------------------------------------- Pendientes
create table public.backlog (
    id uuid primary key,
    user_id uuid not null references auth.users (id) on delete cascade,
    type text not null,
    title text not null,
    status text default 'Pendiente',
    year integer,
    format text,
    start_year integer,
    end_year integer,
    franchise text default 'Otros',
    created_at timestamptz not null,
    updated_at timestamptz not null,
    deleted_at timestamptz,
    server_updated_at timestamptz not null,
    constraint backlog_type_check check (type in ('movie', 'series', 'anime', 'reading')),
    constraint backlog_status_check check (status in ('Pendiente', 'Mirando', 'Terminado'))
);

-- ---------------------------------------------------------------- Trabajo
create table public.work_people (
    id uuid primary key,
    user_id uuid not null references auth.users (id) on delete cascade,
    name text not null,
    start_date date not null,
    cycle jsonb not null,
    sort_order integer default 0,
    created_at timestamptz not null,
    updated_at timestamptz not null,
    deleted_at timestamptz,
    server_updated_at timestamptz not null,
    constraint work_people_cycle_check check (jsonb_typeof(cycle) = 'array')
);

comment on column public.work_people.cycle is 'Array [{type, days}].';

-- ---------------------------------------------------------------- Tarjetas
create table public.cards (
    id uuid primary key,
    user_id uuid not null references auth.users (id) on delete cascade,
    name text not null,
    type text not null,
    cutoff_date integer,
    payment_due_date integer,
    limit_amount numeric(14, 2),
    created_at timestamptz not null,
    updated_at timestamptz not null,
    deleted_at timestamptz,
    server_updated_at timestamptz not null,
    constraint cards_type_check check (type in ('debit', 'credit')),
    constraint cards_cutoff_date_check check (cutoff_date between 1 and 31),
    constraint cards_payment_due_date_check check (payment_due_date between 1 and 31)
);

comment on column public.cards.cutoff_date is 'Día del mes (1–31); NULL en tarjetas de débito.';
comment on column public.cards.payment_due_date is 'Día del mes (1–31); NULL en tarjetas de débito.';

commit;
