# DECISIONES.md

Estados: [OK] decidido · [PROPUESTA] sugerido, el usuario puede cambiarlo · [PENDIENTE] no asumir, preguntar.

## Alcance
- [OK] Solo Android. iOS y web fuera de alcance (no se rompen a propósito, pero no se prueban).
- [OK] Una cuenta Google por dispositivo. Datos privados por usuario: ningún usuario accede a datos de otro.
- [OK] Se requiere un build nativo (no Expo Go): no por Google Sign-In nativo (el login es OAuth + PKCE en el navegador), sino por las variantes con scheme propio (`poguis-registro`, `poguis-registro-dev`) y los módulos nativos. Builds locales con `npm run build:release` / `npm run build:dev`.
- [OK] Publicación en Play Store: fuera de alcance hasta que la app funcione al 100% para uso personal.
- [OK] Nuevo código de datos/sync/auth en TypeScript, conviviendo con el JS actual (allowJs). No se migra el router ni las pantallas existentes en esta etapa.

## Backend
- [OK] Supabase: Postgres + Auth (Google) + RLS. Sin servidor propio.
- [OK] Plan Free para empezar. Es conocida la pausa por inactividad; subir a Pro al publicar o si se necesita 24/7.
- [OK] Esquema de Postgres como archivos SQL en `supabase/migrations/`. Claude Code solo GENERA los archivos; el usuario los aplica.
- [OK] Prohibido ejecutar comandos contra el proyecto remoto de Supabase (`supabase db push`, `db reset --linked`, `functions deploy`, etc.).

## Seguridad
- [OK] RLS activada en todas las tablas. Políticas por `user_id = auth.uid()` para select/insert/update. Sin política DELETE: el borrado es lógico (UPDATE de `deleted_at`).
- [OK] Solo la clave publishable/anon va en la app, vía variables `EXPO_PUBLIC_*` en `.env` (en `.gitignore`). La `service_role` NUNCA va en la app ni en el repo.
- [OK] Tokens de sesión en almacenamiento seguro (validar el patrón recomendado en la doc de Supabase para RN). Se elimina `@user_session` de AsyncStorage y la columna `users.password`.
- [OK] Sesión de Supabase cifrada con `LargeSecureStore` (patrón de la guía oficial de Supabase para Expo): llave AES-256 nueva en cada escritura en `expo-secure-store` y sesión cifrada (AES-CTR) en AsyncStorage. SecureStore queda excluido del Auto Backup de Android (`configureAndroidBackup: true`); un cifrado restaurado sin llave cuenta como "sin sesión". `autoRefreshToken` controlado con `AppState`; `detectSessionInUrl: false`. Los verificadores PKCE se borran al terminar cada intento de login. Verificado: 0 tokens en claro en el almacenamiento de la app.
- [OK] Nonce de Google Sign-In: resuelto por PKCE. El login es `signInWithOAuth({ provider: 'google' })` con `flowType: 'pkce'` y `skipBrowserRedirect`, abierto con `expo-web-browser` (Custom Tabs), y `exchangeCodeForSession`. Hermes no tiene `crypto`: un shim con `expo-crypto` (getRandomValues + SHA-256) hace que auth-js use `S256` (verificado: `code_challenge_method=s256`). Retorno exacto `<scheme>://auth/callback`. El botón nativo de pago queda como mejora futura opcional.
- [OK] Datos sensibles (nombres de contactos, personas de trabajo) viajan en claro sobre TLS y protegidos por RLS. Sin cifrado del lado cliente por ahora.
- [OK] Firma: el release se firma con el keystore de EAS (perfil preview), SHA-256 31:32:DE:…:3E:52, SHA-1 A4:31:C8:…:67:46. Copia local fuera del repo; contraseñas en `%USERPROFILE%\.gradle\gradle.properties`. Nunca borrar ni regenerar ese keystore en EAS. No se cambia de llave hasta cerrar la Fase 5. La SHA-1 es la que se registra en el cliente Android de Google Cloud.
- [OK] Postgres (Fase 2): `user_id` → `auth.users(id)` con `on delete cascade`. Borrar la cuenta borra sus datos; es el único borrado físico.
- [OK] Postgres: FK entre tablas de dominio compuestas `(parent_id, user_id)` → `padre(id, user_id)`, con `unique(id, user_id)` en los padres, `deferrable initially deferred` y sin `on delete`. Las FK no pasan por RLS: así nadie cuelga filas de un padre ajeno.
- [OK] Postgres: grants explícitos por tabla. `authenticated` tiene select, insert y update; `anon` y `public` nada (`revoke all` explícito); nadie tiene delete. Sin `alter default privileges`.
- [OK] Postgres: ninguna función del esquema usa `security definer`; la del trigger es `security invoker` con `search_path` vacío y sin `execute` para `anon` ni `authenticated`.
- [OK] Respaldo JSON: toda columna `password` de cualquier tabla (`users`, `legacy_users`, …) va como `[OCULTO]`; `validar-respaldo.mjs` falla si alguna queda visible. La copia física `.db` la conserva: se trata como dato privado.

