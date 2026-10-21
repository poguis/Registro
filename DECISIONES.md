# DECISIONES.md

Estados: [OK] decidido · [PROPUESTA] sugerido, el usuario puede cambiarlo · [PENDIENTE] no asumir, preguntar.

## Alcance
- [OK] Solo Android. iOS y web fuera de alcance (no se rompen a propósito, pero no se prueban).
- [OK] Una cuenta Google por dispositivo. Datos privados por usuario: ningún usuario accede a datos de otro.
- [OK] Se requiere dev build (no Expo Go) por Google Sign-In nativo.
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
- [PENDIENTE] Nonce en Google Sign-In: el nonce personalizado requiere la versión con licencia de @react-native-google-signin (Universal Sign In). Opciones: comprar licencia (nonce activo: hash SHA-256 a Google, nonce original a Supabase) o módulo gratuito + "Skip nonce check" en Supabase. Decidir antes de Fase 3.
- [OK] Datos sensibles (nombres de contactos, personas de trabajo) viajan en claro sobre TLS y protegidos por RLS. Sin cifrado del lado cliente por ahora.
- [OK] Firma: el release se firma con el keystore de EAS (perfil preview), SHA-256 31:32:DE:…:3E:52, SHA-1 A4:31:C8:…:67:46. Copia local fuera del repo; contraseñas en `%USERPROFILE%\.gradle\gradle.properties`. Nunca borrar ni regenerar ese keystore en EAS. No se cambia de llave hasta cerrar la Fase 5. La SHA-1 es la que se registra en el cliente Android de Google Cloud.

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
- [OK] `cycle_offset` se guarda como valor absoluto, no como incremento (idempotente ante reintentos).
- [OK] Se elimina `checkAndBackfillHistory`; las filas sintéticas ya existentes se conservan tal cual.

## Sincronización
- [OK] Cada escritura local se registra en la tabla `outbox` en la MISMA transacción.
- [OK] Disparadores: apertura de la app, volver a primer plano, recuperar conexión (`@react-native-community/netinfo`) y botón manual. Sin tareas en segundo plano.
- [OK] Orden: primero push de la outbox, luego pull.
- [OK] Push idempotente (upsert por `id`). Nunca incrementos relativos.
- [OK] Pull con cursor sobre `server_updated_at`, asignado por trigger en Postgres (no por el reloj del celular), paginado y con desempate por `id`.
- [OK] Conflictos: último en llegar al servidor gana, por registro. Se refina por entidad en la Fase 4.
- [OK] Reintentos con backoff. La outbox nunca descarta cambios por error.

## Fases
0. Base técnica: verificación de firma del APK, respaldo (copia física .db + JSON) exportable fuera del teléfono, versionado de esquema (`PRAGMA user_version`, línea base aditiva), transacciones, bug de zona horaria, quitar `checkAndBackfillHistory`, corregir docs que piden desinstalar.
1. Capa de datos local: repositorios, UUID, columnas de sync, soft delete, outbox y migración in-place de los datos existentes.
2. Supabase: esquema Postgres, RLS, trigger de `server_updated_at` (archivos SQL).
3. Login con Google: dev build, `signInWithIdToken`, sesión segura. Se retira usuario/contraseña.
4. Sincronización: push/pull, conflictos, estado de sync en la UI.
5. Primer sync de datos existentes y pruebas offline/online.
6. Endurecimiento: revisión de RLS, respaldos, rendimiento (N+1).

## Datos existentes y cuentas
- [OK] Los datos del celular se migran in-place en Fase 1, con respaldo previo verificado.
- [OK] Al inicio de Fase 1, Claude Code cuenta las cuentas locales y se detiene a informar antes de migrar. Si hay una sola, se asocia a la primera cuenta Google (Fase 3).
- [OK] Cuentas locales: el dispositivo tiene 1 cuenta (respaldo 2026-10-20). Se asocia a la primera cuenta Google en Fase 3.
- [OK] Estados de series: `Nueva`, `Mirando`, `Pausado` (los tres cuentan para el límite activo, pestaña Viendo), `En espera`, `Terminado`. Backlog: type `movie|series|anime|reading`, status `Pendiente|Mirando|Terminado`. Se aplican como CHECK en Postgres (Fase 2); localmente se validan en los repositorios.
- [PENDIENTE] Archivo `android.os.Looper` y dependencias `@react-navigation` sin uso: ¿se eliminan?
- [PENDIENTE] Restaurar un respaldo dentro de la app.

## Propuestas nuevas (para aprobar)
- [PROPUESTA] En Fase 1, `user_id` = UUID del usuario local. En Fase 3, al primer login, se reescribe a `auth.uid()` en todas las tablas y en la outbox, en una sola transacción.
- [PROPUESTA] Las filas migradas NO se encolan en la outbox. El primer sync (Fase 5) hace upsert idempotente de todas las filas existentes.
- [PROPUESTA] Las tablas originales se conservan renombradas como `legacy_*` hasta la Fase 6 (rollback sin restaurar respaldo). Se borran solo con aprobación explícita.
- [PROPUESTA] Columnas de sync (`created_at`, `updated_at`, `deleted_at`) en TEXT ISO-8601 UTC `YYYY-MM-DDTHH:MM:SS.sssZ`. Los epoch ms existentes (`watched_at`, `read_at`, `last_watched_at`) se quedan como INTEGER y se convierten a timestamptz en el mapeo de sync.
- [PROPUESTA] `users` es tabla local (no se sincroniza ni pasa por la outbox).
- [PROPUESTA] Variante de desarrollo con package distinto (p. ej. `com.poguis.Registro.dev`) para que el dev build no reemplace la instalación con datos reales.
- [PROPUESTA] La migración de esquema de Fase 1 usa `withExclusiveTransactionAsync`; las operaciones normales de la app usan `withTransactionAsync`.