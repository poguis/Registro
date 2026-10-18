# Auditoría técnica — Registro

> Objetivo: evaluar el estado actual para migrar a **offline-first con sincronización a PostgreSQL** y **login solo con Google**.
> Alcance: solo lectura del repositorio (rama `claude/youthful-sagan-j4mb2c`, commit `e762265`). No se ejecutó la app ni se instalaron dependencias; las versiones salen de `package.json` / `package-lock.json`.

---

## 1. Stack

| Aspecto | Valor | Fuente |
|---|---|---|
| Expo SDK | **54** (`expo` 54.0.33) | `package.json`, `package-lock.json` |
| React Native | **0.81.5** | `package.json` |
| React | 19.1.0 | `package.json` |
| Lenguaje | **JavaScript**. TypeScript: **NO** (no hay `tsconfig.json` ni archivos `.ts/.tsx`) | raíz del repo |
| Router | **Ninguno en uso.** Navegación manual con `currentView` + `navigationHistory` en `useState` y un `switch` | `App.js:27-29`, `App.js:121-124`, `App.js:136-252` |
| expo-router | NO ENCONTRADO | — |
| react-navigation | Instalado (`@react-navigation/native` 6.1.18, `@react-navigation/stack` 6.4.1) pero **no se importa en ningún archivo** (dependencia muerta) | `package.json`; `grep` sin resultados en `src/` y `App.js` |
| Gestor de estado | **Ninguno** (sin Redux/Zustand/MobX/Jotai). Estado local con `useState` por pantalla + un único Context para tema | `src/contexts/ThemeContext.js` |
| Persistencia | `expo-sqlite` 16.0.10 (API async `openDatabaseAsync`) + `@react-native-async-storage/async-storage` 2.2.0 | `src/services/db.js:1,20`, `App.js:3` |
| Otras libs | `expo-status-bar`, `react-native-safe-area-context` (usado), `react-native-screens` y `react-native-gesture-handler` (instalados, sin uso directo), `react-native-web` + `react-dom` (soporte web) | `package.json` |
| Babel / Metro config | NO ENCONTRADO (`babel.config.js`, `metro.config.js` no existen; se usan los defaults de Expo) | raíz |
| New Architecture | `"newArchEnabled": false` | `app.json:9` |
| Plugins de config | `["expo-sqlite"]` | `app.json:32-34` |
| Carpetas nativas | `/android` e `/ios` están en `.gitignore` → flujo **CNG/prebuild** | `.gitignore:39-41` |
| EAS | Perfiles `development` (`developmentClient: true`), `preview`, `production`; `projectId` presente | `eas.json`, `app.json:28-31` |
| Linter / tests / typecheck | NO ENCONTRADO | `package.json` (solo `start/android/ios/web`) |

**¿Expo Go o dev build?** Todas las dependencias nativas actuales (`expo-sqlite`, AsyncStorage, safe-area, screens, gesture-handler) vienen incluidas en Expo Go SDK 54, así que **hoy funciona en Expo Go**. Observaciones:
- Expo Go ejecuta siempre New Architecture, de modo que `newArchEnabled: false` solo aplica a builds nativos (APK de `prebuild`/EAS). La app se prueba en un modo (Go, New Arch) y se distribuye en otro (APK, arquitectura legacy).
- SDK 54 / RN 0.81 es la última versión que admite la arquitectura legacy; al subir de SDK habrá que activar New Architecture.
- **El login con Google nativo** (`@react-native-google-signin/google-signin`) **necesita dev build**; ya existe el perfil `development` en `eas.json`.

---

## 2. Estructura de carpetas (3 niveles)