## Datos locales
- [OK] SQLite local es la fuente de verdad de la UI. Toda lectura y escritura va contra SQLite; la app funciona 100% sin internet.
- [OK] Versionado de esquema con `PRAGMA user_version` y migraciones ordenadas. Prohibido renombrar el archivo `.db` o borrar datos para cambiar el esquema.
- [OK] Operaciones de varios pasos dentro de `withTransactionAsync`.
- [OK] Acceso a datos mediante repositorios por feature (se parte `db.js` de forma gradual).
- [OK] SQLite del dispositivo: 3.50.3 (expo-sqlite 16 empaquetado).

## Modelo de datos
- [OK] IDs: UUID v4 generado en el cliente (`expo-crypto`). Se reescriben las FK enteras en la migración local.
- [OK] Toda tabla sincronizable lleva `id`, `user_id` (también las hijas, desnormalizado), `created_at`, `updated_at`, `deleted_at`.
- [OK] Instantes en UTC (`timestamptz` en Postgres). Fechas de calendario (`start_date`, pausas) como `date` / `YYYY-MM-DD` local.
- [OK] Postgres: `CHECK` en enumerados, `jsonb` para `days_of_week`, `quotas` y `cycle`, `UNIQUE(series_id, season_number)` en `seasons`.
- [OK] `seasons`: upsert por `(series_id, season_number)`; se elimina el delete + reinsert.
- [OK] `watch_history` y `reading_history` se mantienen como dos tablas por ahora.
- [OK] Borrados: tombstones internos (`deleted_at`), sin papelera visible.
- [OK] `series_count` se conserva con su significado actual (límite de series activas); se documenta en el esquema.
- [OK] `days_of_week` y `quotas` usan forma objeto (`{"Monday":1,...}`); el lector conserva la compatibilidad con la forma array legada. `work_people.cycle` es array `[{type, days}]`.
- [OK] Saldo: `current_balance` pasa a calcularse como suma de `balance_history`. El ajuste manual se registra como movimiento de categoría "Ajuste".
- [OK] `services.total_value` se almacena como valor histórico (Internacional = base × 1,20; Local = base + adicional, según ServiciosScreen). Se escribe junto con `original_value`/`additional_value` en la misma operación.
- [OK] Montos en Postgres como `numeric(14,2)`. El mapeador de la Fase 4 redondea a centavos igual que Postgres: empates alejándose de cero, sobre la representación decimal del número con aritmética entera, nunca con `Math.round(x * 100)` (ver `docs/MAPEO-SYNC.md`).
- [OK] Fase 4 (resuelto): los montos se redondean a centavos también al escribir en SQLite, en un solo punto (`roundMoneyColumns` de `src/sync/mapping.ts`, llamado por `insertRow`/`updateRow` de `rows.ts`), con la misma regla que Postgres (`total_value` Internacional 11,988 → 11,99; `adjustBalanceTo`; `limit_amount`). La migración 4 no reescribe montos existentes (el inventario dio 0 que cambiarían); si alguno cambiara, el push lo sube redondeado y el pull lo baja igual.
- [OK] `series.last_watched_at`: 0 (nunca vista) en SQLite ↔ NULL en Postgres. `watched_at` y `read_at` son NOT NULL.
- [OK] CHECK de forma JSON en Postgres: `days_of_week` NULL u objeto, `quotas` objeto, `cycle` array. El mapeador convierte el array legado de `days_of_week` a objeto (como `getQuotasForDate`); un `quotas` en forma array se rechaza y se reporta.
- [OK] `cycle_offset` se guarda como valor absoluto, no como incremento (idempotente ante reintentos).
- [OK] Se elimina `checkAndBackfillHistory`; las filas sintéticas ya existentes se conservan tal cual.

