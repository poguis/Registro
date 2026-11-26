# Traspaso a la Fase 7

Estado al cerrar la Fase 6 (2026-11-11, commit `f97227f`), actualizado al cerrar la 7.1 (2026-11-16), la 7.2 (2026-11-17), la 7.3 (2026-11-18), la 7.4a (2026-11-20), la 7.4b (2026-11-21), la dirección visual (2026-11-22), la 7.5 (2026-11-23) y la 7.5b1 (2026-11-25). Las fases 0–6 están cerradas; el detalle de cada una está en DECISIONES.md (Fases) y CLAUDE.md. El traspaso anterior (`claude/TRASPASO-FASE6.md`) queda como histórico.

## 1. Estado actual

### Celular del usuario
- **Registro (producción)** `com.poguis.Registro`: **1.4.4 / versionCode 18** (7.5b1, 2026-11-25), firma EAS `31:32:DE:…:3E:52`, instalada siempre encima (`install -r`), mismo `firstInstallTime` desde 2026-09-21 (07:49:29). Sync encendida contra **Poguis**. BD local `user_version` **8**: sin `legacy_*` ni columna `password`, con `entertainment_quotas_history.frequency` (7.4b), `series.backlog_id` y `backlog.subtype` (7.5), y la tabla `backlog_tags` y `backlog.tags` (7.5b1; la tabla vacía y las etiquetas en NULL).
- `respaldos/` del celular: los 10 respaldos manuales más recientes y la copia pre-migración más reciente (hoy la `pre-migracion-v8`); 0 copias con la contraseña antigua (retención de la 6.7).
- **Registro Dev** `com.poguis.Registro.dev`: **1.4.4 / versionCode 18** (`user_version` 8), firma `debug.keystore` `fac61745…`, contra **Registro Dev**, instalada encima con el mismo `firstInstallTime` (2026-11-02 13:00:52). El celular tiene Android 17 (SDK 37), con borde a borde obligatorio. Se instala al lado de la app real y tiene su propia BD.

### Poguis (producción)
- **Conteos vigentes** (`verificar-fase5` en Poguis tras instalar la 1.4.4, 2026-11-25; idéntico tabla por tabla al respaldo "después"): **31 filas** en las 16 tablas sincronizadas, **12 vivas y 19 borradas**, un `user_id`, las 17 filas `ok`. Por tabla: `balance_history` 3/3/0, `finance_categories` 6/6/0, `entertainment_categories` 1/0/1, `entertainment_quotas_history` 1/0/1, `series` 1/0/1, `seasons` 1/0/1, `watch_history` 11/0/11, `backlog` 4/0/4, `work_people` 3/3/0, **`backlog_tags` 0/0/0** y las otras 6 en 0.
- Historia de los conteos: 31 / 12 / 19 desde el "después" de la 7.3 (2026-11-18). **Sin cambios en la 7.4a** (2026-11-20: `verificar-fase5` = "después", 31 / 12 / 19, un `user_id`) **ni en la 7.4b** (2026-11-21: `verificar-fase5` = "después" en las 16 filas, 31 / 12 / 19, un `user_id`; `auditar-fase6` 18/18 estrictos) **ni en la dirección visual** (2026-11-22: sin SQL; `verificar-fase5` = "después" en las 16 filas, 31 / 12 / 19, un `user_id`) **ni en la 7.5** (2026-11-23: migración 6; `verificar-fase5` = "después" en las 16 filas, 31 / 12 / 19, un `user_id`) **ni en la 7.5b1** (2026-11-25: migración 7; `verificar-fase5` = "después" en las 17 filas, 31 / 12 / 19 y `backlog_tags` 0/0/0, un `user_id`).
- **Diferencia con la 6.7** (30 / 26 / 4, que coincide con su `verificar-fase5-poguis.json`):
  - +1 fila viva en `balance_history` (de 2 a 3), un movimiento del usuario;
  - 15 tombstones de entretenimiento: 1 categoría, 1 cuota, 1 serie, 1 temporada y 11 filas de `watch_history`. El usuario los borró desde la app antes de la 7.3, como decidió el diseño (Alcance), y quedan para siempre igual que los de la 6.8.
