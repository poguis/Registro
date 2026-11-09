# Traspaso a la Fase 6 (endurecimiento)

Estado al cerrar la Fase 5 (2026-11-04): APK 1.3.0 / versionCode 4 (commit `db1ee50`, firma EAS) en el celular, con la sync encendida contra **Poguis** (producción). Datos reales en el servidor: `balance_history` 1, `finance_categories` 6, `work_people` 3 y 4 tombstones de prueba en `backlog`; un único `user_id`. `user_version` local 4. Registro Dev sigue en el celular con su propio proyecto. Detalle en DECISIONES.md (Fase 5) y CLAUDE.md.

Reglas que siguen vigentes: plan mode y aprobación; nada contra el proyecto remoto (solo archivos SQL que aplica el usuario); nunca desinstalar ni borrar datos sin aprobación explícita; respaldo validado antes y después de tocar datos reales; un APK de producción nunca en un emulador con datos de prueba.

## 0. Avance de la Fase 6
- **6.1 cerrada** (2026-11-07): auditoría de solo lectura.
- **6.2 cerrada** (2026-11-07): pruebas de servidor en Registro Dev.
- **6.3 cerrada** (2026-11-08), en los dashboards, sin cambios de código:
  - claves legacy anon/service_role desactivadas en los dos proyectos;
  - registro de usuarios nuevos cerrado en Poguis (abierto en Registro Dev);
  - client secret de Google rotado y el anterior borrado;
  - plan Free confirmado;
  - Site URL sin cambios.

  Respaldo G del celular válido: 30 / 26 / 4 con un `user_id`.

  Nuevo [PENDIENTE]: migrar a JWT signing keys y revocar el secreto JWT legacy. Se decide al cerrar la Fase 6, como 6.9 o en el backlog. Detalle en DECISIONES.md.
- **6.4 cerrada** (2026-11-08), commit `ed06602`:
  - `expo` 54.0.38 (parches de SDK 54; `expo-doctor` 18/18);
  - quitados `@react-navigation/*`, `react-native-screens`, `react-native-gesture-handler` y `android.os.Looper`;
  - APK 1.3.1 / versionCode 5 instalado encima en el celular, Dev y producción, con la firma sin cambios y el mismo `firstInstallTime`;
  - respaldos H e I idénticos en las 15 tablas y `verificar-fase5` = I (30 / 26 / 4).

  Sin cambios en `src/` ni en el esquema (`user_version` 4).
- **6.5 cerrada** (2026-11-08), commit `dcdc59d`, APK 1.3.2 / versionCode 6 en Dev y producción:
  - indicador con NetInfo y plural correcto;
  - "Cerrar sesión" sin red;
  - respaldo en formato 2 (`backupDirFiles`);
  - N+1 de entretenimiento: 5 consultas, idéntico a `f3772d9` en 3 casos;
  - rango redundante del pull;
  - avisos de Node.

  Respaldos antes y después idénticos y `verificar-fase5` = después (30 / 26 / 4). Regla de sesión y su única excepción en DECISIONES.md. Sin migraciones locales ni cambios en Supabase.

## 1. Anotado durante la Fase 5
1. **Categorías por defecto en una instalación nueva.** Hoy se siembran al iniciar sesión y, al subir, la fusión por clave natural (23505) sube el contenido del dispositivo NUEVO: cambia `created_at`/`updated_at` de las categorías del celular (pasó en la 5.5, esperado) y podría revivir una categoría por defecto borrada. Mejora: no sembrarlas hasta completar el primer pull (y sembrar solo las que falten).
2. **HECHO (6.5).** ~~**Indicador sin red tras un cambio local.**~~ `autoSync.onLocalChange` no pide ciclo sin conexión según NetInfo y `SyncStatus` conserva el último "ok", así que muestra "Sincronizado hace X · N pendiente(s)" (visto en la 5.6 B3). Mejora: mostrar "Sin conexión" según NetInfo y no decir "Sincronizado" cuando hay pendientes. Corregir también el plural "pendiente(s)".
3. **HECHO (6.5:** el respaldo lista `respaldos/` en `meta.backupDirFiles`**).** ~~**Copias físicas previas sin verificación directa.**~~ El respaldo solo lista los `.db` de la carpeta de la BD, no los de `respaldos/` (copias `pre-migracion-vN` y `pre-vinculacion`). En el release no depurable la copia previa solo se confirma de forma indirecta. Mejora: listar también `respaldos/` en el meta del respaldo, u otra verificación.
4. **Tombstones de prueba en el servidor:** `backlog` de Poguis tiene 4 filas borradas (`[prueba RLS]` de la Fase 3 + 3 `[prueba F5]`). Están también en el celular. Decidir si se limpian; no hay DELETE desde el cliente, así que sería un SQL aparte aplicado por el usuario (no migración), con respaldo previo, y los celulares conservarían su copia local.
5. **HECHO (6.5:** `signOutLocal.ts`**).** ~~**`signOut` sin red con el token vencido:**~~ `signOut({ scope: 'local' })` devuelve error sin borrar la sesión local (auth-js no la quita si no puede validar). Valorar borrar la sesión local igualmente.
6. **Tablas vacías sin cursor:** el pull solo guarda cursor cuando recibe filas; las tablas vacías se piden completas en cada ciclo (hoy 11 consultas vacías). Inocuo; valorar guardar un cursor "vacío".
7. **HECHO (6.5:** `ts-esm-hook.mjs` y un solo comando citado**).** ~~**Avisos de Node en los scripts:**~~ `MODULE_TYPELESS_PACKAGE_JSON` al importar `.ts` y `DEP0190` (shell: true) en `build-apk.mjs`. Inocuos.
8. ~~**Plan Free de Supabase:**~~ **RESUELTO (6.3):** se queda en Free, con uso al menos semanal. Si Supabase pausa el proyecto por inactividad, se reanuda desde el dashboard; mientras tanto la app muestra "Sin conexión" y los datos locales siguen disponibles.