## Sincronización
- [OK] Cada escritura local se registra en la tabla `outbox` en la MISMA transacción.
- [OK] Disparadores: apertura de la app, volver a primer plano, recuperar conexión (`@react-native-community/netinfo`) y botón manual. Sin tareas en segundo plano.
- [OK] Fase 4.3: además, una sync tras cada cambio local (cuando una transacción encola algo en la outbox), con antirrebote de 3 s y solo si NetInfo indica conexión; varios cambios seguidos se agrupan en un ciclo y sin conexión no hace nada (sube al reconectar). Y una sync periódica cada 2 min (`periodicMs`, configurable) solo en primer plano y con conexión, pausada en segundo plano (AppState); el siguiente turno se programa al terminar el anterior y se salta si hay una sync en curso, así que nunca se acumulan ciclos. Ambos respetan el single-flight y el backoff (`src/sync/autoSync.ts`). Siguen sin tareas en segundo plano: solo temporizadores de JS con la app abierta.
- [OK] Fase 4.3: al reconectar y con "Sincronizar ahora" se reinicia el backoff solo de las entradas que fallaron por error transitorio de red (no las bloqueadas ni los errores de sesión); el backoff automático entre ciclos no cambia.
- [OK] Fase 4.3: cuando un ciclo escribe datos locales (filas del servidor aplicadas en el pull o un id fusionado por clave natural), el runner emite un aviso al terminar el ciclo y las pantallas abiertas con datos (Dinero, Deudas, Servicios, Tarjetas, Series/Anime y su detalle, Lectura, Registros, Pendiente, Trabajo, Estadísticas) recargan con `useSyncRefresh`. La recarga solo vuelve a leer la BD: no toca formularios ni filtros, y en Registros no muestra el indicador de carga, así que la lista no se desmonta ni pierde el scroll. Un ciclo que solo sube cambios propios no avisa.
- [OK] Motor (`src/sync/`): push de la outbox en orden padres → hijos, lotes de 100, upsert por `id`; al confirmar se borran solo las entradas del snapshot. Errores: de red/timeout/408/429/5xx → reintento con backoff `min(30 s × 2^intentos, 1 h)`; de sesión (401/JWT) → se detiene sin culpar a ninguna entrada; 23505 → fusión por clave natural; 23503 → se encola el padre; el resto (permanentes) → entrada bloqueada (`blocked_at`, visible en la UI con "Reintentar"), nunca borrada. Un lote con error permanente se reintenta fila por fila para bloquear solo la culpable.
- [OK] Pull: páginas de 500 por (`server_updated_at`, `id`), cursor por tabla en `sync_state` guardado tal cual lo devuelve el servidor y en la misma transacción que la página; ventana de solapamiento de 60 s (el rol `authenticated` tiene `statement_timeout` de 8 s). No sobrescribe una fila con entrada pendiente o bloqueada en la outbox, ni reescribe una fila idéntica (la segunda sync escribe 0 veces).
- [OK] Single-flight con watchdog: una sola sync a la vez; lo pedido durante una ejecución se fusiona en UNA extra; un ciclo que pasa de 2 min se da por fallido y la cancelación cooperativa impide que siga escribiendo. `fetch` de supabase-js con timeout por petición.
- [OK] Requisitos para sincronizar: cuenta vinculada, `users.id` = uid de la sesión y sesión válida. Si no, el ciclo termina `skipped` con el motivo en el indicador, sin alertas; la app sigue completa.
- [OK] Aislamiento dev/prod: `app.config.js` pone en `extra.supabase` solo el proyecto de la variante (producción: `EXPO_PUBLIC_SUPABASE_*`; dev: `EXPO_PUBLIC_SUPABASE_DEV_*`, proyecto **Registro Dev**) y `extra.syncEnabled` (`false` en producción hasta la Fase 5; `true` solo en dev). `verificar-secretos --apk` falla si un APK trae el proyecto o la clave del otro, si las claves de `.env` coinciden o si el release tiene la sync encendida. La URL de retorno dev no está en las Redirect URLs de producción.
- [OK] Migración local 4 (`requiresBackup`): `outbox.blocked_at`/`block_reason` e índice, `sync_state` y `sync_meta`. No modifica datos.
- [OK] Orden: primero push de la outbox, luego pull.
- [OK] Push idempotente (upsert por `id`). Nunca incrementos relativos.
- [OK] Pull con cursor sobre `server_updated_at`, asignado por trigger en Postgres (no por el reloj del celular), paginado y con desempate por `id`.
- [OK] `server_updated_at`: lo asigna el trigger `set_server_updated_at` (BEFORE INSERT OR UPDATE) con `clock_timestamp()` al insertar y `greatest(clock_timestamp(), old.server_updated_at)` al actualizar; ignora el valor del cliente. El riesgo de commits fuera de orden frente al cursor y su mitigación (ventana de solapamiento + upsert idempotente) están en `docs/MAPEO-SYNC.md`; se implementa en la Fase 4.
- [OK] Conflictos: último en llegar al servidor gana, por registro completo (sin refinamiento por entidad). Una edición local pendiente no se pisa con el pull: su push posterior gana. Verificado entre el celular y el emulador.
- [OK] Reintentos con backoff. La outbox nunca descarta cambios por error.
- [OK] Fase 4 (resuelto): reinstalación o celular nuevo con las categorías por defecto → fusión por clave natural, sin IDs deterministas (no cubrirían los datos existentes ni lo creado por el usuario). `finance_categories(user_id, name)` y `seasons(series_id, season_number)`: nada las referencia por `id`, así que la fila local adopta el `id` del servidor. En el push (23505): se busca la fila del servidor, se cambia el id local y sus entradas de outbox, y se reintenta con el contenido local. En el pull: la fila local adopta el id; si tiene cambios pendientes conserva su contenido. Si ya existe otra fila local con ese id, la entrada se bloquea ("fusión imposible") y nada se pierde.
- [OK] Fase 4 (resuelto): multidispositivo → la misma fusión por clave natural; dos dispositivos que crean la misma categoría o temporada sin conexión convergen a un solo id (probado en `probar-fase4` y entre celular y emulador).

