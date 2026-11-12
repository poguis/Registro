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
- [OK] Firma: el release se firma con el keystore de EAS (perfil preview), SHA-256 31:32:DE:…:3E:52, SHA-1 A4:31:C8:…:67:46; las dos huellas identifican la firma del APK (`apksigner verify --print-certs`). Copia local fuera del repo; contraseñas en `%USERPROFILE%\.gradle\gradle.properties`. Nunca borrar ni regenerar ese keystore en EAS. Fase 5 cerrada: cualquier cambio de llave (incluido Play App Signing, hoy fuera de la Fase 6) requiere una decisión explícita. Observado el 2026-11-07 (Fase 6.1): en Google Cloud existe un solo cliente OAuth de tipo Web, compartido por Poguis y Registro Dev, y ningún cliente Android; el login (OAuth + PKCE en Custom Tabs) no usa la SHA-1. Nota: un cliente Android con la SHA-1 solo haría falta si se adopta el inicio de sesión nativo de Google. Con Play App Signing la SHA-1 de la app publicada podría cambiar: cambia si Google genera la llave de firma y se conserva si se sube la llave actual de EAS.
- [OK] Postgres (Fase 2): `user_id` → `auth.users(id)` con `on delete cascade`. Borrar la cuenta borra sus datos; es el único borrado físico.
- [OK] Postgres: FK entre tablas de dominio compuestas `(parent_id, user_id)` → `padre(id, user_id)`, con `unique(id, user_id)` en los padres, `deferrable initially deferred` y sin `on delete`. Las FK no pasan por RLS: así nadie cuelga filas de un padre ajeno.
- [OK] Postgres: grants explícitos por tabla. `authenticated` tiene select, insert y update; `anon` y `public` nada (`revoke all` explícito); nadie tiene delete. Sin `alter default privileges`.
- [OK] Fase 6.1 — regla para migraciones futuras: los privilegios por defecto de la plataforma (`pg_default_acl`) conceden a `anon`, `authenticated` y `service_role` las tablas nuevas que cree `postgres` en `public`, aunque "Automatically expose new tables" esté apagado. Por eso toda migración nueva hace `revoke all … from anon, authenticated, public` explícito en cada objeto que cree y concede solo lo necesario a `authenticated` (como la migración 4/4). `supabase/auditar-fase6.sql` (#12–#15) lo comprueba.
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
- [OK] Aislamiento dev/prod: `app.config.js` pone en `extra.supabase` solo el proyecto de la variante (producción: `EXPO_PUBLIC_SUPABASE_*`; dev: `EXPO_PUBLIC_SUPABASE_DEV_*`, proyecto **Registro Dev**) y `extra.syncEnabled` (`true` en las dos variantes desde la Fase 5, cada una contra su proyecto: producción → **Poguis**, dev → **Registro Dev**). `verificar-secretos --apk` falla si un APK trae el proyecto o la clave del otro, si las claves de `.env` coinciden o si un APK trae la sync apagada. Apagado de emergencia: `syncEnabled: false` + `versionCode` nuevo (no se puede bajar de versión). La URL de retorno dev no está en las Redirect URLs de producción.
- [OK] Migración local 4 (`requiresBackup`): `outbox.blocked_at`/`block_reason` e índice, `sync_state` y `sync_meta`. No modifica datos.
- [OK] Orden: primero push de la outbox, luego pull.
- [OK] Push idempotente (upsert por `id`). Nunca incrementos relativos.
- [OK] Pull con cursor sobre `server_updated_at`, asignado por trigger en Postgres (no por el reloj del celular), paginado y con desempate por `id`.
- [OK] `server_updated_at`: lo asigna el trigger `set_server_updated_at` (BEFORE INSERT OR UPDATE) con `clock_timestamp()` al insertar y `greatest(clock_timestamp(), old.server_updated_at)` al actualizar; ignora el valor del cliente. El riesgo de commits fuera de orden frente al cursor y su mitigación (ventana de solapamiento + upsert idempotente) están en `docs/MAPEO-SYNC.md`; se implementa en la Fase 4.
- [OK] Conflictos: último en llegar al servidor gana, por registro completo (sin refinamiento por entidad). Una edición local pendiente no se pisa con el pull: su push posterior gana. Verificado entre el celular y el emulador.
- [OK] Reintentos con backoff. La outbox nunca descarta cambios por error.
- [OK] Fase 4 (resuelto): reinstalación o celular nuevo con las categorías por defecto → fusión por clave natural, sin IDs deterministas (no cubrirían los datos existentes ni lo creado por el usuario). `finance_categories(user_id, name)` y `seasons(series_id, season_number)`: nada las referencia por `id`, así que la fila local adopta el `id` del servidor. En el push (23505): se busca la fila del servidor, se cambia el id local y sus entradas de outbox, y se reintenta con el contenido local. En el pull: la fila local adopta el id; si tiene cambios pendientes conserva su contenido. Si ya existe otra fila local con ese id, la entrada se bloquea ("fusión imposible") y nada se pierde.
- [OK] Fase 5: primera subida desacoplada de la red. `ensureInitialUpload` encola UNA vez por dispositivo todas las filas (vivas y tombstones) de las 15 tablas, sin duplicar entradas pendientes o bloqueadas, y en la MISMA transacción escribe en `sync_meta` la marca `initial_upload_done_at`, el uid y un resumen de conteos (sin contenido). Requiere la sync habilitada y la cuenta vinculada; no necesita red ni sesión; es idempotente (reiniciar no vuelve a encolar). La ejecuta el runner como `prepare` antes de CADA ciclo (con la marca puesta es una lectura), serializada con las escrituras de la app (cola `enqueue`), así queda hecha antes del primer ciclo sea cual sea el disparador, también sin red y justo después de vincular. No dispara el aviso de outbox de la sync automática.
- [OK] Fase 5: sin red ≠ sin sesión. Con la sesión guardada vencida y sin red, auth-js 2.118 devuelve `session: null` con `AuthRetryableFetchError`: el ciclo queda "Sin conexión — N pendientes" (outbox intacta) y Home no pide iniciar sesión. Sin sesión guardada se sigue pidiendo "Inicia sesión". En React Native auth-js no usa lock: el autorrefresco y el ciclo comparten un solo refresco en vuelo.
- [OK] Fase 5 (disparador NUEVO, no estaba en la Fase 4): ciclo al renovarse el token. Solo reacciona a `TOKEN_REFRESHED` (no a `SIGNED_IN` ni `INITIAL_SESSION`), pasa por `requestSync` (single-flight y backoff; motivo `sesion`, que reinicia el backoff de red) y solo si el último ciclo terminó "offline" o sin sesión / con sesión vencida; nunca con la cuenta sin vincular u otra cuenta, y no se registra con la sync apagada. Motivo: tras un refresco fallido auth-js repite el fallo durante 60 s, así que el ciclo de reconexión puede quedar "offline". Cubierto en `probar-fase5`.
- [OK] Fase 5: "Cerrar sesión" usa `signOut({ scope: 'local' })` (ya desde la Fase 3): cierra solo la sesión de este dispositivo; los demás siguen sincronizando.
- [OK] Fase 5: el indicador cuenta filas DISTINTAS con cambios sin subir (no entradas de la outbox). El pull guarda cursor solo en las tablas que recibieron filas; criterio de verificación: cursor en toda tabla con filas en el servidor.
- [OK] Fase 4 (resuelto): multidispositivo → la misma fusión por clave natural; dos dispositivos que crean la misma categoría o temporada sin conexión convergen a un solo id (probado en `probar-fase4` y entre celular y emulador).

## Fases
0. **[CERRADA 2026-10-20]** Base técnica: verificación de firma del APK, respaldo (copia física .db + JSON) exportable fuera del teléfono, versionado de esquema (`PRAGMA user_version`, línea base aditiva), transacciones, bug de zona horaria, quitar `checkAndBackfillHistory`, corregir docs que piden desinstalar.
1. **[CERRADA 2026-10-25]** Capa de datos local: repositorios, UUID, columnas de sync, soft delete, outbox y migración in-place de los datos existentes. Verificada en el celular: `install -r` del APK 1.1.0 (versionCode 2), respaldos previo y posterior válidos, `dryrun-fase1 --par` criterios 1–5 OK.
2. **[CERRADA 2026-10-27]** Supabase: esquema Postgres, RLS, trigger de `server_updated_at` (archivos SQL). Probado en Postgres local (PGlite, `scripts/probar-fase2.mjs`) y aplicado por el usuario en el SQL Editor; `supabase/verificar-fase2.sql` dio los 22 chequeos ok.
3. **[CERRADA 2026-11-01]** Login con Google (OAuth + PKCE en Custom Tabs, no `signInWithIdToken`), sesión cifrada, vinculación de datos locales y retiro de usuario/contraseña. Verificada en el celular: `install -r` del APK 1.2.0 (versionCode 3, firma EAS) sobre la 1.1.0, sin desinstalar; abrió en modo avión antes y después de vincular; vinculación con confirmación del email; respaldos previo (v2) y posterior (v3) válidos; `dryrun-fase3 --par` OK. RLS real verificada desde la variante dev (insert ajeno y DELETE → 403/42501).
4. **[CERRADA 2026-11-02]** Sincronización: push/pull, conflictos, claves naturales, migración 4, estado de sync en la UI, disparadores automáticos y recarga de pantallas. Probada contra el proyecto **Registro Dev** (producción sin escrituras: su APK tiene la sync apagada y no se actualizó). `probar-fase4` (PGlite + dispositivos `node:sqlite` con el código real, escenarios 1–19) y las suites anteriores OK. Verificada entre el emulador y el celular del usuario con Registro Dev instalado al lado de la app real (sin tocarla: versionCode 3, firstInstallTime 2026-09-21): 6 categorías, crear/editar/borrar en ambos sentidos, modo avión y reconexión automática, saldo igual, conflicto ganado por el último en llegar, cambios que llegan solos (tras cada cambio y cada 2 min). La recarga de pantallas abiertas se verificó en el emulador.
5. **[CERRADA 2026-11-04]** Primer sync de los datos reales y pruebas. APK 1.3.0 (versionCode 4, commit `db1ee50`, firma EAS) con la sync encendida en producción. Ensayo previo con `dryrun-fase5` sobre una copia del respaldo A (14/14). En el celular: `install -r` sobre la 1.2.0 en modo avión, sin desinstalar, mismo `firstInstallTime`; sin red mostró "Sin conexión — 10" (10 filas = A) sin pedir sesión; respaldo B = A con la marca de primera subida; al reconectar subió solo en ~10 s; respaldo C = A + el tombstone `[prueba RLS]`; `verificar-fase5.sql` en Poguis = C con un único `user_id`. Verificación independiente con un **AVD nuevo** (`Registro_Verif_36`, instalación limpia + login con Google): idéntico a C ignorando las fechas de las categorías y con los mismos id de las 6 categorías; tras "Sincronizar ahora" en el celular (respaldo D), idéntico sin excepciones. **La fusión de las categorías por defecto cambió sus `created_at`/`updated_at` a los del AVD (esperado, decisión de la Fase 4).** Multidispositivo `[prueba F5]` en los dos sentidos (≤ 2 min sin tocar nada), pruebas online y offline y aislamiento dev/prod (un cambio en Registro Dev no llegó a Poguis). Respaldo final E = D + 3 tombstones `[prueba F5]`; `legacy_*` sin cambios desde A. El `backlog` del servidor queda con 4 tombstones de prueba (RLS + 3 `[prueba F5]`); limpiarlos se decide en la Fase 6. Pendientes: `claude/TRASPASO-FASE6.md`.
6. Endurecimiento, en subfases (una subfase = un APK como máximo; 6.4 y 6.5 NO se juntan):
   - 6.1 **[CERRADA 2026-11-07]** Auditoría de solo lectura del servidor y del repo (`supabase/auditar-fase6.sql`, `scripts/probar-fase6.mjs`, `scripts/escanear-historial.mjs`). Poguis y Registro Dev: 18/18 estrictos y verificar-fase2 22/22; verificar-fase5 de Poguis = respaldo F (30/26/4, un `user_id`); 0 secretos en el historial y en los APK; Advisors y dashboard 100 % clasificados, ninguno requiere migración. Cierra los ítems 5, 6 y 8 de la Fase 2. Informe: `docs/FASE6-AUDITORIA-SERVIDOR.md`.
   - 6.2 **[CERRADA 2026-11-07]** Pruebas de servidor solo en Registro Dev: cascade al borrar una cuenta, RLS con muchas filas y concurrencia (ítems 4 y 7 de la Fase 2); revaluar el índice de `seasons_series_fkey` con volumen. **Requisito corregido:** no hizo falta una segunda cuenta de Google. Se usó un usuario de correo creado desde el panel de Registro Dev (Authentication → Users → Add user, Auto Confirm), que funcionó aunque el proveedor Email está deshabilitado (hallazgo H2, informativo). Siembra sintética de 119.840 filas (escala 1; `supabase/pruebas-fase6-2/`, ensayada con `scripts/probar-fase6-2.mjs`). Borrado desde el dashboard sin error: 0 filas del usuario en las 15 tablas, los demás idénticos a la línea base y sin necesidad del plan B. RLS aplicada en los 9 planes; la peor página a 50.000 filas tarda ≈ 0,9 s frente a los 8 s del timeout. Concurrencia verificada por documentación. `seasons_series_fkey`: (a) confirmado. Auditoría posterior 18/18. **Cierra los ítems 4 y 7 de la Fase 2.** Informe: `docs/FASE6-PRUEBAS-SERVIDOR.md`.
   - 6.3 **[CERRADA 2026-11-08]** Credenciales y plan, aplicados por el usuario en los dashboards. Sin cambios de código, esquema ni datos.
     - **Claves legacy anon/service_role desactivadas** (Disable JWT-based keys) en Registro Dev y en Poguis. La app sincroniza solo con la publishable (probado en los dos). El panel sigue funcionando sin claves secretas: SQL Editor y Authentication → Users comprobados. Según el panel, desactivarlas las bloquea en el encabezado `apikey`, pero siguen siendo válidas como JWT (ver el [PENDIENTE] de JWT signing keys).
     - **"Allow new users to sign up":** cerrado en Poguis y abierto en Registro Dev (para pruebas). Probado que el usuario existente inicia sesión con el registro cerrado. No impide crear usuarios desde el panel (H2 de la 6.2).
     - **Client secret de Google rotado** el 2026-11-08: se agregó el nuevo en los dos proyectos, se deshabilitó el viejo, se probó el login en Dev y en producción, y se borró el viejo. Queda 1 secret activo, compartido por los dos proyectos.
     - **Plan Free** confirmado (ver [OK] abajo).
     - **Site URL:** sin cambios (informativo).
     - Registro Dev quedó con un elemento de backlog de prueba `[prueba F6.3]`: datos de prueba, sin acción.
     - **Respaldo G del celular** (2026-11-08, después de la 6.3): válido (`validar-respaldo`), `user_version` 4, outbox 0. Conteos de las 15 tablas: 30 / 26 / 4 con un `user_id`, igual que el respaldo F.
   - 6.4 **[CERRADA 2026-11-08]** APK de dependencias, commit `ed06602`, sin cambios en `src/`, el esquema local (`user_version` 4), las migraciones ni Supabase.
     - **Dependencias:** `expo` 54.0.33 → **54.0.38** (parches de SDK 54; `expo-doctor` 18/18). `expo-sqlite` sigue en 16.0.10, con SQLite 3.50.3. Quitados, sin uso: `@react-navigation/native`, `@react-navigation/stack`, `react-native-screens` y `react-native-gesture-handler`. `react-native-safe-area-context` se queda porque lo usan `App.js` y 16 pantallas.
     - **Repo:** `android.os.Looper` (archivo vacío) eliminado. `probar-fase3` se ajustó a la versión vigente.
     - **APK 1.3.1 / versionCode 5:**
       - **Dev** (firma `debug.keystore`, `fac61745…`, igual que la 1.2.0): instalado encima en el celular, de versionCode 3 a 5 con el mismo `firstInstallTime`. Pruebas en el celular OK: pantallas, escritura, sync, modo avión, respaldo y reinicio.
       - **Producción** (firma EAS `31:32:DE:…:3E:52`, sin cambios): `install -r` sobre la 1.3.0, de versionCode 4 a 5 con el mismo `firstInstallTime` (2026-09-21). Abrió con la sesión iniciada, los datos visibles y "Sincronizado".
     - **Respaldos:** H (antes, app 1.3.0) e I (después, app 1.3.1) válidos, `user_version` 4 y outbox vacía. `comparar-sync` H vs I: idénticos en las 15 tablas, con el mismo saldo. `verificar-fase5` de Poguis = conteos de I en las 16 filas (30 / 26 / 4, un `user_id`).
   - 6.5 **[CERRADA 2026-11-08]** APK de pulido visible, commit `dcdc59d`, sin migraciones locales (`user_version` 4) ni cambios en Supabase. Suite nueva `scripts/probar-fase6-5.mjs` (42 OK).
     1. **Indicador** (`src/sync/syncStatusText.ts`, función pura `describeSyncStatus` con pruebas de tabla). "Sincronizado hace X" solo con red, sin pendientes y con el último ciclo bien. "Sincronizando…" si hay pendientes o un ciclo en curso. Sin red según NetInfo: "Sin conexión", o "Sin conexión — 1 cambio pendiente" / "— N cambios pendientes". Nunca "pendiente(s)" ni "Sincronizado" con pendientes. Sin red no pide iniciar sesión (H1 de la Fase 5). `controller.ts` avisa a la UI cuando cambia NetInfo y en cada commit que encola, sin ciclos extra ni llamadas de red.
     2. **"Cerrar sesión" sin red** (H6 de la Fase 5; `src/auth/signOutLocal.ts`). En auth-js 2.118, `signOut` con el token vencido y sin red devolvía el error del refresco sin borrar la sesión. Ahora, si `signOut({ scope: 'local' })` falla, se borra la sesión del storage de la app (la clave sale de `auth.storageKey`, la configuración real del cliente) y se repite `signOut`, que ya sin sesión no usa la red: `_removeSession` emite `SIGNED_OUT`, y su contador impide que una renovación en curso resucite la sesión (probado). El botón "Cerrar sesión" aparece también con sesión guardada y sin red (`App.js`).
     3. **Respaldo, formato 2:** `meta.backupDirFiles` lista nombre, tamaño y fecha de cada archivo de `respaldos/`, sin contenido. `validar-respaldo.mjs` acepta los formatos 1 y 2.
     4. **N+1 de `getEntertainmentCategories`:** pasa a 5 consultas fijas (antes 1 + 3 por categoría + 1 por serie) con el mismo resultado. Comprobado el 2026-11-08 contra el original de `git show f3772d9`: idéntico, JSON byte a byte, en 3 casos (usuario con 5 categorías, otro usuario y usuario sin datos). La suite compara contra una copia de referencia de esa versión (`refGetEntertainmentCategories_f3772d9`).
     5. **Pull** (H1 de la 6.2): filtro redundante `gte('server_updated_at', cursor.ts)` delante del `or(...)` del keyset (`supabaseTransport.applyPullFilter`; también en `pglite-transport.mjs`). Las páginas son idénticas, también con empates, y en PGlite la página intermedia pasa de 10.000 filas descartadas a 201.
     6. **Avisos de Node** solo en `scripts/`: MODULE_TYPELESS_PACKAGE_JSON con `scripts/lib/ts-esm-hook.mjs` (marca `src/` como ESM; los scripts cargan `src/` con `await import`), y DEP0190 pasando un solo comando citado en `build-apk.mjs` y `start-dev.mjs`. `package.json` no cambia. Las salidas de `validar-respaldo`, `comparar-sync` y `probar-fase6 --conteos` sobre los respaldos reales son idénticas antes y después, salvo los avisos.
     - **APK 1.3.2 / versionCode 6:**
       - **Dev** (firma `fac61745…`): instalado encima, de versionCode 5 a 6 con el mismo `firstInstallTime`. Pruebas en el celular OK, incluido cerrar sesión sin red tras más de 1 hora y volver a entrar con la misma cuenta.
       - **Producción** (firma EAS `31:32:DE:…:3E:52`): `install -r` sobre la 1.3.1, de versionCode 5 a 6 con el mismo `firstInstallTime` (2026-09-21 07:49:29). Abrió con la sesión iniciada, los datos visibles y "Sincronizado hace X".
     - **Respaldos del celular:** "antes" (app 1.3.1, formato 1) y "después" (app 1.3.2, formato 2, 45 archivos en `respaldos/`) válidos, `user_version` 4 y outbox vacía. `comparar-sync`: idénticos en las 15 tablas, con el mismo saldo. `verificar-fase5` de Poguis = conteos de "después" en las 16 filas (30 / 26 / 4, un `user_id`).
   - 6.6 **[CERRADA 2026-11-10]** APK de siembra de las categorías por defecto tras el primer pull (H2 de la Fase 5), commit `378a164`, sin migraciones locales (`user_version` 4) ni cambios en Supabase.
     - **Siembra diferida:** con la sync encendida, `createLinkedUser` en una BD sin usuarios no siembra; escribe en `sync_meta` la marca `default_categories_pending` = uid. Después del pull COMPLETO de `finance_categories` (todas las páginas, sin error ni cancelación), `syncOnce` llama a `seedPendingDefaultCategories` (por `mutate`). Esa función:
       - solo actúa si la marca es exactamente el uid;
       - crea solo los nombres por defecto que no tienen ninguna fila, ni viva ni borrada, así que nunca revive una categoría borrada;
       - pone las creaciones en la outbox;
       - en la misma transacción limpia la marca (valor NULL) y escribe `default_categories_seeded_at`.

       Si se sembró algo, se sube en el mismo ciclo (segundo push). Si el pull no se completa, no se siembra y se reintenta en el ciclo siguiente. Con la sync apagada, se siembra como antes. Las instalaciones existentes nunca crean la marca ni siembran.
     - **Pruebas:** `scripts/probar-fase6-6.mjs`, 29 OK, casos a–i:
       - a) el servidor ya tiene las 6, una borrada: no se siembra nada y el servidor queda idéntico, incluidos `icon` y las fechas;
       - b) servidor vacío: se siembran 6 y convergen en el mismo ciclo;
       - c) el servidor tiene 4: se siembran solo las 2 que faltan;
       - d) el pull falla: no se siembra y, al completarse, solo lo que falta;
       - e) cierre a mitad de la siembra: se deshace entera, sin duplicados al reabrir;
       - f) sync apagada: siembra inmediata;
       - g) BD existente vinculada: nunca siembra;
       - h) escenario H2: con el comportamiento anterior la borrada revive; ahora no;
       - i) la marca con otro uid: no siembra ni toca la marca.

       `probar-fase1` gana una única excepción justificada en su chequeo de lecturas sin `deleted_at`: `'SELECT value FROM sync_meta'`, porque es una tabla interna de la sync sin borrado lógico. `money.ts` (`ensureCategory`) no cambió.
     - **Prueba en Registro Dev (2026-11-10):**
       - La app no permite borrar categorías, así que el tombstone de "Venta" se hizo en el SQL Editor con un `DO $ … $` de una sola sentencia y guardas (`raise exception` si el uid no existe en el proyecto o si el UPDATE no afecta exactamente 1 fila).
       - Se descartó la consulta B propuesta (un UPDATE con `('texto')::int` dentro de un `CASE`): Postgres pliega las constantes al planificar, así que el cast de un literal falla aunque esté en una rama que no se usa.
       - Celular dev 1.3.2 → 1.3.3, de versionCode 6 a 7 con el mismo `firstInstallTime`.
       - AVD limpio `Registro_Limpio_66` (APK dev, sin la app antes, `install` sin `-r`): tras iniciar sesión con la cuenta dev, Dinero quedó idéntico al celular, sin "Venta" ni duplicados, y el celular siguió igual. El respaldo del AVD no se obtuvo a tiempo (solo quedaron las copias pre-migración de la BD vacía), y el AVD se borró.
       - Una consulta de solo lectura en Registro Dev demostró que el AVD no subió categorías: 6 filas, sin repetidos, "Venta" borrada con el `server_updated_at` más reciente y ninguna fila posterior.
       - Respaldo del celular dev: formato 2, app 1.3.3, outbox vacía, sin la marca; sus categorías coinciden con las del servidor en nombre, borrada, icono y `created_at`.
       - También se borró el AVD `Registro_Verif_36` de la Fase 5.
     - **Producción:** `install -r` de la 1.3.3 (firma EAS `31:32:DE:…:3E:52`) sobre la 1.3.2, de versionCode 6 a 7 con el mismo `firstInstallTime` (2026-09-21 07:49:29). Dinero quedó igual. Respaldos "antes" (app 1.3.2) y "después" (app 1.3.3): formato 2, `user_version` 4, outbox vacía, sin claves `default_categories*`; `comparar-sync`, idénticos en las 15 tablas con el mismo saldo. El primer `verificar-fase5` se ejecutó **por error en Registro Dev** (6/16 filas distintas) y se repitió en Poguis: 16/16 iguales a "después" (30 / 26 / 4, un `user_id`).
     - **Registro Dev:** "Venta" quedó como tombstone de prueba en `finance_categories`, sin acción.
   - 6.7 **[CERRADA 2026-11-11]** Limpieza local destructiva: migración 5 (`legacy_*`) y retención de `respaldos/`. Commit `c01c283`, APK 1.3.4 / versionCode 8. Es la única subfase de la Fase 6 que borra datos de forma irreversible.
     - **Excepción autorizada por el dueño de los datos** a "ninguna migración borra datos", la única:
       - **La migración 5** (`src/data/db/migration5.ts`, con `requiresBackup`, que crea `pre-migracion-v5`) elimina SOLO estas 16 tablas, por **lista explícita**, de hijos a padres:
         - `legacy_finance_transactions`, `legacy_entertainment_pauses`, `legacy_entertainment_quotas_history`, `legacy_seasons`;
         - `legacy_watch_history`, `legacy_reading_history`, `legacy_series`, `legacy_entertainment_categories`;
         - `legacy_finance_contacts`, `legacy_balance_history`, `legacy_finance_categories`, `legacy_services`;
         - `legacy_backlog`, `legacy_work_people`, `legacy_cards`, `legacy_users`.

         No renombra ni recrea el `.db`, no hace VACUUM y no toca ninguna otra tabla: verifica que los conteos de las 15 tablas sincronizadas, `users`, `outbox`, `sync_meta`, `sync_state`, `_id_map` y `_migration_log` no cambian. `LATEST_VERSION` = 5.
       - **Borrado de archivos**, solo dentro de `respaldos/`.
     - **Reglas de retención** (`backupRetention.ts`, función pura):
       - se conservan los 10 respaldos manuales más recientes (el `.db` y el `.json` de un mismo sello forman un par) y la copia pre-migración más reciente;
       - los patrones son exactos y admiten un sufijo `-N` opcional (`registro_respaldo_<sello>[-N].(db|json)`, `registro_pre-migracion-vN_<sello>[-N].db`, `registro_pre-vinculacion_<sello>[-N].db`);
       - **una copia con la contraseña antigua nunca se conserva**: su par se borra entero y no ocupa ninguno de los 10 puestos;
       - **el respaldo recién creado nunca se borra**;
       - la pre-vinculación se borra;
       - un nombre desconocido se conserva y se informa.

       La limpieza corre una vez al abrir la 1.3.4, después de la migración 5 (marca `sync_meta.backup_cleanup_first_at`), y después de cada "Respaldar datos". Deja en `sync_meta` (`backup_cleanup_last_at`, `backup_cleanup_last_summary`) un resumen sin nombres.
     - **Verificación de la contraseña en el celular** (`backupCleanup.js`): solo sobre los archivos que se conservarían.
       - Los JSON se analizan en busca de campos `password` visibles.
       - Los `.db` se abren directamente con `expo-sqlite`. La versión 16.0.10 **no tiene modo de solo lectura**: sus opciones son `enableChangeListener`, `useNewConnection`, `finalizeUnusedStatementsBeforeClosing` y las de libSQL, y en Android abre con `sqlite3_open`.
       - **Mitigaciones:**
         - antes se lee la cabecera, y solo se abre un archivo en modo de diario clásico (no WAL);
         - solo se abre si no hay `-journal`, `-wal` ni `-shm`;
         - solo se hacen lecturas;
         - después se comprueba que no aparecieron archivos auxiliares y que el tamaño no cambió;
         - si no se puede verificar, decide la cabecera (`user_version` ≤ 2) o la fecha frente a la migración 3.
       - **Guardas al borrar:** el nombre tiene que coincidir con un patrón (sin `/` ni `..`), la ruta tiene que ser exactamente `respaldos/<nombre>` y nunca la BD principal, y un fallo al borrar no detiene a los demás.
     - **Pruebas:** `scripts/probar-fase6-7.mjs`, 39 OK. Cubren la migración 5 sobre el fixture y sobre una copia del respaldo real, el inventario real de 49 archivos (= D4), la tabla de casos, el ejecutor y la integración.
       - `probar-fase1/3`, `dryrun-fase1/5` y `validar-respaldo` se adaptaron a la v5, con su justificación en el commit.
       - Diagnóstico: 11 copias internas con la contraseña antigua (5 comprobadas en su copia de la PC y 6 deducidas por esquema o fecha).
     - **Registro Dev (2026-11-11):**
       - 1.3.3 → 1.3.4, de versionCode 7 a 8 con el mismo `firstInstallTime`, sin pantalla de error;
       - respaldos "antes" (v4, 16 `legacy_*`), "después" y "segundo" (v5, sin `legacy_*` ni columna `password`);
       - la limpieza inicial borró las pre-migraciones v2, v3 y v4 (3 archivos);
       - "segundo" conservó "después" y el propio;
       - `comparar-sync`: idénticos en las 15 tablas.
     - **Producción (2026-11-11):**
       - **Archivo permanente** antes de instalar: `registro_respaldo_20261111-202909` (`.db` y `.json`, app 1.3.3, `user_version` 4, 30 / 26 / 4), en `.local-data/fase6-7/prod/archivo/` (solo ese par) y en Google Drive, carpeta `RESPALDO/PROD`. No se borra nunca. Hizo también de respaldo "antes".
       - `install -r` de la 1.3.4 (firma EAS `31:32:DE:…:3E:52`) sobre la 1.3.3, de versionCode 7 a 8 con el mismo `firstInstallTime`, sin pantalla de error.
       - Respaldos "después" (`…203404`) y "segundo" (`…203553`): v5, sin `legacy_*` ni columna `password`, outbox vacía. Están en `.local-data/fase6-7/prod/`, junto con `verificar-fase5-poguis.json`.
       - **Limpieza inicial:** 32 borrados (5.722.177 B), 21 conservados, 0 con contraseña conservada y 0 fallos. Quedan 10 respaldos (incluido el archivo) y la `pre-migracion-v5`; ni rastro de las 11 copias con contraseña ni de la pre-vinculación. Coincide exactamente con aplicar las reglas al listado del archivo.
       - La limpieza tras "después" borró el par más viejo (2 archivos), y "segundo" conservó "después" y el propio.
       - `comparar-sync`: archivo vs después y después vs segundo, idénticos en las 15 tablas con el mismo saldo.
       - `verificar-fase5` de Poguis: 16/16 = "después" (30 / 26 / 4, un `user_id`).
   - 6.8 Tombstones de prueba en Poguis (4 en `backlog`). Se decide al llegar; recomendación: no limpiar.