```
Registro/
├── .agent/
│   └── workflows/
│       └── build-apk-windows.md     # Guía para compilar el APK local en Windows (prebuild + gradlew)
├── assets/                           # Iconos y splash (icon, adaptive-icon, splash-icon, favicon .png)
├── docs/
│   └── AUDITORIA.md                  # Este documento
├── src/
│   ├── contexts/
│   │   └── ThemeContext.js           # Tema claro/oscuro (Context + AsyncStorage 'app_theme')
│   ├── screens/                      # 14 pantallas; UI + lógica de negocio + llamadas a db
│   │   ├── LoginScreen.js            # Login/registro usuario+contraseña
│   │   ├── HomeScreen.js             # Menú principal
│   │   ├── DineroScreen.js           # Saldo, movimientos, categorías
│   │   ├── DeudasPrestamosScreen.js  # Deudas y préstamos por contacto
│   │   ├── StatisticsScreen.js       # Estadísticas de ingresos/gastos
│   │   ├── ServiciosScreen.js        # Servicios/suscripciones
│   │   ├── CardsScreen.js            # Tarjetas débito/crédito
│   │   ├── SeriesAnimeScreen.js      # Categorías de entretenimiento
│   │   ├── SeriesDetailScreen.js     # Series de una categoría de video
│   │   ├── ChapterRegistryScreen.js  # Registro de capítulos vistos
│   │   ├── ReadingDetailScreen.js    # Series de una categoría de lectura
│   │   ├── ReadingRegistryScreen.js  # Registro de capítulos leídos
│   │   ├── BacklogScreen.js          # Pendientes (películas, series, anime, lectura)
│   │   └── TrabajoScreen.js          # Turnos/ciclos de personas
│   └── services/
│       ├── db.js                     # Clase única DatabaseService (esquema + todas las queries)
│       └── backlogUtils.js           # Funciones puras de cuotas/backlog/fechas
├── App.js                            # Raíz: init DB, sesión, router por estado
├── index.js                          # registerRootComponent(App)
├── app.json / eas.json               # Config Expo y EAS
├── package.json / package-lock.json
├── CLAUDE.md / README.md             # Documentación
└── android.os.Looper                 # Archivo vacío de 0 bytes, sin uso (residuo)
```

No existen `src/components`, `src/hooks`, `src/utils`, `src/types` ni `src/api`: **NO ENCONTRADO**. No hay componentes reutilizables; cada pantalla define sus propios modales y estilos.

---

## 3. Persistencia actual

| Tecnología | Uso | Dónde |
|---|---|---|
| **expo-sqlite** (archivo `app_registro_v3.db`) | Todos los datos de dominio | `src/services/db.js:3,20` |
| **AsyncStorage** | `@user_session` (objeto usuario serializado) | `App.js:43,51,55,99,112` |
| **AsyncStorage** | `app_theme` (`'dark'`/`'light'`) | `src/contexts/ThemeContext.js:51,64` |
| MMKV / WatermelonDB / Realm / SecureStore | NO ENCONTRADO | — |

**Centralización:** el acceso a SQLite está **centralizado** en el singleton `DatabaseService` (`src/services/db.js:1591`). Ninguna pantalla ejecuta SQL directamente; todas importan `db` y llaman a sus métodos. Matices:
- La **lógica de negocio sí está dispersa** por las pantallas. Por ejemplo, un movimiento de dinero lo coordina `DineroScreen.js:313-323` con 3 llamadas separadas (`addTransaction` → `addBalanceTransaction` → `updateUserBalance`) **sin transacción SQL**.
- `db.js` no usa `withTransactionAsync` en ningún método, tampoco en operaciones de varios pasos (`addSeriesWithSeasons`, `updateSeriesWithSeasons`, `addEntertainmentCategory`).
- `PRAGMA foreign_keys = ON` está activo (`db.js:21`), por lo que los `ON DELETE CASCADE` funcionan.
- AsyncStorage se usa solo en `App.js` y `ThemeContext.js`.

---

## 4. Modelo de datos

### 4.1 Generación de IDs
**Todas** las tablas usan `INTEGER PRIMARY KEY AUTOINCREMENT`. El ID se lee con `result.lastInsertRowId`. **No hay UUIDs** en ninguna parte.

### 4.2 Diagrama de relaciones

```
users ─┬─< finance_contacts ─< finance_transactions
       ├─< balance_history            (category = TEXT libre, sin FK a finance_categories)
       ├─< finance_categories
       ├─< services
       ├─< backlog
       ├─< work_people
       ├─< cards
       └─< entertainment_categories ─┬─< entertainment_pauses
                                     ├─< entertainment_quotas_history
                                     └─< series ─┬─< seasons
                                                 ├─< watch_history
                                                 └─< reading_history
```
Todas las FK tienen `ON DELETE CASCADE`. Las tablas hijas de nivel 2 y 3 **no tienen `user_id`**: la propiedad se resuelve con JOIN (`db.js:1250-1253`, `db.js:1316-1319`).

