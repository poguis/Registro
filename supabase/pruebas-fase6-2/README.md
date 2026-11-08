# Fase 6.2 — Pruebas de servidor: SOLO Registro Dev

**Nunca ejecutar nada de esta carpeta en Poguis.** Estos archivos no son migraciones. Análisis y resultados: `docs/FASE6-PRUEBAS-SERVIDOR.md`. Ensayo local: `node scripts/probar-fase6-2.mjs`.

| Archivo | Qué hace | ¿Escribe? |
|---|---|---|
| `01-sembrar-volumen.sql` | Siembra ~120.000 filas sintéticas para el usuario de prueba (una sentencia `DO`, con guardas) | Sí, solo INSERT |
| `02-medir-pull.sql` | Genera los 9 bloques `EXPLAIN` del pull con RLS | No |
| `03-verificar-cascada.sql` | Conteos por tabla del usuario de prueba y de los demás | No |
| `04-limpieza-emergencia.sql` | **Plan B**: borra las filas del usuario de prueba si falla el paso 6. Única excepción a "sin DELETE". | Sí, solo DELETE de filas sintéticas |

En todos los archivos el uid se pega en la línea marcada `PEGAR_UID_AQUI`. No guardes el uid en el repo. Ejecuta siempre con el rol del editor en **postgres**.

## Requisito previo
Crea un usuario de prueba en Registro Dev, por ejemplo con Authentication → Users → Add user, y copia su uid. Tienen que quedar **al menos 2 usuarios** en `auth.users`: tu usuario dev y el de prueba. Las guardas de 01 y 04 lo exigen.

## Escala recomendada: 1
Criterio: se toman los tiempos de PGlite a escala 1 del 01 y de la cascada.
- Si los dos son ≤ 20 s → escala 1.
- Si el mayor está entre 20 y 40 s → 0.5.
- Si supera 40 s → 0.25.

Motivo: el editor corta las consultas a los 60 s, y un margen de 3× cubre que el CPU compartido del plan Free rinda menos que PGlite en el PC.

**Medido en PGlite (`probar-fase6-2`, escala 1):**
- 01: **5,0 s**, para 119.840 filas;
- cascada: **0,2 s** en total, de los que `seasons_series_fkey` toma 0,08 s en 500 llamadas;
- tamaño de las 15 tablas: **28,7 MB**.

Por eso, **escala 1**: la línea `ESCALA` del 01 se deja en `1`.

## Orden de ejecución y qué esperar
Pega el uid solo en el SQL Editor; no guardes el archivo del repo con el uid.

1. **03 (antes).** Esperado:
   - `prueba_filas` = 0 en las 15 tablas;
   - `uid en auth.users` = sí;
   - `usuarios en auth.users` ≥ 2.

   Guarda el resultado completo: es la línea base de los demás usuarios.
2. **01.** Debe terminar sin error con el aviso "F6.2: siembra completa (escala 1): 119840 filas". Si falla una guarda, no se escribió nada; lee el mensaje y para.
3. **03.** Esperado:
   - `prueba_filas` = la tabla de volumen del 01 (`TODAS` = 119.840);
   - columnas `otros_*` idénticas al paso 1.

   Anota el tamaño de la BD y los grupos repetidos (informativo).
4. **Espera al autoanalyze.** Repite 03 hasta que las filas 24–25 ("filas modificadas desde el último ANALYZE") sean pocas, muy por debajo de 50.000. Suele tardar uno o dos minutos. Así los planes del 02 son los que verá la app.
5. **02, paso 1.** Ejecuta el archivo: devuelve 9 filas, cada una con un bloque en la columna `bloque`.
6. **02, paso 2.** Pega cada bloque en una pestaña nueva (rol **postgres**; no uses el selector "authenticated" del editor) y ejecuta. Guarda los 9 planes.

   **Validez:** cada plan debe mostrar un `InitPlan` y `user_id = (InitPlan …)`. Si no aparecen, no se aplicó la RLS y esa medición no vale.
7. **Borra el usuario de prueba** en Authentication → Users → Delete user. Anota si terminó bien y cuánto tardó, aproximadamente.
8. **03 (después).** Esperado:
   - `prueba_filas` = 0 en las 15 tablas;
   - `uid en auth.users` = no;
   - columnas `otros_*` idénticas al paso 1.

Entrégame los resultados de los pasos 1, 3, 4 (filas 24–25), 6 (los 9 planes), 7 y 8.

## Deshacer
El paso 7 lo deshace todo: borrar el usuario de prueba elimina sus filas por la cascada `user_id → auth.users on delete cascade`.

## Si algo falla
- **El 01 se corta por tiempo:** al ser una sola sentencia, se revierte entero y no queda ninguna fila. Baja la línea `ESCALA` a `0.5` (o `0.25`) y repite desde el paso 2.
- **Una guarda aborta:** no se escribió nada. Revisa el uid pegado y que haya 2 usuarios.
- **Falla el borrado del paso 7:** la operación es atómica, así que no se borra nada. Anótalo y usa el **Plan B**:
  1. Ejecuta `04-limpieza-emergencia.sql` con el uid de prueba. El SQL Editor mostrará el **aviso de operación destructiva**: es esperado. Confirma solo si estás en Registro Dev y el paso 7 falló. Es la única excepción a "sin DELETE" de la 6.2.

     Sus guardas abortan sin borrar nada si:
     - el uid no existe;
     - hay menos de 2 usuarios;
     - alguna fila del uid no es demostrablemente sintética (prefijo `[F6.2]`, `created_at` = 2000-06-02 y padre sintético).
  2. Ejecuta 03: deben quedar 0 filas del uid en las 15 tablas y las columnas `otros_*` idénticas al paso 1.
  3. El usuario de Auth queda sin datos. Puedes reintentar borrarlo desde el dashboard o dejarlo.
