-- Auditoría de la Fase 6.1 (SOLO LECTURA). Correr en el SQL Editor de Supabase (Poguis y
-- Registro Dev). No modifica nada y no es una migración (va junto a verificar-fase2.sql y
-- verificar-fase5.sql). Una sola sentencia; solo metadatos del catálogo y conteos: nunca filas
-- de dominio, emails, uid, tokens ni claves.
--
-- Devuelve: orden | chequeo | valor | esperado | ok (mismo formato que verificar-fase2.sql).
--   Estricto: esperado y ok true/false. Informativo: esperado y ok NULL.
--   No repite los 22 chequeos de verificar-fase2.sql; los temas que se solapan (RLS, políticas
--   para otros roles, DELETE para authenticated, security definer, FK con cascade) van aquí por
--   tabla y sobre todo el esquema public, listando la tabla culpable.
--
-- "Solo Supabase" (pueden dar false en PGlite, scripts/probar-fase6.mjs): #2 y #19.
-- Dependen de la plataforma: #2 (versión de Postgres), #6 (extensiones que instale Supabase) y
-- #19 (statement_timeout de sus roles). Si en Supabase dan false no es un fallo de la ETAPA A
-- de la 6.1: se clasifican en la ETAPA B (docs/FASE6-AUDITORIA-SERVIDOR.md).
--
-- Fuentes de los valores esperados: supabase/migrations/ (1/4 función, 2/4 tablas y FK,
-- 3/4 triggers, 4/4 RLS y grants), DECISIONES.md (Seguridad, Sincronización) y docs/MAPEO-SYNC.md.

