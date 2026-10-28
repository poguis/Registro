-- Stub mínimo de Supabase para probar supabase/migrations/ en PGlite (scripts/probar-fase2.mjs).
-- SOLO para pruebas locales: nunca va en supabase/migrations/ ni se aplica en Supabase.
--
-- Replica lo que el esquema usa de la plataforma:
--   - roles anon, authenticated y service_role (nologin);
--   - schema auth con auth.users(id) y auth.uid(), que lee el claim "sub" como Supabase
--     (request.jwt.claim.sub o request.jwt.claims ->> 'sub');
--   - usage del schema public para anon, authenticated y service_role (como en Supabase);
--   - el peor caso de privilegios por defecto: todo lo nuevo en public queda concedido a
--     anon y authenticated, para comprobar que los revoke explícitos de las migraciones bastan.

create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create schema auth;
grant usage on schema auth to anon, authenticated, service_role;

create table auth.users (
    id uuid primary key,
    created_at timestamptz not null default now()
);

create function auth.uid() returns uuid
language sql stable
as $$
    select coalesce(
        nullif(current_setting('request.jwt.claim.sub', true), ''),
        (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    )::uuid
$$;
grant execute on function auth.uid() to anon, authenticated, service_role;

grant usage on schema public to anon, authenticated, service_role;

alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
