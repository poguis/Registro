# Mapeo de sincronización SQLite ↔ Postgres

Referencia para el mapeador de la Fase 4. Esquema local: `src/data/db/migration2.ts` (`user_version` 2). Esquema del servidor: `supabase/migrations/` (Fase 2).

Hay un prototipo ejecutable de estas reglas en `scripts/lib/mapeo-sync.mjs`. `scripts/probar-fase2.mjs` lo usa para cargar en un Postgres local (PGlite) todas las BD reales y de prueba.

## Alcance
- **Se sincronizan 15 tablas:** `finance_contacts`, `finance_transactions`, `balance_history`, `finance_categories`, `services`, `entertainment_categories`, `entertainment_pauses`, `entertainment_quotas_history`, `series`, `seasons`, `watch_history`, `reading_history`, `backlog`, `work_people`, `cards`.
- **No se sincronizan** (solo existen en el celular): `users`, `outbox`, `_id_map`, `_migration_log` y `legacy_*`.
- **Orden de push (padres antes que hijos):** el de la lista anterior. Las FK son diferidas, así que dentro de una misma transacción el orden no importa, pero entre lotes sí.

## Reglas de conversión

| Tipo SQLite | Tipo Postgres | Push (SQLite → Postgres) | Pull (Postgres → SQLite) |
|---|---|---|---|
| `TEXT` UUID | `uuid` | tal cual | tal cual (minúsculas) |
| `TEXT` ISO-8601 UTC (`created_at`, `updated_at`, `deleted_at`) | `timestamptz` | tal cual (`YYYY-MM-DDTHH:MM:SS.sssZ`) | `new Date(v).toISOString()`: vuelve a ISO con `Z` y milisegundos (Postgres devuelve `+00:00` y hasta µs; se trunca a ms) |
| `INTEGER` epoch ms (`watched_at`, `read_at`) | `timestamptz not null` | `new Date(ms).toISOString()`; un 0 es un error y se reporta | `Date.parse(v)` (ms) |
| `INTEGER` epoch ms con 0 = nunca (`series.last_watched_at`) | `timestamptz` (NULL) | 0 o NULL → NULL; si no, ISO | NULL → 0 |
| `TEXT` `YYYY-MM-DD` (fechas de calendario locales) | `date` | tal cual | tal cual (Postgres devuelve `YYYY-MM-DD`; sin zona horaria) |
| `REAL` monto | `numeric(14,2)` | `roundMoney(v)` (ver Redondeo), enviado como texto | `Number(v)` |
| `INTEGER` | `integer` | tal cual; si no es entero, error | tal cual |
| `TEXT` JSON objeto | `jsonb` (CHECK objeto) | `JSON.parse` + normalización (ver JSON) | `JSON.stringify(v)` |
| `TEXT` JSON array | `jsonb` (CHECK array) | `JSON.parse` | `JSON.stringify(v)` |
| `TEXT` | `text` | tal cual | tal cual |
| — | `server_updated_at timestamptz` | **no se envía** (si se envía, el trigger lo ignora) | se guarda como cursor del pull, no en la fila de dominio |

Nulabilidad y valores por defecto: Postgres repite los del SQLite local, así que ningún NULL que el local permita hace fallar un push.

## Tabla por tabla

En todas las tablas las columnas comunes son:
- `id` uuid PK;
- `user_id` uuid, FK a `auth.users(id)` con **on delete cascade**;
- `created_at`, `updated_at`: timestamptz not null;
- `deleted_at`: timestamptz;
- `server_updated_at`: timestamptz not null, **solo del servidor**.

### finance_contacts
| Columna | SQLite | Postgres | Notas |
|---|---|---|---|
| name | TEXT NOT NULL | text not null | |

Es padre: `unique(id, user_id)`.

### finance_transactions
| Columna | SQLite | Postgres | Notas |
|---|---|---|---|
| contact_id | TEXT NOT NULL | uuid not null | FK compuesta `(contact_id, user_id)` → finance_contacts |
| type | TEXT NOT NULL | text not null | CHECK `debt`, `loan` |
| amount | REAL NOT NULL | numeric(14,2) not null | redondeo a centavos |
| description | TEXT | text | |

### balance_history
| Columna | SQLite | Postgres | Notas |
|---|---|---|---|
| amount | REAL NOT NULL | numeric(14,2) not null | puede ser negativo; saldo = SUM de los no borrados |
| category | TEXT NOT NULL | text not null | nombre de categoría (no es FK) |
| description | TEXT | text | |

### finance_categories
| Columna | SQLite | Postgres | Notas |
|---|---|---|---|
| name | TEXT NOT NULL | text not null | `unique(user_id, name)` en los dos lados |
| icon | TEXT | text | |

### services
| Columna | SQLite | Postgres | Notas |
|---|---|---|---|
| name | TEXT NOT NULL | text not null | |
| type | TEXT NOT NULL | text not null | CHECK `Local`, `Internacional` |
| status | TEXT NOT NULL | text not null | CHECK `Activo`, `Inactivo` |
| original_value | REAL NOT NULL | numeric(14,2) not null | |
| additional_value | REAL DEFAULT 0 | numeric(14,2) default 0 | |
| total_value | REAL NOT NULL | numeric(14,2) not null | valor histórico; Internacional = base × 1,20 puede dar más de 2 decimales → se redondea |

