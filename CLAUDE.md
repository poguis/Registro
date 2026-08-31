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

### Building an APK

Cloud build (uses EAS credits):
```bash
npm install -g eas-cli
set EAS_NO_VCS=1 && eas build --profile preview --platform android
```

Local build (no EAS credits), see `.agent/workflows/build-apk-windows.md` for the full checklist (verifying `android/local.properties`, `settings.gradle` autolinking, `ndkVersion` in `android/app/build.gradle`):
```bash
npx expo prebuild -p android
cd android
./gradlew assembleDebug        # or assembleRelease
```
Output APK: `android/app/build/outputs/apk/release/app-release.apk` (or `debug/`). When reinstalling after a schema change to `db.js`, uninstall the previous APK first — SQLite files persist across installs and old data can conflict with a new schema.

## Architecture

There is no router/navigation library despite `@react-navigation` being a dependency — navigation is a hand-rolled state machine.

- **Entry point**: `index.js` → `App.js`.
- **Navigation**: `App.js` holds `currentView` (a string like `HOME`, `DINERO`, `SERIES_DETAIL`, ...) plus a `navigationHistory` stack in local state. A big `switch` in the render body maps `currentView` to a screen component. `handleNavigate(view)` pushes onto history; `handleBack()` (also wired to the Android hardware back button) pops it, or exits the app / shows a confirm dialog when the history is empty at `HOME`. When adding a new screen: add a `case` in the `App.js` switch, plus calls to `onNavigate('NEW_VIEW')` from wherever it should be reachable, and pass `onBack` through.
- **Auth**: `LoginScreen` calls `db.loginUser`/`db.registerUser`, which hash passwords with `bcryptjs` (`registerUser`) and verify with `bcrypt.compareSync` (`loginUser`); accounts created before this change had plaintext passwords and are transparently rehashed to bcrypt on their next successful login. `index.js` imports `react-native-get-random-values` first (before any other import) so bcryptjs gets a secure RNG on-device. The logged-in user object (password field stripped) is persisted to `AsyncStorage` under `@user_session` and restored on app start in `App.js`'s init effect.
- **Screens**: `src/screens/*.js` — one file per screen, receiving `user`, `onBack`, and sometimes `onNavigate`/`category` as props from `App.js`. Detail flows (e.g. Series → SeriesDetail → ChapterRegistry, or Reading → ReadingDetail → ReadingRegistry) pass a `selectedCategory` object down through `App.js` state rather than through navigation params.
- **Theming**: `src/contexts/ThemeContext.js` exposes a `ThemeProvider`/`useTheme()` context wrapping the whole app. `colors.light` / `colors.dark` define the palette; the active theme follows the system color scheme by default but can be toggled and is persisted to `AsyncStorage` (`app_theme`). Screens read `const { theme, isDarkMode, toggleTheme } = useTheme()` and style against `theme.*` tokens rather than hardcoding colors.
- **Data layer**: `src/services/db.js` is a single `DatabaseService` class (exported as a singleton instance) wrapping `expo-sqlite`. It owns schema creation (`init()` runs `CREATE TABLE IF NOT EXISTS` for every table — users, finance_contacts, finance_transactions, balance_history, finance_categories, services, entertainment_categories/pauses/quotas_history, series, seasons, watch_history, reading_history, backlog, work_people, cards) and every query/mutation used by the app as async methods (e.g. `addTransaction`, `getFinanceData`, `updateSeriesProgress`, `getBacklogItems`). Screens call `db.<method>(...)` directly — there is no separate repository/service split per feature. All methods lazily call `this.init()` if `this.db` isn't set yet, and return either raw rows or `{ success, error }`-shaped objects (mutations mostly use the latter).
- **Backlog quota math**: `src/services/backlogUtils.js` contains pure functions (`getQuotasForDate`, `calculateBacklog`, `isDatePaused`, `getLocalDateString`) used to compute how far behind/ahead a series or reading category is, based on `start_date`, `days_of_week`/`frequency`, pause ranges, and a `quotas_history` override table (JSON-encoded per-day quotas that can change over time). When quota/pause logic needs changes, this is the file to touch — keep it framework-free (no React/SQLite imports) so it stays independently testable.
- Dates are compared as local `YYYY-MM-DD` strings (`getLocalDateString`), not JS `Date` objects or UTC, to avoid timezone drift — follow this convention for any new date comparisons.

## Notes on history

An earlier MVC-style layer (`src/views`, `src/controllers`, `src/database`, `src/models`) was removed because it was never wired into the actual app flow. If MVC is reintroduced, do it as a new module and migrate off `src/services/db.js` gradually rather than reviving the old files.
