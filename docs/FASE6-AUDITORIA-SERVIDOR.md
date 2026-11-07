# Fase 6.1: auditoría de solo lectura del servidor

Estado: **ETAPAS A y B terminadas (2026-11-07).** Reglas de este informe: sin emails, uid, Client ID ni valores de claves o del client secret. Solo conteos, nombres de chequeo o de lint, sí/no y fechas.

## 1. Alcance y fuentes
- **Proyectos:** **Poguis** (producción, datos reales) y **Registro Dev** (pruebas).
- **Consultas** (solo lectura, ejecutadas por el usuario en el SQL Editor; resultados en JSON en `.local-data/fase6/`):
  - `supabase/auditar-fase6.sql`: 31 chequeos, 18 estrictos y 13 informativos;
  - `supabase/verificar-fase2.sql`: 22 chequeos;
  - `supabase/verificar-fase5.sql`: en Poguis, para cruzarlo con F; en Registro Dev, para probar la procedencia de sus resultados.
- **Línea base local:** respaldo F `registro_respaldo_20261107-130116` (app 1.3.0, `user_version` 4). El usuario lo hizo justo después de ver "Sincronizado", y `verificar-fase5` se corrió inmediatamente después.
- **Dashboard y Google Cloud:** notas del usuario (`.local-data/fase6/dashboard-notas.md.md`) y los hechos que dio por escrito el 2026-11-07.
- **Pruebas locales (ETAPA A):**
  - `scripts/probar-fase6.mjs`: escaneo estático, ejecución `read only` en PGlite y 5 negativas;
  - `scripts/escanear-historial.mjs`: 78 commits, 49.750 líneas agregadas, 0 hallazgos; `verificar-secretos` OK en el repo y en los APK release y dev.

**Chequeos que dependen de la plataforma:** #2 (versión), #6 (extensiones en `public`) y #19 (`statement_timeout`). Estaba previsto que, si daban `false` en Supabase, se clasificaran aquí. En los dos proyectos dieron `true`.

## 2. auditar-fase6: Poguis
- **18/18 estrictos en `true`:** #2, #4–#6, #8–#10, #12–#15, #17, #19 y #23–#28.
- **13 informativos:**
  | # | Valor |
  |---|---|
  | 1 | PostgreSQL 17.11 (x86_64, 64-bit) |
  | 3 | `postgres` · `rolsuper=false` |
  | 7 | 0 tipos propios |
  | 11 | 0 tablas con RLS forzada |
  | 16 | CREATE en public: anon `false` / PUBLIC `false` |
  | 18 | `postgres`/tablas → anon, authenticated, postgres, service_role; `postgres`/secuencias y funciones → solo postgres; `supabase_admin`/tablas, secuencias y funciones → anon, authenticated, postgres, service_role |
  | 20 | anon con `statement_timeout=3s` |
  | 21 | service_role existe · `rolbypassrls=true` · `rolcanlogin=false` |
  | 22 | service_role en las 15 tablas: MAINTAIN, REFERENCES, TRIGGER, TRUNCATE (sin SELECT/INSERT/UPDATE/DELETE) |
  | 26 | `auth.users` = 1 |
  | 29 | `user_id` distintos con filas = 1 |
  | 30 | extensiones: pg_stat_statements, pgcrypto y uuid-ossp en `extensions`; supabase_vault en `vault`; plpgsql en `pg_catalog` |
  | 31 | 12 MB |

## 3. auditar-fase6: Registro Dev
Mismos resultados que Poguis: **18/18 estrictos en `true`** y los mismos 13 valores informativos (PostgreSQL 17.11, `postgres` sin superusuario, mismos privilegios por defecto, mismo `service_role`, 1 usuario, 12 MB).

**Procedencia probada.** Los JSON de `auditar-fase6` y `verificar-fase2` de los dos proyectos son idénticos byte a byte, lo que es coherente con el mismo esquema, Postgres 17.11, un usuario y 12 MB en cada uno. Para probar que los de Registro Dev salieron de Registro Dev, el usuario corrió allí `verificar-fase5.sql` (`verificar-fase5-registro-dev.json`):
- Sus conteos difieren de los de Poguis en 8 de las 15 tablas. `TODAS` = **21 / 18 / 3** frente a 30 / 26 / 4 en Poguis.
  - Registro Dev: `balance_history` 7, `backlog` 7 (4 vivos / 3 borrados), `work_people` 1, sin series ni historial.
  - Poguis: `balance_history` 2, `backlog` 4 (0 / 4), `work_people` 3, `watch_history` 11.