### 4.3 Entidades (esquema real, `src/services/db.js:25-266`)

#### users (`db.js:25-32`)
```sql
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  current_balance REAL DEFAULT 0
);
```
Sin `created_at`. `current_balance` es un valor derivado que se guarda aparte (ver §8).

#### finance_contacts (`db.js:35-43`)
```sql
CREATE TABLE IF NOT EXISTS finance_contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```
Unicidad por nombre solo validada en código (`db.js:361-364`), no en el esquema. No existen métodos para editar ni borrar contactos: NO ENCONTRADO.

#### finance_transactions (`db.js:46-56`)
```sql
CREATE TABLE IF NOT EXISTS finance_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id INTEGER NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('debt', 'loan')),
  amount REAL NOT NULL,
  description TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (contact_id) REFERENCES finance_contacts(id) ON DELETE CASCADE
);
```
`amount` puede ser negativo (los abonos se guardan como montos negativos, `DineroScreen.js:298`). Sin `user_id`.

#### balance_history (`db.js:59-69`)
```sql
CREATE TABLE IF NOT EXISTS balance_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  amount REAL NOT NULL,
  category TEXT NOT NULL,
  description TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```
`category` es texto libre (desnormalizado): no referencia a `finance_categories`.

#### finance_categories (`db.js:72-82`)
```sql
CREATE TABLE IF NOT EXISTS finance_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  icon TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, name),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```
Al registrar un usuario se siembran 6 categorías por defecto (`db.js:579-584`). `icon` no se escribe en ningún punto.

#### services (`db.js:85-98`)
```sql
CREATE TABLE IF NOT EXISTS services (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('Local', 'Internacional')),
  status TEXT NOT NULL CHECK(status IN ('Activo', 'Inactivo')),
  original_value REAL NOT NULL,
  additional_value REAL DEFAULT 0,
  total_value REAL NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```
`total_value` es derivado (lo calcula la pantalla y se guarda).

#### entertainment_categories (`db.js:101-115`)
```sql
CREATE TABLE IF NOT EXISTS entertainment_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  type TEXT CHECK(type IN ('video', 'reading')) NOT NULL,
  start_date TEXT,
  days_of_week TEXT, -- JSON string ["Monday", "Wednesday"]
  frequency INTEGER DEFAULT 0,
  series_count INTEGER DEFAULT 0,
  description TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```
`days_of_week` es JSON serializado en TEXT. La misma cadena se copia en `entertainment_quotas_history.quotas`.

#### entertainment_pauses (`db.js:118-126`)
```sql
CREATE TABLE IF NOT EXISTS entertainment_pauses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL,
  pause_start TEXT NOT NULL,
  pause_end TEXT,
  FOREIGN KEY (category_id) REFERENCES entertainment_categories(id) ON DELETE CASCADE
);
```
`pause_end IS NULL` significa que la pausa sigue activa. Sin `created_at`.

#### entertainment_quotas_history (`db.js:129-138`)
```sql
CREATE TABLE IF NOT EXISTS entertainment_quotas_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL,
  quotas TEXT NOT NULL, -- JSON string
  start_date TEXT NOT NULL,
  end_date TEXT,
  FOREIGN KEY (category_id) REFERENCES entertainment_categories(id) ON DELETE CASCADE
);
```
Registro vigente = `end_date IS NULL`. Lo gestiona `updateEntertainmentCategory` (`db.js:844-861`).

#### series (`db.js:141-157` + migraciones `db.js:213-222`)
```sql
CREATE TABLE IF NOT EXISTS series (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'Nueva', -- 'Nueva', 'Mirando', 'Terminada', 'Pausada'
  current_season INTEGER DEFAULT 1,
  current_episode INTEGER DEFAULT 1,
  initial_season INTEGER DEFAULT 1,
  initial_episode INTEGER DEFAULT 1,
  total_seasons INTEGER DEFAULT 0,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (category_id) REFERENCES entertainment_categories (id) ON DELETE CASCADE
);
-- columnas añadidas por migración:
-- cycle_offset INTEGER DEFAULT 0
-- interleave_offset INTEGER DEFAULT 0
-- last_watched_at INTEGER DEFAULT 0   (epoch ms)
```
Esta tabla guarda tanto series de video como de lectura (según el `type` de la categoría).
**Inconsistencia de enumerados:** el comentario del esquema dice `'Terminada'`/`'Pausada'`, pero el código usa `'Terminado'`, `'En espera'`, `'Pausado'` (`db.js:742,1114`, `SeriesDetailScreen.js:38,173`). Sin `CHECK`.

