# Traspaso a la Fase 7

Estado al cerrar la Fase 6 (2026-11-11, commit `f97227f`), actualizado al cerrar la 7.1 (2026-11-16), la 7.2 (2026-11-17), la 7.3 (2026-11-18) y la 7.4a (2026-11-20). Las fases 0–6 están cerradas; el detalle de cada una está en DECISIONES.md (Fases) y CLAUDE.md. El traspaso anterior (`claude/TRASPASO-FASE6.md`) queda como histórico.

## 1. Estado actual

### Celular del usuario
- **Registro (producción)** `com.poguis.Registro`: **1.3.7 / versionCode 11** (7.4a, 2026-11-20), firma EAS `31:32:DE:…:3E:52`, instalada siempre encima (`install -r`), mismo `firstInstallTime` desde 2026-09-21. Sync encendida contra **Poguis**. BD local `user_version` 5: sin `legacy_*` ni columna `password`.
- `respaldos/` del celular: los 10 respaldos manuales más recientes y la `pre-migracion-v5`; 0 copias con la contraseña antigua (retención de la 6.7).
- **Registro Dev** `com.poguis.Registro.dev`: **1.3.7 / versionCode 11**, firma `debug.keystore` `fac61745…`, contra **Registro Dev**, instalada encima con el mismo `firstInstallTime`. Se instala al lado de la app real y tiene su propia BD.

### Poguis (producción)
- Datos reales de un único usuario: **31 filas** en las 15 tablas sincronizadas, **12 vivas y 19 borradas** (`verificar-fase5` 16/16 = respaldo "después" de la 7.3, 2026-11-18). **Sin cambios en la 7.4a** (2026-11-20: `verificar-fase5` = "después", 31 / 12 / 19, un `user_id`).
- **Diferencia con la 6.7** (30 / 26 / 4, que coincide con su `verificar-fase5-poguis.json`):
  - +1 fila viva en `balance_history` (de 2 a 3), un movimiento del usuario;
  - 15 tombstones de entretenimiento: 1 categoría, 1 cuota, 1 serie, 1 temporada y 11 filas de `watch_history`. El usuario los borró desde la app antes de la 7.3, como decidió el diseño (Alcance), y quedan para siempre igual que los de la 6.8.
- Las otras 4 borradas son los tombstones de prueba de `backlog` (`[prueba RLS]` y 3 `[prueba F5]`). **Se quedan** (6.8, decisión del usuario).
- Esquema: las 4 migraciones de `supabase/migrations/`, RLS en las 15 tablas, sin DELETE, sin `security definer`. Auditoría 6.1: 18/18 estrictos.
- Auth:
  - registro de usuarios nuevos **cerrado**;
  - proveedor Google;
  - claves legacy anon/service_role desactivadas;
  - plan Free;
  - Site URL `localhost` (solo de respaldo).

### Registro Dev
- Mismas 4 migraciones y proveedor Google. El registro está **abierto** para pruebas.
- Datos de prueba que se quedan sin acción: el elemento `[prueba F6.3]` en `backlog` y el tombstone "Venta" en `finance_categories` (6.6). El usuario sintético de la 6.2 se borró (cascade verificado).

### Versiones y commits
- `app.json`: `versionName` 1.3.7, `versionCode` 11. Para cada APK que se vaya a instalar, subir los dos (las versiones no pueden bajar).
- Expo SDK 54 (`expo` 54.0.38), React Native 0.81.5, `expo-sqlite` 16.0.10 (SQLite 3.50.3, sin modo de solo lectura), auth-js 2.118.
- Commits de la Fase 6:
  - `97fb9b6` / `ceed19b` (6.1)
  - `15017ff` (6.2)
  - `09be20b` (6.3)
  - `ed06602`, `f3772d9` (6.4)
  - `dcdc59d`, `29f5a32` (6.5)
  - `378a164`, `6277242` (6.6)
  - `c01c283`, `9950d0d` (6.7)
  - `f97227f` (cierre de la Fase 6).
