-- Fase 7.5 — vínculo Pendiente ↔ Series/Lectura y subtipo de lectura.
--
-- Solo aditiva: dos columnas nuevas (NULL), un CHECK que pasan todas las filas actuales (subtype
-- NULL), un UNIQUE (id, user_id) que ninguna fila puede violar (id es la clave primaria), una FK
-- compuesta y su índice. No crea tablas, no toca datos ni las migraciones aplicadas.
--
-- backlog.subtype (text, NULL): subtipo de lectura, 'book' | 'comic' | 'manga'. NULL en películas,
--   series y anime, y en la lectura de antes de la 7.5.
-- series.backlog_id (uuid, NULL): título de Pendiente al que está vinculada la serie (la serie es
--   la hija). NULL = serie sin vínculo (las de antes de la 7.5). Un título tiene como máximo una
--   serie viva (regla de la app, sin UNIQUE: los tombstones lo violarían y un 23505 no es una
--   fusión por clave natural).
-- series_backlog_fkey: compuesta (backlog_id, user_id) → backlog (id, user_id), diferida y SIN
--   on delete, como las demás FK entre tablas de dominio (el borrado es lógico). Con backlog_id
--   NULL no se comprueba (MATCH SIMPLE). El motor de sync la reconoce por el nombre ante un 23503.
--
-- Privilegios (regla de la Fase 6.1): las columnas heredan los grants de la tabla (por tabla,
-- migración 4/4); el constraint y el índice no tienen privilegios propios. Aun así se reafirman
-- los grants de las dos tablas igual que en 4/4 (idempotente: mismo resultado que antes;
-- scripts/probar-fase7-5.mjs lo compara en PGlite). RLS y políticas: sin cambios.

begin;

alter table public.backlog add column subtype text;

alter table public.backlog add constraint backlog_subtype_check
    check (subtype is null or (type = 'reading' and subtype in ('book', 'comic', 'manga')));

alter table public.backlog add constraint backlog_id_user_key unique (id, user_id);

alter table public.series add column backlog_id uuid;

alter table public.series add constraint series_backlog_fkey foreign key (backlog_id, user_id)
    references public.backlog (id, user_id) deferrable initially deferred;

create index series_backlog_idx on public.series (backlog_id, user_id);

comment on column public.backlog.subtype is
    'Subtipo de lectura: book | comic | manga. NULL fuera de lectura y en la lectura anterior a la Fase 7.5.';
comment on column public.series.backlog_id is
    'Título de Pendiente vinculado (Fase 7.5). NULL = serie sin vínculo.';

revoke all on table public.backlog from anon, authenticated, public;
grant select, insert, update on table public.backlog to authenticated;
revoke all on table public.series from anon, authenticated, public;
grant select, insert, update on table public.series to authenticated;

commit;