### Fuera de la Fase 6 (Fase 7 / backlog)
- PIN / huella.
- Realtime.
- IDEA (no es una decisión): la app no permite borrar ni ocultar categorías de dinero desde la interfaz (visto en la 6.6). Además, Dinero también muestra los nombres usados en `balance_history` (`getDistinctCategories`).
- Play Store / Play App Signing (sigue vigente el [OK] de Alcance: fuera de alcance hasta que la app funcione al 100 % para uso personal).
- Restaurar un respaldo dentro de la app (sigue [PENDIENTE]).

### Descartado
- Cursor para las tablas vacías: sin filas no hay un `server_updated_at` del servidor para fijarlo, y usar el reloj del celular reabriría el riesgo de commits fuera de orden (docs/MAPEO-SYNC.md). Se mantiene pedir esas tablas completas (consulta vacía).

## Datos existentes y cuentas
- [OK] Los datos del celular se migran in-place en Fase 1, con respaldo previo verificado.
- [OK] Al inicio de Fase 1, Claude Code cuenta las cuentas locales y se detiene a informar antes de migrar. Si hay una sola, se asocia a la primera cuenta Google (Fase 3).
- [OK] Cuentas locales: el dispositivo tiene 1 cuenta (respaldo 2026-10-20). Se asocia a la primera cuenta Google en Fase 3.
- [OK] Estados de series: `Nueva`, `Mirando`, `Pausado` (los tres cuentan para el límite activo, pestaña Viendo), `En espera`, `Terminado`. Backlog: type `movie|series|anime|reading`, status `Pendiente|Mirando|Terminado`. Se aplican como CHECK en Postgres (Fase 2); localmente se validan en los repositorios.
- [OK] Fase 6.4 (2026-11-08): eliminados `android.os.Looper` y las dependencias sin uso `@react-navigation/native`, `@react-navigation/stack`, `react-native-screens` y `react-native-gesture-handler`.
- [PENDIENTE] Restaurar un respaldo dentro de la app.
- [OK] Fase 3 (migración 3): `users` se reconstruye sin `password` (con `email` y `linked_at`, sin `UNIQUE(username)`) y `legacy_users.password` queda vacío; con `PRAGMA secure_delete` el texto viejo no queda en el archivo. Las copias físicas previas sí lo conservan (ver Fase 6).
- [OK] Vinculación: operación única con copia física previa y una transacción exclusiva; `users.id` y el `user_id` de las 15 tablas pasan a ser el `auth.uid()`; no encola en la outbox ni cambia `updated_at`; borra `@user_session`; pide confirmación mostrando el email de Google.
- [OK] Una cuenta Google por dispositivo: si los datos ya están vinculados a otra cuenta, o hay varias cuentas locales, el login se bloquea con un mensaje y no se toca nada.
- [OK] Offline-first del acceso: con datos locales la app SIEMPRE abre (sin red, con token vencido o sin sesión). Solo una instalación sin datos exige el login con Google. Cerrar sesión de Google borra solo la sesión y no bloquea la app.
- [OK] Fase 6.5 (2026-11-08), regla de sesión: **la app nunca cierra la sesión sola**; solo el usuario, con "Cerrar sesión" (que funciona también sin red) o borrando los datos de la app. Sin red o con el token vencido, la sesión sigue guardada. Cerrar sesión no toca los datos locales (BD, outbox, respaldos), y las reglas de vinculación no cambian. **Única excepción aceptada:** auth-js borra la sesión por su cuenta cuando el servidor rechaza definitivamente el refresh token (sesión revocada o usuario borrado) y el access token ya venció. Nunca ocurre por falta de red ni por un token vencido.
- [OK] Fase 6.7 (2026-11-11): las copias internas con la contraseña antigua (pre-migración v2/v3 y respaldos anteriores a la migración 3, 11 en total) se borraron en el celular con la retención de `respaldos/`, que nunca conserva una copia con contraseña.
- [PENDIENTE] (usuario) Decidir qué hacer con las 43 copias con la contraseña antigua que hay en `.local-data/` (lista D3 de la 6.7). Claude Code no las toca.
  - Destaca `emulador-fase1/respaldo/registro_respaldo_20261021-033646.json`, con la contraseña **visible** en el JSON.
  - **Del celular real:**
    - `respaldo-real/registro_respaldo_20261020-211827.db`;
    - `respaldo-pre-fase1/registro_respaldo_20261025-191228.db` y `cargado.sqlite`;
    - `respaldo-post-fase1/registro_respaldo_20261025-191742.db` y `cargado.sqlite`;
    - `respaldo-post-fase1-fix/registro_respaldo_20261025-195442.db`;
    - `respaldo-pre-fase3/registro_respaldo_20261101-123248.db`;
    - `revalidado-post-fase1.sqlite`;
    - `dryrun-fase1/real/antes/app_registro_v3.db`.
  - **De pruebas y emulador (34):** `emulador*/…`, `emulador-fase3/almacen-release/…`, `dryrun-fase1/A|B|C/antes`, `pruebas-pc/…` y `pruebas-fase1/alterado.*` (alterados a propósito por la prueba).
  - **Recomendación:** borrar las de pruebas y emulador; las del celular real, borrarlas o guardarlas cifradas fuera del repo.