### entertainment_categories
| Columna | SQLite | Postgres | Notas |
|---|---|---|---|
| name | TEXT NOT NULL | text not null | |
| type | TEXT NOT NULL | text not null | CHECK `video`, `reading` |
| start_date | TEXT | date | |
| days_of_week | TEXT JSON | jsonb | CHECK NULL u objeto; el array legado se convierte (ver JSON) |
| frequency | INTEGER DEFAULT 0 | integer default 0 | n > 0: n por día; n < 0: 1 cada \|n\| días |
| series_count | INTEGER DEFAULT 0 | integer default 0 | **límite** de series activas, no un conteo (`comment on column`) |
| description | TEXT | text | |

Es padre: `unique(id, user_id)`.

### entertainment_pauses
| Columna | SQLite | Postgres | Notas |
|---|---|---|---|
| category_id | TEXT NOT NULL | uuid not null | FK compuesta → entertainment_categories |
| pause_start | TEXT NOT NULL | date not null | |
| pause_end | TEXT | date | NULL = pausa vigente |

### entertainment_quotas_history
| Columna | SQLite | Postgres | Notas |
|---|---|---|---|
| category_id | TEXT NOT NULL | uuid not null | FK compuesta → entertainment_categories |
| quotas | TEXT JSON NOT NULL | jsonb not null | CHECK objeto; un array se rechaza y se reporta (no existe en los datos) |
| start_date | TEXT NOT NULL | date not null | |
| end_date | TEXT | date | NULL = cuota vigente |

### series
| Columna | SQLite | Postgres | Notas |
|---|---|---|---|
| category_id | TEXT NOT NULL | uuid not null | FK compuesta → entertainment_categories |
| name / description | TEXT | text | |
| status | TEXT DEFAULT 'Nueva' | text default 'Nueva' | CHECK `Nueva`, `Mirando`, `Pausado`, `En espera`, `Terminado` |
| current_season, current_episode, initial_season, initial_episode | INTEGER DEFAULT 1 | integer default 1 | |
| total_seasons, sort_order, interleave_offset | INTEGER DEFAULT 0 | integer default 0 | |
| cycle_offset | INTEGER DEFAULT 0 | integer default 0 | valor absoluto |
| last_watched_at | INTEGER epoch ms, 0 = nunca | timestamptz NULL | 0 ↔ NULL |

Es padre: `unique(id, user_id)`.

### seasons
| Columna | SQLite | Postgres | Notas |
|---|---|---|---|
| series_id | TEXT NOT NULL | uuid not null | FK compuesta → series |
| season_number | INTEGER NOT NULL | integer not null | `unique(series_id, season_number)` en los dos lados |
| episode_count | INTEGER DEFAULT 0 | integer default 0 | |

### watch_history / reading_history
| Columna | SQLite | Postgres | Notas |
|---|---|---|---|
| series_id | TEXT NOT NULL | uuid not null | FK compuesta → series |
| season_number, episode_number | INTEGER NOT NULL | integer not null | |
| watched_at / read_at | INTEGER epoch ms NOT NULL | timestamptz not null | |

### backlog
| Columna | SQLite | Postgres | Notas |
|---|---|---|---|
| type | TEXT NOT NULL | text not null | CHECK `movie`, `series`, `anime`, `reading` |
| title | TEXT NOT NULL | text not null | |
| status | TEXT DEFAULT 'Pendiente' | text default 'Pendiente' | CHECK `Pendiente`, `Mirando`, `Terminado` |
| year, start_year, end_year | INTEGER | integer | |
| format | TEXT | text | texto libre |
| franchise | TEXT DEFAULT 'Otros' | text default 'Otros' | |

### work_people
| Columna | SQLite | Postgres | Notas |
|---|---|---|---|
| name | TEXT NOT NULL | text not null | |
| start_date | TEXT NOT NULL | date not null | |
| cycle | TEXT JSON NOT NULL | jsonb not null | CHECK array `[{type, days}]` |
| sort_order | INTEGER DEFAULT 0 | integer default 0 | |

### cards
| Columna | SQLite | Postgres | Notas |
|---|---|---|---|
| name | TEXT NOT NULL | text not null | |
| type | TEXT NOT NULL | text not null | CHECK `debit`, `credit` |
| cutoff_date, payment_due_date | INTEGER | integer | día del mes, CHECK 1–31; NULL en débito |
| limit_amount | REAL | numeric(14,2) | |

