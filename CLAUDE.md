# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

Registro is a personal-management mobile app built with Expo/React Native. The app is still 100% local (SQLite): a Supabase Postgres schema exists since Phase 2 (`supabase/`), but the app does not connect to it until the sync phases. It covers:
- Finances / balance tracking, debts & loans
- Series/Anime/Reading tracking with quota-based backlog calculations
- Backlog (pending items)
- Work (`Trabajo`), Services (`Servicios`), Cards (`Cards`)

The UI and comments are in Spanish; keep new user-facing strings and comments consistent with that.

## Commands

```bash
npm install          # install dependencies
npx expo start        # run dev server (Expo Go / web / emulator)
npm run android        # expo run:android
npm run ios            # expo run:ios
npm run web             # expo start --web
```

There is no lint, test, or typecheck script configured in `package.json` — do not assume `npm test`/`npm run lint` exist.

Verification scripts (Node 22.5+, use the built-in `node:sqlite`; not bundled into the app; never print row contents):
```bash
node scripts/probar-fase0.mjs                     # migration 1 + backup.js with the real code against node:sqlite (shims in scripts/lib/)
node scripts/probar-fase1.mjs                     # migration 2, every mutation + outbox, session mapping, backup of a v2 DB, grep checks
node scripts/dryrun-fase1.mjs                     # migration 2 on copies of the 4 test DBs (criteria 1–5); --par <antes.db> <despues.db> --etiqueta X for a device pair
node scripts/probar-fase2.mjs                     # applies supabase/migrations/ to a LOCAL in-memory Postgres (PGlite) with an auth stub; RLS, grants, FKs, trigger, CHECKs, upsert, cascade, verificar-fase2.sql, and loads the v2 test/real DBs
node scripts/test-date-range.mjs                  # needs TZ=America/Guayaquil (PowerShell: $env:TZ='America/Guayaquil')
node scripts/validar-respaldo.mjs <respaldo.json> --db <copia.db>   # validates an in-app backup and loads it into .local-data/
node scripts/comparar-bd.mjs <antes.db> <despues.db>                # counts, content hashes, sqlite_master, user_version
```
Real user data (backups, pulled DBs, APKs) lives only in `.local-data/` (git-ignored).

### Building an APK

Cloud build (uses EAS credits):
```bash
npm install -g eas-cli
set EAS_NO_VCS=1 && eas build --profile preview --platform android
```

Local build (no EAS credits), see `.agent/workflows/build-apk-windows.md` for the full checklist (verifying `android/local.properties`, `settings.gradle` autolinking, `ndkVersion` in `android/app/build.gradle`):

⚠️ Antes de `npx expo prebuild` o de regenerar `android/`: el `signingConfig release` vive en `android/app/build.gradle`, que git ignora, y `prebuild` lo pierde. Hay que reaplicarlo después (pendiente: moverlo a un config plugin). Después de cada build, comparar el certificado del APK nuevo con el instalado usando `apksigner verify --print-certs`. Si no coincide, NO instalar ni desinstalar.
```bash
npx expo prebuild -p android
cd android
./gradlew assembleDebug        # or assembleRelease
```
Output APK: `android/app/build/outputs/apk/release/app-release.apk` (or `debug/`). Versión actual: `versionName` 1.1.0, `versionCode` 2 (en `app.json` y en `android/app/build.gradle`; subir ambos en cada APK que se instale). Nunca desinstalar: los cambios de esquema van como migración versionada; instalar encima con el mismo keystore.

Gradle 8.14.3 does not run on Java 25 (the JBR bundled with current Android Studio): build with JDK 17 (`JAVA_HOME="C:\Program Files\Microsoft\jdk-17.0.20.101-hotspot"`). `android/local.properties` must have `sdk.dir` (SDK at `D:\Users\Carlos\AppData\Local\Android\Sdk`). `android/` already exists locally, so new Expo modules autolink without `prebuild`.

Firma (ver DECISIONES.md, Seguridad): el release se firma con el keystore de EAS (perfil preview), SHA-256 `31:32:DE:…:3E:52`, el mismo del APK instalado en el celular. `android/app/build.gradle` lee 4 propiedades de `%USERPROFILE%\.gradle\gradle.properties` (fuera del repo): `REGISTRO_UPLOAD_STORE_FILE`, `REGISTRO_UPLOAD_STORE_PASSWORD`, `REGISTRO_UPLOAD_KEY_ALIAS`, `REGISTRO_UPLOAD_KEY_PASSWORD`. Si falta alguna, o el archivo del keystore no existe, cualquier tarea release falla con un mensaje claro: nunca cae al `debug.keystore`. Las tareas debug siguen firmando con `debug.keystore`. Nunca leer, mostrar ni copiar esas contraseñas, ni borrar o regenerar el keystore en EAS.