- [OK] Fase 6.3 (2026-11-08): claves legacy anon/service_role desactivadas (Disable JWT-based keys) en Registro Dev y en Poguis. Las dos variantes usan solo `sb_publishable_`, y la sincronización se probó en las dos.
- [PENDIENTE] Migrar a JWT signing keys y revocar el secreto JWT legacy. Invalida del todo los tokens legacy, que siguen siendo válidos como JWT aunque estén bloqueados en el encabezado `apikey`, y afecta a la firma de las sesiones. Se decide al cerrar la Fase 6: subfase 6.9 o backlog.
- [OK] Fase 6.3 (2026-11-08): "Allow new users to sign up" cerrado en Poguis y abierto en Registro Dev (para pruebas). El usuario existente inicia sesión con el registro cerrado. No impide crear usuarios desde el panel (hallazgo H2 de la 6.2).
- [OK] Fase 6.3 (2026-11-08): plan Free. La app se usa al menos una vez por semana; si Supabase pausa el proyecto por inactividad, se reanuda desde el dashboard (mientras tanto la app muestra "Sin conexión" y los datos locales siguen disponibles).
- [OK] Fase 6.6 (2026-11-10): en una instalación nueva con la sync encendida, las categorías por defecto se siembran solo después del primer pull completo de `finance_categories`, y solo las que falten (sin revivir las borradas). Con la sync apagada, como antes; las instalaciones existentes nunca siembran.