## Fases
0. **[CERRADA 2026-10-20]** Base técnica: verificación de firma del APK, respaldo (copia física .db + JSON) exportable fuera del teléfono, versionado de esquema (`PRAGMA user_version`, línea base aditiva), transacciones, bug de zona horaria, quitar `checkAndBackfillHistory`, corregir docs que piden desinstalar.
1. **[CERRADA 2026-10-25]** Capa de datos local: repositorios, UUID, columnas de sync, soft delete, outbox y migración in-place de los datos existentes. Verificada en el celular: `install -r` del APK 1.1.0 (versionCode 2), respaldos previo y posterior válidos, `dryrun-fase1 --par` criterios 1–5 OK.
2. **[CERRADA 2026-10-27]** Supabase: esquema Postgres, RLS, trigger de `server_updated_at` (archivos SQL). Probado en Postgres local (PGlite, `scripts/probar-fase2.mjs`) y aplicado por el usuario en el SQL Editor; `supabase/verificar-fase2.sql` dio los 22 chequeos ok.
3. **[CERRADA 2026-11-01]** Login con Google (OAuth + PKCE en Custom Tabs, no `signInWithIdToken`), sesión cifrada, vinculación de datos locales y retiro de usuario/contraseña. Verificada en el celular: `install -r` del APK 1.2.0 (versionCode 3, firma EAS) sobre la 1.1.0, sin desinstalar; abrió en modo avión antes y después de vincular; vinculación con confirmación del email; respaldos previo (v2) y posterior (v3) válidos; `dryrun-fase3 --par` OK. RLS real verificada desde la variante dev (insert ajeno y DELETE → 403/42501).
4. **[CERRADA 2026-11-02]** Sincronización: push/pull, conflictos, claves naturales, migración 4, estado de sync en la UI, disparadores automáticos y recarga de pantallas. Probada contra el proyecto **Registro Dev** (producción sin escrituras: su APK tiene la sync apagada y no se actualizó). `probar-fase4` (PGlite + dispositivos `node:sqlite` con el código real, escenarios 1–19) y las suites anteriores OK. Verificada entre el emulador y el celular del usuario con Registro Dev instalado al lado de la app real (sin tocarla: versionCode 3, firstInstallTime 2026-09-21): 6 categorías, crear/editar/borrar en ambos sentidos, modo avión y reconexión automática, saldo igual, conflicto ganado por el último en llegar, cambios que llegan solos (tras cada cambio y cada 2 min). La recarga de pantallas abiertas se verificó en el emulador.
5. Primer sync de datos existentes y pruebas offline/online.
6. Endurecimiento: revisión de RLS, respaldos, rendimiento (N+1).