Pruebas de actualización con datos: AVD `Registro_GoogleAPIs_36` (imagen Google APIs, permite `adb root`). Usar siempre `adb -s emulator-5554`; el celular solo lo maneja el usuario.

## Supabase (`supabase/`)

- `supabase/migrations/<YYYYMMDDHHMMSS>_<nombre>.sql`: the Postgres schema (Phase 2). Four files: the `set_server_updated_at` function, the 15 synced tables, indexes + triggers, and RLS + grants. Each file runs in `begin; … commit;`.
- `supabase/verificar-fase2.sql`: read-only check that returns 22 rows (`chequeo | valor | esperado | ok`); all must be `ok = true`. It is not a migration.
- **The user applies the SQL by hand in the Supabase SQL Editor** (guide: `docs/SUPABASE-FASE2.md`). Claude Code only writes the files and tests them locally with `scripts/probar-fase2.mjs` (PGlite, devDependency `@electric-sql/pglite`; the auth stub `scripts/lib/pg-auth-stub.sql` is test-only and never goes into `migrations/`). Never run anything against the remote project.
- Schema changes after Phase 2 = a NEW migration file, never edits to applied ones.
- Column mapping SQLite ↔ Postgres (types, rounding money to cents half-away-from-zero, `last_watched_at` 0 ↔ NULL, JSON shapes, server-only `server_updated_at`, cursor risk): `docs/MAPEO-SYNC.md`; executable prototype in `scripts/lib/mapeo-sync.mjs`.
- Server rules: RLS on all 15 tables; policies `to authenticated` for select/insert/update with `(select auth.uid()) = user_id`; no DELETE (soft delete). Grants: `authenticated` select/insert/update only, nothing to `anon`/`public`. Composite FKs `(parent_id, user_id)`; `user_id` → `auth.users` on delete cascade. No `security definer` functions.

## Architecture

There is no router/navigation library despite `@react-navigation` being a dependency — navigation is a hand-rolled state machine.

