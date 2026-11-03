# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

Registro is a personal-management mobile app built with Expo/React Native. All data lives in local SQLite and the app works 100% offline. Since Phase 3 it signs in with Google through Supabase Auth. Since Phase 4 the dev variant syncs local data with Supabase Postgres (push of the outbox + pull with a cursor) against a separate project, **Registro Dev**; the production variant has sync OFF until Phase 5. It covers:
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
npm run start:dev       # Metro for the dev variant (APP_VARIANT=development)
npm run build:release   # production APK (see "Building an APK")
npm run build:dev       # dev-variant APK
```

There is no lint, test, or typecheck script configured in `package.json` — do not assume `npm test`/`npm run lint` exist.

Verification scripts (Node 22.5+, use the built-in `node:sqlite`; not bundled into the app; never print row contents):
```bash
node scripts/probar-fase0.mjs                     # migration 1 + backup.js with the real code against node:sqlite (shims in scripts/lib/)
node scripts/probar-fase1.mjs                     # migration 2, every mutation + outbox, session mapping, backup of a v2 DB, grep checks
node scripts/dryrun-fase1.mjs                     # migration 2 on copies of the 4 test DBs (criteria 1–5); --par <antes.db> <despues.db> --etiqueta X for a device pair
node scripts/probar-fase2.mjs                     # applies supabase/migrations/ to a LOCAL in-memory Postgres (PGlite) with an auth stub; RLS, grants, FKs, trigger, CHECKs, upsert, cascade, verificar-fase2.sql, and loads the v2 test/real DBs
node scripts/probar-fase3.mjs                     # migration 3, account linking (fake uid), account flow, encrypted storage, PKCE verifier cleanup, crypto shim, variants/redirect, signing plugin
node scripts/dryrun-fase3.mjs --par <antes.db> <despues.db> [--etiqueta X] [--sin-vincular]   # device pair before/after Phase 3 (counts, uid, password, secure_delete)
node scripts/probar-fase4.mjs                     # sync engine: PGlite with the real migrations + RLS (auth stub) as the server, 2–3 node:sqlite "devices" running the real code; scenarios 1–19 (CRUD, offline, conflicts, natural keys, paging/overlap, network cuts, blocked entries, rounding, prod flag, watchdog, reconnect retry, auto-sync triggers, screen-refresh notice). Several minutes; run it ALONE (CPU contention with a Gradle build makes scenario 6 exceed its 180 s cap)
node scripts/verificar-secretos.mjs [--apk <apk>]  # no secrets in repo/APK, .env ignored, prod and dev keys/projects differ; with --apk: the APK has only its variant's project and key (never the other's) and the release has syncEnabled false
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

