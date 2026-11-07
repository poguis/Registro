# Traspaso a la Fase 6 (endurecimiento)

Estado al cerrar la Fase 5 (2026-11-04): APK 1.3.0 / versionCode 4 (commit `db1ee50`, firma EAS) en el celular, con la sync encendida contra **Poguis** (producción). Datos reales en el servidor: `balance_history` 1, `finance_categories` 6, `work_people` 3 y 4 tombstones de prueba en `backlog`; un único `user_id`. `user_version` local 4. Registro Dev sigue en el celular con su propio proyecto. Detalle en DECISIONES.md (Fase 5) y CLAUDE.md.

Reglas que siguen vigentes: plan mode y aprobación; nada contra el proyecto remoto (solo archivos SQL que aplica el usuario); nunca desinstalar ni borrar datos sin aprobación explícita; respaldo validado antes y después de tocar datos reales; un APK de producción nunca en un emulador con datos de prueba.

## 1. Anotado durante la Fase 5
1. **Categorías por defecto en una instalación nueva.** Hoy se siembran al iniciar sesión y, al subir, la fusión por clave natural (23505) sube el contenido del dispositivo NUEVO: cambia `created_at`/`updated_at` de las categorías del celular (pasó en la 5.5, esperado) y podría revivir una categoría por defecto borrada. Mejora: no sembrarlas hasta completar el primer pull (y sembrar solo las que falten).
2. **Indicador sin red tras un cambio local.** `autoSync.onLocalChange` no pide ciclo sin conexión según NetInfo y `SyncStatus` conserva el último "ok", así que muestra "Sincronizado hace X · N pendiente(s)" (visto en la 5.6 B3). Mejora: mostrar "Sin conexión" según NetInfo y no decir "Sincronizado" cuando hay pendientes. Corregir también el plural "pendiente(s)".
3. **Copias físicas previas sin verificación directa.** El respaldo solo lista los `.db` de la carpeta de la BD, no los de `respaldos/` (copias `pre-migracion-vN` y `pre-vinculacion`). En el release no depurable la copia previa solo se confirma de forma indirecta. Mejora: listar también `respaldos/` en el meta del respaldo, u otra verificación.
4. **Tombstones de prueba en el servidor:** `backlog` de Poguis tiene 4 filas borradas (`[prueba RLS]` de la Fase 3 + 3 `[prueba F5]`). Están también en el celular. Decidir si se limpian; no hay DELETE desde el cliente, así que sería un SQL aparte aplicado por el usuario (no migración), con respaldo previo, y los celulares conservarían su copia local.
5. **`signOut` sin red con el token vencido:** `signOut({ scope: 'local' })` devuelve error sin borrar la sesión local (auth-js no la quita si no puede validar). Valorar borrar la sesión local igualmente.
6. **Tablas vacías sin cursor:** el pull solo guarda cursor cuando recibe filas; las tablas vacías se piden completas en cada ciclo (hoy 11 consultas vacías). Inocuo; valorar guardar un cursor "vacío".
7. **Avisos de Node en los scripts:** `MODULE_TYPELESS_PACKAGE_JSON` al importar `.ts` y `DEP0190` (shell: true) en `build-apk.mjs`. Inocuos.
8. **Plan Free de Supabase:** Poguis ya tiene los datos reales; una pausa por inactividad deja la app en "Sin conexión" (los datos locales siguen). Valorar Pro o un uso periódico.

## 2. Lista de Fase 6 del prompt de la Fase 5 (fuera de alcance entonces)
- Borrar las tablas `legacy_*` y las copias físicas internas (pre-migración / pre-vinculación conservan la contraseña antigua; ver DECISIONES.md, [PENDIENTE]).
- ~~Eliminar el Client secret viejo de Google~~: ya no aplica (6.1: el de la Fase 4 no existe; hay 1 solo secret, creado el 2026-11-02). **Ahora: rotar el client secret actual en la 6.3**, porque su valor quedó expuesto en un chat el 2026-11-07. El cliente OAuth es Web y lo comparten los dos proyectos: hay que actualizarlo en Auth → Google de ambos.
- Actualizar `expo`: `npx expo-doctor` marca `expo` 54.0.33 frente a ~54.0.37 esperada (único chequeo que falla, 17/18).
- N+1 de `getEntertainmentCategories`.
- Limpiar el tombstone RLS (ahora junto con los 3 `[prueba F5]`, punto 1.4).
- Play Store y Play App Signing: **fuera de alcance** según DECISIONES.md (Alcance: hasta que la app funcione al 100 % para uso personal). Pasan a "Fuera de la Fase 6 (Fase 7 / backlog)".
- PIN / huella.
- Realtime.

## 3. Lista de la Fase 2 que sigue abierta (ítems 4–8)
4. La tabla real `auth.users` y el `on delete cascade` al borrar una cuenta desde el dashboard.
5. ~~Versión y rol~~ **CERRADO (6.1):** PostgreSQL 17.11 en los dos proyectos; SQL Editor como `postgres` sin superusuario. Ver `docs/FASE6-AUDITORIA-SERVIDOR.md`.
6. ~~`service_role`~~ **CERRADO (6.1):** bypassrls, sin S/I/U/D en las 15 tablas, 0 secret keys, nunca en el repo, el historial ni los APK; la clave legacy sigue activa → 6.3. Ver `docs/FASE6-AUDITORIA-SERVIDOR.md`.
7. Concurrencia real (commits fuera de orden frente al cursor del pull) y rendimiento de RLS con muchas filas.
8. ~~Resultado del Security Advisor~~ **CERRADO (6.1):** 1 WARN por proyecto (Leaked Password Protection, no aplica). Ver `docs/FASE6-AUDITORIA-SERVIDOR.md`.

## 4. Otros [PENDIENTE] de DECISIONES.md
- Archivo `android.os.Looper` en la raíz y dependencias `@react-navigation` sin uso: ¿se eliminan?
- Restaurar un respaldo dentro de la app.

## 5. Verificado en la Fase 5 y lo que no
**Verificado:** suites `probar-fase0..5` y `verificar-secretos` en PC; `dryrun-fase5` con la copia del respaldo real (14/14); en el celular, instalación `install -r` sin desinstalar, apertura sin red ("Sin conexión — 10", sin pedir sesión), primera subida sola al reconectar, servidor = datos del celular con un único `user_id`; verificación independiente desde un AVD nuevo (idéntico sin excepciones tras la vuelta); multidispositivo en los dos sentidos; online, offline y aislamiento dev/prod; "Cerrar sesión" (`scope: 'local'`) en el AVD sin afectar al celular, que siguió sincronizando en toda la 5.6; respaldos A–E válidos; `legacy_*` sin cambios.

**No verificado en dispositivo:** la reconexión dentro de los 60 s de enfriamiento de auth-js seguida del ciclo por `TOKEN_REFRESHED` (solo en `probar-fase5` con el auth-js real); una cuenta Google distinta (solo en `probar-fase3`); el texto exacto del indicador tras "Sincronizar ahora" antes del respaldo D (no se anotó; D confirma el resultado).