#### seasons (`db.js:160-168`)
```sql
CREATE TABLE IF NOT EXISTS seasons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  series_id INTEGER NOT NULL,
  season_number INTEGER NOT NULL,
  episode_count INTEGER DEFAULT 0,
  FOREIGN KEY (series_id) REFERENCES series (id) ON DELETE CASCADE
);
```
Sin `UNIQUE(series_id, season_number)`. Cada vez que se edita una serie, sus temporadas **se borran y se vuelven a insertar** (`db.js:993-1002`), así que los IDs cambian en cada edición.

#### watch_history (`db.js:171-180`) / reading_history (`db.js:183-192`)
```sql
CREATE TABLE IF NOT EXISTS watch_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  series_id INTEGER NOT NULL,
  season_number INTEGER NOT NULL,
  episode_number INTEGER NOT NULL,
  watched_at INTEGER NOT NULL,          -- epoch ms
  FOREIGN KEY (series_id) REFERENCES series (id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS reading_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  series_id INTEGER NOT NULL,
  season_number INTEGER NOT NULL,
  episode_number INTEGER NOT NULL,
  read_at INTEGER NOT NULL,             -- epoch ms
  FOREIGN KEY (series_id) REFERENCES series (id) ON DELETE CASCADE
);
```
Son dos tablas con la misma estructura. `watch_history` se rellena con **timestamps sintéticos** mediante `checkAndBackfillHistory` (`db.js:1147-1206`, `timestamp = sort_order - 10000000 + loop*1000`).

#### backlog (`db.js:195-210`)
```sql
CREATE TABLE IF NOT EXISTS backlog (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  type TEXT NOT NULL, -- 'movie', 'series', 'anime', 'reading'
  status TEXT DEFAULT 'Pendiente', -- 'Pendiente', 'Mirando', 'Terminado'
  title TEXT NOT NULL,
  year INTEGER,
  format TEXT,
  start_year INTEGER,
  end_year INTEGER,
  franchise TEXT DEFAULT 'Otros',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```
Sin `CHECK` en `type`/`status`. `franchise` es texto libre.

#### work_people (`db.js:240-251`)
```sql
CREATE TABLE IF NOT EXISTS work_people (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  start_date TEXT NOT NULL,
  cycle TEXT NOT NULL, -- JSON string: [{ "type": "dia", "days": 1 }, ...]
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```
El formato de `cycle` se deduce de `TrabajoScreen.js:70,81,88`.

#### cards (`db.js:254-266`)
```sql
CREATE TABLE IF NOT EXISTS cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('debit', 'credit')),
  cutoff_date INTEGER,        -- día del mes
  payment_due_date INTEGER,   -- día del mes
  limit_amount REAL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```
No guarda número de tarjeta, CVV ni fecha de expiración.

### 4.4 Migraciones existentes (`db.js:213-230`)
No hay versión de esquema (`PRAGMA user_version` o tabla `schema_migrations`): **NO ENCONTRADO**. El mecanismo actual es una lista de `ALTER TABLE ... ADD COLUMN` que se ejecuta en cada arranque; los errores se tragan con un `catch {}` vacío:
```js
`ALTER TABLE series ADD COLUMN cycle_offset INTEGER DEFAULT 0;`,
`ALTER TABLE series ADD COLUMN interleave_offset INTEGER DEFAULT 0;`,
`ALTER TABLE series ADD COLUMN sort_order INTEGER DEFAULT 0;`,
`ALTER TABLE series ADD COLUMN initial_season INTEGER DEFAULT 1;`,
`ALTER TABLE series ADD COLUMN initial_episode INTEGER DEFAULT 1;`,
`ALTER TABLE series ADD COLUMN last_watched_at INTEGER DEFAULT 0;`,
`ALTER TABLE work_people ADD COLUMN sort_order INTEGER DEFAULT 0;`,   // falla siempre en instalación nueva: la tabla se crea después (db.js:240)
`ALTER TABLE backlog ADD COLUMN franchise TEXT DEFAULT 'Otros';`
```
Los cambios grandes de esquema se resolvieron **renombrando el archivo de la base** (`app_registro_v3.db`, `db.js:3`), con lo que se pierden los datos anteriores, y pidiendo desinstalar el APK (`.agent/workflows/build-apk-windows.md:32`).

