# Fase 6.2 — Pruebas de servidor (solo Registro Dev)

Cierra los dos ítems abiertos de la lista de la Fase 2:
- **4:** la cascada `ON DELETE CASCADE` al borrar un usuario de `auth.users` desde el dashboard;
- **7:** la concurrencia y el rendimiento de la RLS con muchas filas.

Además revalúa el aviso "Unindexed foreign keys" sobre `seasons_series_fkey` (6.1, hallazgo 2).

Todo se ejecuta **solo en Registro Dev**, con un usuario de prueba creado para esto. Nada se ejecuta en Poguis, y no se toca la app, el esquema, las migraciones ni los datos reales.

Archivos:
- `supabase/pruebas-fase6-2/` (01–04 y README; no son migraciones);
- `scripts/probar-fase6-2.mjs` (ensayo en PGlite).

## 1. Alcance y reglas
- **ETAPA A** (Claude Code): genera los archivos y los ensaya en PGlite con las migraciones reales y el stub de auth. No se ejecuta nada remoto.
- **ETAPA B** (usuario): crea el usuario de prueba, ejecuta 01–03 en el SQL Editor de Registro Dev siguiendo el README, borra el usuario desde el dashboard y entrega los resultados.
- Cada SQL lleva el encabezado "SOLO Registro Dev. Nunca ejecutar en Poguis." y guardas que abortan sin escribir.
- 01 no tiene DELETE, UPDATE, DROP, TRUNCATE ni ALTER. 02 y 03 son de solo lectura. 04 (Plan B) es la única excepción a "sin DELETE" y solo se usa si falla el borrado desde el dashboard.

## 2. Volumen y justificación
A escala 1 se siembran unas 122.000 filas para el usuario de prueba. Las dos tablas que más crecen con el uso real son:
- `watch_history`: 1 fila por episodio visto, varias al día con cuotas diarias. Es la tabla con más filas en Poguis.
- `balance_history`: 1 fila por movimiento de dinero, más los "Ajuste".

Cada una lleva 50.000 filas, que equivalen a más de 10 años de uso intenso. El resto va en proporción:

| Tabla | Filas |
|---|---|
| `reading_history` | 10.000 |
| `finance_transactions` | 5.000 |
| `seasons` | 2.000 (4 por serie) |
| `backlog` | 2.000 |
| `series` | 500 |
| `entertainment_pauses` | 100 |
| `entertainment_quotas_history` | 100 |
| `finance_contacts` | 50 |
| `services` | 30 |
| `finance_categories` | 20 |
| `work_people` | 20 |
| `entertainment_categories` | 10 |
| `cards` | 10 |

Alrededor del 5 % de cada tabla son tombstones. Total exacto: 119.840 filas. Tamaño medido en PGlite: **28,6 MB** en las 15 tablas con sus índices. El límite es 100 MB (plan Free: 500 MB). En PGlite, el 01 tarda 4,4–5,0 s; escala recomendada para Supabase: 1 (criterio en el README).

## 3. Guardas y centinela sintético
**01 (siembra)**, una sola sentencia `DO`, atómica. Aborta sin escribir si:
1. el uid no existe en `auth.users`;
2. el uid ya tiene filas en alguna de las 15 tablas;
3. hay menos de 2 usuarios en `auth.users`.

En Poguis fallarían la 1 (el uid de prueba no existe) y la 3 (hay un solo usuario).

**Marca sintética doble:**
- prefijo `[F6.2]` en todo texto obligatorio;
- `created_at` = `updated_at` = `2000-06-02T00:00:00Z` en todas las filas. Es un centinela imposible en datos de la app, que escribe `nowIso()` desde 2026.

**04 (Plan B)**, una sola sentencia `DO`. Aborta sin borrar si:
- **(a)** el uid no existe;
- **(b)** hay menos de 2 usuarios;
- **(c)** alguna fila del uid no es demostrablemente sintética:
  - en las tablas con texto: prefijo y centinela;
  - en `entertainment_pauses` y `entertainment_quotas_history`: centinela y una `entertainment_categories` padre sintética;
  - en `seasons`, `watch_history` y `reading_history`: centinela y una `series` padre sintética.

