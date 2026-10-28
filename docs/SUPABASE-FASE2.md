# Aplicar la Fase 2 en Supabase (lo hace el usuario)

Claude Code no ejecuta nada contra el proyecto remoto. Estos pasos se hacen a mano en el dashboard y en el SQL Editor.

## 1. Antes de aplicar: revisar el proyecto
- [ ] **Región:** la más cercana a Ecuador entre las que ofrezca Supabase (normalmente una de EE. UU. Este o São Paulo). No se puede cambiar después.
- [ ] **Versión de Postgres:** Settings → Infrastructure. Lo esperado es 15 o superior; las pruebas locales corrieron en 18 (PGlite) con SQL compatible con 15+.
- [ ] **Data API:** activa, con `public` entre los esquemas expuestos (la app la usará en la Fase 4). Las tablas solo quedan accesibles por los grants explícitos de la migración 4/4.
- [ ] **Privilegios por defecto de `public`:** comprueba que tablas nuevas no se expongan solas. Busca en Settings → Data API una opción que conceda automáticamente las tablas nuevas a `anon` y `authenticated`, y desactívala si existe. Aunque esté activa, la migración 4/4 hace `revoke all … from anon, authenticated, public` en cada tabla y la consulta de verificación lo comprueba (chequeos 9 a 12). Para verlo por SQL (solo lectura):
  ```sql
  select pg_get_userbyid(defaclrole) as rol, defaclobjtype as tipo, defaclacl as acl
  from pg_default_acl where defaclnamespace = 'public'::regnamespace;
  ```
- [ ] **`public` vacío:** el chequeo 2 de la verificación debe salir vacío. Si el proyecto ya tiene tablas propias en `public`, para y avísame.
- [ ] **Claves:** no copies la `service_role` ni ninguna secret key a ningún archivo ni chat. En esta fase no se usa ninguna clave.
- [ ] **Auth:** no hace falta configurar nada todavía. El login con Google es la Fase 3.

## 2. Orden de aplicación (SQL Editor → New query)
Pega cada archivo **completo** en una consulta nueva y ejecútalo **en este orden**, uno por uno:
1. `supabase/migrations/20261026000100_server_updated_at.sql`
2. `supabase/migrations/20261026000200_tablas.sql`
3. `supabase/migrations/20261026000300_indices_triggers.sql`
4. `supabase/migrations/20261026000400_rls_grants.sql`

Detalles:
- Cada archivo va entre `begin; … commit;`. Si uno falla, no deja nada a medias. **Detente**, no sigas con el siguiente y pásame el mensaje de error exacto.
- No edites los archivos en el editor. Si algo hay que cambiar, se cambia en el repo.
- No los ejecutes dos veces. El segundo intento falla con "already exists", y eso no daña nada, pero avísame.
- Si el editor advierte sobre consultas "destructivas" o pide confirmar, revisa que el texto pegado sea el del archivo y confirma.

## 3. Verificación (solo lectura)
Pega `supabase/verificar-fase2.sql` en una consulta nueva y ejecútalo. Devuelve 22 filas `chequeo | valor | esperado | ok`, y **todas deben tener `ok = true`**. Pásame la tabla completa: no contiene datos personales.

| # | Chequeo | Esperado |
|---|---|---|
| 1 | tablas de `public` que son las 15 del esquema | 15 |
| 2 | tablas de `public` fuera de las 15 | vacío |
| 3 | tablas con RLS activada | 15 |
| 4 | políticas SELECT / INSERT / UPDATE | 15 / 15 / 15 |
| 5 | políticas DELETE o ALL | 0 |
| 6 | políticas que no son `to authenticated` | 0 |
| 7 | políticas sin `auth.uid() = user_id` | 0 |
| 8 | `authenticated`: tablas con SELECT / INSERT / UPDATE | 15 / 15 / 15 |
| 9 | `authenticated`: DELETE, TRUNCATE, REFERENCES o TRIGGER | 0 |
| 10 | `anon`: cualquier privilegio en las 15 tablas | 0 |
| 11 | `anon` / PUBLIC: grants de columna | 0 |
| 12 | PUBLIC: grants de tabla | 0 |
| 13 | triggers `set_server_updated_at` activos (BEFORE INSERT OR UPDATE) | 15 |
| 14 | funciones de `public` con `security definer` | 0 |
| 15 | `set_server_updated_at`: security invoker y `search_path` vacío | sí |
| 16 | `anon` / `authenticated` pueden ejecutar la función del trigger | false / false |
| 17 | FK a `auth.users` con `on delete cascade` | 15 |
| 18 | FK compuestas `(parent_id, user_id)` diferidas, sin on delete | 7 |
| 19 | índices de pull `(user_id, server_updated_at, id)` | 15 |
| 20 | `has_schema_privilege('authenticated', 'public', 'USAGE')` | true: lo concede Supabase y la app lo necesita |
| 21 | `has_schema_privilege('anon', 'public', 'USAGE')` | true: Supabase lo concede por defecto. Solo permite "ver" el esquema; no da acceso a ninguna tabla (chequeo 10). Si sale false, también es seguro, pero avísame porque difiere de lo esperado. |
| 22 | versión de Postgres ≥ 15 | true |

Opcional: Supabase → Advisors → Security Advisor. No debería mostrar avisos de "RLS disabled" ni de `search_path` mutable en estas tablas. Pásame lo que muestre.

## 4. Qué NO hacer
- No ejecutes `supabase link`, `db push` ni `db reset`, ni conectes nada local al proyecto.
- No insertes datos de prueba en el proyecto real. Las pruebas de datos se hicieron en local (`scripts/probar-fase2.mjs`).
