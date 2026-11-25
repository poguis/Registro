-- Fase 7.5b1 — etiquetas de Pendiente (O11; decisiones E1–E9 en claude/DISENO-ENTRETENIMIENTO.md).
--
-- Solo aditiva: una tabla nueva (catálogo de etiquetas, vacía al crearla) y una columna nueva NULL
-- en backlog con un CHECK que pasan todas las filas actuales (tags NULL). No toca datos ni las
-- migraciones aplicadas.
--
-- public.backlog_tags: catálogo de etiquetas por sección (el tipo del título: movie | series |
--   anime | reading). Igual que las demás tablas sincronizadas: user_id → auth.users on delete
--   cascade, columnas de sync, server_updated_at (trigger), índice de pull, RLS con 3 políticas y
--   sin DELETE (el borrado es lógico). Ninguna tabla la referencia por id: los títulos guardan los
--   NOMBRES (backlog.tags), así que la fusión por clave natural del motor de sync es segura.
--   name: el nombre que se muestra, normalizado por la app (sin espacios al inicio ni al final y los
--     internos reducidos a uno), de 1 a 30 caracteres.
--   name_key: la clave de unicidad, que calcula SOLO la app (name normalizado + toLowerCase; los
--     acentos cuentan). El servidor no la recalcula: lower() de Postgres puede no coincidir con el de
--     JS en algunas letras. De 1 a 60 caracteres (toLowerCase puede alargar letras como "İ").
--   unique (user_id, section, name_key): única por sección sin distinguir mayúsculas; incluye los
--     tombstones (la app revive la fila borrada en vez de insertar otra).
-- backlog.tags (jsonb, NULL): nombres de las etiquetas del título, como array de strings en la forma
--   canónica de la app (sin repetir por clave, ordenados por clave). NULL = sin etiquetas.
--
-- Privilegios (regla de la Fase 6.1): revoke explícito en la tabla nueva y solo select / insert /
-- update a authenticated. Se reafirman los grants de backlog igual que en 4/4 (mismo resultado que
-- antes; scripts/probar-fase7-5b1.mjs lo compara en PGlite). RLS y políticas de backlog: sin cambios.

begin;

create table public.backlog_tags (
    id uuid primary key,
    user_id uuid not null references auth.users (id) on delete cascade,
    section text not null,
    name text not null,
    name_key text not null,
    created_at timestamptz not null,
    updated_at timestamptz not null,
    deleted_at timestamptz,
    server_updated_at timestamptz not null,
    constraint backlog_tags_section_check check (section in ('movie', 'series', 'anime', 'reading')),
    constraint backlog_tags_name_check check (char_length(name) between 1 and 30 and name = btrim(name)),
    constraint backlog_tags_name_key_check check (char_length(name_key) between 1 and 60 and name_key = btrim(name_key)),
    constraint backlog_tags_user_section_key_key unique (user_id, section, name_key)
);

create index backlog_tags_pull_idx on public.backlog_tags (user_id, server_updated_at, id);

create trigger set_server_updated_at before insert or update on public.backlog_tags
    for each row execute function public.set_server_updated_at();

alter table public.backlog_tags enable row level security;

create policy backlog_tags_select_own on public.backlog_tags for select to authenticated
    using ((select auth.uid()) = user_id);
create policy backlog_tags_insert_own on public.backlog_tags for insert to authenticated
    with check ((select auth.uid()) = user_id);
create policy backlog_tags_update_own on public.backlog_tags for update to authenticated
    using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

revoke all on table public.backlog_tags from anon, authenticated, public;
grant select, insert, update on table public.backlog_tags to authenticated;

alter table public.backlog add column tags jsonb;

alter table public.backlog add constraint backlog_tags_array_check
    check (tags is null or (jsonb_typeof(tags) = 'array' and not jsonb_path_exists(tags, '$[*] ? (@.type() != "string")')));

comment on table public.backlog_tags is
    'Etiquetas de Pendiente por sección (Fase 7.5b1). name_key la calcula la app; nadie referencia esta tabla por id.';
comment on column public.backlog.tags is
    'Nombres de las etiquetas del título (Fase 7.5b1): array de strings, sin repetir por clave y ordenado por clave. NULL = sin etiquetas.';

revoke all on table public.backlog from anon, authenticated, public;
grant select, insert, update on table public.backlog to authenticated;

commit;