Borra de hijos a padres y no toca `auth.users`.

## 4. Método del 02 (rendimiento del pull con RLS)
- **La consulta:** la del transporte de la app (`src/sync/supabaseTransport.ts:34–47`):
  - primera página sin filtro;
  - siguientes con `(server_updated_at > ts or (server_updated_at = ts and id > id))`;
  - `order by server_updated_at, id limit 500`.

  No filtra por `user_id`: lo pone la RLS (`(select auth.uid()) = user_id`).
- **Paso 1:** un SELECT de solo lectura calcula los cursores reales y genera 9 bloques: `watch_history`, `balance_history` y `backlog` × primera / intermedia (fila N/2) / última (fila N−499).
- **Paso 2:** cada bloque, ejecutado con el rol del editor en `postgres`, hace:
  ```sql
  select set_config('request.jwt.claims', …, true);
  set local role authenticated;
  explain (analyze, buffers) <consulta>;
  ```
  Las sentencias de un envío corren en una transacción implícita, así que el rol y los claims no persisten (comprobado en PGlite: rol, claims, catálogo y conteos idénticos antes y después).
- **Validez:** el plan debe mostrar el `InitPlan` de `auth.uid()` y `user_id = (InitPlan …)`.

## 5. Concurrencia (ítem 7): commits fuera de orden frente al cursor
**El riesgo** (`docs/MAPEO-SYNC.md`, "Riesgo del cursor"): una fila escrita a la hora T y confirmada en T + d puede quedar por detrás de un cursor que ya avanzó con otra transacción confirmada antes. El pull la recupera solo si d es menor que la ventana de solapamiento.

**1. Cómo se asigna `server_updated_at`:**
- Lo pone el trigger BEFORE ROW `set_server_updated_at`, con `clock_timestamp()` en INSERT y `greatest(clock_timestamp(), old.server_updated_at)` en UPDATE (`supabase/migrations/20261026000100_server_updated_at.sql:5–9` y `:22–27`).
- Es la hora de escritura de cada fila, no `now()` (inicio de la transacción). Así, el hueco d es solo el tiempo entre la escritura de la fila y el COMMIT.