---

## 5. Login actual

**Flujo:**
1. `LoginScreen.js:27-52` pide usuario y contraseña. Según el modo llama a `db.registerUser` o a `db.loginUser`.
2. `db.registerUser` (`db.js:278-294`) inserta la contraseña **en texto plano** y siembra las categorías.
3. `db.loginUser` (`db.js:296-307`) ejecuta `SELECT * FROM users WHERE username = ? AND password = ?` y devuelve **la fila completa**.
4. `App.js:97-108` (`handleLogin`) guarda esa fila con `AsyncStorage.setItem('@user_session', JSON.stringify(userData))`.
5. Al arrancar, `App.js:43-57` restaura la sesión si existe `userData.id`. No hay expiración, token ni comprobación contra la base.
6. Logout: `App.js:110-119` borra `@user_session`.

**Problemas de seguridad detectados:**
- Contraseñas en **texto plano** en SQLite (`users.password`), sin hash ni sal.
- La sesión en AsyncStorage **incluye la contraseña en claro**, porque `SELECT *` devuelve todas las columnas. AsyncStorage no está cifrado.
- `expo-secure-store` no se usa: NO ENCONTRADO.
- La sesión es solo un `id` local, sin token firmado. Si se modifica `@user_session` se puede "ser" otro usuario del dispositivo.
- No hay límite de intentos, política de contraseñas ni recuperación de cuenta.
- La base SQLite no está cifrada (no se usa SQLCipher).
- Varias cuentas pueden convivir en un mismo dispositivo. El paso a Google necesitará mapear `users.id` local ↔ identidad Google (`sub`).
- La sesión restaurada contiene un `current_balance` congelado al momento del login. Las pantallas vuelven a leer el saldo con `getUserBalance`, pero el objeto `user` en memoria queda desactualizado.

---

## 6. Mapa pantallas → entidades

L = lectura, E = escritura (insert/update), B = borrado físico.

| Pantalla | Métodos `db.*` | Entidades |
|---|---|---|
| `LoginScreen.js` | `loginUser`, `registerUser` | users (L/E), finance_categories (E, siembra) |
| `HomeScreen.js` | — (solo navegación) | — |
| `DineroScreen.js` | `getUserBalance`, `updateUserBalance`, `getBalanceHistory`, `addBalanceTransaction`, `getDistinctCategories`, `addFinanceCategory`, `getFinanceData`, `addTransaction` | users.current_balance (L/E), balance_history (L/E), finance_categories (L/E), finance_contacts (L/E), finance_transactions (L/E) |
| `DeudasPrestamosScreen.js` | `getFinanceData`, `addTransaction`, `deleteTransaction` | finance_contacts (L/E), finance_transactions (L/E/B) |
| `StatisticsScreen.js` | `getStatisticsData`, `getCategoryHistory` | balance_history (L) |
| `ServiciosScreen.js` | `getServices`, `addService`, `updateService`, `toggleServiceStatus`, `deleteService` | services (L/E/B) |
| `CardsScreen.js` | `getCards`, `addCard`, `updateCard`, `deleteCard` | cards (L/E/B) |
| `SeriesAnimeScreen.js` | `getEntertainmentCategories`, `addEntertainmentCategory`, `updateEntertainmentCategory`, `deleteEntertainmentCategory`, `pauseCategory`, `resumeCategory` | entertainment_categories (L/E/B + cascada), quotas_history (L/E), pauses (L/E), series/seasons (L, para totales) |
| `SeriesDetailScreen.js` | `getEntertainmentCategories`, `getSeriesByCategory`, `getSeasonsBySeries`, `addSeriesWithSeasons`, `updateSeriesWithSeasons`, `updateSeriesProgress`, `updateSeriesSortOrder`, `restartSeries`, `deleteSeries`, `pauseCategory`, `resumeCategory` | series (L/E/B), seasons (L/E/B), pauses (E), categories (L) |
| `ReadingDetailScreen.js` | mismos métodos que `SeriesDetailScreen` | ídem |
| `ChapterRegistryScreen.js` | `getFullWatchlist`, `getHistory`, `getEntertainmentCategories`, `addHistory`, `removeHistory`, `updateSeriesProgress` | watch_history (L/E/B), series (L/E), seasons (L), categories (L) |
| `ReadingRegistryScreen.js` | `getFullWatchlist`, `getReadingHistory`, `getEntertainmentCategories`, `addReadingHistory`, `removeReadingHistory`, `updateSeriesProgress` | reading_history (L/E/B), series (L/E), seasons (L), categories (L) |
| `BacklogScreen.js` | `getBacklogItems`, `getBacklogCounts`, `addBacklogItem`, `updateBacklogItem`, `updateBacklogStatus`, `deleteBacklogItem` | backlog (L/E/B) |
| `TrabajoScreen.js` | `getWorkPeople`, `addWorkPerson`, `updateWorkPerson`, `updateWorkPersonOrder`, `deleteWorkPerson` | work_people (L/E/B) |
| `App.js` | `init` (+ `checkAndBackfillHistory`) | esquema completo; watch_history (E, backfill) |
| `ThemeContext.js` | — | AsyncStorage `app_theme` |