- `usuarios_distintos` de `TODAS` = 1, igual que su auditar #29.

Queda descartado que sean los resultados de Poguis copiados.

## 4. verificar-fase2 en los dos proyectos
**Poguis: 22/22 `ok`. Registro Dev: 22/22 `ok`** (procedencia probada en la sección 3).

## 5. verificar-fase5 de Poguis vs. conteos del respaldo F
`node scripts/probar-fase6.mjs --conteos` sobre F frente a `verificar-fase5-poguis.json`: **16/16 filas idénticas** (total / vivos / borrados / usuarios distintos).

| tabla | F = Poguis |
|---|---|
| balance_history | 2 / 2 / 0 / 1 |
| finance_categories | 6 / 6 / 0 / 1 |
| entertainment_categories | 1 / 1 / 0 / 1 |
| entertainment_quotas_history | 1 / 1 / 0 / 1 |
| series | 1 / 1 / 0 / 1 |
| seasons | 1 / 1 / 0 / 1 |
| watch_history | 11 / 11 / 0 / 1 |
| backlog | 4 / 0 / 4 / 1 |
| work_people | 3 / 3 / 0 / 1 |
| las 6 restantes | 0 / 0 / 0 / 0 |
| **TODAS** | **30 / 26 / 4 / 1**, `ok = true` en todas |

F es válido (`validar-respaldo`: 37 tablas, 0 violaciones de FK, `legacy_users.password` oculta). Este cruce confirma además que los SQL "de Poguis" se corrieron en Poguis.

## 6. Security Advisor
| Proyecto | Nivel | Lint | Entidad | Clasificación |
|---|---|---|---|---|
| Poguis | WARN | Leaked Password Protection Disabled | Auth | (d) |
| Registro Dev | WARN | Leaked Password Protection Disabled | Auth | (d) |

## 7. Performance Advisor (iguales en los dos proyectos)
| Nivel | Lint | Entidad | Clasificación |
|---|---|---|---|
| INFO | Unindexed foreign keys | `public.seasons` (`seasons_series_fkey`) | (a) |
| INFO | Unused Index | `finance_transactions_contact_idx` | (a) |
| INFO | Unused Index | `entertainment_pauses_category_idx` | (a) |
| INFO | Unused Index | `entertainment_quotas_history_category_idx` | (a) |
| INFO | Unused Index | `series_category_idx` | (a) |
| INFO | Unused Index | `watch_history_series_idx` | (a) |
| INFO | Unused Index | `reading_history_series_idx` | (a) |