Local build (no EAS credits), one command per variant (`scripts/build-apk.mjs`):
```bash
npm run build:release   # com.poguis.Registro, signed with the EAS keystore → .local-data/apk/registro-release-<version>-vc<code>-<commit>[-mod-<stamp>].apk
npm run build:dev       # com.poguis.Registro.dev, release-mode (embedded JS) signed with debug.keystore (fac61745…) → .local-data/apk/registro-dev-<version>-vc<code>-<commit>[-mod-<stamp>].apk
```
Each one: stops the Gradle daemon (on Windows it locks `android/app/build` and `--clean` fails with EBUSY), runs `npx expo prebuild -p android --clean` with the variant, ensures `sdk.dir`, runs `gradlew assembleRelease` with JDK 17, copies the APK to `.local-data/apk/`, prints applicationId, versionName/versionCode (aapt2) and the certificate SHA-256 (apksigner), and runs `verificar-secretos --apk`. **The production build fails if the fingerprint is not `3132ded2…3e52`: do not install it.** `-mod-<stamp>` means the working tree had uncommitted changes. Needs `.env` (see `.env.example`): `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (production project) and `EXPO_PUBLIC_SUPABASE_DEV_URL` / `EXPO_PUBLIC_SUPABASE_DEV_PUBLISHABLE_KEY` (Registro Dev); publishable keys only, never a secret/service_role key. Step-by-step guide: `.agent/workflows/build-apk-windows.md`. `android/` is generated and git-ignored: never edit it by hand (a copy of the pre-Phase-3 folder is in `.local-data/android-respaldo-fase2/`).

Variants (`app.config.js`, `APP_VARIANT`; `app.json` keeps the static values): production `com.poguis.Registro` / "Registro" / scheme `poguis-registro`; development (`APP_VARIANT=development`) `com.poguis.Registro.dev` / "Registro Dev" / scheme `poguis-registro-dev`. They install side by side, each with its own DB. `app.config.js` puts ONLY the variant's project in `extra.supabase = { url, key }` (the app never reads `process.env`) and `extra.syncEnabled` (`false` in production, `true` only in dev), so a release APK never contains Registro Dev and vice versa. Current version: `versionName` 1.2.0, `versionCode` 3 (in `app.json`; bump both for every APK that will be installed). Never uninstall: schema changes go as versioned migrations; install on top (`install -r`) with the same keystore, after checking the fingerprint with `apksigner verify --print-certs`.

Gradle 8.14.3 does not run on Java 25 (the JBR bundled with current Android Studio): build with JDK 17 (`JAVA_HOME="C:\Program Files\Microsoft\jdk-17.0.20.101-hotspot"`). `android/local.properties` must have `sdk.dir` (SDK at `D:\Users\Carlos\AppData\Local\Android\Sdk`). Modules autolink in each `prebuild`.

Firma (ver DECISIONES.md, Seguridad): el release se firma con el keystore de EAS (perfil preview), SHA-256 `31:32:DE:…:3E:52`, el mismo del APK instalado en el celular. El config plugin `plugins/withReleaseSigning.js` escribe la firma en `android/app/build.gradle` en cada `prebuild` (modo `eas` en producción; modo `debug` solo en la variante dev), que lee 4 propiedades de `%USERPROFILE%\.gradle\gradle.properties` (fuera del repo): `REGISTRO_UPLOAD_STORE_FILE`, `REGISTRO_UPLOAD_STORE_PASSWORD`, `REGISTRO_UPLOAD_KEY_ALIAS`, `REGISTRO_UPLOAD_KEY_PASSWORD`. Si falta alguna, o el archivo del keystore no existe, cualquier tarea release falla con un mensaje claro: nunca cae al `debug.keystore`. Las tareas debug siguen firmando con `debug.keystore`. Nunca leer, mostrar ni copiar esas contraseñas, ni borrar o regenerar el keystore en EAS.

Pruebas de actualización con datos: AVD `Registro_GoogleAPIs_36` (imagen Google APIs, permite `adb root`). Usar siempre `adb -s emulator-5554`; el celular solo lo maneja el usuario.

## Supabase (`supabase/`)

- `supabase/migrations/<YYYYMMDDHHMMSS>_<nombre>.sql`: the Postgres schema (Phase 2). Four files: the `set_server_updated_at` function, the 15 synced tables, indexes + triggers, and RLS + grants. Each file runs in `begin; … commit;`.
- `supabase/verificar-fase2.sql`: read-only check that returns 22 rows (`chequeo | valor | esperado | ok`); all must be `ok = true`. It is not a migration.
- **The user applies the SQL by hand in the Supabase SQL Editor** (guide: `docs/SUPABASE-FASE2.md`). Claude Code only writes the files and tests them locally with `scripts/probar-fase2.mjs` (PGlite, devDependency `@electric-sql/pglite`; the auth stub `scripts/lib/pg-auth-stub.sql` is test-only and never goes into `migrations/`). Never run anything against the remote project.
- Schema changes after Phase 2 = a NEW migration file, never edits to applied ones.
- Column mapping SQLite ↔ Postgres (types, rounding money to cents half-away-from-zero, `last_watched_at` 0 ↔ NULL, JSON shapes, server-only `server_updated_at`, cursor risk): `docs/MAPEO-SYNC.md`; implemented in `src/sync/mapping.ts` (`toRemote`, `fromRemote`, `roundMoneyColumns`, `NATURAL_KEYS`, `TABLES` in dependency order), which the test scripts import directly.
- Projects: production (`apftkztkqvjpvdmeixzw`, used by the release; receives NO writes until Phase 5) and **Registro Dev** (same 4 migrations, Google provider, redirect `poguis-registro-dev://auth/callback`; used by the dev variant and all sync tests). The dev redirect is not in production's Redirect URLs.
- Server rules: RLS on all 15 tables; policies `to authenticated` for select/insert/update with `(select auth.uid()) = user_id`; no DELETE (soft delete). Grants: `authenticated` select/insert/update only, nothing to `anon`/`public`. Composite FKs `(parent_id, user_id)`; `user_id` → `auth.users` on delete cascade. No `security definer` functions.

## Architecture

There is no router/navigation library despite `@react-navigation` being a dependency — navigation is a hand-rolled state machine.