- **Entry point**: `index.js` → `App.js`.
- **Navigation**: `App.js` holds `currentView` (a string like `HOME`, `DINERO`, `SERIES_DETAIL`, ...) plus a `navigationHistory` stack in local state. A big `switch` in the render body maps `currentView` to a screen component. `handleNavigate(view)` pushes onto history; `handleBack()` (also wired to the Android hardware back button) pops it, or exits the app / shows a confirm dialog when the history is empty at `HOME`. When adding a new screen: add a `case` in the `App.js` switch, plus calls to `onNavigate('NEW_VIEW')` from wherever it should be reachable, and pass `onBack` through.
- **Auth**: `LoginScreen` calls `db.loginUser`/`db.registerUser` (plaintext-password lookup — no hashing; Google login replaces it in Phase 3). `loginUser` returns only `{ id, username }`, and that is all `App.js` stores in `AsyncStorage` under `@user_session` (`toSession`). On start, `App.js` restores it through `db.resolveSessionUser`: an old numeric id is mapped to its UUID via `_id_map` and the session is rewritten; if it cannot be mapped, the session is closed.
- **Screens**: `src/screens/*.js` — one file per screen, receiving `user`, `onBack`, and sometimes `onNavigate`/`category` as props from `App.js`. Detail flows (e.g. Series → SeriesDetail → ChapterRegistry, or Reading → ReadingDetail → ReadingRegistry) pass a `selectedCategory` object down through `App.js` state rather than through navigation params.
- **Theming**: `src/contexts/ThemeContext.js` exposes a `ThemeProvider`/`useTheme()` context wrapping the whole app. `colors.light` / `colors.dark` define the palette; the active theme follows the system color scheme by default but can be toggled and is persisted to `AsyncStorage` (`app_theme`). Screens read `const { theme, isDarkMode, toggleTheme } = useTheme()` and style against `theme.*` tokens rather than hardcoding colors.
- **Data layer** (Phase 1): `src/services/db.js` is a **facade** — the `DatabaseService` singleton keeps the same method names and return shapes the screens already use (raw rows, or `{ success, error }` for mutations), and delegates to per-feature repositories in TypeScript under `src/data/`. Screens still call `db.<method>(...)` directly; methods lazily call `this.init()` if needed. New data logic goes in a repository, not in `db.js`.
  - `src/data/repositories/`: `money`, `debts`, `users`, `services`, `cards`, `backlog`, `work`, `entertainment`, `series`, `history`, plus `rows.ts` (`insertRow`, `updateRow`, `reviveRow`, `softDelete`, `softDeleteWhere`). Every domain write goes through `rows.ts`, which sets the sync columns and calls `enqueueChange` (`src/data/outbox/outbox.ts`) in the same transaction. IDs come from `newId()` (`src/data/ids.ts`, UUID v4 via `expo-crypto`), timestamps from `nowIso()` (`src/data/clock.ts`).
  - **Sync columns**: every domain table has `id TEXT` (UUID), `user_id`, `created_at`, `updated_at`, `deleted_at` (ISO-8601 UTC). Deletion is always logical (`deleted_at`), with logical cascade (category → series → seasons/history/pauses/quotas). **Every read filters `deleted_at IS NULL`.** No `DELETE FROM` or `lastInsertRowId` outside migrations (`probar-fase1` greps for it).
  - **Outbox**: one row per changed record (`table_name`, `row_id`, `op`), deduplicated per transaction, no snapshot. Rows migrated from the old schema are not enqueued (the first sync upserts everything, Phase 5).
  - **Balance** = `SUM(balance_history.amount)` of non-deleted rows; `current_balance` is no longer read or written. A manual balance edit (`adjustBalanceTo`) creates an "Ajuste" movement for the difference.
  - **Schema / migrations** (`src/services/migrations.js`): `init()` opens `app_registro_v3.db` (name in `dbConfig.js`, never change it), sets `PRAGMA foreign_keys = ON`, and runs pending migrations by `PRAGMA user_version`. Each migration runs in `withExclusiveTransactionAsync` and bumps `user_version` only on success; migrations with `requiresBackup` (all ≥ 2) make a physical copy (`VACUUM INTO`) first and abort if it fails. Migration 1 is the additive baseline (16 `CREATE TABLE IF NOT EXISTS` + missing columns). Migration 2 (`src/data/db/migration2.ts`, current `user_version` 2) renames the 16 old tables to `legacy_*` (kept until Phase 6, never written by the app), creates the new UUID tables, maps old integer ids through `_id_map`, copies the data, adds an "Ajuste" balance row if the stored balance ≠ SUM, verifies counts in the transaction and writes a summary to `_migration_log` (App.js shows it once). New schema changes = a new entry in `MIGRATIONS`, never edits to existing migrations. After applying a migration `init()` reopens the connection and checks `user_version` and the schema; on any failure it returns `false` with `db.lastInitError` and `App.js` shows only `DatabaseErrorScreen` (backup + retry).
  - **Write queue / transactions** (`src/data/db/connection.ts`): `enqueue` serializes all app writes; `tx` wraps them in `withTransactionAsync` (not exclusive); `mutate = enqueue(tx(...))`. Every mutation in `QUEUED_MUTATIONS` (= `TX_MUTATIONS`) is transactional: row + outbox commit together. A queued mutation must never call another queued mutation (deadlock): reuse logic via repository functions that run inside the current `tx`. A money movement is a single call, `registerMoneyMovement` (debt/loan + `balance_history`). `DEV_FAIL_TX` / `DEV_FAIL_MIGRATION` in `devFlags.js` simulate failures (only in `__DEV__`; leave them `false`).
  - **Backup** (`src/services/backup.js`): read-only, opens its own connection (no `init()`/migrations, so it works from the error screen). Writes `files/SQLite/respaldos/registro_respaldo_<stamp>.db` (`VACUUM INTO`, keeps everything including passwords) and `.json` (all tables incl. `legacy_*` + `meta`; **every `password` column in any table** replaced by `[OCULTO]`; `validar-respaldo.mjs` fails otherwise), then opens the Android share sheet for each file. Button "Respaldar datos" on `HomeScreen`.
- **Backlog quota math**: `src/services/backlogUtils.js` contains pure functions (`getQuotasForDate`, `calculateBacklog`, `isDatePaused`, `getLocalDateString`) used to compute how far behind/ahead a series or reading category is, based on `start_date`, `days_of_week`/`frequency`, pause ranges, and a `quotas_history` override table (JSON-encoded per-day quotas that can change over time). When quota/pause logic needs changes, this is the file to touch — keep it framework-free (no React/SQLite imports) so it stays independently testable.
- Dates are compared as local `YYYY-MM-DD` strings (`getLocalDateString`), not JS `Date` objects or UTC, to avoid timezone drift — follow this convention for any new date comparisons.
- Exception: `created_at`/`updated_at`/`deleted_at` are ISO-8601 UTC (`YYYY-MM-DDTHH:MM:SS.sssZ`, written by `nowIso()`). `src/services/dateRange.js` is the single conversion point: `getUtcRange` turns local days into UTC bounds (Dinero, Estadísticas), and `parseDbTimestamp` parses a stored timestamp (ISO, or the old `YYYY-MM-DD HH:MM:SS` still present in `legacy_*`).

## Notes on history

An earlier MVC-style layer (`src/views`, `src/controllers`, `src/database`, `src/models`) was removed because it was never wired into the actual app flow. If MVC is reintroduced, do it as a new module and migrate off `src/services/db.js` gradually rather than reviving the old files.

