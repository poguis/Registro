-- Fase 7.4b — frecuencia de lectura en el historial de ritmo.
--
-- Solo aditiva: una columna nueva en public.entertainment_quotas_history, sin tocar datos ni las
-- migraciones aplicadas. No crea objetos nuevos.
--
-- frequency (integer, NULL):
--   lectura: la frecuencia del período (n > 0: n tomos por día; n < 0: 1 tomo cada |n| días);
--   video: siempre NULL;
--   NULL en un período de lectura de antes de la 7.4b = la frecuencia de la categoría.
-- Sin CHECK, igual que entertainment_categories.frequency.
--
-- Privilegios (regla de la Fase 6.1): la columna hereda los grants de la tabla, que son por tabla
-- (migración 4/4), no por columna. Aun así se reafirman igual que en 4/4 (idempotente: el
-- resultado es el mismo que antes; scripts/probar-fase7-4b.mjs lo compara en PGlite).
-- RLS y políticas: sin cambios.

begin;

alter table public.entertainment_quotas_history add column frequency integer;

comment on column public.entertainment_quotas_history.frequency is
    'Lectura: frecuencia del período (n > 0: n por día; n < 0: 1 cada |n| días). Video: NULL. NULL en lectura = la de la categoría (períodos anteriores a la Fase 7.4b).';

revoke all on table public.entertainment_quotas_history from anon, authenticated, public;
grant select, insert, update on table public.entertainment_quotas_history to authenticated;

commit;