with
tablas(t) as (
    values ('finance_contacts'), ('finance_transactions'), ('balance_history'), ('finance_categories'),
           ('services'), ('entertainment_categories'), ('entertainment_pauses'),
           ('entertainment_quotas_history'), ('series'), ('seasons'), ('watch_history'),
           ('reading_history'), ('backlog'), ('work_people'), ('cards')
),
pub as (
    select oid from pg_namespace where nspname = 'public'
),
roles as (
    select (select oid from pg_roles where rolname = 'anon') as anon,
           (select oid from pg_roles where rolname = 'authenticated') as authenticated,
           (select oid from pg_roles where rolname = 'service_role') as service_role
),
rels as (
    select c.oid, c.relname, c.relkind, c.relowner, c.relacl, c.relrowsecurity, c.relforcerowsecurity
    from pg_class c
    where c.relnamespace = (select oid from pub) and c.relkind in ('r', 'p', 'v', 'm', 'S', 'f')
),
-- ACL efectivo (con el valor por defecto cuando relacl es NULL) de cada relación de public.
rel_acl as (
    select r.relname, a.grantee, a.privilege_type
    from rels r,
         lateral aclexplode(coalesce(r.relacl, acldefault((case when r.relkind = 'S' then 's' else 'r' end)::"char", r.relowner))) a
),
fns as (
    select p.oid, p.proname, p.prosecdef, p.proowner, p.proacl
    from pg_proc p
    where p.pronamespace = (select oid from pub)
),
fn_acl as (
    select f.proname, a.grantee, a.privilege_type
    from fns f, lateral aclexplode(coalesce(f.proacl, acldefault('f'::"char", f.proowner))) a
),
pol as (
    select tablename, policyname, cmd, roles from pg_policies where schemaname = 'public'
),
auth_users as (
    select c.oid from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'auth' and c.relname = 'users'
),
duenos(user_id) as (
              select user_id from public.finance_contacts
    union all select user_id from public.finance_transactions
    union all select user_id from public.balance_history
    union all select user_id from public.finance_categories
    union all select user_id from public.services
    union all select user_id from public.entertainment_categories
    union all select user_id from public.entertainment_pauses
    union all select user_id from public.entertainment_quotas_history
    union all select user_id from public.series
    union all select user_id from public.seasons
    union all select user_id from public.watch_history
    union all select user_id from public.reading_history
    union all select user_id from public.backlog
    union all select user_id from public.work_people
    union all select user_id from public.cards
),
rolcfg as (
    select rolname, coalesce(array_to_string(rolconfig, ', '), '') as cfg,
           (select substring(x from '^statement_timeout=(.*)$') from unnest(rolconfig) x where x like 'statement_timeout=%') as stmt_timeout
    from pg_roles where rolname in ('anon', 'authenticated')
),
chequeos(orden, chequeo, valor, esperado) as (
    -- A. Versión y rol (ítem 5 de la lista de la Fase 2)
    select 1, 'versión (version())', version(), null::text
    union all select 2, '(solo Supabase) server_version_num entre 150000 y 179999 (Supabase 15–17)',
        (current_setting('server_version_num')::int between 150000 and 179999)::text || ' (' || current_setting('server_version_num') || ')',
        'true (' || current_setting('server_version_num') || ')'
    union all select 3, 'rol actual · superusuario',
        current_user || ' · rolsuper=' || (select rolsuper::text from pg_roles where rolname = current_user), null

    -- B. Esquema public (migraciones 1/4–3/4)
    union all select 4, 'public: vistas / vistas materializadas / secuencias / tablas foráneas',
        (select count(*) filter (where relkind = 'v') || ' / ' || count(*) filter (where relkind = 'm')
                || ' / ' || count(*) filter (where relkind = 'S') || ' / ' || count(*) filter (where relkind = 'f') from rels),
        '0 / 0 / 0 / 0'
    union all select 5, 'public: funciones o procedimientos que no son set_server_updated_at (lista)',
        coalesce((select string_agg(proname, ', ' order by proname) from fns where proname <> 'set_server_updated_at'), ''), ''
    union all select 6, 'extensiones instaladas en el esquema public (depende de la plataforma)',
        (select count(*) from pg_extension where extnamespace = (select oid from pub))::text, '0'
    union all select 7, 'public: tipos propios (enum, dominio, rango, compuesto suelto)',
        (select count(*) from pg_type ty left join pg_class tc on tc.oid = ty.typrelid
          where ty.typnamespace = (select oid from pub)
            and (ty.typtype in ('e', 'd', 'r', 'm') or (ty.typtype = 'c' and tc.relkind = 'c')))::text, null

    -- C. Políticas (migración 4/4; DECISIONES Seguridad)
    union all select 8, 'tablas de public cuyas políticas no son exactamente 1 SELECT + 1 INSERT + 1 UPDATE (lista)',
        coalesce((select string_agg(r.relname, ', ' order by r.relname) from rels r
          where r.relkind in ('r', 'p')
            and not coalesce((select count(*) = 3
                                     and count(*) filter (where p.cmd = 'SELECT') = 1
                                     and count(*) filter (where p.cmd = 'INSERT') = 1
                                     and count(*) filter (where p.cmd = 'UPDATE') = 1
                              from pol p where p.tablename = r.relname), false)), ''), ''
    union all select 9, 'políticas cuyo rol no es exactamente {authenticated} (lista tabla.política)',
        coalesce((select string_agg(tablename || '.' || policyname, ', ' order by tablename, policyname) from pol
          where roles <> array['authenticated']::name[]), ''), ''
    union all select 10, 'tablas de public sin RLS (lista)',
        coalesce((select string_agg(relname, ', ' order by relname) from rels where relkind in ('r', 'p') and not relrowsecurity), ''), ''
    union all select 11, 'tablas de public con RLS forzada (relforcerowsecurity)',
        (select count(*) from rels where relkind in ('r', 'p') and relforcerowsecurity)::text, null

    -- D. Privilegios (migración 4/4; DECISIONES grants)
    union all select 12, 'anon: privilegios en relaciones de public (tablas, vistas, secuencias)',
        (select count(*) from rel_acl, roles where grantee = roles.anon)::text, '0'
    union all select 13, 'PUBLIC: privilegios en relaciones de public',
        (select count(*) from rel_acl where grantee = 0)::text, '0'
    union all select 14, 'anon o PUBLIC: EXECUTE en funciones de public',
        (select count(*) from fn_acl, roles where privilege_type = 'EXECUTE' and (grantee = 0 or grantee = roles.anon))::text, '0'
    union all select 15, 'authenticated: DELETE / TRUNCATE / REFERENCES / TRIGGER en relaciones de public (lista)',
        coalesce((select string_agg(relname || ':' || privilege_type, ', ' order by relname, privilege_type) from rel_acl, roles
          where grantee = roles.authenticated and privilege_type in ('DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER')), ''), ''
    union all select 16, 'anon / PUBLIC: CREATE en el esquema public',
        has_schema_privilege('anon', 'public', 'CREATE')::text || ' / '
            || coalesce((select bool_or(a.grantee = 0 and a.privilege_type = 'CREATE')
                         from pg_namespace n, lateral aclexplode(coalesce(n.nspacl, acldefault('n'::"char", n.nspowner))) a
                         where n.nspname = 'public'), false)::text, null

    -- E. Funciones (DECISIONES Seguridad: ninguna security definer)
    union all select 17, 'funciones security definer en public (lista)',
        coalesce((select string_agg(proname, ', ' order by proname) from fns where prosecdef), ''), ''

    -- F. Privilegios por defecto (DECISIONES: las migraciones no usan alter default privileges)
    union all select 18, 'pg_default_acl en public: rol creador / tipo → roles que recibirían privilegios',
        coalesce((select string_agg(x, '; ' order by x) from (
            select pg_get_userbyid(d.defaclrole) || '/' || d.defaclobjtype::text || ' → '
                   || (select string_agg(distinct case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end, ',')
                       from aclexplode(d.defaclacl) a) as x
            from pg_default_acl d where d.defaclnamespace = (select oid from pub)) s), ''), null

    -- G. Configuración de roles (MAPEO-SYNC: la ventana de 60 s depende de statement_timeout 8s)
    union all select 19, '(solo Supabase) statement_timeout de authenticated (depende de la plataforma)',
        coalesce((select stmt_timeout from rolcfg where rolname = 'authenticated'), '(sin valor)'), '8s'
    union all select 20, 'rolconfig de anon',
        coalesce((select cfg from rolcfg where rolname = 'anon'), '(sin rol)'), null
    union all select 21, 'service_role: existe · rolbypassrls · rolcanlogin (ítem 6 de la Fase 2)',
        coalesce((select 'sí · ' || rolbypassrls::text || ' · ' || rolcanlogin::text from pg_roles where rolname = 'service_role'), 'no'), null
    union all select 22, 'service_role: privilegios en las 15 tablas (tablas con alguno · tipos)',
        (select count(distinct relname) || ' · ' || coalesce(string_agg(distinct privilege_type, ',' order by privilege_type), '')
           from rel_acl, roles where grantee = roles.service_role and relname in (select t from tablas)), null

    -- H. FK y triggers (migraciones 2/4 y 3/4)
    union all select 23, 'tablas de las 15 sin FK user_id → auth.users(id) ON DELETE CASCADE (lista)',
        coalesce((select string_agg(t, ', ' order by t) from tablas
          where not exists (
            select 1 from pg_constraint con
            join pg_class c on c.oid = con.conrelid and c.relnamespace = (select oid from pub) and c.relname = tablas.t
            join pg_attribute att on att.attrelid = c.oid and att.attname = 'user_id'
            where con.contype = 'f' and con.confrelid = (select oid from auth_users)
              and con.conkey = array[att.attnum] and con.confdeltype = 'c')), ''), ''
    union all select 24, 'triggers de usuario en public que no son set_server_updated_at',
        (select count(*) from pg_trigger tg join rels r on r.oid = tg.tgrelid
          where not tg.tgisinternal and tg.tgname <> 'set_server_updated_at')::text, '0'

    -- I. Realtime (fuera de alcance)
    union all select 25, 'tablas de public en la publicación supabase_realtime',
        (select count(*) from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public')::text, '0'

    -- J. Auth (solo conteos; DECISIONES: login solo con Google)
    union all select 26, 'auth.users: total', (select count(*) from auth.users)::text, null
    union all select 27, 'auth.users: anónimos (is_anonymous)', (select count(*) from auth.users where is_anonymous)::text, '0'
    union all select 28, 'auth.identities: proveedores distintos',
        coalesce((select string_agg(distinct provider, ',' order by provider) from auth.identities), ''), 'google'
    union all select 29, 'user_id distintos con filas en public', (select count(distinct user_id) from duenos)::text, null

    -- K. Extensiones y tamaño
    union all select 30, 'extensiones instaladas (nombre@esquema)',
        coalesce((select string_agg(e.extname || '@' || n.nspname, ', ' order by e.extname)
                  from pg_extension e join pg_namespace n on n.oid = e.extnamespace), ''), null
    union all select 31, 'tamaño de la base de datos', pg_size_pretty(pg_database_size(current_database())), null
)
select orden, chequeo, valor, esperado,
       case when esperado is null then null else valor = esperado end as ok
from chequeos
order by orden;