**2. Cuántas sentencias escribe cada transacción de la app:**
- El push envía cada lote, de hasta 100 filas (`src/sync/config.ts:21`), como **una** petición `upsert` (`src/sync/engine.ts:168`, `supabaseTransport.ts:28`, `onConflict: 'id'`).
- PostgREST la convierte en una única sentencia `INSERT … ON CONFLICT (id) DO UPDATE`, dentro de la transacción que abre por petición.
- La app no hace ninguna otra escritura en el servidor: el pull y `findByNaturalKey` son lecturas, y no hay funciones expuestas (6.1 #5 y #14).

**3. Por qué ninguna transacción de escritura de `authenticated` dura más de 8 s:**
- PostgREST ejecuta cada petición dentro de una transacción (`START TRANSACTION; <ajustes de la transacción>; <consulta principal>; END;`).
- Aplica los ajustes del rol suplantado (`ALTER ROLE … SET statement_timeout`) como ajustes de ámbito de transacción.
  - Fuente: [PostgREST, Transactions](https://docs.postgrest.org/en/stable/references/transactions.html), secciones de transacción por petición y "Impersonated Role Settings" (igual en la versión 12).
  - Supabase lo documenta para sus roles `anon`, `authenticated` y `service_role` en [PostgREST 11.1](https://supabase.com/blog/postgrest-11-1-release).
- Valor por defecto en Supabase: `authenticated: 8s` ([Supabase, Timeouts](https://supabase.com/docs/guides/database/postgres/timeouts)). La 6.1 confirmó `statement_timeout=8s` en los dos proyectos (`auditar-fase6` #19).
- Las esperas de bloqueo ocurren dentro de la sentencia principal, así que cuentan para su `statement_timeout`. Las demás sentencias de la transacción (los `set_config` de los claims) son instantáneas.
- **Cota:** d ≤ duración de la sentencia principal (≤ 8 s) + COMMIT (ms).

**4. Por qué cabe en la ventana:**
- El pull pide `server_updated_at >= cursor − 60 s` en la primera página de cada ciclo (`src/sync/engine.ts:292`, `src/sync/config.ts:22`).
- 60 s ≥ 8 s + ε, con un margen de ~7×.
- Las filas repetidas por la ventana se aplican de forma idempotente (`docs/MAPEO-SYNC.md`, punto 2 del riesgo).

**Grado de verificación:** **verificado por documentación** (las URLs de arriba, leídas el 2026-11-07) y por el catálogo (#19). No se mide empíricamente, porque haría falta una petición de la Data API de más de 8 s y la app no tiene ninguna función expuesta para provocarla.

**Escrituras fuera de la app** (no pasan por ese límite):
- SQL Editor como `postgres`: tope de 2 min por la configuración global, o 60 s del editor.
- La siembra 01.
- La cascada de Auth.

La cascada solo borra, y el pull no ve filas borradas físicamente. La siembra solo afecta al usuario de prueba, que no tiene dispositivos.

**Regla:** toda escritura manual sobre filas de un usuario real (por ejemplo, la limpieza de tombstones de la 6.8) debe ser una sola sentencia corta (menos de 60 s) o hacerse con los dispositivos sin red.

**Riesgo residual:** un salto atrás del reloj del servidor.
- `greatest(…)` mantiene cada fila no decreciente.
- Entre filas distintas, el desfase queda dentro de la ventana si el salto es menor de ~50 s (60 s − 8 s − ε). NTP corrige el reloj de forma gradual.
- La alternativa estricta, con `pg_current_xact_id()` y `pg_snapshot_xmin`, está descrita en `docs/MAPEO-SYNC.md` y no se adopta.

**Empates de `server_updated_at`:** solo ocurren si el reloj tiene poca resolución (en PGlite sí: 56 grupos en una siembra pequeña; en Supabase se espera ~0, y 03 lo informa). El desempate por `id` se probó en PGlite con bloques de 700 empates que cruzan las páginas de 500: 0 duplicadas y 0 perdidas.

**Conclusión del análisis:** no hay ningún camino de la app que rompa la ventana de 60 s.

## 6. `seasons_series_fkey` (aviso de la 6.1)
- **La FK:** `seasons (series_id, user_id) → series (id, user_id)`, `NO ACTION` y `deferrable initially deferred` (`supabase/migrations/20261026000200_tablas.sql:196–197`).
- **El índice que la cubre:** la búsqueda inversa (hijos de una serie) usa el índice único `seasons_series_season_key (series_id, season_number)`, cuya primera columna es `series_id`. El Advisor solo reconoce índices cuyo prefijo son todas las columnas de la FK.
- **¿Cuándo se comprueba?** Al borrar o cambiar la clave referenciada `series (id, user_id)`:
  - **La app nunca la cambia:**
    - `authenticated` no tiene DELETE (6.1 #15);
    - el upsert es `ON CONFLICT (id) … SET id = excluded.id`, el mismo valor;
    - `user_id` no puede cambiar por el `WITH CHECK` de la política de update (`20261026000400_rls_grants.sql:35–36`);
    - Postgres omite la comprobación RI cuando la clave no cambia.
  - **Sí ocurre** en el borrado de la cuenta: la cascada desde `auth.users` borra físicamente las series, y la FK de `seasons` busca hijos de cada serie. En PGlite aparece como "seasons_series_fkey (series)" con una llamada por serie, resuelta con el índice anterior.
- **Clasificación: (a) confirmado.** La cascada de Registro Dev terminó sin error con 500 series y 2000 temporadas (sección 7), y en PGlite `seasons_series_fkey` tardó 0,01–0,08 s en 500 llamadas usando el índice anterior. No hace falta el índice `(series_id, user_id)` ni una migración.

## 7. Cascada (ítem 4): resultados
**Referencia de PGlite** (ETAPA A, escala 1, `set constraints all immediate` para que las FK diferidas entren en el EXPLAIN):
- borrado completo en **0,2 s**;
- las 15 FK `user_id → auth.users` en cascada, 1 llamada cada una;
- FK compuestas `NO ACTION`: 500 llamadas de `seasons_series_fkey`, `watch_history_series_fkey` y `reading_history_series_fkey`; 50 de `finance_transactions_contact_fkey`; 10 de cada FK hacia `entertainment_categories`;
- `seasons_series_fkey` tardó 0,01–0,08 s en 500 llamadas (dos ejecuciones);
- después: 0 filas del usuario de prueba en las 15 tablas, el uid ya no está en `auth.users` y el usuario "real" queda idéntico (conteos y hash).

**Registro Dev (2026-11-07).** Los resultados están en `.local-data/fase6-2/`, fuera del repo.
- **Usuario de prueba:** se creó en Authentication → Users → Add user → Create new user, con un email `@example.com` y Auto Confirm, **con el proveedor Email deshabilitado**. Ver el hallazgo H2 de la sección 9.
- **Línea base:** no se ejecutó el "03 antes". En su lugar se usan `verificar-fase5` de Registro Dev de la 6.1 y las columnas `otros_*` del 03 tras la siembra; coinciden tabla por tabla:

  | Tabla | total / vivos / borrados / usuarios |
  |---|---|
  | `balance_history` | 7 / 7 / 0 / 1 |
  | `finance_categories` | 6 / 6 / 0 / 1 |
  | `backlog` | 7 / 4 / 3 / 1 |
  | `work_people` | 1 / 1 / 0 / 1 |
  | las otras 11 | 0 |
  | **TODAS** | **21 / 18 / 3 / 1** |

- **01 a escala 1:** terminó sin error.
- **03 tras la siembra:**
  - `prueba_filas` = la tabla de volumen de la sección 2 en las 15 tablas, con `TODAS` = **119.840**;
  - `otros_*` = la línea base;
  - uid en `auth.users` = sí, con 2 usuarios en total;
  - 0 grupos de `server_updated_at` repetidos en las 3 tablas: en Supabase el reloj tiene resolución de µs, como se esperaba;
  - la BD pasó de 12 MB (6.1 #31) a 40 MB, de los que 23 MB son `watch_history` + `balance_history` con sus índices;
  - filas modificadas desde el último ANALYZE: 50.000 / 50.007.
- **03 tras el autoanalyze:** lo mismo, con las filas modificadas desde el último ANALYZE en 0 / 0.
- **Borrado del usuario de prueba desde el dashboard:** terminó sin error. **No hizo falta el 04** (Plan B), y el tiempo no se anotó.
- **03 tras el borrado:**
  - `prueba_filas` = **0 en las 15 tablas**;
  - uid en `auth.users` = **no**, con **1** usuario en total;
  - `otros_*` = la línea base (21 / 18 / 3 / 1);
  - la BD queda en 25 MB.
- **Auditoría 6.1 repetida al final** (`auditar-fase6.sql`):
  - **18/18 estrictos**;
  - #26 `auth.users` = **1**;
  - #28 proveedores = **google**: la identidad de email se fue con el usuario;
  - #29 = 1 `user_id`;
  - el único cambio frente a la 6.1 es #31, el tamaño (12 → 25 MB): es espacio que Postgres retiene tras el borrado y que el autovacuum reutiliza. Informativo; el límite del plan Free es 500 MB.

**Conclusión:** `ON DELETE CASCADE` desde la tabla real `auth.users` borra las filas del usuario en las 15 tablas, incluidas las FK compuestas diferidas, en una operación del dashboard, y no toca a los demás usuarios. **El ítem 4 queda CERRADO.**

## 8. Rendimiento de la RLS (ítem 7): resultados
**Referencia de PGlite** (ETAPA A, escala 1). La RLS se aplicó en los 18 planes: `InitPlan` de `auth.uid()` y `user_id = (InitPlan …)`.

| Página (watch_history, N = 50.000) | Sin estadísticas | Con ANALYZE (como tras el autoanalyze) |
|---|---|---|
| primera | Bitmap Heap Scan de las 50.000 filas + top-N sort; 1130 buffers; 44,5 ms | Index Scan de `watch_history_pull_idx`; 500 filas; 125 buffers; 0,6 ms |
| intermedia (fila 25.000) | Bitmap Heap Scan (BitmapOr) de las 25.000 restantes + top-N sort; 570 buffers; 17,2 ms | Index Scan con `Filter` del `OR`: **25.000 filas descartadas**; 7193 buffers; 11,8 ms |
| última | Bitmap Heap Scan de 499 filas; 19 buffers; 1,0 ms | Bitmap Heap Scan de 499 filas; 19 buffers; 0,9 ms |

`balance_history` se comporta igual: intermedia con ANALYZE, 25.000 descartadas y 8567 buffers. `backlog` (N = 2000) tarda ≤ 2,5 ms en todas.

**Registro Dev (2026-11-07):** los 9 planes, tras el autoanalyze, con el rol `authenticated` y los claims del usuario de prueba.
- **La RLS se aplicó en los 9:** todos tienen `InitPlan 1`, y la condición `user_id = (InitPlan 1).col1` aparece como `Index Cond` (primera e intermedia) o en el `Recheck Cond` del BitmapOr (última).
- **Todos los buffers son `shared hit`:** no hubo lecturas de disco, así que el tiempo es de CPU.

| Tabla (N filas del usuario) | Página | Nodo | Filas descartadas por el `Filter` | Buffers | Tiempo |
|---|---|---|---|---|---|
| `watch_history` (50.000) | primera | Index Scan `watch_history_pull_idx` | 0 | 14 | 18,3 ms |
| | intermedia (fila 25.000) | Index Scan + `Filter` del `OR` | **25.000** | 578 | **459,3 ms** |
| | última (quedan 499) | Bitmap Heap Scan (BitmapOr, rango) + Sort | 0 | 25 | 7,1 ms |
| `balance_history` (50.000) | primera | Index Scan `balance_history_pull_idx` | 0 | 15 | 7,6 ms |
| | intermedia | Index Scan + `Filter` del `OR` | **25.000** | 625 | **245,4 ms** |
| | última | Bitmap Heap Scan (BitmapOr) + Sort | 0 | 26 | 11,2 ms |
| `backlog` (2000) | primera | Index Scan `backlog_pull_idx` | 0 | 16 | 17,0 ms |
| | intermedia (fila 1000) | Index Scan + `Filter` del `OR` | 1000 | 42 | 25,4 ms |
| | última | Bitmap Heap Scan (BitmapOr) + Sort | 0 | 24 | 7,4 ms |

**Lectura de los planes:** la hipótesis se confirma en Supabase.
- Con el `OR` sin rango, la condición de índice es solo `user_id`. El recorrido empieza en la primera fila del usuario y descarta como `Filter` todas las anteriores al cursor.
- La última página es barata porque el planificador estima pocas filas y separa el `OR` en dos rangos (BitmapOr). Con muchas filas restantes prefiere el Index Scan ordenado y paga el `Filter`.
- El costo por fila descartada en Supabase es de unos **18,4 µs** en `watch_history` (459,3 ms / 25.000) y **9,8 µs** en `balance_history`. Es unas 20–40 veces más que en PGlite (≈ 0,5 µs), por el CPU compartido del plan Free. Para extrapolar se toma el valor mayor, el conservador.

**Extrapolación de una primera sincronización completa** (dispositivo nuevo, 50.000 filas por tabla, 100 páginas de 500):
- **Filas descartadas:** la página k (k = 0…99) descarta 500·k filas, así que en total son 500 · (0 + 1 + … + 99) = **2.475.000 por tabla**. Es una cota superior: las últimas páginas pasan al BitmapOr.
- **Tiempo de servidor:**
  - con el `OR` actual: ≈ 2.475.000 × 18,4 µs ≈ **45 s** en `watch_history` y ≈ 24 s en `balance_history`, es decir, **≈ 70 s** para las dos;
  - con un recorrido por rango: 100 páginas × ~10–20 ms ≈ **1–2 s por tabla**.
- **Página más cara:** la penúltima, que descarta 49.500 filas: ≈ 0,9 s.
- **No es un fallo:** el ciclo tiene un watchdog de 2 min, y unos 70 s de servidor más la red y la aplicación local podrían superarlo con 100.000 filas. Aun así el cursor se guarda por página, en la misma transacción que la aplica (`engine.ts:304–315`), y el siguiente ciclo continúa donde quedó; además arranca con `gte(since)`, que sí es un rango.

**Volumen a partir del cual una página alcanzaría el `statement_timeout` de 8 s**, con 18,4 µs por fila:
- **Una página descarta P filas:** P = 8 s / 18,4 µs ≈ **435.000 filas**.
- **Página intermedia** (cursor en N/2): **N ≈ 870.000 filas por tabla** (≈ 1,6 M con el costo de `balance_history`).
- **Peor página de una sincronización completa** (la penúltima, que descarta ≈ N): **N ≈ 435.000 filas por tabla**.
- **Margen:** 50.000 filas ya equivalen a más de 10 años de uso intenso (sección 2), y hoy Poguis tiene ~30 filas. Hay **≥ 8,7×** frente al peor caso.

**Conclusión:** el rendimiento de la RLS queda **aprobado con margen**. Las páginas típicas (incrementales o primeras) cuestan 7–18 ms, y la peor página a 50.000 filas está más de 8 veces por debajo del timeout. El costo O(N²/500) de una primera sincronización es una mejora de rendimiento para la app (hallazgo H1), no un riesgo actual.

**Concurrencia:** se mantiene lo de la sección 5. Está verificada por documentación (PostgREST: una transacción por petición con el `statement_timeout` de 8 s del rol; 6.1 #19), **sin medición empírica**. La siembra confirmó además que en Supabase no hay empates de `server_updated_at`; el desempate por `id` se probó en PGlite (ETAPA A, A2).

**El ítem 7 queda CERRADO.**

## 9. Clasificación y cierre de los ítems 4 y 7
| # | Punto | Clasificación | Evidencia y acción |
|---|---|---|---|
| Ítem 4 | Cascada `user_id → auth.users on delete cascade` desde el dashboard | **CERRADO** | Sección 7: 0 filas en las 15 tablas, uid ausente, 1 usuario y los demás idénticos a la línea base; no hizo falta el 04. |
| Ítem 7 | Rendimiento de la RLS con volumen | **CERRADO** (aprobado con margen) | Sección 8: RLS en los 9 planes; páginas típicas 7–18 ms; la peor a 50.000 filas ≈ 0,9 s frente a 8 s. |
| Ítem 7 | Concurrencia (commits fuera de orden frente al cursor) | **CERRADO** (verificado por documentación) | Sección 5; sin medición empírica, como ya estaba anotado. 0 empates en Supabase. |
| 6.1 hallazgo 2 | `seasons_series_fkey` sin índice propio | **(a) confirmado** | Sección 6; la cascada terminó sin error; en PGlite tarda 0,01–0,08 s en 500 llamadas. |
| H1 | Pull: el `OR` del keyset sin rango hace que cada página recorra O(posición) filas | **(b-app)** mejora de rendimiento para la **6.5**, no urgente | Ver abajo. |
| H2 | El panel crea usuarios con email aunque el proveedor Email esté deshabilitado | **(a)** informativo | Ver abajo. |
| H3 | Tamaño de la BD de Registro Dev 12 → 25 MB tras sembrar y borrar | **(a)** informativo | Espacio que Postgres retiene y que el autovacuum reutiliza; 5 % del límite Free (500 MB). No afecta a Poguis. |

**H1 — propuesta exacta (no aplicada; no se cambió código de la app en la 6.2):**
- **Cambio:** en `src/sync/supabaseTransport.ts`, `pullPage`, rama `if (after)` (línea 40), agregar un filtro **redundante** de rango antes del `or(...)`:
  ```ts
  q = q.gte('server_updated_at', after.ts)
       .or(`server_updated_at.gt."${after.ts}",and(server_updated_at.eq."${after.ts}",id.gt.${after.id})`);
  ```
- **SQL resultante:** `server_updated_at >= X and (server_updated_at > X or (server_updated_at = X and id > Y))`. Devuelve exactamente las mismas filas, porque toda fila que cumple el `OR` cumple `>= X`, pero la condición de índice pasa a ser el rango `(user_id = auth.uid(), server_updated_at >= X)` sobre `*_pull_idx`. El `Filter` solo descarta las filas con `server_updated_at = X` e `id <= Y`, que en Supabase son prácticamente 0.
- **Comprobado en PGlite** (script de scratchpad, fuera del repo; escala 1, con ANALYZE, rol `authenticated` y RLS), página intermedia:

  | Tabla | Actual: Index Cond / descartadas / buffers / tiempo | Con el filtro: Index Cond / descartadas / buffers / tiempo | Mismas 500 filas y orden |
  |---|---|---|---|
  | `watch_history` | `user_id` / 25.000 / 6992 / 12,6 ms | `user_id` + `server_updated_at >= X` / 16 / 99 / 0,9 ms | sí |
  | `balance_history` | `user_id` / 25.000 / 8258 / 12,5 ms | `user_id` + `server_updated_at >= X` / 25 / 185 / 1,4 ms | sí |

  Las 16 y 25 filas son empates del reloj de PGlite; en Supabase no hay.
- **Impacto esperado en Supabase:** una sincronización completa de 50.000 filas pasa de O(N²/500), unos 45 s de servidor, a O(N), unos 1–2 s.
- **Por qué no es urgente:**
  - hoy hay ~30 filas reales;
  - la peor página a 50.000 filas está 8,7 veces por debajo del timeout;
  - el cursor por página hace que un corte por el watchdog no pierda progreso.
- **Verificación en la 6.5:**
  - `probar-fase4` (paginación, solapamiento y cortes de red) y `probar-fase5`;
  - repetir los 9 planes del 02 con el filtro en Registro Dev: la página intermedia debe mostrar `server_updated_at >= …` en el `Index Cond` y ~0 filas descartadas.

**H2 — usuarios creados desde el panel:**
- **Qué pasó:** con el proveedor Email deshabilitado, Authentication → Users → Add user → Create new user (Auto Confirm) creó igualmente un usuario con identidad de email.
- **Qué significa:** el interruptor del proveedor no limita lo que puede hacer quien tiene acceso al dashboard; es una capacidad de administración. No se probó si ese usuario podía iniciar sesión (la app solo usa Google).
- **Consecuencias:**
  - para la 6.3, desactivar "Allow new users to sign up" en Poguis cierra el registro público, pero no impide crear usuarios desde el panel. Es lo esperado, y la defensa es el acceso al dashboard;
  - para pruebas futuras, ya no hace falta una segunda cuenta de Google (ver DECISIONES.md, 6.2);
  - la auditoría posterior confirma que no quedó rastro: #26 = 1 y #28 = google.

**Subfase 6.2: CERRADA (2026-11-07).**