- Las otras 4 borradas son los tombstones de prueba de `backlog` (`[prueba RLS]` y 3 `[prueba F5]`). **Se quedan** (6.8, decisión del usuario).
- Esquema: las **7** migraciones de `supabase/migrations/` (la 5.ª, `20261121000100_frecuencia_cuotas.sql`, de la 7.4b; la 6.ª, `20261122000100_vinculo_pendiente.sql`, de la 7.5; la 7.ª, `20261124000100_etiquetas.sql`, de la 7.5b1, aplicada el 2026-11-25 justo antes del `install -r`), RLS en las **16** tablas, sin DELETE, sin `security definer`. Verificaciones tras la 7.ª: `verificar-fase7-5b1` 20/20, `verificar-fase2` 22/22 (16 tablas, fila 18 = 8 FK compuestas) y `auditar-fase6` con todos los estrictos ok (informativo #31, tamaño de la base: 12 MB).
- Auth:
  - registro de usuarios nuevos **cerrado**;
  - proveedor Google;
  - claves legacy anon/service_role desactivadas;
  - plan Free;
  - Site URL `localhost` (solo de respaldo).

### Registro Dev
- Mismas **7** migraciones (la 6.ª aplicada antes del APK 1.4.0 y la 7.ª antes del APK 1.4.2, cada una con sus verificaciones: `verificar-fase7-5` 15/15, `verificar-fase7-5b1` 20/20, `verificar-fase2` 22/22, `auditar-fase6` con todos los estrictos ok) y proveedor Google. El registro está **abierto** para pruebas.
- **Datos de la 7.5b1:** los títulos y las etiquetas de las pruebas de la 7.5b1 (pasos 3.x, 4.x y 6.x) **se conservan hasta cerrar la 7.5b2**, para probar los filtros y el selector. El respaldo final de la 1.4.2 coincidió con `verificar-fase5` de Registro Dev (17/17), con `backlog.tags` en forma canónica y el catálogo sin anomalías.
- **Datos anteriores:** al cerrar la 7.5 el usuario borró desde la app todos los datos de prueba (las categorías de la 7.4b —"Video 7.4b", "Lectura 7.4b"— y de la 7.5, sus series y todo Pendiente, incluido `[prueba F6.3]`). Sus tombstones quedan. Sigue el tombstone "Venta" en `finance_categories` (6.6). El usuario sintético de la 6.2 se borró (cascade verificado).

### Versiones y commits
- `app.json`: `versionName` 1.4.4, `versionCode` 18. Para cada APK que se vaya a instalar, subir los dos (las versiones no pueden bajar).
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
  - `90ea3b5` (7.4a), `47f358c` (corrección de la 7.4a) y `6fbc2c6` (cierre de la 7.4a);
  - `20ad1cb` (7.4b) y `bd17bb9` (cierre de la 7.4b);
  - `c8eb200` (dirección visual) y `6a1722f` (cierre de la dirección visual);
  - `c2c42c2` (7.5, APK 1.4.0 / vc 14, solo Registro Dev), `1f1eec8` (corrección tras la prueba del celular, APK 1.4.1 / vc 15) y `0154e5d` (cierre de la 7.5);
  - `78ae675` (diseño: orden tras la 7.5 y decisiones de O11, O13 y O14);
  - `1d8d756` (7.5b1, APK 1.4.2 / vc 16, solo Registro Dev), `a0a4cfc` (corrección 1, APK 1.4.3 / vc 17, solo Registro Dev), `78d8755` (corrección 2, APK 1.4.4 / vc 18) y el commit de este cierre.

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
  2. `install -r` encima, sin desinstalar, comprobando la firma y el `firstInstallTime`. `apksigner` está en `D:\Users\Carlos\AppData\Local\Android\Sdk\build-tools\36.0.0\apksigner.bat` (la 34.0.0 no existe en esta PC; `scripts/build-apk.mjs` usa la 36.0.0);
  3. abrir y comprobar los datos y el indicador;
  4. respaldo "después";
  5. `validar-respaldo` de los dos y `comparar-sync` antes vs después (16 tablas desde la 7.5b1, mismo saldo);
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
9. **Rediseño de entretenimiento (subfases 7.3–7.10):** ver `claude/DISENO-ENTRETENIMIENTO.md`. El análisis previo (7.2, §6), el motor puro (7.3, §7), la 7.4a (§8), la 7.4b (§9), la dirección visual (§10) la 7.5 (§11) y la 7.5b1 (§12) están cerrados; el orden siguiente quedó [OK] el 2026-11-23 en el diseño (7.5b2 Pendiente, 7.6, 7.7 Lectura, 7.7b Películas, 7.8…). El rediseño completo de las pantallas va al final, después de la 7.11 (decisión del usuario, 2026-11-22).
10. **FK local `seasons → series` en el pull** (hallazgo de la 7.5, anterior a ella; sin corregir). Las FK locales de la migración 2 son diferidas: si otro dispositivo sube una serie y sus temporadas entre el pull de `series` y el de `seasons` de este, la página de `seasons` falla al confirmar. La excepción sale de `localTx` sin capturar y el runner solo la escribe en la consola: ese ciclo no deja `last_error`, no bloquea filas y no baja las tablas siguientes. El ciclo siguiente lo corrige solo. Probado en `probar-fase7-5` §12a. La 7.5 evitó el mismo problema en `series.backlog_id` dejándolo sin FK local.

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
- **Siguiente:** la 7.4b (con migración, primero en Supabase), según el diseño. Cerrada: ver §9.

## 9. Fase 7.4b — historial de ritmo, fecha de inicio fija y R10–R12 [CERRADA 2026-11-21]
- **Commit:** `20ad1cb`; APK **1.3.8 / versionCode 12**. Migración 5 de Supabase (`supabase/migrations/20261121000100_frecuencia_cuotas.sql`, solo aditiva) y migración local 6 (`src/data/db/migration6.ts`, copia `pre-migracion-v6`). Verificación de solo lectura: `supabase/verificar-fase7-4b.sql` (9 filas).
- **Qué cambió:**
  - **El ritmo cambia desde mañana:** cuotas por día y, en lectura, frecuencia. El período vigente cierra hoy y se abre uno nuevo desde mañana, así que ni la meta de hoy ni la de los días anteriores cambian.
  - **R10:** otra edición del mismo día actualiza el período que empieza mañana; si deshace el cambio, ese período se borra y el anterior se reabre. Nunca queda un período con fin anterior a su inicio.
  - **R11:** la comparación es por contenido (cuotas normalizadas a los 7 días, sin depender del orden de las claves, y la frecuencia en lectura). Una edición sin cambios, o que solo toca el nombre, la descripción o el límite, no crea período.
  - **La frecuencia va en el historial** (`entertainment_quotas_history.frequency`). Un período de lectura de antes (NULL = la de la categoría) se congela con ese valor al cerrarse.
  - **"1 cada N":** fracciones exactas por período, redondeando solo el total. Los días de atraso y adelanto se expresan en el N de hoy y de mañana; con un solo período es la fórmula de siempre.
  - **Fecha de inicio:** fija con registros (en la pantalla, con el texto "La fecha de inicio no se puede cambiar porque ya hay registros.", y en el repositorio). Sin registros es editable y el primer período se mueve con ella.
  - **R12:** reanudar una pausa el mismo día en que empezó la borra lógicamente. Nota: como la pausa no tuvo efecto, hoy vuelve a contar para la meta.
- **Pruebas en la PC:**
  - `scripts/probar-fase7-4b.mjs`: **24 OK**.
  - `probar-fase7-2`: **17 OK**; `CASOS` cambia en C4, C9 y C14.
  - `probar-fase7-3`: **12 OK**.
  - El resto de suites en verde, en serie, con `probar-fase4` sola (88 OK).
  - Compatibilidad 1.3.7 ↔ 1.3.8 probada con PGlite y el código real de `47f358c`:
    - **a.** la 1.3.7 contra un servidor CON la columna: pull sin fallos y su push conserva `frequency`;
    - **b.** la 1.3.8 contra un servidor SIN ella: filas bloqueadas, que suben tras el SQL y "Reintentar".
  - Privilegios de la tabla y de sus columnas idénticos antes y después de la migración.
- **Hallazgo:** C14 pasaba sin probar nada desde la 7.2 (`every` sobre una lista vacía). Ahora usa `some` y `pausasVivas`.
- **Registro Dev:**
  - SQL aplicado, `verificar-fase7-4b` 9/9;
  - partes HOY y MAÑANA de la lista, todo OK;
  - el respaldo HOY tenía 2 períodos por categoría editada, la frecuencia 2 congelada y las pausas sin efecto borradas.
- **Producción, con el protocolo completo:**
  - respaldo "antes" (app 1.3.7, v5);
  - SQL en Poguis (`verificar-fase7-4b` 9/9) justo antes del `install -r` de la 1.3.8, con la firma EAS `3132ded2…3e52`, de versionCode 11 a 12 y con el mismo `firstInstallTime`;
  - respaldo "después" (app 1.3.8, v6, con `pre-migracion-v6`);
  - los dos válidos y `comparar-sync` idénticos en las 15 tablas, con el mismo saldo;
  - `verificar-fase5` = "después" en las 16 filas (31 / 12 / 19, un `user_id`) y `auditar-fase6` 18/18.
- **Siguiente:** la dirección visual (O5 y el diseño visual de las ideas), antes de la 7.5. Cerrada: ver §10.

## 10. Dirección visual — tema A, tipografía, hojas propias y nombres largos [CERRADA 2026-11-22]
- **Commit:** `c8eb200`; APK **1.3.9 / versionCode 13**. Solo visual: sin cambios de esquema (`user_version` 6), migraciones, `src/entertainment/`, `src/data/`, `src/sync/`, `src/services/`, `src/auth/` ni `supabase/`; sin SQL.
- **Qué cambió:**
  - **Tema A "Hueso y petróleo"** (claro y oscuro) en `src/contexts/ThemeContext.js`, única fuente de colores, fuentes y radios. Las pantallas usan tokens (`theme.*` o `makeStyles(t)`), nunca colores fijos. Se conserva la preferencia `app_theme`; "seguir el sistema" no se agrega.
  - **Plus Jakarta Sans** 400/500/600/700 embebida con el plugin de `expo-font`; `src/components/AppText.js` (`Text` y `TextInput`) pone la familia de cada peso.
  - **Hojas propias (O6):** `BottomSheet`, `Toast`, `SheetProvider` (cola, de a una) y `useSheet` (`confirm` / `informar` / `avisar`) reemplazan los 78 `Alert.alert`, con los mismos textos. Sin excepciones.
  - **Nombres largos:** 2 líneas en filas y tarjetas, 3 en el título del detalle, 2 en la categoría de una cabecera, 1 con elipsis en subtítulos y metadatos; los mensajes de las hojas, completos.
  - **Barras:** borde a borde (`edgeToEdgeEnabled`), una sola `StatusBar` en la raíz y `expo-navigation-bar` solo para el color de los íconos. Splash `#F6F1E8`; el ícono adaptativo no cambió.
  - **Colores de identidad** con los tonos del tema: tipos y estados de Pendiente, crédito (azul) y débito (verde), lo que debo (rojo) y lo que me deben (azul), ingreso y gasto, y los turnos y resaltados de Trabajo.
- **Pruebas en la PC:**
  - `scripts/probar-tema.mjs` (nuevo): **48 OK**. Comprueba contrastes, 0 `Alert.alert`, 0 colores fijos, 0 tokens viejos, fuentes, la hoja, el aviso, los proveedores y que no hay cambios de esquema.
  - `probar-fase7-2` **17 OK** con `CASOS` intacto, `7-3` **12 OK** con 0 diferencias, `7-4a` **35 OK** y `7-4b` **24 OK**.
    - Solo cambia el mecanismo: `scripts/lib/hojas-stub.mjs` traduce las hojas al registro de `Alert`.
    - En la 7-3, el registro `retorno` se compara al final cuando hubo una alerta con botones, porque la función nueva espera la elección.
  - El resto de suites en verde, en serie, con `probar-fase4` sola (88 OK). `probar-fase3`: la versión fija pasa a 1.3.9 / 13.
  - `expo-doctor` 18/18, `expo export` sin errores, `escanear-historial` y `verificar-secretos` en 0.
- **Registro Dev:** 1.3.9 instalada encima. La lista por pantalla, en modo claro y oscuro, dio todo OK: nombres largos, hojas, aviso, Atrás, barras y fuente en modo avión.
- **Producción, con el protocolo completo:**
  - respaldo "antes" (app 1.3.8, v6);
  - `install -r` de la 1.3.9 con la firma EAS `3132ded2…3e52` comprobada, de versionCode 12 a 13 y con el mismo `firstInstallTime` (2026-09-21);
  - respaldo "después" (app 1.3.9, v6);
  - los dos válidos (formato 2, `user_version` 6, outbox vacía) y `comparar-sync` idénticos en las 15 tablas, con el mismo saldo;
  - `verificar-fase5` en Poguis = "después" en las 16 filas (31 / 12 / 19, un `user_id`).
- **Pendientes para una subfase de pulido** (sin corregir aquí; detalle en `claude/DISENO-ENTRETENIMIENTO.md`):
  - **B1:** en Dinero, "Seleccionar Rango" usa `now`, que no está definido; si el año queda vacío, la pantalla lanza un error.
  - **B2:** el formulario de Trabajo no tiene `onRequestClose`, así que Atrás no lo cierra.
  - **O7:** textos mejorables de las alertas.
- **Decisión del usuario (2026-11-22):** esta subfase aplicó solo la base visual. El rediseño completo de las pantallas va al final, después de la 7.11; "Hoy te toca" sigue en la 7.9.
- **Siguiente:** la 7.5, según el diseño. Cerrada: ver §11.

## 11. Fase 7.5 — vínculo Pendiente↔Series/Lectura y subtipo [CERRADA 2026-11-23]
- **Commits:** `c2c42c2` (APK 1.4.0 / vc 14, solo Registro Dev) y `1f1eec8` (corrección tras la prueba del celular, APK **1.4.1 / versionCode 15**). Migración 6 de Supabase (`supabase/migrations/20261122000100_vinculo_pendiente.sql`, solo aditiva) y migración local 7 (`src/data/db/migration7.ts`, copia `pre-migracion-v7`). Verificación de solo lectura: `supabase/verificar-fase7-5.sql` (15 filas).
- **Qué cambió** (decisiones D1–D9 en `claude/DISENO-ENTRETENIMIENTO.md`, "Pendiente ↔ Series/Lectura"):
  - **D1** `series.backlog_id` (la serie es la hija), con FK compuesta en el servidor y **sin FK local**. Un título tiene como máximo una serie viva vinculada, sin UNIQUE.
  - **D2** `backlog.status` guardado. Lo escribe solo `writeBacklogStatus`, desde el reflejo (`reflectLinkedBacklogStatus`), la liberación (`releaseLinkedTitles`) y la reconciliación (`reconcileLinkedTitles`, tras el pull completo de `series`). La etiqueta se lee de la serie.
  - **D3** las series sin vínculo quedan heredadas, sin acción "Vincular".
  - **D4** el nombre de la serie y el título de Pendiente se mantienen iguales en la misma transacción.
  - **D5 (versión final, corrección)** borrar una categoría borra sus series u obras vinculadas con su progreso, y sus títulos **vuelven a Pendiente sin vínculo** (y al selector). Borrar desde el detalle o desde Pendiente sigue borrando los dos lados.
  - **D6** en Pendiente, Mirando no se pone a mano en serie, anime ni lectura. Sin vínculo se alterna Pendiente ↔ Terminado, y pasar a Terminado pide confirmación ("Marcar como Terminado"). Las películas, igual.
  - **D7** `backlog.subtype` (`book` / `comic` / `manga`), obligatorio en lectura, con filtro.
  - **D8** "Nuevo título" desde Series/Lectura: título, tipo o subtipo y año.
  - **D9** los datos de prueba de Dev se borraron al cerrar.
  - **Reconciliación:** con series vivas → Mirando o Terminado; un título en Mirando sin series vivas y con al menos una vinculada borrada → Pendiente. Un Terminado no se toca, ni un Mirando sin ninguna serie vinculada.
  - **Interfaz:** "De Pendiente" / "Nuevo título" al agregar (selector `PendientePicker`), chip "Vinculado", textos de borrado, subtipo y filtro en Pendiente. La elección de "Agregar" se limpia al editar, cerrar o guardar.
- **Pruebas en la PC:**
  - `scripts/probar-fase7-5.mjs`: **61 OK** (motor puro, alta vinculada, reflejo en cada camino de `series.status`, comprobación estática del punto único con control negativo, selector, borrados, D4, D6, migración 7 sobre una v6 de `6a1722f`, Supabase en PGlite, sync entre dispositivos y reconciliación, carreras del pull, 23503, `unblockAll`, compatibilidad a y b, el borrado de una categoría igual que en `c2c42c2` en todo lo demás).
  - El resto en verde, en serie, con `probar-fase4` sola: `probar-fase0` 22, `probar-fase1` 82, `dryrun-fase1` 60, `probar-fase2` 63, `probar-fase3` 104, `probar-fase4` 88, `probar-fase5` 35, `probar-fase6` 13, `probar-fase6-2` 47, `probar-fase6-5` 45, `probar-fase6-6` 29, `probar-fase6-7` 39, `probar-fase7-1` 25, `probar-fase7-2` 17 (`CASOS` cambia solo en C13), `probar-fase7-3` 12 (0 diferencias), `probar-fase7-4a` 35, `probar-fase7-4b` 24, `probar-tema` 48 y `test-date-range` 24.
  - `expo-doctor` 18/18, `expo export` sin errores, `escanear-historial` y `verificar-secretos` en 0.
- **Registro Dev:**
  - SQL antes del APK 1.4.0 (`verificar-fase7-5` 15/15, `auditar-fase6` con todos los estrictos ok, `verificar-fase2` 22/22);
  - la 1.4.0 instalada encima: lista de 29 pasos OK, con las observaciones O8–O14 (en el diseño);
  - la 1.4.1 instalada encima (sin SQL), de versionCode 14 a 15 y con el mismo `firstInstallTime`: pasos 1–12 OK;
  - el respaldo "después" de la 1.4.0 es válido (`user_version` 7, outbox vacía, columnas nuevas). Los datos de prueba se borraron al cerrar (§1).
- **Producción, con el protocolo completo:**
  - respaldo "antes" (app 1.3.9, v6, outbox vacía, 31 / 12 / 19, un `user_id`);
  - SQL en Poguis el 2026-11-23, justo antes del `install -r` (`verificar-fase7-5` 15/15, `auditar-fase6` con todos los estrictos ok, `verificar-fase2` 22/22). La 1.3.9 sincronizó bien con el esquema nuevo;
  - `install -r` de la 1.4.1 con la firma EAS `3132ded2…3e52` (verificada por `build:release` y por el `install -r` sobre la app firmada con EAS), de versionCode 13 a 15 y con el `firstInstallTime` 2026-09-21 07:49:29 antes y después;
  - respaldo "después" (app 1.4.1, v7, `pre-migracion-v7` en `meta.backupDirFiles`, outbox vacía) y `comparar-sync` antes vs después idénticos en las 15 tablas, con el mismo saldo;
  - `verificar-fase5` en Poguis = "después" en las 16 filas (31 / 12 / 19, un `user_id`).
- **Hallazgos:**
  - **FK local `seasons → series` en el pull:** anterior a la 7.5, sin corregir (§3, punto 10).
  - **Dos reglas nuevas del motor** (DECISIONES.md, Sincronización; `docs/MAPEO-SYNC.md`): el pull aplica y compara solo las columnas que trae la fila remota; "Reintentar" (`unblockAll`) libera también las entradas que esperan a un padre bloqueado (`PARENT_BLOCKED`).
  - **Límite conocido:** si se borra una serie mientras su título todavía no llegó al celular (solo con dos dispositivos), el título vuelve a Pendiente sin vínculo por la reconciliación. No se pierde nada.
  - **Respaldo "antes" de Registro Dev perdido.** Sin impacto: era solo Dev, y la migración se verificó con `verificar-fase7-5` (15/15), `auditar-fase6` (todos los estrictos ok), `verificar-fase2` (22/22) y las pruebas del celular. En producción el "antes" sigue siendo obligatorio.
  - **Formulario de categorías de lectura:** el límite (`series_count`) aparece dos veces, como "Límite (Viendo)" y como "Límite Simultáneo (Viendo)". Es el mismo campo. → 7.7.
- **Observaciones del celular:** O8–O14 en `claude/DISENO-ENTRETENIMIENTO.md` (Observaciones). El orden tras la 7.5 y O11, O13 y O14 quedaron [OK] el 2026-11-23.
- **Siguiente:** la 7.5b (Pendiente: O8–O12), según el diseño. Se dividió en 7.5b1 (cerrada: ver §12) y 7.5b2.

## 12. Fase 7.5b1 — etiquetas [CERRADA 2026-11-25]
- **Commits:**
  - `1d8d756` (APK 1.4.2 / vc 16, solo Registro Dev);
  - `a0a4cfc` (corrección 1, APK 1.4.3 / vc 17, solo Registro Dev);
  - `78d8755` (corrección 2, APK **1.4.4 / versionCode 18**, producción);
  - el commit de este cierre.
  - Migración 7 de Supabase (`supabase/migrations/20261124000100_etiquetas.sql`, solo aditiva) y migración local 8 (`src/data/db/migration8.ts`, copia `pre-migracion-v8`). Verificación de solo lectura: `supabase/verificar-fase7-5b1.sql` (20 filas).
- **Qué cambió** (decisiones E1–E9 y P-a…P-f en `claude/DISENO-ENTRETENIMIENTO.md`, "Decisiones de la 7.5b1"):
  - **Modelo A:** catálogo sincronizado `backlog_tags` (`section`, `name`, `name_key`) y `backlog.tags` (nombres; TEXT con JSON en local, jsonb en el servidor; NULL = sin etiquetas).
  - **`name_key`:** el nombre normalizado en minúsculas, calculado solo por la app. Clave natural y UNIQUE `(user_id, section, name_key)` en los dos lados, con los tombstones incluidos: crear o renombrar a la clave de una borrada la revive (P-b). En el servidor, CHECK de `name` de 1 a 30 y de `name_key` de 1 a 60.
  - **Forma canónica de `backlog.tags`:** sin repetir por clave, ordenada por clave código por código, NULL si queda vacía. La aplican el repositorio y el mapeo (también al bajar). En pantalla, `localeCompare('es')`.
  - **Todo compara por clave:** guardar un título usa el nombre del catálogo; el filtro (TODAS las elegidas, o "Sin etiquetas") y el conteo de borrado ("Se quitará de N títulos." / "Se quitará de 1 título." / "No está en ningún título."). Renombrar, también solo mayúsculas, reescribe los títulos de la sección.
  - **Pantalla:** chips en el formulario, con "Nueva etiqueta" y "De otras secciones"; gestión por sección; filtro en las 4 secciones; etiquetas de la fila en 1 línea. Fuera las chips y el filtro de franquicia (O9 cerrada).
  - **`backlog.franchise`** queda como columna heredada: no se muestra, no se filtra ni se escribe (el DEFAULT llena las altas; editar conserva el valor).
  - **`linkAccount`** reescribe también `backlog_tags.user_id`.
  - **Sync:** `backlog_tags` al final de `TABLES`, `NATURAL_KEYS` `(user_id, section, name_key)`, tipo `tags` canónico en el mapeo. Herramientas en 16 tablas; `verificar-fase5` de 17 filas.
- **Corrección 1** (1.4.3, tras la prueba del celular):
  - **C1:** en Pendiente el título se ve completo en la fila; el campo de título es multilínea (hasta 5 líneas, Enter cierra el teclado, los saltos de línea pasan a espacio).
  - **C2 y C3** (el teclado tapaba campos): **`HojaConTeclado`**, sin `Modal` nativo. Usa el alto del evento de teclado (`e.endCoordinates.height`) y los insets de safe-area, sin `KeyboardAvoidingView`, y lleva el campo con el foco a la vista con `measureLayout`. Se usa en el formulario de Pendiente, la gestión de etiquetas, las categorías y los formularios de serie y de obra (variante centrada).
  - **Atrás con pila de hojas:** `App.js` es el único listener de `hardwareBackPress` y primero cierra la hoja abierta (`src/hooks/hojasAbiertas.js`).
- **Corrección 2** (1.4.4):
  - **D1** (la gestión quedaba fija en ~2,5 filas): la causa era un `maxHeight` en porcentaje contra un envoltorio que mide su contenido. Ahora las tarjetas no tienen porcentajes ni altos fijos, y **`alturaHoja`** (función pura) da el máximo: 85 % de la ventana con el teclado cerrado, el área libre con el teclado abierto.
  - **D2** (franja bajo la hoja): la hoja se dibujaba dentro del `SafeAreaView` de la pantalla. Ahora se dibuja en **`HojasHost`**, el último hijo de la `View` raíz de `App.js`, a través de un almacén puro (`src/hooks/almacenHojas.js`, id estable, publicación en `useLayoutEffect`).
- **Pruebas en la PC (finales, 1.4.4):**
  - `scripts/probar-fase7-5b1.mjs`: **51 OK**. Cubre el módulo puro, el catálogo, renombrar y borrar con sus textos, guardar en una transacción, la forma canónica y los huérfanos, el filtro, la comprobación estática de `franchise`, la migración 8 sobre una v7 de `1f1eec8`, Supabase en PGlite, la sync entre 2 dispositivos, la compatibilidad a y b, `linkAccount`, C1, Atrás con el `handleBack` real, `alturaHoja` y el almacén.
  - `probar-tema` **54** (sección 8, teclado: `HojaConTeclado`, Atrás con un solo listener, campos dentro de la hoja, ningún alto fijo, con controles negativos).
  - `probar-fase1` **85** (+3: una prueba por cada mutación nueva de la fachada).
  - Las demás, iguales a la 7.5, en serie y con `probar-fase4` sola: `probar-fase0` 22, `dryrun-fase1` 60, `probar-fase2` 63, `probar-fase3` 104, `probar-fase4` 88, `probar-fase5` 35, `probar-fase6` 13, `probar-fase6-2` 47, `probar-fase6-5` 45, `probar-fase6-6` 29, `probar-fase6-7` 39, `probar-fase7-1` 25, `probar-fase7-2` 17 (`CASOS` sin cambios), `probar-fase7-3` 12, `probar-fase7-4a` 35, `probar-fase7-4b` 24, `probar-fase7-5` 61 y `test-date-range` 24.
  - `expo-doctor` 18/18, `expo export` sin errores, `escanear-historial` y `verificar-secretos` en 0.
- **Registro Dev** (Android 17 / SDK 37):
  - el SQL se aplicó antes de la 1.4.2 (`verificar-fase7-5b1` 20/20, `verificar-fase2` 22/22, `auditar-fase6` con los estrictos ok);
  - 1.4.2 → 1.4.3 → 1.4.4, siempre `install -r` con el mismo `firstInstallTime` (2026-11-02 13:00:52);
  - los respaldos "antes" (v7) y "después de instalar" (v8) son idénticos en las 16 tablas. El respaldo final de la 1.4.2 coincide con `verificar-fase5` de Registro Dev (17/17), con `backlog.tags` canónicas y el catálogo sin anomalías;
  - los datos de prueba se conservan hasta cerrar la 7.5b2 (§1).
- **Producción, con el protocolo completo** (2026-11-25):
  - respaldo "antes" `registro_respaldo_20261125-211157` (app 1.4.1, v7, outbox vacía, 31 / 12 / 19, un `user_id`);
  - SQL en Poguis justo antes del `install -r` (`verificar-fase7-5b1` 20/20, `verificar-fase2` 22/22 con 16 tablas y 8 FK compuestas, `auditar-fase6` con todos los estrictos ok; informativo #31: 12 MB);
  - `install -r` de `registro-release-1.4.4-vc18-78d8755.apk`, con la firma EAS `3132ded2…3e52` verificada con `apksigner` antes de instalar, de versionCode 15 a 18 y con el `firstInstallTime` 2026-09-21 07:49:29 antes y después;
  - respaldo "después" `registro_respaldo_20261125-211946` (app 1.4.4, v8, `pre-migracion-v8`, 1 resumen nuevo en `_migration_log`, `backlog_tags` vacía, `tags` NULL, outbox vacía) y `comparar-sync` antes vs después idénticos en las 16 tablas, con el mismo saldo;
  - `verificar-fase5` en Poguis (17 filas) = "después" en las 17 (31 / 12 / 19, `backlog_tags` 0/0/0, un `user_id`).
- **Hallazgos:**
  - **Compatibilidad b** (el APK antes que el SQL): las filas de `backlog` y `backlog_tags` quedan bloqueadas, el pull de `backlog_tags` falla y el ciclo termina "offline": el indicador dice "Sin conexión" aunque haya red. No se pierde nada, y tras el SQL + "Reintentar" converge. El orden de siempre (SQL → APK) lo evita; el motor no se cambió.
  - **`scripts/lib/ts-esm-hook.mjs`** resuelve ahora los imports sin extensión entre módulos de `src/` (desde que `mapping.ts` importa `tags.ts`).
  - **Android 17 con borde a borde obligatorio:** el `Modal` nativo vive en su propia ventana, el teclado no lo redimensiona, y los eventos de teclado de RN 0.81 son de la ventana de la actividad. De ahí `HojaConTeclado` y `HojasHost`. Plan B documentado y no instalado: `react-native-keyboard-controller` 1.18.5 (Expo SDK 54), que exige `react-native-reanimated` ~4.1.1 y `react-native-worklets` 0.5.1, `KeyboardProvider` y recompilar lo nativo.
  - **Formularios fuera del módulo** con el mismo problema del teclado: Tarjetas, Servicios y Dinero **sí**; Deudas/Préstamos, Estadísticas y Trabajo **probable**. → subfase de pulido, junto con B2. `PendientePicker` pasa a `HojaConTeclado` en la 7.5b2, por su campo de búsqueda (O10).
- **Observaciones del celular:** O15 (títulos completos dentro de una categoría) en el diseño → 7.5b2.
- **Siguiente:** la 7.5b2 (Pendiente compacto O12, selector "De Pendiente" dinámico O10, O8 y O15), según el diseño.