## Propuestas nuevas (para aprobar)
- [OK] En Fase 1, `user_id` = UUID del usuario local. En Fase 3, al primer login, se reescribe a `auth.uid()` en todas las tablas y en la outbox, en una sola transacción.
- [OK] Las filas migradas NO se encolan en la outbox. El primer sync (Fase 5) hace upsert idempotente de todas las filas existentes.
- [OK] Las tablas originales se conservaron renombradas como `legacy_*` hasta la Fase 6. **Eliminadas en la Fase 6.7** (migración 5, con aprobación explícita y copia previa `pre-migracion-v5`; archivo permanente en `.local-data/fase6-7/prod/archivo/` y en Google Drive, `RESPALDO/PROD`).
- [OK] Columnas de sync (`created_at`, `updated_at`, `deleted_at`) en TEXT ISO-8601 UTC `YYYY-MM-DDTHH:MM:SS.sssZ`. Los epoch ms existentes (`watched_at`, `read_at`, `last_watched_at`) se quedan como INTEGER y se convierten a timestamptz en el mapeo de sync.
- [OK] `users` es tabla local (no se sincroniza ni pasa por la outbox).
- [OK] Variantes con `app.config.js` (`APP_VARIANT`): producción `com.poguis.Registro` / "Registro" / `poguis-registro`; desarrollo `com.poguis.Registro.dev` / "Registro Dev" / `poguis-registro-dev`. Se instalan una al lado de la otra, cada una con su BD. La firma la pone el config plugin `plugins/withReleaseSigning.js` en cada `prebuild`: EAS en producción; `debug.keystore` solo en dev. La prueba de RLS existe solo en la variante dev.
- [OK] La prueba de RLS real deja una fila `[prueba RLS]` como tombstone en `backlog` del servidor (cuenta del usuario); el primer pull (Fase 5) la bajará como borrada.
- [OK] La migración de esquema de Fase 1 usa `withExclusiveTransactionAsync`; las operaciones normales de la app usan `withTransactionAsync`.