## Datos existentes y cuentas
- [OK] Los datos del celular se migran in-place en Fase 1, con respaldo previo verificado.
- [OK] Al inicio de Fase 1, Claude Code cuenta las cuentas locales y se detiene a informar antes de migrar. Si hay una sola, se asocia a la primera cuenta Google (Fase 3).
- [OK] Cuentas locales: el dispositivo tiene 1 cuenta (respaldo 2026-10-20). Se asocia a la primera cuenta Google en Fase 3.
- [OK] Estados de series: `Nueva`, `Mirando`, `Pausado` (los tres cuentan para el límite activo, pestaña Viendo), `En espera`, `Terminado`. Backlog: type `movie|series|anime|reading`, status `Pendiente|Mirando|Terminado`. Se aplican como CHECK en Postgres (Fase 2); localmente se validan en los repositorios.
- [PENDIENTE] Archivo `android.os.Looper` y dependencias `@react-navigation` sin uso: ¿se eliminan?
- [PENDIENTE] Restaurar un respaldo dentro de la app.
- [OK] Fase 3 (migración 3): `users` se reconstruye sin `password` (con `email` y `linked_at`, sin `UNIQUE(username)`) y `legacy_users.password` queda vacío; con `PRAGMA secure_delete` el texto viejo no queda en el archivo. Las copias físicas previas sí lo conservan (ver Fase 6).
- [OK] Vinculación: operación única con copia física previa y una transacción exclusiva; `users.id` y el `user_id` de las 15 tablas pasan a ser el `auth.uid()`; no encola en la outbox ni cambia `updated_at`; borra `@user_session`; pide confirmación mostrando el email de Google.
- [OK] Una cuenta Google por dispositivo: si los datos ya están vinculados a otra cuenta, o hay varias cuentas locales, el login se bloquea con un mensaje y no se toca nada.
- [OK] Offline-first del acceso: con datos locales la app SIEMPRE abre (sin red, con token vencido o sin sesión). Solo una instalación sin datos exige el login con Google. Cerrar sesión de Google borra solo la sesión y no bloquea la app.
- [PENDIENTE] Fase 6: las copias físicas pre-migración/pre-vinculación dentro del celular conservan la contraseña antigua; decidir si se eliminan (con aprobación del usuario).

## Propuestas nuevas (para aprobar)
- [OK] En Fase 1, `user_id` = UUID del usuario local. En Fase 3, al primer login, se reescribe a `auth.uid()` en todas las tablas y en la outbox, en una sola transacción.
- [OK] Las filas migradas NO se encolan en la outbox. El primer sync (Fase 5) hace upsert idempotente de todas las filas existentes.
- [OK] Las tablas originales se conservan renombradas como `legacy_*` hasta la Fase 6 (rollback sin restaurar respaldo). Se borran solo con aprobación explícita.
- [OK] Columnas de sync (`created_at`, `updated_at`, `deleted_at`) en TEXT ISO-8601 UTC `YYYY-MM-DDTHH:MM:SS.sssZ`. Los epoch ms existentes (`watched_at`, `read_at`, `last_watched_at`) se quedan como INTEGER y se convierten a timestamptz en el mapeo de sync.
- [OK] `users` es tabla local (no se sincroniza ni pasa por la outbox).
- [OK] Variantes con `app.config.js` (`APP_VARIANT`): producción `com.poguis.Registro` / "Registro" / `poguis-registro`; desarrollo `com.poguis.Registro.dev` / "Registro Dev" / `poguis-registro-dev`. Se instalan una al lado de la otra, cada una con su BD. La firma la pone el config plugin `plugins/withReleaseSigning.js` en cada `prebuild`: EAS en producción; `debug.keystore` solo en dev. La prueba de RLS existe solo en la variante dev.
- [OK] La prueba de RLS real deja una fila `[prueba RLS]` como tombstone en `backlog` del servidor (cuenta del usuario); el primer pull (Fase 5) la bajará como borrada.
- [OK] La migración de esquema de Fase 1 usa `withExclusiveTransactionAsync`; las operaciones normales de la app usan `withTransactionAsync`.