## 2. Lista de Fase 6 del prompt de la Fase 5 (fuera de alcance entonces)
- Borrar las tablas `legacy_*` y las copias físicas internas (pre-migración / pre-vinculación conservan la contraseña antigua; ver DECISIONES.md, [PENDIENTE]).
- ~~Eliminar el Client secret viejo de Google~~: ya no aplica (6.1: el de la Fase 4 no existe; hay 1 solo secret, creado el 2026-11-02). ~~Rotar el client secret actual en la 6.3~~ **HECHO (6.3, 2026-11-08):** el secret quedó expuesto en un chat el 2026-11-07. Se agregó el nuevo en Auth → Google de los dos proyectos, se deshabilitó el viejo, se probó el login en Dev y en producción, y se borró el viejo. Queda 1 secret activo, compartido por los dos proyectos.
- ~~Actualizar `expo`~~ **HECHO (6.4):** 54.0.33 → 54.0.38; `expo-doctor` 18/18.
- ~~N+1 de `getEntertainmentCategories`~~ **HECHO (6.5):** 5 consultas fijas, idéntico a `f3772d9`.
- Limpiar el tombstone RLS (ahora junto con los 3 `[prueba F5]`, punto 1.4).
- Play Store y Play App Signing: **fuera de alcance** según DECISIONES.md (Alcance: hasta que la app funcione al 100 % para uso personal). Pasan a "Fuera de la Fase 6 (Fase 7 / backlog)".
- PIN / huella.
- Realtime.

## 3. Lista de la Fase 2 (ítems 4–8; todos cerrados en la Fase 6: 5, 6 y 8 en la 6.1; 4 y 7 en la 6.2)
4. ~~La tabla real `auth.users` y el `on delete cascade`~~ **CERRADO (6.2):** en Registro Dev se borró desde el dashboard, sin error, un usuario de prueba con 119.840 filas sintéticas (`supabase/pruebas-fase6-2/01`). Resultado: 0 filas en las 15 tablas, uid ausente y el otro usuario idéntico a la línea base; no hizo falta el plan B (04); auditoría posterior 18/18. Ver `docs/FASE6-PRUEBAS-SERVIDOR.md` §7.
5. ~~Versión y rol~~ **CERRADO (6.1):** PostgreSQL 17.11 en los dos proyectos; SQL Editor como `postgres` sin superusuario. Ver `docs/FASE6-AUDITORIA-SERVIDOR.md`.
6. ~~`service_role`~~ **CERRADO (6.1):** bypassrls, sin S/I/U/D en las 15 tablas, 0 secret keys, nunca en el repo, el historial ni los APK; clave legacy desactivada en la 6.3 (bloqueada en el encabezado `apikey`, aunque sigue siendo válida como JWT hasta migrar a JWT signing keys, [PENDIENTE]). Ver `docs/FASE6-AUDITORIA-SERVIDOR.md`.
7. ~~Concurrencia real y rendimiento de RLS con muchas filas~~ **CERRADO (6.2):**
   - **RLS:** se aplicó en los 9 planes del pull (`02`). Páginas típicas 7–18 ms; la peor a 50.000 filas ≈ 0,9 s frente a los 8 s del timeout (≥ 8,7× de margen).
   - **Concurrencia:** verificada por documentación, sin medición empírica. 0 empates de `server_updated_at` en Supabase.
   - **Hallazgo H1 (b-app) → 6.5:** añadir al pull el rango redundante `gte('server_updated_at', after.ts)`.

   Ensayo local: `scripts/probar-fase6-2.mjs`. Detalle: `docs/FASE6-PRUEBAS-SERVIDOR.md` §8–9.
8. ~~Resultado del Security Advisor~~ **CERRADO (6.1):** 1 WARN por proyecto (Leaked Password Protection, no aplica). Ver `docs/FASE6-AUDITORIA-SERVIDOR.md`.

## 4. Otros [PENDIENTE] de DECISIONES.md
- ~~Archivo `android.os.Looper` y dependencias `@react-navigation` sin uso~~ **HECHO (6.4):** eliminados.
- Restaurar un respaldo dentro de la app.

## 5. Verificado en la Fase 5 y lo que no
**Verificado:** suites `probar-fase0..5` y `verificar-secretos` en PC; `dryrun-fase5` con la copia del respaldo real (14/14); en el celular, instalación `install -r` sin desinstalar, apertura sin red ("Sin conexión — 10", sin pedir sesión), primera subida sola al reconectar, servidor = datos del celular con un único `user_id`; verificación independiente desde un AVD nuevo (idéntico sin excepciones tras la vuelta); multidispositivo en los dos sentidos; online, offline y aislamiento dev/prod; "Cerrar sesión" (`scope: 'local'`) en el AVD sin afectar al celular, que siguió sincronizando en toda la 5.6; respaldos A–E válidos; `legacy_*` sin cambios.

**No verificado en dispositivo:** la reconexión dentro de los 60 s de enfriamiento de auth-js seguida del ciclo por `TOKEN_REFRESHED` (solo en `probar-fase5` con el auth-js real); una cuenta Google distinta (solo en `probar-fase3`); el texto exacto del indicador tras "Sincronizar ahora" antes del respaldo D (no se anotó; D confirma el resultado).