---

## 7. Archivos / imágenes

- `expo-file-system`: **NO ENCONTRADO** (no está en `package.json` ni se importa).
- `expo-image-picker`, `expo-camera`, `expo-document-picker`, `expo-media-library`: **NO ENCONTRADO**.
- Componente `<Image>` en pantallas: **NO ENCONTRADO**.
- Columnas de tipo ruta/URI/blob en el esquema: **NO ENCONTRADO**. `finance_categories.icon` es `TEXT`, pero nunca se escribe.
- Único contenido binario: los assets estáticos de `assets/*.png` (icono y splash).

**Conclusión:** no hay adjuntos de usuario. La sincronización no tiene que manejar archivos por ahora.

---

## 8. Riesgos para sincronizar

### 8.1 Timestamps
- **Ninguna tabla tiene `updated_at`.** No se puede saber qué filas cambiaron desde la última sincronización ni resolver conflictos por "último en escribir".
- Tablas **sin ningún timestamp**: `users`, `entertainment_pauses`, `entertainment_quotas_history`, `seasons`.
- Formatos de fecha mezclados:
  - `created_at` = `CURRENT_TIMESTAMP` de SQLite → **UTC** `YYYY-MM-DD HH:MM:SS`.
  - `watched_at`, `read_at`, `last_watched_at` = epoch ms (`INTEGER`).
  - `start_date`, `pause_*`, `quotas.start_date/end_date` = `YYYY-MM-DD` local.
- **Bug de zona horaria:** `DineroScreen.js:88-112` y `StatisticsScreen.js:41-61` filtran `created_at` (UTC) con límites de fecha **local** (`YYYY-MM-DD 00:00:00`), pero luego muestran la hora convirtiendo a UTC (`+ 'Z'`, `DineroScreen.js:132`). En Ecuador (UTC-5), los movimientos hechos después de las 19:00 caen en el día siguiente del filtro.

### 8.2 Borrados físicos
Todos los borrados son `DELETE` sin *soft delete* (`deleted_at`) ni *tombstones*:
- `deleteTransaction` (`db.js:392`), `deleteService` (`:640`), `deleteEntertainmentCategory` (`:879`), `deleteSeries` (`:1073`), `removeHistory` (`:1225`), `removeReadingHistory` (`:1291`), `deleteBacklogItem` (`:1462`), `deleteWorkPerson` (`:1529`), `deleteCard` (`:1583`).
- `ON DELETE CASCADE` borra hijos en silencio: al eliminar una categoría desaparecen sus series, temporadas, historial, pausas y cuotas. Ninguna de esas bajas queda registrada para propagarse.
- `updateSeriesWithSeasons` hace **delete + reinsert** de `seasons` (`db.js:994`). Para la sincronización aparece como N borrados y N inserciones en cada edición.