## 8. Configuración del dashboard (iguales en los dos proyectos salvo la Redirect URL)
| Ajuste | Valor | Clasificación |
|---|---|---|
| Permitir registro de usuarios nuevos | sí | (c) |
| Inicios de sesión anónimos | no | conforme (DECISIONES; #27 = 0) |
| Vinculación manual de identidades | no | conforme |
| Proveedores | solo Google; Email deshabilitado | conforme (#28 = `google`) |
| Confirmar email | sí | (d) |
| Site URL | `http://localhost:3000` | (a) |
| Redirect URLs | cada proyecto solo la suya (`poguis-registro://…` / `poguis-registro-dev://…`) | conforme (DECISIONES: la URL dev no está en producción) |
| Publishable key | presente | conforme |
| Secret keys | 0 | conforme |
| Claves legacy anon / service_role (JWT) | activas | (c) |
| Esquemas expuestos | `graphql_public`, `public` | (a) por `graphql_public` |
| Exponer tablas nuevas automáticamente | no | conforme (decisión de la Fase 2) |
| "Tablas expuestas 0 de 15", "funciones expuestas 0 de 1" | — | (d) |
| Max rows | 1000 | (a) |
| Plan | Free (organización) | (c) [PENDIENTE] Free o Pro |
| Pausa por inactividad mencionada | no | informativo |

## 9. Google Cloud
- **Cliente OAuth:** un único cliente de tipo **Web**, compartido por Poguis y Registro Dev. **No hay cliente Android.**
- **Client secret:** 1, creado el 2026-11-02 y habilitado; el de la Fase 4 ya no existe. **Su valor quedó expuesto en un chat el 2026-11-07** → (c) rotarlo.
- **Pantalla de consentimiento:** Testing, usuarios externos, 1 usuario de prueba. Hoy solo la cuenta del usuario puede iniciar sesión → (a) informativo; condiciona la 6.2.
- **Contradicción con la documentación:** `DECISIONES.md` (Seguridad, Firma) dice "La SHA-1 es la que se registra en el cliente Android de Google Cloud". Lo observado: no existe cliente Android. El login es OAuth web con PKCE (DECISIONES, Nonce) y no usa la SHA-1. **Corrección aplicada el 2026-11-07** en `DECISIONES.md` (Seguridad, Firma): registra lo observado (un solo cliente Web compartido, ningún cliente Android), conserva la SHA-1 como huella de la firma del APK y anota, sin decidir nada, que un cliente Android con la SHA-1 solo haría falta con el inicio de sesión nativo de Google y que con Play App Signing la SHA-1 cambiaría.
  No hay otras menciones en CLAUDE.md, docs/, claude/ ni .agent/.
- **Requisito para desactivar las claves legacy:** `verificar-secretos` confirma que la clave de las dos variantes en `.env` empieza por `sb_publishable_` ("la clave es publishable" OK en producción y en development), sin mostrar valores. Además, los dos APK actuales traen solo `sb_publishable_`.

## 10. Clasificación de hallazgos
(a) aceptado por diseño · (b) requiere migración → subfase nueva · (c) configuración del dashboard → la aplica el usuario · (d) falso positivo o no aplica.

| # | Hallazgo (proyecto) | Clase | Evidencia y decisión |
|---|---|---|---|
| 1 | Leaked Password Protection Disabled (los dos) | **(d)** | Protege contraseñas de Email; el proveedor Email está deshabilitado y #28 = solo `google`. No hay contraseñas en Auth. |
| 2 | Unindexed FK `seasons_series_fkey` (los dos) | **(a)** | Decisión de la migración 3/4: "seasons(series_id) ya está cubierto por unique (series_id, season_number)". La FK compuesta `(series_id, user_id)` tiene `series_id` como primera columna de ese índice. El padre solo se borra físicamente en cascada al borrar la cuenta. Se revalúa con las pruebas de volumen de la 6.2. |
| 3 | 6 × Unused Index (los dos) | **(a)** | Creados a propósito (migración 3/4: "un índice por cada FK entre tablas de dominio"). Con ~30 filas el planificador no los usa. Quitarlos dispararía "Unindexed foreign keys". Se conservan. |
| 4 | Data API "0 de 15 tablas / 0 de 1 funciones expuestas" (los dos) | **(d)** | Es la vista del dashboard con "exponer automáticamente" apagado. `authenticated` sí tiene SELECT/INSERT/UPDATE en las 15 (verificar-fase2 #8 = 15/15/15), y la sync real funciona (Fases 4–5, F = servidor). La función no debe ser ejecutable (#14 = 0; verificar-fase2 #16). **No se activa nada.** |
| 5 | Exponer tablas nuevas apagado, pero `pg_default_acl` (#18) concede a anon/authenticated/service_role las tablas nuevas que cree `postgres` en public (los dos) | **(a)** | Incoherencia anotada. Las migraciones actuales revocan explícitamente (#12 = #13 = 0). **Regla obligatoria:** toda migración futura revoca todo a `anon`, `authenticated` y `public` y concede solo lo necesario a `authenticated`. |
| 6 | `service_role`: bypassrls, sin S/I/U/D en las 15, con TRUNCATE/REFERENCES/TRIGGER/MAINTAIN (los dos) | **(a)** | #21–#22. 0 secret keys en los dos proyectos. Nunca apareció en el repo, el historial (escanear-historial: 0 JWT service_role) ni los APK (verificar-secretos). Con la clave legacy service_role todavía activa (hallazgo 8), la mitigación es desactivarla. **Cierra el ítem 6 de la Fase 2.** |
| 7 | Postgres 17.11; SQL Editor como `postgres` sin superusuario (los dos) | **(a)** | #1–#3; dentro de 15–17 (#2 `true`). **Cierra el ítem 5 de la Fase 2.** |
| 8 | Claves legacy anon / service_role (JWT) activas (los dos) | **(c)** | Desactivarlas en la 6.3, primero en Registro Dev y luego en Poguis. Requisito cumplido: las dos variantes usan `sb_publishable_`. |
| 9 | Client secret de Google expuesto el 2026-11-07 (cliente compartido) | **(c)** | Rotarlo en la 6.3; afecta a los dos proyectos a la vez (actualizar el secret en Auth → Google de ambos). Reemplaza el ítem "eliminar el Client secret viejo", que ya no aplica (el viejo no existe). |
| 10 | "Allow new users to sign up" activo (los dos) | **(c)** | [PENDIENTE] decidir si se desactiva en Poguis; hoy lo mitiga el modo Testing de Google (1 usuario de prueba). En Registro Dev se mantiene activo para la 6.2. |
| 11 | "Confirmar email" activo (los dos) | **(d)** | Solo aplica al proveedor Email, que está deshabilitado. |
| 12 | Site URL `http://localhost:3000` (los dos) | **(a)** | Informativo: es el destino de reserva si la Redirect URL no coincide (diagnóstico de la Fase 3). Cambiarlo es opcional en la 6.3. |
| 13 | Max rows 1000 (los dos) | **(a)** | Compatible con las páginas de pull de 500 (`config.ts` `pageSize`). **Restricción:** `pageSize` debe ser ≤ Max rows si alguna vez se cambia. |
| 14 | `graphql_public` expuesto sin `pg_graphql` instalado (los dos) | **(a)** | Informativo (#30: `pg_graphql` no está instalado). |
| 15 | Plan Free | **(c)** | [PENDIENTE] Free o Pro (ya estaba en el traspaso); el dashboard no menciona una pausa. |
| 16 | Pantalla de consentimiento en Testing con 1 usuario de prueba | **(a)** | Informativo; la 6.2 necesita una segunda cuenta de prueba. |
| 17 | DECISIONES.md menciona un cliente Android / SHA-1 en Google Cloud | — | Contradicción con lo observado; **corregida** en DECISIONES.md (sección 9). |

**100 % clasificado:** 15 de los Advisors (1 del Security y 7 del Performance por proyecto, agrupados en las filas 1–3) y todos los ajustes del dashboard y de Google Cloud (secciones 8 y 9). Ninguno es (b): **no hace falta ninguna migración nueva.**

## 11. Ítems 5, 6 y 8 de la lista de la Fase 2
- **5. Versión y rol: CERRADO.** PostgreSQL 17.11 en los dos proyectos (#1–#2). El SQL Editor corre como `postgres` sin superusuario (#3).
- **6. `service_role`: CERRADO.**
  - Atributos: `rolbypassrls`, no puede iniciar sesión, y en las 15 tablas solo MAINTAIN/REFERENCES/TRIGGER/TRUNCATE (#21–#22).
  - Claves: 0 secret keys.
  - Nunca apareció en el repo, el historial ni los APK.
  - Queda la clave legacy activa → 6.3 (hallazgo 8).
- **8. Security Advisor: CERRADO.** Un único WARN por proyecto (Leaked Password Protection), clasificado (d). Performance Advisor clasificado (a).

## 12. Acciones propuestas (no aplicadas)
| Acción | Subfase | Quién |
|---|---|---|
| Rotar el client secret de Google (cliente Web compartido) y actualizarlo en Auth → Google de los dos proyectos | 6.3 | usuario |
| [PENDIENTE] Desactivar las claves legacy anon/service_role: primero Registro Dev, luego Poguis | 6.3 | usuario |
| [PENDIENTE] Desactivar "Allow new users to sign up" en Poguis | 6.3 | usuario |
| [PENDIENTE] Free o Pro | 6.3 | usuario |
| Opcional: Site URL | 6.3 | usuario |
| Agregar una segunda cuenta de Google como usuario de prueba y mantener el registro abierto en Registro Dev | 6.2 | usuario |
