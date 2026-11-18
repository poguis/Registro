# Traspaso a la Fase 7

Estado al cerrar la Fase 6 (2026-11-11, commit `f97227f`), actualizado al cerrar la 7.1 (2026-11-16) y la 7.2 (2026-11-17). Las fases 0–6 están cerradas; el detalle de cada una está en DECISIONES.md (Fases) y CLAUDE.md. El traspaso anterior (`claude/TRASPASO-FASE6.md`) queda como histórico.

## 1. Estado actual

### Celular del usuario
- **Registro (producción)** `com.poguis.Registro`: **1.3.4 / versionCode 8**, firma EAS `31:32:DE:…:3E:52`, instalada siempre encima (`install -r`), mismo `firstInstallTime` desde 2026-09-21. Sync encendida contra **Poguis**. BD local `user_version` 5: sin `legacy_*` ni columna `password`.
- `respaldos/` del celular: los 10 respaldos manuales más recientes y la `pre-migracion-v5`; 0 copias con la contraseña antigua (retención de la 6.7).
- **Registro Dev** `com.poguis.Registro.dev`: **1.3.4 / versionCode 8**, firma `debug.keystore` `fac61745…`, contra **Registro Dev**. Se instala al lado de la app real y tiene su propia BD.

### Poguis (producción)
- Datos reales de un único usuario: 30 filas en las 15 tablas sincronizadas, 26 vivas y 4 borradas (`verificar-fase5` 16/16 = respaldo "después" de la 6.7).
- Las 4 borradas son los tombstones de prueba de `backlog` (`[prueba RLS]` y 3 `[prueba F5]`). **Se quedan** (6.8, decisión del usuario).
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
- `app.json`: `versionName` 1.3.4, `versionCode` 8. Para cada APK que se vaya a instalar, subir los dos (las versiones no pueden bajar).
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
- Commits de la Fase 7: `89a3514` (7.1, implementación), `d4bad14` (cierre de la 7.1) y `d55b5e1` (7.2).

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
9. **Rediseño de entretenimiento (subfases 7.3–7.10):** ver `claude/DISENO-ENTRETENIMIENTO.md`. El análisis previo (7.2) está cerrado (ver §6).

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