### 8.3 IDs autoincrementales
- Todas las PK son `AUTOINCREMENT`, así que dos dispositivos generarán el mismo `id` para registros distintos. Se necesitan UUID (v4/v7) generados en el cliente, o un mapeo `local_id ↔ server_id`.
- Las FK (`user_id`, `contact_id`, `category_id`, `series_id`) también son enteros y habrá que reescribirlas en la migración.
- `removeHistory` identifica la fila por `(series_id, season, episode)` + el `watched_at` más reciente, no por ID (`db.js:1225-1232`).
- `addTransaction` busca el contacto **por nombre** (`db.js:361-364`). Entre dispositivos pueden crearse contactos duplicados con el mismo nombre.

### 8.4 Datos derivados almacenados
- `users.current_balance` se guarda aparte de `balance_history`, no se recalcula desde el historial y se puede **sobrescribir a mano** (`DineroScreen.js:173`). Hay riesgo de divergencia entre dispositivos. Recomendación: calcularlo, o modelar los ajustes manuales como movimientos.
- `services.total_value` = original + adicional, calculado en la UI.
- `series.cycle_offset` acumula episodios en `restartSeries` con `cycle_offset = cycle_offset + ?` (`db.js:1061`). Un incremento relativo no es idempotente ante reintentos de sincronización.
- `series.current_season/current_episode/status` duplican información que también vive en `watch_history`/`reading_history`.
- `entertainment_categories.days_of_week` se duplica en `quotas_history.quotas`.
- `watch_history` contiene filas **sintéticas** del backfill (`db.js:1147-1206`), indistinguibles de las reales.
- `entertainment_categories.series_count` **no es derivado**: es el límite de series activas que define el usuario (`SeriesAnimeScreen.js:236`, validado en `ReadingDetailScreen.js:202-204`). El nombre puede confundir en el modelo del servidor.

### 8.5 Lógica duplicada
- `getLocalDateString` está definida dos veces: `db.js:4-9` y `backlogUtils.js:1`.
- El cálculo de episodios absolutos está en `db.js:724-748` (`getAbs`, dentro de `getEntertainmentCategories`) y también en `backlogUtils.js:198-218` (`getAbsoluteEpisodeCount`, `getWatchedCountSinceStart`).
- `SeriesDetailScreen.js` (707 líneas) y `ReadingDetailScreen.js` (653 líneas) son casi copias; lo mismo ocurre con `ChapterRegistryScreen.js` y `ReadingRegistryScreen.js`, y con `watch_history` y `reading_history`.
- Coexisten `calculateBacklog` y `calculateBacklogV2` (`backlogUtils.js:56,220`), importadas por varias pantallas.
- El cálculo de rangos de fecha (hoy/semana/mes/año/personalizado) está repetido en `DineroScreen.js:80-112` y `StatisticsScreen.js:41-61`.

### 8.6 Operaciones no atómicas
- Movimiento de dinero: 3 escrituras sin transacción (`DineroScreen.js:313-323`). Si la app falla a mitad del proceso, el saldo y el historial quedan inconsistentes.
- `addSeriesWithSeasons`, `updateSeriesWithSeasons`, `addEntertainmentCategory` y `updateEntertainmentCategory` hacen varias escrituras sin `withTransactionAsync`.
- `getEntertainmentCategories` lanza consultas N+1 por categoría, serie y temporada (`db.js:701-764`). Afectará el rendimiento cuando la base crezca con datos sincronizados.

### 8.7 Datos sensibles
- Finanzas personales: saldo, movimientos, deudas y préstamos con **nombres de terceros** (`finance_contacts.name`), límites de tarjetas y días de corte (`cards`).
- `work_people`: nombres de personas y sus turnos.
- Contraseñas en claro (`users.password`), que además se copian a AsyncStorage.
- Al sincronizar con PostgreSQL hará falta: TLS, autorización por fila (RLS o filtro por `user_id` en el servidor), cifrado en reposo y decidir si los nombres de terceros se suben tal cual.

### 8.8 Otros
- Las tablas hijas no tienen `user_id`, así que el servidor no puede filtrar por dueño sin JOIN. Para sincronizar conviene desnormalizar `user_id` en cada tabla.
- Hay enumerados en español sin `CHECK` y con valores incoherentes (`'Terminada'` vs `'Terminado'`, `'Pausada'` vs `'Pausado'`/`'En espera'`). Se deben normalizar antes de migrar a PostgreSQL con `CHECK`/`ENUM`.
- Los JSON en TEXT (`days_of_week`, `quotas`, `cycle`) deberían pasar a `jsonb` en PostgreSQL, con validación de esquema.
- No hay versionado de esquema local. Hace falta un sistema de migraciones antes de añadir columnas de sincronización (`id uuid`, `updated_at`, `deleted_at`, `dirty`/`version`).

