# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

Registro is a personal-management mobile app built with Expo/React Native (no backend — everything is local). It covers:
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
node scripts/probar-fase0.mjs                     # runs the real migrations.js/db.js/backup.js against node:sqlite (shims in scripts/lib/)
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

⚠️ Antes de `npx expo prebuild` o de regenerar `android/`: respaldar el keystore que firma el release (hoy `android/app/debug.keystore`) fuera del repo. Después del build, comparar el certificado del APK nuevo con el instalado usando `apksigner verify --print-certs`. Si no coincide, NO instalar ni desinstalar.
```bash
npx expo prebuild -p android
cd android
./gradlew assembleDebug        # or assembleRelease
```
Output APK: `android/app/build/outputs/apk/release/app-release.apk` (or `debug/`). Nunca desinstalar: los cambios de esquema van como migración versionada; instalar encima con el mismo keystore.

Gradle 8.14.3 does not run on Java 25 (the JBR bundled with current Android Studio): build with JDK 17 (`JAVA_HOME="C:\Program Files\Microsoft\jdk-17.0.20.101-hotspot"`). `android/local.properties` must have `sdk.dir` (SDK at `D:\Users\Carlos\AppData\Local\Android\Sdk`). `android/` already exists locally, so new Expo modules autolink without `prebuild`.

Firma: el APK instalado en el celular NO coincide con `android/app/debug.keystore` (ver DECISIONES.md, Seguridad). Hasta resolverlo, los APK locales solo van al emulador. Para pruebas de actualización con datos se usa el AVD `Registro_GoogleAPIs_36` (imagen Google APIs, permite `adb root`); usar siempre `adb -s emulator-5554` para no tocar el celular.

## Architecture

There is no router/navigation library despite `@react-navigation` being a dependency — navigation is a hand-rolled state machine.

- **Entry point**: `index.js` → `App.js`.
- **Navigation**: `App.js` holds `currentView` (a string like `HOME`, `DINERO`, `SERIES_DETAIL`, ...) plus a `navigationHistory` stack in local state. A big `switch` in the render body maps `currentView` to a screen component. `handleNavigate(view)` pushes onto history; `handleBack()` (also wired to the Android hardware back button) pops it, or exits the app / shows a confirm dialog when the history is empty at `HOME`. When adding a new screen: add a `case` in the `App.js` switch, plus calls to `onNavigate('NEW_VIEW')` from wherever it should be reachable, and pass `onBack` through.
- **Auth**: `LoginScreen` calls `db.loginUser`/`db.registerUser` (plaintext-password lookup — no hashing). The logged-in user object is persisted to `AsyncStorage` under `@user_session` and restored on app start in `App.js`'s init effect.
- **Screens**: `src/screens/*.js` — one file per screen, receiving `user`, `onBack`, and sometimes `onNavigate`/`category` as props from `App.js`. Detail flows (e.g. Series → SeriesDetail → ChapterRegistry, or Reading → ReadingDetail → ReadingRegistry) pass a `selectedCategory` object down through `App.js` state rather than through navigation params.
- **Theming**: `src/contexts/ThemeContext.js` exposes a `ThemeProvider`/`useTheme()` context wrapping the whole app. `colors.light` / `colors.dark` define the palette; the active theme follows the system color scheme by default but can be toggled and is persisted to `AsyncStorage` (`app_theme`). Screens read `const { theme, isDarkMode, toggleTheme } = useTheme()` and style against `theme.*` tokens rather than hardcoding colors.
- **Data layer**: `src/services/db.js` is still a single `DatabaseService` class (exported as a singleton instance; repositories per feature arrive in Phase 1) wrapping `expo-sqlite`. It holds every query/mutation used by the app as async methods (e.g. `addTransaction`, `getFinanceData`, `updateSeriesProgress`, `getBacklogItems`). Screens call `db.<method>(...)` directly. Methods lazily call `this.init()` if `this.db` isn't set yet, and return either raw rows or `{ success, error }`-shaped objects (mutations mostly use the latter).
  - **Schema / migrations** (`src/services/migrations.js`): `init()` opens `app_registro_v3.db` (name in `dbConfig.js`, never change it), sets `PRAGMA foreign_keys = ON`, and runs pending migrations by `PRAGMA user_version`. Each migration runs in `withExclusiveTransactionAsync` and bumps `user_version` only on success; migrations ≥ 2 require a physical copy (`VACUUM INTO`) first and abort if it fails. Migration 1 is the additive baseline (the 16 `CREATE TABLE IF NOT EXISTS` + missing columns via `PRAGMA table_info`). New schema changes = a new entry in `MIGRATIONS`, never edits to migration 1. `init()` uses a single promise, assigns `this.db` only after migrating, and on failure returns `false` with `db.lastInitError`; `App.js` then shows only `DatabaseErrorScreen` (backup + retry), never the app with a half-migrated schema.
  - **Write queue / transactions**: every mutation is wrapped by `_enqueue` (list `QUEUED_MUTATIONS` at the end of `db.js`), so app writes never overlap. Multi-step ones (`TX_MUTATIONS`) also use `_tx` (`withTransactionAsync`, not exclusive). A queued mutation must never call another queued mutation (deadlock): reuse logic via internal `_…Tx` helpers. A money movement is a single call, `registerMoneyMovement` (debt/loan + `balance_history` + balance). `DEV_FAIL_TX` / `DEV_FAIL_MIGRATION` in `devFlags.js` simulate failures (only in `__DEV__`; leave them `false`).
  - **Backup** (`src/services/backup.js`): read-only, opens its own connection (no `init()`/migrations, so it works from the error screen). Writes `files/SQLite/respaldos/registro_respaldo_<stamp>.db` (`VACUUM INTO`) and `.json` (all tables + `meta`; `users.password` replaced by `[OCULTO]`), then opens the Android share sheet for each file. Button "Respaldar datos" on `HomeScreen`.
- **Backlog quota math**: `src/services/backlogUtils.js` contains pure functions (`getQuotasForDate`, `calculateBacklog`, `isDatePaused`, `getLocalDateString`) used to compute how far behind/ahead a series or reading category is, based on `start_date`, `days_of_week`/`frequency`, pause ranges, and a `quotas_history` override table (JSON-encoded per-day quotas that can change over time). When quota/pause logic needs changes, this is the file to touch — keep it framework-free (no React/SQLite imports) so it stays independently testable.
- Dates are compared as local `YYYY-MM-DD` strings (`getLocalDateString`), not JS `Date` objects or UTC, to avoid timezone drift — follow this convention for any new date comparisons.
- Exception: `created_at` is written by SQLite `CURRENT_TIMESTAMP` (UTC, `YYYY-MM-DD HH:MM:SS`). To filter it by local days use `getUtcRange` in `src/services/dateRange.js` — the only place that converts local days to UTC bounds (Dinero and Estadísticas use it).

## Notes on history

An earlier MVC-style layer (`src/views`, `src/controllers`, `src/database`, `src/models`) was removed because it was never wired into the actual app flow. If MVC is reintroduced, do it as a new module and migrate off `src/services/db.js` gradually rather than reviving the old files.

Before Phase 0, big schema changes were done by renaming the `.db` file (losing data) and asking to uninstall the APK; that is now forbidden. Phase 0 (2026-10-18) replaced the start-up `ALTER TABLE` list with swallowed errors by the versioned migrations above, removed `checkAndBackfillHistory` (the synthetic `watch_history` rows it created are kept as they are), and fixed the UTC/local filter bug in Dinero/Estadísticas. Still pending from the original audit: UUIDs, sync columns, soft delete and outbox (Phase 1); Google login (Phase 3).

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