## Redondeo a centavos
- Postgres redondea `numeric(14,2)` con **empates alejándose de cero** (1,005 → 1,01; −1,005 → −1,01; 0,125 → 0,13). El mapeador debe redondear **exactamente igual** antes del push. Si no, el pull devuelve un valor distinto del que el celular cree haber enviado.
- El redondeo se hace sobre el **valor en centavos con aritmética entera**, partiendo de la representación decimal más corta del número: `String(v)`, que es lo mismo que envía `JSON.stringify`.
  - Nunca con `Math.round(v * 100) / 100`: `1.005 * 100` es `100.49999999999999` en coma flotante, así que daría 1,00 mientras Postgres da 1,01.
  - Prototipo: `toCents` / `roundMoney` en `scripts/lib/mapeo-sync.mjs`, con BigInt. Se compara contra Postgres en 15 casos límite (incluye 1,005, −1,005, 2,675, 0,125, 11,988000000000001 y notación exponencial).
- El mapeador envía el monto **como texto** (`"11.99"`), no como número de coma flotante.
- **Datos actuales:** 0 de 66 montos de las 8 BD cargadas cambian al redondear a 2 decimales.
- **[PENDIENTE] Fase 4:** redondear también al escribir en SQLite (`total_value` Internacional = base × 1,20 y montos escritos con más de 2 decimales). Así el valor local ya es el mismo que guardará el servidor.

## JSON
- `days_of_week`: objeto `{"Monday": n, …, "Sunday": n}`. La forma array legada (`["Monday", …]`) se convierte en el push igual que lo hace hoy `getQuotasForDate` en `src/services/backlogUtils.js`: los días listados toman `frequency || 0` y el resto 0. Hoy no hay arrays en los datos.
- `quotas`: objeto. Un array se **rechaza** (error de mapeo, la fila queda en la outbox con `last_error`), porque su significado depende del tipo de categoría y no se debe adivinar. Hoy no hay ninguno.
- `cycle`: array de `{type, days}`.
- Pull: `JSON.stringify(v)`. jsonb no conserva el orden de las claves ni los espacios, lo que es inocuo para los lectores actuales.

## Columnas solo del servidor
- `server_updated_at`: lo asigna el trigger `set_server_updated_at` (BEFORE INSERT OR UPDATE) e ignora el valor del cliente.
  - En INSERT: `clock_timestamp()`.
  - En UPDATE: `greatest(clock_timestamp(), old.server_updated_at)`, así es no decreciente por fila aunque el reloj del servidor retroceda.
  - No existe en SQLite. El celular solo guarda el **cursor** del pull, `(server_updated_at, id)` de la última fila recibida, por tabla.
- `updated_at` lo envía el cliente y el servidor no lo toca. Regla de conflictos: gana el último en llegar al servidor (DECISIONES).

## Riesgo del cursor: commits fuera de orden
- `server_updated_at` se fija **al escribir la fila**, pero la fila solo es visible para otros **al confirmar** la transacción.
- Si la transacción T1 escribe a las 10:00:00.100 y confirma a las 10:00:02, y mientras tanto T2 escribe a las 10:00:01 y confirma a las 10:00:01.5, un pull a las 10:00:01.8 ve T2 y avanza el cursor a 10:00:01. Cuando T1 confirma, su fila (10:00:00.100) queda **por detrás del cursor** y nunca se descargaría.
- Con `clock_timestamp()` el hueco es solo el tiempo entre la escritura y el commit, no toda la transacción como con `now()`. Pero no es cero.
- **Mitigación propuesta para la Fase 4** (no implementada aún):
  1. **Ventana de solapamiento:** el pull pide `server_updated_at > cursor − Δ` (por ejemplo, Δ = 5 minutos, mucho más que la duración de cualquier transacción del push).
  2. **Upsert idempotente local:** las filas repetidas por la ventana se aplican por `id` sin efectos secundarios. Si `updated_at` y el contenido son iguales, no hay cambio. Nunca se aplican incrementos relativos.
  3. El cursor avanza al máximo `(server_updated_at, id)` recibido y la paginación desempata por `id`.
  4. Alternativa más estricta si la ventana no basta: guardar `pg_current_xact_id()` por fila y descargar solo hasta `pg_snapshot_xmin(pg_current_snapshot())`, que garantiza que no queden transacciones abiertas por debajo del cursor. Requiere una columna y una función extra en el servidor.

## Seguridad que impone el servidor
- **RLS** en las 15 tablas. Políticas `to authenticated` para select, insert y update con `(select auth.uid()) = user_id`; update con USING y WITH CHECK. Sin DELETE.
  - El pull recibe también los tombstones, porque select no filtra `deleted_at`.
  - Un upsert sobre un `id` de otro usuario falla (RLS USING) y no lo modifica.
- **FK compuestas** `(parent_id, user_id)`: no se puede colgar una fila de un padre ajeno.
- **`user_id`** se reescribe a `auth.uid()` en la Fase 3, antes del primer push.
- **Grants:** `authenticated` tiene select, insert y update; `anon` no tiene nada. No hay delete para nadie del lado cliente.
- **Borrar la cuenta** en `auth.users` borra en cascada todas sus filas. Es el único borrado físico.

## Multidispositivo
Sigue **[PENDIENTE]** (Fase 4). Las claves naturales `seasons(series_id, season_number)` y `finance_categories(user_id, name)` pueden chocar entre dispositivos en el pull; ver DECISIONES.md.
