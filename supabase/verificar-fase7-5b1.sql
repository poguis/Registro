-- Verificación de la Fase 7.5b1 (migración 20261124000100_etiquetas.sql). SOLO LECTURA: no es una
-- migración y no escribe nada (un único SELECT, sin INSERT, UPDATE, DELETE ni DDL).
-- Se ejecuta a mano en el SQL Editor de cada proyecto (Registro Dev y luego Poguis) DESPUÉS de
-- aplicar la migración. Devuelve 20 filas (orden | chequeo | valor | esperado | ok), sin contenido
-- de dominio; todas deben salir ok = true. Sin la migración no falla: las filas de backlog_tags y
-- backlog.tags salen "(no existe)" con ok = false.
with
tabla as (
    select c.oid, c.relrowsecurity, c.relforcerowsecurity
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'backlog_tags' and c.relkind = 'r'
),
columnas as (
    select column_name, data_type, is_nullable, column_default, ordinal_position
    from information_schema.columns
    where table_schema = 'public' and table_name = 'backlog_tags'
),
col_tags as (
    select data_type, is_nullable, column_default
    from information_schema.columns
    where table_schema = 'public' and table_name = 'backlog' and column_name = 'tags'
),
restricciones as (
    select con.conname, con.contype, con.confdeltype,
           rel.relname as tabla, ref.relname as referida, refn.nspname as esquema_ref,
           pg_get_constraintdef(con.oid) as def,
           (select string_agg(a.attname, ',' order by k.ord) from unnest(con.conkey) with ordinality k(attnum, ord)
              join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.attnum) as cols,
           (select string_agg(a.attname, ',' order by k.ord) from unnest(con.confkey) with ordinality k(attnum, ord)
              join pg_attribute a on a.attrelid = con.confrelid and a.attnum = k.attnum) as refcols
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace n on n.oid = rel.relnamespace
    left join pg_class ref on ref.oid = con.confrelid
    left join pg_namespace refn on refn.oid = ref.relnamespace
    where n.nspname = 'public' and rel.relname in ('backlog_tags', 'backlog')
      and con.contype in ('c', 'u', 'f')
),
disparador as (
    select count(*) as n from pg_trigger tg join tabla on tabla.oid = tg.tgrelid
    where tg.tgname = 'set_server_updated_at' and not tg.tgisinternal and tg.tgenabled = 'O'
      and (tg.tgtype & 1) = 1 and (tg.tgtype & 2) = 2 and (tg.tgtype & 4) = 4 and (tg.tgtype & 16) = 16
),
indice as (
    select indexdef from pg_indexes where schemaname = 'public' and tablename = 'backlog_tags' and indexname = 'backlog_tags_pull_idx'
),
priv_auth as (
    select table_name, string_agg(privilege_type, ',' order by privilege_type) as p
    from information_schema.role_table_grants
    where table_schema = 'public' and table_name in ('backlog_tags', 'backlog') and grantee = 'authenticated'
    group by table_name
),
priv_otros as (
    select table_name, count(*) as n
    from information_schema.role_table_grants
    where table_schema = 'public' and table_name in ('backlog_tags', 'backlog') and grantee in ('anon', 'PUBLIC')
    group by table_name
),
priv_col_otros as (
    select count(*) filter (where table_name = 'backlog_tags') as n_tags,
           count(*) filter (where table_name = 'backlog' and column_name = 'tags') as n_col
    from information_schema.column_privileges
    where table_schema = 'public' and table_name in ('backlog_tags', 'backlog') and grantee in ('anon', 'PUBLIC')
),
politicas as (
    select cmd, roles, qual, with_check from pg_policies where schemaname = 'public' and tablename = 'backlog_tags'
),
filas(orden, chequeo, valor, esperado) as (values
    (1, 'backlog_tags: existe · RLS activa · RLS forzada',
        coalesce((select 'sí · ' || relrowsecurity::text || ' · ' || relforcerowsecurity::text from tabla), '(no existe)'), 'sí · true · false'),
    (2, 'backlog_tags: columnas (nombre:tipo:nulable, en orden)',
        coalesce((select string_agg(column_name || ':' || data_type || ':' || is_nullable, ',' order by ordinal_position) from columnas), '(no existe)'),
        'id:uuid:NO,user_id:uuid:NO,section:text:NO,name:text:NO,name_key:text:NO,created_at:timestamp with time zone:NO,updated_at:timestamp with time zone:NO,deleted_at:timestamp with time zone:YES,server_updated_at:timestamp with time zone:NO'),
    (3, 'backlog_tags: columnas con default', (select count(*) filter (where column_default is not null)::text from columnas), '0'),
    (4, 'backlog_tags_section_check: movie / series / anime / reading',
        coalesce((select def from restricciones where conname = 'backlog_tags_section_check'), '(no existe)'),
        'CHECK ((section = ANY (ARRAY[''movie''::text, ''series''::text, ''anime''::text, ''reading''::text])))'),
    (5, 'backlog_tags_name_check: de 1 a 30 caracteres, sin espacios al inicio ni al final',
        coalesce((select def from restricciones where conname = 'backlog_tags_name_check'), '(no existe)'),
        'CHECK ((((char_length(name) >= 1) AND (char_length(name) <= 30)) AND (name = btrim(name))))'),
    (6, 'backlog_tags_name_key_check: de 1 a 60 caracteres, sin espacios al inicio ni al final',
        coalesce((select def from restricciones where conname = 'backlog_tags_name_key_check'), '(no existe)'),
        'CHECK ((((char_length(name_key) >= 1) AND (char_length(name_key) <= 60)) AND (name_key = btrim(name_key))))'),
    (7, 'backlog_tags_user_section_key_key: UNIQUE (user_id, section, name_key)',
        coalesce((select contype::text || ' ' || tabla || '(' || cols || ')' from restricciones where conname = 'backlog_tags_user_section_key_key'), '(no existe)'),
        'u backlog_tags(user_id,section,name_key)'),
    (8, 'FK user_id → auth.users(id) ON DELETE CASCADE (y ninguna otra FK)',
        coalesce((select string_agg(tabla || '(' || cols || ') → ' || esquema_ref || '.' || referida || '(' || refcols || ') / ' || confdeltype::text, '; ')
                    from restricciones where tabla = 'backlog_tags' and contype = 'f'), '(no existe)'),
        'backlog_tags(user_id) → auth.users(id) / c'),
    (9, 'trigger set_server_updated_at BEFORE INSERT OR UPDATE FOR EACH ROW', (select n::text from disparador), '1'),
    (10, 'índice backlog_tags_pull_idx sobre (user_id, server_updated_at, id)',
        coalesce((select case when indexdef like '%(user_id, server_updated_at, id)' then '(user_id, server_updated_at, id)' else indexdef end from indice), '(no existe)'),
        '(user_id, server_updated_at, id)'),
    (11, 'authenticated: privilegios de tabla en backlog_tags',
        coalesce((select p from priv_auth where table_name = 'backlog_tags'), '(ninguno)'), 'INSERT,SELECT,UPDATE'),
    (12, 'anon y PUBLIC: privilegios de tabla en backlog_tags',
        coalesce((select n::text from priv_otros where table_name = 'backlog_tags'), '0'), '0'),
    (13, 'anon y PUBLIC: privilegios de columna en backlog_tags', (select n_tags::text from priv_col_otros), '0'),
    (14, 'políticas de backlog_tags (comandos)',
        coalesce((select string_agg(cmd, ',' order by cmd) from politicas), '(ninguna)'), 'INSERT,SELECT,UPDATE'),
    (15, 'políticas de backlog_tags: DELETE o ALL', (select count(*)::text from politicas where cmd in ('DELETE', 'ALL')), '0'),
    (16, 'políticas de backlog_tags que no son "to authenticated" o sin auth.uid() = user_id',
        (select count(*)::text from politicas
          where roles <> '{authenticated}'
             or (cmd in ('SELECT', 'UPDATE') and coalesce(qual, '') not like '%auth.uid()%user_id%')
             or (cmd in ('INSERT', 'UPDATE') and coalesce(with_check, '') not like '%auth.uid()%user_id%')), '0'),
    (17, 'backlog.tags: tipo / admite NULL / default',
        coalesce((select data_type || ' / ' || is_nullable || ' / ' || coalesce(column_default, '(sin default)') from col_tags), '(no existe)'),
        'jsonb / YES / (sin default)'),
    (18, 'backlog_tags_array_check: NULL o array de strings',
        coalesce((select def from restricciones where conname = 'backlog_tags_array_check' and tabla = 'backlog'), '(no existe)'),
        'CHECK (((tags IS NULL) OR ((jsonb_typeof(tags) = ''array''::text) AND (NOT jsonb_path_exists(tags, ''$[*]?(@.type() != "string")''::jsonpath)))))'),
    (19, 'anon y PUBLIC: privilegios sobre backlog.tags', (select n_col::text from priv_col_otros), '0'),
    (20, 'backlog: authenticated / anon y PUBLIC (privilegios de tabla, sin cambios)',
        coalesce((select p from priv_auth where table_name = 'backlog'), '(ninguno)') || ' / '
            || coalesce((select n::text from priv_otros where table_name = 'backlog'), '0'),
        'INSERT,SELECT,UPDATE / 0')
)
select orden, chequeo, valor, esperado, valor = esperado as ok
from filas
order by orden;
