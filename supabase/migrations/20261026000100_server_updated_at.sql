-- Fase 2 · 1/4 — Función del trigger de server_updated_at.
--
-- server_updated_at es el cursor del pull (Fase 4). Lo asigna SIEMPRE el servidor,
-- ignorando lo que mande el cliente:
--   - INSERT: clock_timestamp() (hora real del momento en que se escribe la fila;
--     now() devolvería la hora de inicio de la transacción, y el desfase frente al
--     commit sería mayor).
--   - UPDATE: greatest(clock_timestamp(), old.server_updated_at), para que sea no
--     decreciente en la misma fila aunque el reloj del servidor retroceda.
-- El riesgo de commits fuera de orden frente al cursor está en docs/MAPEO-SYNC.md.
--
-- security invoker (nunca security definer) y search_path vacío.

begin;

create function public.set_server_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
    if tg_op = 'UPDATE' then
        new.server_updated_at := greatest(clock_timestamp(), old.server_updated_at);
    else
        new.server_updated_at := clock_timestamp();
    end if;
    return new;
end;
$$;

comment on function public.set_server_updated_at() is
    'Trigger BEFORE INSERT OR UPDATE: asigna server_updated_at con la hora del servidor (cursor del pull).';

revoke all on function public.set_server_updated_at() from public, anon, authenticated;

commit;