---

## 9. Preguntas abiertas

1. **Datos existentes:** ¿hay que migrar los datos de los dispositivos actuales (`app_registro_v3.db`) al nuevo modelo con UUID, o se puede empezar de cero?
2. **Multiusuario por dispositivo:** hoy pueden existir varias cuentas locales. Con Google, ¿una sola cuenta por dispositivo? ¿Cómo se asocian las cuentas locales existentes a una cuenta Google (por ejemplo, la primera que inicie sesión)?
3. **Multidispositivo:** ¿el mismo usuario usará la app en varios dispositivos a la vez? Esto define la estrategia de conflictos (último en escribir, por campo, o CRDT para contadores como `cycle_offset` y `current_balance`).
4. **Backend:** ¿qué hay del lado servidor? ¿Supabase (PostgreSQL + Auth Google + RLS), una API propia (Node/NestJS, etc.) o un motor de sincronización (PowerSync, ElectricSQL)? No se encontró código de backend en el repo.
5. **Plataformas:** ¿se mantiene el soporte web (`react-native-web`) y iOS, o solo Android? Afecta la elección de librería de Google Sign-In y de base local (`expo-sqlite` en web es experimental).
6. **Expo Go vs dev build:** ¿aceptas dejar Expo Go y usar un dev build (`eas.json` → `development`)? Es necesario para Google Sign-In nativo.
7. **Saldo:** ¿`current_balance` debe ser la suma de `balance_history` o se permiten ajustes manuales? En el segundo caso, ¿se registran como movimientos de tipo "ajuste"?
8. **Datos sensibles:** ¿los nombres de contactos y personas de trabajo pueden ir al servidor en claro, o requieren cifrado del lado cliente?
9. **Historial sintético:** ¿se conservan las filas generadas por `checkAndBackfillHistory` o se descartan en la migración?
10. **Estados de series:** ¿cuál es la lista canónica (`Nueva`, `Mirando`, `En espera`, `Terminado`, `Pausado`…)?
11. **Borrados:** ¿se necesita papelera o restauración (soft delete visible al usuario), o basta con *tombstones* internos para la sincronización?
12. **Sincronización:** ¿automática en segundo plano, manual (botón), o al abrir la app y al recuperar conexión?
13. **Lenguaje y navegación:** ¿se acepta introducir TypeScript y un router real (expo-router) dentro de este proyecto, o se mantiene JS + navegación manual?
14. **Archivo `android.os.Looper`** (0 bytes, raíz): ¿se puede eliminar?

---

## Resumen

- Expo SDK 54 / RN 0.81.5, JavaScript sin TypeScript, sin router real ni gestor de estado; New Architecture desactivada en builds nativos; hoy corre en Expo Go.
- Persistencia: expo-sqlite (16 tablas) centralizada en `src/services/db.js`; AsyncStorage para sesión y tema. Sin archivos ni imágenes.
- Todas las PK son `AUTOINCREMENT`; no hay UUID, `updated_at` ni soft delete; los borrados son físicos con `CASCADE`.
- Migraciones con `ALTER TABLE` y errores ignorados, sin versión de esquema; los cambios grandes renombraron el archivo `.db`.
- Login inseguro: contraseña en texto plano en SQLite y copiada a AsyncStorage dentro de la sesión.
- Datos derivados guardados (`current_balance`, `total_value`, `cycle_offset` incremental) y escrituras multi-paso sin transacción.
- Bug de zona horaria: los filtros de fecha comparan `created_at` UTC con límites locales.
- Hay lógica duplicada (pantallas Series/Reading, historiales, `getLocalDateString`, cálculo de episodios).
- Requisitos previos a la sincronización: UUID, `updated_at`/`deleted_at`, `user_id` en todas las tablas, migraciones versionadas y transacciones.
- Google Sign-In requerirá dev build; quedan 14 preguntas abiertas que definen el diseño.