- Commits de la Fase 7:
  - `89a3514` (7.1, implementación) y `d4bad14` (cierre de la 7.1);
  - `d55b5e1` (7.2) y `758e7de` (diseño y cierre de la 7.2);
  - `241c26e` (7.3, implementación), `45f5cda` (cierre de la 7.3) y `0d8d327` (diseño con I1–I6 y 7.4 dividida);
  - `90ea3b5` (7.4a), `47f358c` (corrección de la 7.4a) y el commit de este cierre.

### Credenciales (nombres y ubicación, nunca valores)
- `.env` (fuera de git; plantilla `.env.example`): `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (Poguis) y `EXPO_PUBLIC_SUPABASE_DEV_URL` / `EXPO_PUBLIC_SUPABASE_DEV_PUBLISHABLE_KEY` (Registro Dev). Solo claves `sb_publishable_`; 0 secret keys en los dos proyectos.
- Firma del release: keystore de EAS (perfil preview). Las 4 propiedades `REGISTRO_UPLOAD_*` están en `%USERPROFILE%\.gradle\gradle.properties`, fuera del repo. Nunca leerlas, mostrarlas ni copiarlas, ni regenerar el keystore.
- Google: un cliente OAuth Web compartido por los dos proyectos, con 1 client secret activo (rotado el 2026-11-08). La pantalla de consentimiento está en modo Testing.
- Comprobación: `escanear-historial` y `verificar-secretos` (también con `--apk`) dan 0 secretos en el repo, el historial y los APK.

### Archivo permanente
- `registro_respaldo_20261111-202909` (`.db` y `.json`, app 1.3.3, `user_version` 4, con las 16 `legacy_*`), sin contraseña.
- Ubicación: `.local-data/fase6-7/prod/archivo/` y Google Drive, carpeta `RESPALDO/PROD`. **No se borra nunca.**

## 2. Forma de trabajo que funcionó
- **Plan antes de tocar nada:** plan mode, el usuario revisa el plan y lo aprueba (a veces con condiciones). Una subfase = como máximo un APK, y no se juntan subfases.
- **Etapas por subfase:**
  - **A.** Plan, implementación y verificación en la PC: suites `probar-*` contra node:sqlite y PGlite con el código real, más las anteriores. Se muestran los resultados y se espera el OK.
  - Commit en `main`, con `git add` explícito por archivo.
  - APK dev (`npm run build:dev`).
  - **B.** El usuario prueba Registro Dev en el celular.
  - APK de producción (`npm run build:release`, que falla si la huella no es `3132ded2…3e52`).
  - **D.** El usuario instala en el celular.
  - **E.** Validación, documentación y commit de cierre.
- **Dev siempre antes que producción.** Los experimentos van contra Registro Dev; nunca un APK de producción en un emulador con datos de prueba.
- **Protocolo de instalación en producción:**
  1. respaldo "antes" desde la app;
  2. `install -r` encima, sin desinstalar, comprobando la firma y el `firstInstallTime`;
  3. abrir y comprobar los datos y el indicador;
  4. respaldo "después";
  5. `validar-respaldo` de los dos y `comparar-sync` antes vs después (15 tablas, mismo saldo);
  6. el usuario ejecuta `supabase/verificar-fase5.sql` en el SQL Editor de **Poguis**, comprobando que es Poguis y no Registro Dev, y se compara con "después".
- **El usuario aplica a mano** todo lo que toca los proyectos remotos (SQL Editor, dashboards). Claude Code solo escribe archivos y los prueba en local.
- **Revisar con lupa lo que se propone.** El usuario detectó errores reales en los planes y el SQL (la consulta B de la 6.6, plegada por Postgres al planificar). Una prueba que falla se arregla en la implementación, no cambiando la prueba sin justificarlo; las referencias se fijan contra el commit original.
- `.local-data/` es de solo lectura para Claude Code (las copias de trabajo van al scratchpad), sin imprimir valores de `.env`, contraseñas ni contenido de filas. `adb` solo con el emulador (`-s emulator-5554`) cuando se autorice; el celular lo maneja el usuario.
- Git: solo `main`; nunca push, merge, rebase, reset --hard ni clean.

- **Fixtures de prueba (7.1):** las suites leen `.local-data/fixtures-saneados/` (o `REGISTRO_FIXTURES_DIR`) a través de `scripts/lib/fixtures.mjs`. Los originales se borraron, así que esa carpeta ya no se puede regenerar: hay que conservarla.
  - El usuario guarda una copia (los 7 `.db` y `manifest.json`) en Google Drive, carpeta `RESPALDO/FIXTURES`. Se trata como dato privado: 2 fixtures tienen datos reales del celular, aunque sin contraseña.
  - Al restaurarla, `fixture()` valida cada copia contra el SHA-256 de `manifest.json`. Si falta algo o no coincide, las suites fallan con un mensaje claro.

## 3. Backlog de la Fase 7 (sin orden decidido; cada punto se planifica y aprueba aparte)
Cerrado: el punto 7 (7.1, ver §5). Los demás siguen pendientes.
1. **PIN / huella** para abrir la app. Cuidar que no rompa el offline-first: con datos locales la app siempre abre.
2. **Realtime** (cambios que llegan sin esperar al ciclo de 2 min). Hoy no está en la publicación de Realtime (auditoría 6.1); hace falta revisar RLS y el consumo del plan Free.
3. **Play Store / Play App Signing.** Hoy está fuera de alcance según el [OK] de Alcance, hasta que la app funcione al 100 % para uso personal. Implica la clave de subida frente al keystore de EAS actual: planificarlo sin perder la posibilidad de instalar encima.
4. **Restaurar un respaldo dentro de la app** ([PENDIENTE]). Hay que decidir qué pasa con la sync, la outbox y el `user_id`.
5. **JWT signing keys:** migrar y revocar el secreto JWT legacy ([PENDIENTE]). **Antes, investigar el efecto sobre las sesiones activas** (si cierra la sesión del celular y cómo se recupera, también sin red). Riesgo teórico: `service_role` nunca se filtró y las claves legacy ya están desactivadas como API keys.
6. **Borrar u ocultar categorías de dinero** desde la interfaz (IDEA de la 6.6). Además, Dinero también muestra los nombres usados en `balance_history` (`getDistinctCategories`).
7. ~~**Fixtures saneados** para cerrar el grupo B de copias con contraseña.~~ **[CERRADA 2026-11-16, 7.1, implementación `89a3514`]** (ver §5).
8. Otras ideas anotadas:
   - **Pantalla de consentimiento de Google en Testing:** Google muestra "Google no verificó esta app". Valorar publicarla si llega a la Play Store.
   - **Sin verificar en un dispositivo:**
     - la reconexión dentro de los 60 s de enfriamiento de auth-js seguida del ciclo por `TOKEN_REFRESHED` (solo en `probar-fase5`);
     - una cuenta Google distinta bloqueada (solo en `probar-fase3`).
   - **Descartado:** el cursor para las tablas vacías (DECISIONES.md, Descartado).
9. **Rediseño de entretenimiento (subfases 7.3–7.10):** ver `claude/DISENO-ENTRETENIMIENTO.md`. El análisis previo (7.2, §6), el motor puro (7.3, §7) y la 7.4a (§8) están cerrados; sigue la 7.4b.

## 4. [PENDIENTE] vigentes (DECISIONES.md)
- **Restaurar un respaldo dentro de la app.**
- **JWT signing keys** (backlog de la Fase 7; investigar primero las sesiones).
- ~~Grupo B de copias con la contraseña antigua en `.local-data/`~~: resuelto en la 7.1 (pasa a [OK]). El grupo A (26) lo borró el usuario.

## 5. Fase 7.1 — fixtures saneados [CERRADA 2026-11-16]
- **Implementación:** `89a3514`. Scripts nuevos:
  - `scripts/lib/fixtures.mjs`;
  - `scripts/sanear-fixtures.mjs`;
  - `scripts/escanear-contrasenas.mjs`;
  - `scripts/probar-fase7-1.mjs`.
  Las suites leen las copias saneadas y nunca los originales. Sin cambios en `src/`, la app, versiones, migraciones ni `supabase/`.
- **Composición real del grupo B:** 7 fixtures y sus 4 copias `dryrun-fase1/*/antes/` tenían la contraseña real. Las 5 salidas de `probar-fase0/1` tenían valores ficticios propios, ahora sintéticos.
- **Verificación:** línea base en `f97227f` y tres corridas completas, con `probar-fase4` siempre sola: con `REGISTRO_FIXTURES_DIR`, con las copias definitivas del usuario y después de borrar los originales. Siempre los mismos conteos (`probar-fase3` 104, con +5 por la comprobación nueva; `probar-fase4` 88). `probar-fase7-1`: 26 OK con originales y 25 sin ellos (la rama "originales ya borrados" tiene una comprobación en vez de dos; 25 es el resultado normal desde el 2026-11-16).
  - `escanear-contrasenas`: 0 "real" en `.local-data/`.
  - `escanear-historial` y `verificar-secretos`: 0 hallazgos.
- **Hallazgos para el usuario (sin acción de Claude Code):**
  - `.local-data/emulador-credenciales.txt` (143 B): Claude Code no lo abrió. Puede tener credenciales del emulador en claro, y `escanear-contrasenas` no mira `.txt` ni `.log`. Lo revisa el usuario.
  - `.local-data/pruebas-fase4-dbg/`: un solo archivo, `F/app_registro_v3.db` (446.464 B, 2026-11-01), sin contraseña. Ningún script actual lo genera: es un resto de la depuración de la Fase 4.
  - **Respaldos `.db` anteriores a la migración 3** que se hayan compartido fuera de la PC (Google Drive, Descargas, chats o correo al usar la hoja de compartir de Android): la copia física conserva la contraseña antigua (DECISIONES.md, Seguridad); los `.json` la llevan como `[OCULTO]`. Revisarlos y borrarlos donde estén. El archivo permanente de Drive `RESPALDO/PROD` (`registro_respaldo_20261111-202909`, `user_version` 4) es posterior a la migración 3 y no la tiene.

## 6. Fase 7.2 — análisis [CERRADA 2026-11-17]
- **Commit:** `d55b5e1`. Solo lectura: sin cambios en `src/`, la app, el esquema, `supabase/` ni versiones; sin APK.
- **`docs/ENTRETENIMIENTO-ACTUAL.md`:** cómo funcionan hoy Pendiente, Series/Anime y Lectura, con referencias archivo:línea. Incluye el mapa de pantallas, el modelo de datos, estados, ciclo, cuotas, lectura, Pendiente, punto de inicio, la tabla de brechas, los riesgos R1–R14 y un anexo con el estado de React y los métodos de `db.js` de cada función de pantalla.
- **`scripts/probar-fase7-2.mjs`: 17 OK.** Son 14 casos de caracterización (C1–C14) como tablas de entrada → resultado actual (el oráculo para la 7.3), más la extracción y 2 pruebas negativas.
  - La suite ejecuta el código real de las pantallas: extrae las funciones con `@babel/parser` y `@babel/traverse`, dependencias transitivas que no están en `package.json`.
  - Usa solo datos sintéticos.
- **Hallazgos clave:**
  - **La lógica de la cola y del orden vive en closures de las pantallas** (R14), y las de lectura son copias de las de video (R13).
  - **C9 recalcula el pasado:** la frecuencia de lectura y la fecha de inicio (lectura y video) no tienen historial; solo las cuotas por día lo tienen (C4).
  - **El historial no se usa para contar:** el progreso sale del puntero (puntero − inicial, +1 si está cerrada, + `cycle_offset`). Eso explica R5–R8, y la grilla mueve el puntero sin escribir historial (R7).
  - **Datos de producción** (respaldo "segundo" de la 6.7): 1 categoría de video, 1 serie, 1 temporada y 11 filas en `watch_history`; nada de lectura; `backlog` solo con los 4 tombstones de prueba. El usuario los borra desde la app y el rediseño no los migra (`claude/DISENO-ENTRETENIMIENTO.md`, Alcance).
- **Siguiente:** el rediseño, subfases 7.3–7.10, según `claude/DISENO-ENTRETENIMIENTO.md`.

## 7. Fase 7.3 — motor puro [CERRADA 2026-11-18]
- **Commit:** `241c26e`; APK **1.3.5 / versionCode 9**. Sin cambios en `src/data/`, `src/sync/`, `backlogUtils.js`, migraciones ni `supabase/`.
- **Módulos puros en `src/entertainment/`**, compartidos por video y lectura. No usan React, SQLite, `Alert` ni `db`, y la fecha entra como parámetro. Devuelven datos y decisiones; las pantallas ejecutan los efectos (alertas con sus textos y escrituras en `db`, en el mismo orden).
  - `queue.ts`: `buildQueue`, `episodesForSeries`, `decideMarkWatched`. Antes eran `generateInterleavedList`, `generateEpisodesForSeries` y el cálculo de `onMarkWatched` en los dos registros.
  - `seriesDetail.ts`: `filterSeriesByTab`, `reorderActive`, `validateSeriesForm`, `isActiveLimitReached`, `buildSeriesSave`, `appendSeasonRow`/`removeSeasonRow`, `decideChapterTap`, `resolveProgressStatus`, `restartWatchedCount`, `decideTogglePause`, `categoryPauseDates`. Antes estaban dentro de los dos detalles.
  - Las 4 pantallas (`ChapterRegistryScreen`, `ReadingRegistryScreen`, `SeriesDetailScreen`, `ReadingDetailScreen`) llaman al motor. `SeriesAnimeScreen` y `BacklogScreen` no cambian.
  - **Comportamiento idéntico**, incluidos los bugs R1–R14 y R15 (temporada de 0 capítulos: `QueueVariant`). Se corrigen en la 7.4.
- **Pruebas en la PC:**
  - `scripts/probar-fase7-3.mjs` (**19 OK, 0 diferencias**): equivalencia con el código de `d55b5e1`, extraído con `git show`, en tres niveles:
    - los 14 casos;
    - la cola (nivel puro);
    - 13 familias de funciones de pantalla (nivel efectos): llamadas a `db` con sus argumentos y en orden, alertas, setters y cada botón, sobre 600 entradas por variante con semilla fija. Las excepciones se comparan por tipo y mensaje.
    - Incluye 2 controles negativos.
  - `scripts/probar-fase7-2.mjs`: **17 OK con `CASOS` intacto** (idéntico a `d55b5e1`). Inyecta el motor y obtiene la cola con el `loadData` real de cada registro.
  - Extractor compartido: `scripts/lib/extraer-pantalla.mjs`.
  - El resto de suites en verde, en serie, con `probar-fase4` sola (88 OK). `probar-fase3`: la versión fija pasa a 1.3.5 / 9.
  - `expo-doctor` 18/18 y `expo export` sin errores. `escanear-historial` y `verificar-secretos` en 0.
- **Registro Dev:** 1.3.5 instalada encima con el mismo `firstInstallTime`. La lista de verificación dio todo OK, y los pasos 1–3 (C1: cola, atraso, orden incorrecto) dieron igual que en la 1.3.4.
- **Producción, con el protocolo completo:**
  - respaldo "antes" (app 1.3.4) con "Sincronizado" y sin pendientes;
  - `install -r` de la 1.3.5 con la firma EAS `3132ded2…3e52` comprobada, de versionCode 8 a 9 y con el mismo `firstInstallTime`;
  - respaldo "después" (app 1.3.5);
  - los dos válidos (formato 2, `user_version` 5, outbox vacía) y `comparar-sync` idénticos en las 15 tablas, con el mismo saldo;
  - `verificar-fase5` en Poguis: 16/16 = "después" (31 / 12 / 19, un `user_id`).
- Observaciones del celular: O1 (límite obligatorio, mínimo 1, avisado al tocar Agregar; reemplaza R2) y O2 (Pendiente/Visto en el Registro de lectura) → 7.4a; O3 (Continuar y Volver a ver desde En espera y Terminado) → 7.6. Lista viva e ideas I1–I6 en claude/DISENO-ENTRETENIMIENTO.md.
- **Siguiente:** la 7.4 (correcciones del motor y fuente de verdad), según el diseño.

## 8. Fase 7.4a — historial como conteo, ciclo y correcciones [CERRADA 2026-11-20]
- **Commits:** `90ea3b5` (implementación, APK 1.3.6 / vc 10, solo Registro Dev) y `47f358c` (corrección tras la prueba del celular, APK **1.3.7 / versionCode 11**). Sin cambios de esquema, migraciones, `src/sync/` ni `supabase/`.
- **Qué cambió:**
  - **El historial cuenta lo visto:** `watched_count` de una serie = sus filas vivas de `watch_history` + `reading_history`; `totalWatched` de una categoría = la suma de TODAS sus series vivas (también pausadas y cerradas). El puntero solo dice cuál es el siguiente; `initial_*` y `cycle_offset` ya no cuentan.
  - **La grilla es "marcar vistos hasta aquí":** hacia adelante escribe una fila por capítulo en una sola transacción y pide confirmación con más de 1; hacia atrás pregunta "¿Desmarcar desde…?" y borra la fila más reciente de cada capítulo. En el último capítulo sigue la alerta En espera / Terminado.
  - **Ciclo:** la serie nueva va al final de la vuelta en curso. La pausada que se reanuda entra en esa vuelta y **conserva su lugar** (E3 opción B, decidida tras la prueba de la 1.3.6).
  - **Corregidos:** R1, R2, R5–R8, R15 y R16 (hueco de temporadas). **Cerradas:** O1 (límite obligatorio ≥ 1, aviso antes del formulario), O2 (pestañas del Registro de lectura en modo oscuro) y O4 (temporadas de al menos 1 capítulo).
- **Pruebas en la PC:**
  - `scripts/probar-fase7-4a.mjs`: **35 OK** (ciclo E1–E3, escenario P4 y flechas con una pausada, grilla, R8, reiniciar, R1, cabecera del Registro, R15, hueco, O1, O4, outbox y sync de un `interleave_offset` negativo por PGlite).
  - `probar-fase7-2`: **17 OK**; `CASOS` cambia solo en C2, C3, C7, C11 y C12 frente a `241c26e`.
  - `probar-fase7-3`: **12 OK, 0 diferencias** frente a `241c26e` en las familias que no cambian.
  - El resto de suites en verde, en serie, con `probar-fase4` sola (88 OK). `expo-doctor` 18/18, `expo export` sin errores, `escanear-historial` y `verificar-secretos` en 0.
- **Registro Dev:** la 1.3.6 (P1–P13) y la 1.3.7 (P4, flechas, P2, P5 y P12), todo OK.
- **Producción, con el protocolo completo:**
  - respaldo "antes" (app 1.3.5);
  - `install -r` de la 1.3.7 con la firma EAS `3132ded2…3e52` comprobada, de versionCode 9 a 11 y con el mismo `firstInstallTime`;
  - respaldo "después" (app 1.3.7);
  - los dos válidos y `comparar-sync` idénticos en las 15 tablas, con el mismo saldo;
  - `verificar-fase5` en Poguis = "después" en las 16 filas (31 / 12 / 19, un `user_id`).
- **Siguiente:** la 7.4b (con migración, primero en Supabase), según el diseño.