Before Phase 0, big schema changes were done by renaming the `.db` file (losing data) and asking to uninstall the APK; that is now forbidden. **Phase 0 is CLOSED (2026-10-20)**: verified on the user's phone (`install -r` of the EAS-signed APK over the existing install, no uninstall; real backup validated: SQLite 3.50.3, `user_version` 1, 16 tables, 0 FK violations, 1 local account). Phase 0 replaced the start-up `ALTER TABLE` list with swallowed errors by the versioned migrations above, removed `checkAndBackfillHistory` (the synthetic `watch_history` rows it created are kept as they are), and fixed the UTC/local filter bug in Dinero/Estadísticas.

**Phase 1 is CLOSED (2026-10-25)**: repositories in `src/data/`, `db.js` as facade, UUIDs, sync columns, soft delete, outbox and migration 2 (in-place, with `legacy_*` kept). Verified on the user's phone: `install -r` of the EAS-signed APK 1.1.0 (`versionCode` 2) over the existing install, no uninstall; the app showed the migration summary with identical counts and no balance adjustment; backups before and after validated (after: `user_version` 2, `users` and `legacy_users` passwords hidden in the JSON); `dryrun-fase1 --par` criteria 1–5 OK. A first phone backup made with an earlier 1.1.0 build exposed `legacy_users.password` in the JSON; it was deleted by the user and the fix (mask every `password` column) shipped before closing. Still pending: Google login (Phase 3).

**Phase 2 is CLOSED (2026-10-27)**: Postgres schema for the 15 synced tables (`users`, `outbox`, `_id_map`, `_migration_log` and `legacy_*` stay local), RLS, explicit grants and the `server_updated_at` trigger, as SQL files only. Tested on a local Postgres (PGlite) with `scripts/probar-fase2.mjs`, including loading 232/232 rows from the real and test v2 DBs. The user applied the 4 migrations in the SQL Editor of a new Free project ("Automatically expose new tables" off, Data API on; on file 2 the editor offered "Run and enable RLS", which only enables RLS earlier) and `verificar-fase2.sql` gave 22/22 ok. The app is not connected yet.

Still to verify against real Supabase in Phase 3 (PGlite cannot test them):
1. The real JWT: who issues and signs it, expiry and claims (`role`, `aud`, `sub`), and the Data API switching role from it.
2. The Data API: upsert with `onConflict`, how numbers/JSON/timestamps are serialized and returned, and how RLS errors map to HTTP codes.
3. The platform's real default privileges (the stub simulated the worst case; `verificar-fase2.sql` checked the result).
4. The real `auth.users` table and `on delete cascade` when deleting an account from the dashboard.
5. Version and role: PGlite is Postgres 18 and ran as superuser; Supabase runs 15–17 and the SQL Editor runs as `postgres`.
6. `service_role` (not used by the app).
7. Real concurrency (out-of-order commits vs. the pull cursor) and RLS performance with many rows.
8. The Security Advisor result.

## Migración offline-first (reglas vigentes)
Leer DECISIONES.md y docs/AUDITORIA.md antes de cambiar código. Usar plan mode y esperar aprobación. Las secciones de arriba que dicen "sin backend", "login con contraseña" o "db.js único" describen el estado ANTERIOR; actualizarlas al cerrar cada fase.

- La app debe funcionar 100% sin internet. Lectura y escritura siempre contra SQLite local.
- Toda tabla sincronizable: id (UUID v4 cliente), user_id, created_at, updated_at, deleted_at.
- Borrado siempre lógico. Cada cambio local se registra en `outbox` dentro de la misma transacción.
- Operaciones de varios pasos en `withTransactionAsync`.
- Cambios de esquema local solo con migraciones versionadas (`PRAGMA user_version`). Prohibido renombrar el `.db` o borrar datos.
- Tokens solo en almacenamiento seguro. Nunca credenciales ni `service_role` en el repo.
- Al cerrar cada fase: `npx expo-doctor`, `npx expo export --platform android` y verificación manual; listar qué se verificó. No existen scripts de lint/test: no asumirlos.

## Git (estricto)
- Trabajar siempre en `main`. No crear ni cambiar de rama.
- NUNCA `git push` (ni `--force`), ni tocar remotos.
- NUNCA `git merge`, `git rebase`, `git reset --hard`, `git clean`, `git checkout -- <ruta>` ni `git stash drop`.
- No commitear salvo que el usuario lo pida. No PRs, no `gh`.

## Supabase (estricto)
- NUNCA ejecutar comandos contra el proyecto remoto. Solo generar SQL en `supabase/migrations/`.
- Solo la clave publishable en `.env` (`EXPO_PUBLIC_*`); `.env` en `.gitignore`.

Si una tarea requiere algo de lo prohibido, detenerse y preguntar.