- **Entry point**: `index.js` → `App.js`.
- **Navigation**: `App.js` holds `currentView` (a string like `HOME`, `DINERO`, `SERIES_DETAIL`, ...) plus a `navigationHistory` stack in local state. A big `switch` in the render body maps `currentView` to a screen component. `handleNavigate(view)` pushes onto history; `handleBack()` (also wired to the Android hardware back button) pops it, or exits the app / shows a confirm dialog when the history is empty at `HOME`. When adding a new screen: add a `case` in the `App.js` switch, plus calls to `onNavigate('NEW_VIEW')` from wherever it should be reachable, and pass `onBack` through.
- **Auth** (Phase 3, `src/auth/`; the UI never imports supabase-js): Google login with Supabase OAuth + PKCE. `googleAuth.ts`: `signInWithOAuth({ provider: 'google', options: { redirectTo, skipBrowserRedirect: true } })` → `WebBrowser.openAuthSessionAsync` (Chrome Custom Tabs) → `exchangeCodeForSession(code)`; the redirect is EXACTLY `<scheme>://auth/callback` (`redirect.ts`; it must match Supabase's Redirect URLs or Supabase falls back to the Site URL). Hermes has no `crypto`: `cryptoShim.ts` provides `getRandomValues` + SHA-256 via `expo-crypto` so auth-js uses `S256` (otherwise Math.random + `plain`). Client (`supabase.ts`): Project URL + publishable key from `Constants.expoConfig.extra.supabase` (the variant's project, see Variants), `flowType: 'pkce'`, `detectSessionInUrl: false`, `autoRefreshToken` started/stopped with `AppState`; if the env vars are missing the login shows an error but the app still opens local data. Session storage: `LargeSecureStore` (`secureStorage.ts`, Supabase's official Expo pattern): a new AES-256 key per write in `expo-secure-store` (excluded from Android Auto Backup) and the session AES-CTR-encrypted in AsyncStorage; leftover PKCE verifiers are deleted after every attempt. `accountFlow.ts`: the startup identity comes from the local `users` table, never from the network, so with local data the app ALWAYS opens (offline, expired token or signed out); only an install without data shows "Continuar con Google". Unlinked data shows a non-blocking "Vincula tu cuenta de Google". Linking (`src/data/db/linkAccount.ts`) is a one-time operation (physical copy + exclusive transaction) that rewrites `users.id` and `user_id` in the 15 tables to `auth.uid()`, removes `@user_session` and enqueues nothing, after a confirmation screen showing the Google email (`LinkAccountScreen`). One Google account per device: another account, or several local accounts, is blocked without changes. "Cerrar sesión" signs out of Google only (data kept, app stays open). `RlsTestScreen` / `rlsProbe.ts` exist only in the dev variant. Testing notes: the first time, Chrome may show its welcome screen; if the login ends at `localhost`, close the tab and retry. While the Google consent screen is in "Testing", Google shows "Google no verificó esta app" → Continuar.
- **Screens**: `src/screens/*.js` — one file per screen, receiving `user`, `onBack`, and sometimes `onNavigate`/`category` as props from `App.js`. Detail flows (e.g. Series → SeriesDetail → ChapterRegistry, or Reading → ReadingDetail → ReadingRegistry) pass a `selectedCategory` object down through `App.js` state rather than through navigation params.
- **Sync** (Phase 4, `src/sync/`, TypeScript; the UI only uses `useSync` / `useSyncRefresh` and never imports the engine or supabase-js):
  - `engine.ts`: `syncOnce` = checks (sync enabled, linked account, `users.id` = session uid, valid session; otherwise `skipped` with a reason) → **push** of the outbox (snapshot of ready entries, grouped by row, current row state mapped with `toRemote`, upsert by `id` in batches of 100 in parent → child order; confirmed outbox ids deleted) → **pull** of the 15 tables (pages of 500 ordered by `server_updated_at, id`, cursor per table in `sync_state` stored exactly as returned, 60 s overlap window; rows with a pending/blocked outbox entry or identical content are skipped) → `sync_meta`. Errors: network/timeout/408/429/5xx → backoff `min(30 s·2^attempts, 1 h)` tagged `red · `; auth (401/JWT) → stop without blaming entries; 23505 → natural-key merge (`finance_categories(user_id, name)`, `seasons(series_id, season_number)`: the local row adopts the server id); 23503 → enqueue the parent; anything else → `blocked_at`/`block_reason` (shown in the UI, "Reintentar" = `unblockAll`), never deleted. Last write to reach the server wins. `syncWithWatchdog`: a cycle over 2 min is failed and cancelled cooperatively. `supabaseTransport.ts` implements `transport.ts` (fetch with a per-request timeout); tests use `scripts/lib/pglite-transport.mjs`.
  - `runner.ts`: single-flight (one sync at a time; requests during a run merge into ONE extra run). Reasons `reconexion` and `boton` first reset the backoff of network-tagged entries (`resetNetworkBackoff`). After each cycle, if the sync wrote local data (pull applied rows or a merged id: `takeLocalDataChanged`), it calls `onDataChanged`.
  - Triggers, registered only in `controller.ts` `startSyncTriggers` (App.js; no-op when sync is disabled): app open, AppState → `active`, NetInfo `isConnected` false → true, the "Sincronizar ahora" button, and `autoSync.ts`: after every local transaction that enqueued outbox entries (`setOutboxCommitListener` in `connection.ts`; the engine writes the outbox outside `tx()`, so it never triggers itself) a cycle with a 3 s debounce, only when connected; and a periodic cycle every 2 min only in the foreground and connected, scheduled after the previous one ends and skipped while a sync runs. No background tasks. Timings in `config.ts` (`changeDebounceMs`, `periodicMs`).
  - UI: `SyncStatus.js` on Home (only when `syncEnabled`) shows synced / syncing / offline with N pending / sign in / N errors with detail and "Reintentar". Screens that show data call `useSyncRefresh(reload)`: when a cycle changed local data they re-read the DB without resetting forms, filters or scroll (Registros reloads silently, without the loading spinner). New data screens must do the same.
  - Migration 4 (`src/data/db/migration4.ts`, current `user_version` 4): `outbox.blocked_at` / `block_reason` + index, `sync_state`, `sync_meta`; no data changes.
  - Testing: `probar-fase4` on the PC; on devices, only the dev variant against Registro Dev (emulator `-s emulator-5554` + the user's phone with Registro Dev installed next to the real app). The release (production) must keep `syncEnabled: false` until Phase 5.
- **Theming**: `src/contexts/ThemeContext.js` exposes a `ThemeProvider`/`useTheme()` context wrapping the whole app. `colors.light` / `colors.dark` define the palette; the active theme follows the system color scheme by default but can be toggled and is persisted to `AsyncStorage` (`app_theme`). Screens read `const { theme, isDarkMode, toggleTheme } = useTheme()` and style against `theme.*` tokens rather than hardcoding colors.
- **Data layer** (Phase 1): `src/services/db.js` is a **facade** — the `DatabaseService` singleton keeps the same method names and return shapes the screens already use (raw rows, or `{ success, error }` for mutations), and delegates to per-feature repositories in TypeScript under `src/data/`. Screens still call `db.<method>(...)` directly; methods lazily call `this.init()` if needed. New data logic goes in a repository, not in `db.js`.
  - `src/data/repositories/`: `money`, `debts`, `users`, `services`, `cards`, `backlog`, `work`, `entertainment`, `series`, `history`, plus `rows.ts` (`insertRow`, `updateRow`, `reviveRow`, `softDelete`, `softDeleteWhere`). Every domain write goes through `rows.ts`, which sets the sync columns and calls `enqueueChange` (`src/data/outbox/outbox.ts`) in the same transaction. IDs come from `newId()` (`src/data/ids.ts`, UUID v4 via `expo-crypto`), timestamps from `nowIso()` (`src/data/clock.ts`).
  - **Sync columns**: every domain table has `id TEXT` (UUID), `user_id`, `created_at`, `updated_at`, `deleted_at` (ISO-8601 UTC). Deletion is always logical (`deleted_at`), with logical cascade (category → series → seasons/history/pauses/quotas). **Every read filters `deleted_at IS NULL`.** No `DELETE FROM` or `lastInsertRowId` outside migrations (`probar-fase1` greps for it).
  - **Outbox**: one row per changed record (`table_name`, `row_id`, `op`), deduplicated per transaction, no snapshot. Rows migrated from the old schema are not enqueued (the first sync upserts everything, Phase 5).
  - **Balance** = `SUM(balance_history.amount)` of non-deleted rows; `current_balance` is no longer read or written. A manual balance edit (`adjustBalanceTo`) creates an "Ajuste" movement for the difference.
  - **Schema / migrations** (`src/services/migrations.js`): `init()` opens `app_registro_v3.db` (name in `dbConfig.js`, never change it), sets `PRAGMA foreign_keys = ON`, and runs pending migrations by `PRAGMA user_version`. Each migration runs in `withExclusiveTransactionAsync` and bumps `user_version` only on success; migrations with `requiresBackup` (all ≥ 2) make a physical copy (`VACUUM INTO`) first and abort if it fails. Migration 1 is the additive baseline (16 `CREATE TABLE IF NOT EXISTS` + missing columns). Migration 2 (`src/data/db/migration2.ts`) renames the 16 old tables to `legacy_*` (kept until Phase 6, never written by the app), creates the new UUID tables, maps old integer ids through `_id_map`, copies the data, adds an "Ajuste" balance row if the stored balance ≠ SUM, verifies counts in the transaction and writes a summary to `_migration_log` (App.js shows it once, only if there was data). Migration 3 (`src/data/db/migration3.ts`) rebuilds `users` without `password` (with `email`, `linked_at`; no `UNIQUE(username)`), empties `legacy_users.password` and uses `PRAGMA secure_delete` so the old text is not left in the file. Migration 4: see Sync. New schema changes = a new entry in `MIGRATIONS`, never edits to existing migrations. After applying a migration `init()` reopens the connection and checks `user_version` and the schema; on any failure it returns `false` with `db.lastInitError` and `App.js` shows only `DatabaseErrorScreen` (backup + retry).
  - **Write queue / transactions** (`src/data/db/connection.ts`): `enqueue` serializes all app writes; `tx` wraps them in `withTransactionAsync` (not exclusive); `mutate = enqueue(tx(...))`. Every mutation in `QUEUED_MUTATIONS` (= `TX_MUTATIONS`) is transactional: row + outbox commit together. A queued mutation must never call another queued mutation (deadlock): reuse logic via repository functions that run inside the current `tx`. A money movement is a single call, `registerMoneyMovement` (debt/loan + `balance_history`). `DEV_FAIL_TX` / `DEV_FAIL_MIGRATION` / `DEV_FAIL_LINK` in `devFlags.js` simulate failures (only in `__DEV__`; leave them `false`).
  - **Backup** (`src/services/backup.js`): read-only, opens its own connection (no `init()`/migrations, so it works from the error screen). Writes `files/SQLite/respaldos/registro_respaldo_<stamp>.db` (`VACUUM INTO`, keeps everything including old passwords; if the name already exists a `-2`, `-3`… suffix is added) and `.json` (all tables incl. `legacy_*` + `meta`; **every `password` column in any table** replaced by `[OCULTO]`; `validar-respaldo.mjs` fails otherwise), then opens the Android share sheet for each file. Button "Respaldar datos" on `HomeScreen`.
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

**Phase 3 is CLOSED (2026-11-01)**: Google login (OAuth + PKCE, S256), encrypted session, migration 3, account linking, variants and the signing config plugin. Verified on the emulator (dev and release: login, persistent session, airplane mode with embedded JS before and after linking, sign-out keeps data, 0 tokens in clear in app storage, PKCE verifiers cleaned) and on the user's phone: `install -r` of the EAS-signed APK 1.2.0 (`versionCode` 3) over 1.1.0, no uninstall; opened in airplane mode before and after linking; linking confirmed with the Google email; backups before (v2) and after (v3) valid; `dryrun-fase3 --par` OK. "Another Google account is blocked" is covered only by `probar-fase3` (the user has one account). From the Phase 2 list, items 1–3 are now verified against real Supabase with the dev variant's RLS test (real JWT and Data API: read 200, insert 201, update 200, insert with another `user_id` → 403 / 42501, DELETE → 403 / 42501); items 4–8 remain open. The RLS test left a `[prueba RLS]` tombstone row in the server's `backlog`. First-login diagnosis: an attempt that took ~20 min (Chrome welcome screen) fell back to the Site URL (`localhost`), most likely because the OAuth `state` expired; retrying works.

**Phase 4 is CLOSED (2026-11-02)**: sync engine (push/pull, conflicts, natural-key merge, money rounding at write time), migration 4, sync status UI, automatic triggers (after each change and every 2 min), reconnect retry and screen refresh, all against **Registro Dev**; production received no writes (its APK has sync off and was not updated). Verified with `probar-fase4` (scenarios 1–19) plus all previous suites, on the emulator, and between the emulator and the user's phone (Registro Dev installed next to the real app, which stayed untouched: `versionCode` 3, `firstInstallTime` 2026-09-21): 6 default categories, create/edit/delete both ways, airplane mode and automatic reconnect, same balance, conflict won by the last write, changes arriving on their own. Screen refresh verified on the emulator. Credentials of both projects (secret keys, DB passwords, Google Client secret) were rotated by the user. Still open from the Phase 2 list: items 4–8. The first real sync of the existing phone data is Phase 5.

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