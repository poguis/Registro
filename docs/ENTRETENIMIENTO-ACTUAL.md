# Entretenimiento: cómo funciona HOY (Fase 7.2)

Análisis de solo lectura de Pendiente (backlog), Series/Anime y Lectura en la app 1.3.4 / vc 8 (`user_version` 5), hecho antes de rediseñar el módulo. No describe lo que debería hacer: describe lo que hace.

Cada afirmación lleva una referencia `archivo:línea` o el caso de `scripts/probar-fase7-2.mjs` que la demuestra (**C1–C14**). La suite ejecuta el código real con datos sintéticos:
- la fachada `db.js`, los repositorios y `backlogUtils.js` sobre node:sqlite;
- las funciones de las pantallas, extraídas del archivo con `@babel/parser`.

Las referencias de línea corresponden al commit `d4bad14`.

> **Nota (Fase 7.3, `241c26e`):** la lógica de las funciones del anexo A vive ahora en `src/entertainment/` (`queue.ts` y `seriesDetail.ts`), con el mismo comportamiento (`scripts/probar-fase7-3.mjs`: 0 diferencias). Las pantallas solo ejecutan los efectos. Las referencias `archivo:línea` de este documento siguen correspondiendo a `d4bad14`. Desde la 7.3 se agrega R15.
>
> **Nota (Fase 7.4a, `90ea3b5` y `47f358c`):** desde la 7.4a están corregidos R1, R2, R5, R6, R7, R8 y R15, y C2 (la serie nueva entra al final de la vuelta en curso; la pausada que se reanuda entra en esa vuelta conservando su lugar). Se agrega R16, también corregido. El historial cuenta lo visto y la grilla es "marcar vistos hasta aquí". Este documento sigue describiendo el comportamiento de `d4bad14`; el actual está en CLAUDE.md (Architecture) y en `scripts/probar-fase7-4a.mjs`.

---

## 1. Mapa de pantallas y archivos

| Pantalla (vista en `App.js`) | Archivo | Para qué |
|---|---|---|
| Pendiente (`PENDIENTE`, `App.js:301-307`) | `src/screens/BacklogScreen.js` | Lista de pendientes por tipo (película, serie, anime, lectura), con estado y franquicia |
| Series/Anime (`SERIES_ANIME`, `App.js:308-322`) | `src/screens/SeriesAnimeScreen.js` | Lista de categorías de video y lectura; crear, editar, pausar y borrar categorías; atraso o adelanto por categoría |
| Detalle de video (`SERIES_DETAIL`, `App.js:323-331`) | `src/screens/SeriesDetailScreen.js` | Series de una categoría de video: agregar, editar, ordenar, pausar, grilla de progreso, reiniciar |
| Registro de capítulos (`CHAPTER_REGISTRY`, `App.js:341-348`) | `src/screens/ChapterRegistryScreen.js` | La cola intercalada de capítulos pendientes, marcar y desmarcar vistos, historial |
| Detalle de lectura (`READING_DETAIL`, `App.js:332-340`) | `src/screens/ReadingDetailScreen.js` | Copia del detalle de video con textos de lectura ("Obra", "Parte", "Tomo") |
| Registro de lectura (`READING_REGISTRY`, `App.js:349-356`) | `src/screens/ReadingRegistryScreen.js` | Copia del registro de capítulos con `reading_history` |
| Estadísticas (`STATISTICS`, `App.js:357-363`) | `src/screens/StatisticsScreen.js` | **Solo dinero**: `db.getStatisticsData` / `db.getCategoryHistory` (`StatisticsScreen.js:47,58`, `db.js:264-280`). No hay estadísticas de entretenimiento |

La categoría elegida se pasa por `selectedCategory` en el estado de `App.js`. El tipo decide a qué detalle se navega (`App.js:313-319`).

**Datos y lógica:**
- `src/data/repositories/entertainment.ts`: categorías, pausas, historial de cuotas y el progreso agregado por categoría (`getEntertainmentCategories`, `:64-128`).
- `src/data/repositories/series.ts`: series, temporadas, `getFullWatchlist`, `restartSeries`.
- `src/data/repositories/history.ts`: `watch_history` y `reading_history`.
- `src/data/repositories/backlog.ts`: pendientes.
- `src/services/db.js`: la fachada que usan las pantallas (`:394-680`).
- `src/services/backlogUtils.js`: funciones puras de cuotas, atraso y conteo (`getQuotasForDate`, `calculateBacklog`, `getAbsoluteEpisodeCount`, `getWatchedCountSinceStart`, `calculateBacklogV2`).
- **La cola y los ajustes de orden no están en módulos:** viven dentro de las pantallas, como closures de React (ver el anexo A).

## 2. Modelo de datos usado de verdad

Esquema local en `src/data/db/migration2.ts:85-155`. En Postgres: `supabase/migrations/20261026000200_tablas.sql` (CHECK de `type` en `:109`, de `series.status` en `:176-177` y de `backlog` en `:246-247`). Todas las tablas llevan además las columnas de sync.

### `entertainment_categories` (`migration2.ts:85-94`)
| Columna | En la práctica |
|---|---|
| `type` | `'video'` o `'reading'`. Decide la pantalla de detalle y la fórmula de la meta (`backlogUtils.js:78-101`) |
| `start_date` | Primer día que suma cuota (`backlogUtils.js:24,64-73`). **No tiene historial**: cambiarlo recalcula toda la meta (**C9**) |
| `days_of_week` | JSON por día. **Video:** capítulos de ese día (`SeriesAnimeScreen.js:210-215,548-560`). **Lectura:** 0 o 1, día activo o no (`SeriesAnimeScreen.js:217-225`). Es la cuota vigente; las anteriores están en `entertainment_quotas_history`. El array legado se acepta al leer (`backlogUtils.js:46-48`) |
| `frequency` | **Lectura:** > 0 son N tomos por día activo; < 0 es 1 tomo cada \|N\| días activos (`backlogUtils.js:94-101`; formulario en `SeriesAnimeScreen.js:596-605`). **Video:** no interviene en la meta (solo se usaba con el array legado, `backlogUtils.js:48`). **No tiene historial** (**C9**) |
| `series_count` | Límite de series activas (Nueva, Mirando o Pausado) al agregar una serie (`SeriesDetailScreen.js:213-225`, `ReadingDetailScreen.js:198-210`). El formulario solo lo pide en video (`SeriesAnimeScreen.js:621-632`). `NULL` = sin límite; **0 bloquea toda serie nueva**, aunque el esquema y el formulario digan "0 = sin límite" (**C12**) |
| `description`, `name` | Texto libre |

### `entertainment_quotas_history` (`migration2.ts:101-107`)
Períodos de cuota (`quotas` JSON, `start_date`, `end_date`; NULL = vigente).
- **Alta:** al crear la categoría se inserta el primer período desde `start_date` o desde hoy (`entertainment.ts:36-41`).
- **Edición:** solo si cambia el JSON de `days_of_week` (comparación de texto) se cierra el vigente con `end_date` = ayer y se abre otro desde hoy (`entertainment.ts:169-181`).
- **Lectura:** `getQuotasForDate` toma el primer período que contiene el día. Si ninguno lo contiene, usa el `days_of_week` actual (`backlogUtils.js:26-53`).

### `entertainment_pauses` (`migration2.ts:95-100`)
Rangos `pause_start`–`pause_end` (NULL = pausa vigente) de la **categoría**. Los días pausados no suman cuota (`backlogUtils.js:8-16,74`).
- La pantalla pausa con fecha de hoy y reanuda con fecha de ayer (`SeriesAnimeScreen.js:259-277`, `SeriesDetailScreen.js:369-386`; repositorio en `entertainment.ts:137-153`).
- Una pausa abierta cuenta hasta hoy en las proyecciones (`backlogUtils.js:115-120`).
- Pausar y reanudar el mismo día no excluye nada (**C14**).

### `series` (`migration2.ts:108-123`) — también las obras de lectura
| Columna | En la práctica |
|---|---|
| `status` | Nueva, Mirando, Pausado, En espera o Terminado (`series.ts:9`, validado en `:11-15`). Ver el punto 3 |
| `current_season` / `current_episode` | **Puntero al siguiente capítulo por ver** (`entertainment.ts:106`). En Terminado o En espera apunta al **último visto**, y el conteo suma +1 (`backlogUtils.js:215`) |
| `initial_season` / `initial_episode` | El puntero al crear la serie (`series.ts:72`). **Nunca se actualiza:** ni al editar (`series.ts:86-93`) ni al reiniciar (`series.ts:126-131`). Es la base del conteo de vistos (`backlogUtils.js:208-218`) |
| `total_seasons` | Cantidad de temporadas válidas del formulario (`SeriesDetailScreen.js:234`). Marca el final de la cola y del "último capítulo" (`ChapterRegistryScreen.js:111,131`) |
| `sort_order` | Orden de la serie dentro de la categoría. Lo fija el repositorio con MAX + 1 de **todas** las series no borradas (`series.ts:63-67`). El valor que calcula la pantalla (activas + 1, `SeriesDetailScreen.js:246-247`) **se ignora** (**C2**, `sortOrderPedidoPorPantalla`). Las flechas ↑↓ renumeran del 1 al n **solo las activas** (`SeriesDetailScreen.js:154-172`). En la cola desempata dentro de la misma vuelta: `getFullWatchlist` ordena por `sort_order` (`series.ts:160`) y la cola usa ese índice (`ChapterRegistryScreen.js:94-102`) |
| `interleave_offset` | Desplazamiento **solo para el orden** de la cola: se suma al progreso al intercalar (`ChapterRegistryScreen.js:89-90`), no al atraso. Al crear la serie vale el máximo progreso de las activas (`SeriesDetailScreen.js:248-254`); al reanudar una pausada sube hasta ese máximo (`:339-357`) |
| `cycle_offset` | Capítulos de vueltas anteriores ("volver a ver"): se suma al conteo de vistos (`backlogUtils.js:217`, `entertainment.ts:114-115`). Lo escribe `restartSeries` como valor absoluto (`series.ts:120-132`) |
| `last_watched_at` | Epoch ms del último cambio de puntero (`series.ts:110`); 0 al desmarcar (`ChapterRegistryScreen.js:152`). Solo desempata `getFullWatchlist` (`series.ts:160`) |

### `seasons` (`migration2.ts:124-130`)
`season_number` y `episode_count`, con `UNIQUE(series_id, season_number)`. Se guardan con un upsert que revive las borradas y borra lógicamente las que ya no vienen (`series.ts:35-58`). El formulario las numera desde 1 (`SeriesDetailScreen.js:116-118`, **C10**).

### `watch_history` / `reading_history` (`migration2.ts:131-144`)
Bitácora: una fila por capítulo marcado en el registro (`history.ts:13-18`; `ChapterRegistryScreen.js:136`, `ReadingRegistryScreen.js:108`).
- Desmarcar borra lógicamente la fila más reciente de ese capítulo (`history.ts:21-29`).
- **No se usa para contar:** el progreso sale solo del puntero. La grilla del detalle (`updateToChapter`) mueve el puntero **sin escribir historial** (`SeriesDetailScreen.js:284-293`).

### `backlog` (`migration2.ts:145-155`)
`type` (película, serie, anime o lectura), `title`, `status` (Pendiente, Mirando o Terminado), `year` (películas), `start_year`/`end_year`, `format` y `franchise` (por defecto 'Otros'). Enumerados validados en `backlog.ts:9-17`. Ver el punto 7.

### Qué son temporadas y capítulos en Lectura
Las mismas columnas, con otros nombres: **temporada = "Parte" y capítulo = "Tomo"**.
- Formulario y mensajes: `ReadingDetailScreen.js:20,187,193,195`.
- "Lee primero el Tomo …": `ReadingRegistryScreen.js:98`.
- Unidad "Tomos" en la meta: `backlogUtils.js:185`, mostrada en `SeriesAnimeScreen.js:436-439`.

**No existe el concepto de capítulo de lectura:** la unidad que se registra es el tomo (**C8**).

## 3. Estados de la serie

| Transición | Quién y cuándo |
|---|---|
| → **Nueva** | Al crear: el formulario siempre arranca en 'Nueva' (`SeriesDetailScreen.js:18,272`) y el repositorio la usa por defecto (`series.ts:70`). **El formulario no tiene selector de estado**: el modal solo pide nombre, descripción, temporadas y progreso (`SeriesDetailScreen.js:539-589`); al editar se conserva el estado que tenía (`:139`) |
| Nueva → **Mirando** | Marcar cualquier capítulo no final en el registro (`ChapterRegistryScreen.js:135-147`); mover el puntero en la grilla más allá de T1E1 (`SeriesDetailScreen.js:285`); reiniciar (`series.ts:130`) |
| Nueva/Mirando ↔ **Pausado** | El botón ⏸/▶ de la tarjeta (`SeriesDetailScreen.js:330-367`). Al reanudar ajusta `interleave_offset` (**C3**). Pausar una **serie** no toca la pausa de la **categoría** |
| → **En espera** / **Terminado** | Solo desde la alerta del último capítulo: en el registro (`ChapterRegistryScreen.js:141-146`) o al tocar el último capítulo en la grilla (`SeriesDetailScreen.js:295-300`) |
| En espera/Terminado/Pausado → **Mirando** | Tocar en la grilla un capítulo que no sea el último (`SeriesDetailScreen.js:302-304`) |

**Al marcar el último capítulo de la última temporada** (**C6**):
- Aparece la alerta "¡Completada!" con En espera, Terminado o Cancelar.
- Con En espera o Terminado: se guarda el historial, el puntero queda en el último capítulo, la serie sale de la cola y el conteo suma +1.
- Con Cancelar no se guarda nada.

**Reanudar (capítulos o temporadas nuevas)** (**C7**): no hay un "reanudar".
- Al editar una serie terminada para agregar el capítulo 21 a la T6, o una T7, la serie **sigue en Terminado y fuera de la cola** (`series.ts:83-97` no toca el estado).
- **Capítulo nuevo en la última temporada:** la única vía es la grilla. Tocar el 21 lo da por **visto** (vuelve a preguntar En espera o Terminado; el conteo pasa de 120 a 121). Tocar el 20 lo deja en Mirando y lo marca como **no visto** (el conteo baja a 119).
- **Temporada nueva:** sí funciona tocando su C1. La serie pasa a Mirando en T7E1, con el conteo intacto (120) y T7E1 primera en la cola.

**Volver a ver** (**C11**): el botón "Reiniciar" (`SeriesDetailScreen.js:308-328` → `series.ts:120-132`).
- Suma lo visto a `cycle_offset` y lleva el puntero a T1E1 en "Mirando", en la **misma** serie y categoría.
- No toca `initial_season`/`initial_episode`.
- Ver el punto 10 para sus efectos laterales.

## 4. Algoritmo del ciclo de video

**Fuente de la cola:** `generateInterleavedList` y `generateEpisodesForSeries` (`ChapterRegistryScreen.js:85-120`) sobre `db.getFullWatchlist` (`series.ts:142-175`).
- `getFullWatchlist` trae las series en estado Nueva, Mirando, En espera o Terminado, **sin Pausado** (`series.ts:159`), ordenadas por `sort_order`, `last_watched_at` y `created_at` (`:160`).
- `generateEpisodesForSeries` descarta Terminado, En espera y Pausado (`:109`) y lista desde el puntero hasta el final: hasta 500 por serie y 999 si falta la temporada (`:110-118`).
- Cada capítulo recibe `orden = (progreso + interleave_offset + índice) × 1.000.000 + posición de la serie` (`:90-94`). El progreso es `getWatchedCountSinceStart`.
- Se ordena por ese número y después por `sort_order` (`:99-102`).

**Resultado:** un round-robin de **1 capítulo por serie y vuelta**, en orden de `sort_order`. Cada serie avanza a su propio ritmo según cuántos lleva vistos (**C1**).

| Situación | Comportamiento actual |
|---|---|
| N capítulos por día | **N no cambia el orden.** Solo decide cuántos de los primeros de la cola se pintan como atraso (`ChapterRegistryScreen.js:158`). Con 5 series, N=1 y N=2 dan la misma cola (**C1**) |
| Serie nueva a mitad de ciclo | `interleave_offset` = máximo progreso de las activas (`SeriesDetailScreen.js:248-254`). Con S1 y S2 en 2 y S3–S5 en 1, S6 entra **detrás de S5·T1E3**, es decir al final de la vuelta **siguiente**, no de la actual. El atraso de la categoría no cambia (**C2**) |
| Pausar una serie | Sale de la cola y las demás siguen rotando (**C3**) |
| Reanudar | Su `interleave_offset` sube hasta igualar a la más avanzada (`SeriesDetailScreen.js:339-347`) y vuelve a la cola detrás de ella (**C3**) |
| Terminar una serie | Sale de la cola (En espera o Terminado, `ChapterRegistryScreen.js:109`). Su progreso **sigue contando** para la categoría (`getFullWatchlist` la incluye) |
| Marcar fuera de orden | Solo se permite el primer pendiente de **cada serie** ("Orden incorrecto", `ChapterRegistryScreen.js:125-126`). Se puede saltar a otra serie aunque no sea la siguiente de la cola |

El orden manual (↑↓) solo cambia `sort_order`, que desempata dentro de una vuelta. No cambia cuántas vueltas lleva cada serie.

## 5. Cuotas, pendientes y adelanto

`calculateBacklog(categoría, vistos)` (`backlogUtils.js:56-196`) recorre día por día desde `start_date` hasta hoy:
- **Video:** meta = Σ cuota del día, con el período de `quotas_history` vigente ese día, excepto los días pausados (`:73-92`).
- **Lectura:** cuenta los días activos (cuota > 0) no pausados. Meta = días × `frequency`, o días / \|`frequency`\| redondeado hacia abajo (`:94-101`).
- **Atraso** = meta − vistos (mínimo 0); **adelanto** = vistos − meta (`:103-109`).
- **Días de atraso:** se cuentan hacia atrás desde hoy con las cuotas de cada día (`:124-145`).
- **Días de adelanto:** hacia adelante desde mañana (`:147-168`). Ejemplo: 5 días con cuota 1 y 8 vistos dan un adelanto de 3 caps y 3 días (**C5**).
- **Lectura con frecuencia negativa:** días de atraso = días activos − vistos × N (`:169-183`).

**"Vistos" de la categoría:** la suma de `getWatchedCountSinceStart` de sus series (`backlogUtils.js:208-237`, misma fórmula que `entertainment.ts:97-116`). Es decir, (puntero − inicial), +1 si está cerrada, + `cycle_offset`. **Cada pantalla suma un conjunto distinto de series** (**C3**):
- La lista de categorías y el detalle: todas las series (`entertainment.ts:95`, `SeriesDetailScreen.js:82-98`).
- El registro de capítulos: `getFullWatchlist`, **sin las pausadas** (`ChapterRegistryScreen.js:74`). Con una serie pausada, el registro muestra más atraso.

**Editar una categoría** (`SeriesAnimeScreen.js:227-257` → `entertainment.ts:163-191`), **C4** y **C9**:
- **Cuotas por día:** cierra el período vigente **ayer** y abre uno nuevo **desde hoy**. El pasado no cambia y el cambio rige ya para hoy. Cambiar la cuota de hoy de 1 a 3 sube la meta de 10 a 12, y la de ayer no cambia.
- **Dos ediciones el mismo día:** dejan un período vacío (inicio hoy, fin ayer), inofensivo pero acumulable.
- **Frecuencia (lectura) y fecha de inicio (lectura y video):** se sobrescriben sin historial y **recalculan toda la meta desde el inicio**:
  - frecuencia 2 → 3: de 20 a 30;
  - inicio adelantado 10 días: lectura de 20 a 40, video de 10 a 20;
  - inicio atrasado 5 días: video de 10 a 5.
- Al adelantar el inicio, los días anteriores al primer período usan la cuota **actual** (`backlogUtils.js:42-53`).

## 6. Lectura hoy

`ReadingDetailScreen.js` y `ReadingRegistryScreen.js` son **copias** de las de video con otros textos: el diff de la lógica solo cambia mensajes (`ReadingDetailScreen.js:184-350` frente a `SeriesDetailScreen.js:199-367`).

| Aspecto | Lectura | Video |
|---|---|---|
| Unidad registrada | Tomo (temporada = parte) | Capítulo |
| Historial | `reading_history` (`ReadingRegistryScreen.js:108`) | `watch_history` (`ChapterRegistryScreen.js:136`) |
| Meta | Días activos × frecuencia, o 1 cada N días activos (`backlogUtils.js:94-101`) | Σ cuota de cada día |
| Cuota por día | Día activo sí o no (`SeriesAnimeScreen.js:217-225`) | N capítulos por día |
| Historial del ritmo | Días activos sí; **frecuencia no** (**C9**) | Cuotas sí |
| Límite de obras | Se aplica si `series_count` no es NULL, pero el formulario no lo ofrece (`SeriesAnimeScreen.js:621`) | Sí |
| Cola y estados | Mismo algoritmo y mismos estados (**C8**) | — |

**"1 cada N días"** cuenta días **activos** (`validDaysPassed`, `backlogUtils.js:81-88`), no días de calendario: con los 7 días activos y N = 3, 9 días dan 3 tomos (**C8**).

## 7. Pendiente hoy

`BacklogScreen.js` + `backlog.ts`:
- **Pestañas por tipo:** `movie`, `series`, `anime`, `reading` (`backlog.ts:9`, `BacklogScreen.js:38`). Filtros: estado (`:301`) y franquicia. Orden: título, año o fecha de alta (`backlog.ts:38-59`).
- **Campos:** título, año (películas), años de inicio y fin, formato (por defecto "24 min") y franquicia (`BacklogScreen.js:53-60,87-99`).
- **Edición:** título, años, formato y franquicia (`BacklogScreen.js:124-135`, `backlog.ts:84-93`). **No se edita el tipo.**
- **Estado:** el botón rota Pendiente → Mirando → Terminado → Pendiente (`BacklogScreen.js:137-146`, **C13**). Se borra lógicamente (`:148-164`).
- **Relación con series: ninguna.**
  - No hay columna que vincule `backlog` con `series` (`migration2.ts:145-155`).
  - Crear una serie no crea nada en Pendiente.
  - Cambiar el estado en Pendiente no toca ninguna serie (**C13**).
  - Se permiten títulos repetidos.
- **En producción**, `backlog` solo tiene los 4 tombstones de prueba (sección C).

## 8. Punto de inicio: temporada 0 y capítulo 0 (**C10**)
- **Temporada 0 (especiales):** no existe. El formulario numera desde 1 (`SeriesDetailScreen.js:116-118`) y la validación de rango exige ≥ 1 (`:208,210`).
- **Estado Nueva:** el puntero inicial no se valida (`:204`). T0C1 y T1C0 se guardan tal cual (también como `initial_*`), pero la cola los trata como T1E1 (`current_season || 1`, `ChapterRegistryScreen.js:110`) y el conteo da 0. **No hay forma real de empezar en un C0 o en un T0.**
- **Estado Mirando:** T0 se rechaza ("Temporada fuera de rango").
- **Empezar a mitad** (por ejemplo T2E1) sí funciona: la cola arranca ahí y el conteo parte de 0.

## 9. Brechas frente a los objetivos del rediseño

| Objetivo | Hoy | Evidencia |
|---|---|---|
| Vincular Pendiente ↔ series/lectura (serie nueva aparece en Pendiente como Mirando; Pendiente ya no cambia estados) | **No existe.** Son tablas y pantallas independientes; tampoco hoy Pendiente cambia el estado de una serie | `migration2.ts:145-155`; **C13** |
| Punto de inicio elegible (T1C1, T1C0, T0C1…) | **Parcial.** Se puede empezar en cualquier TxCy ≥ 1; T0 y C0 no existen (se guardan pero se tratan como 1) | **C10**; `ChapterRegistryScreen.js:110` |
| Al terminar la última temporada: Terminar o En espera | **Existe** (la alerta ofrece En espera, Terminado o Cancelar) | **C6**; `ChapterRegistryScreen.js:141-146` |
| Reanudar desde Terminado/En espera: capítulos nuevos → siguiente capítulo | **No existe correctamente.** Editar no reanuda; tocar el capítulo nuevo lo da por visto y tocar el anterior lo desmarca | **C7** |
| Reanudar: temporada nueva → su C1 | **Parcial.** Editar no reanuda; hay que tocar T(n+1)C1 en la grilla (así sí queda bien) | **C7** |
| Volver a ver en la misma categoría | **Parcial.** "Reiniciar" lo hace, pero con errores de conteo (inicio a mitad, desde En espera) | **C11**; punto 10 |
| Serie que entra a mitad de ciclo → al final del ciclo actual, sin salir atrasada | **Parcial.** No genera atraso, pero entra al final del ciclo **siguiente** | **C2** |
| Lectura por capítulos (tomo opcional) | **No existe.** La unidad es el tomo y la "parte" ocupa el lugar de la temporada | punto 6; **C8** |
| Ritmo "N por día" o "1 cada N días" | **Parcial.** Lectura sí, con frecuencia > 0 o < 0, pero "cada N días" cuenta días **activos**. Video solo tiene N por día de la semana | `backlogUtils.js:94-101`; **C8** |
| Bloque de alternancia K (3/día con K=4: lunes A1–A3, martes A4, B1, B2) | **No existe.** La cola alterna siempre de a 1 capítulo por serie | `ChapterRegistryScreen.js:85-104`; **C1** |
| Cambios de ritmo hacia adelante sin recalcular el pasado | **Parcial.** Las cuotas por día sí; la frecuencia de lectura y la fecha de inicio recalculan todo el pasado | **C4**, **C9** |

## 10. Bugs y riesgos encontrados (corregidos o pendientes, ver la última columna)

| # | Hallazgo | Evidencia | Efecto |
|---|---|---|---|
| R1 | El registro de capítulos no cuenta el progreso de las series **pausadas**: `getFullWatchlist` excluye 'Pausado' | `series.ts:159`, `ChapterRegistryScreen.js:74`; **C3** (10 frente a 12) | Más atraso en el registro que en el detalle y la lista mientras haya una serie pausada. **Corregido en la 7.4a.** |
| R2 | `series_count = 0` bloquea toda serie nueva, aunque el esquema (`migration2.ts:92`) y el formulario digan "0 = sin límite". Además, al reabrir el formulario el 0 se muestra vacío y al guardar pasa a NULL | `SeriesDetailScreen.js:220-224`, `SeriesAnimeScreen.js:194,239,627`; **C12** | Una categoría con 0 no admite series hasta volver a editarla. **Corregido en la 7.4a.** |
| R3 | Frecuencia (lectura) y fecha de inicio sin historial | `entertainment.ts:182-190`; **C9** | Cambiar el ritmo de lectura reescribe atraso y adelanto pasados |
| R4 | Reanudar un capítulo nuevo de la última temporada no tiene vía correcta | **C7** | El capítulo queda visto sin verlo, o el anterior pierde su "visto" |
| R5 | Reiniciar no actualiza `initial_season`/`initial_episode` | `series.ts:126-131`; **C11** | Si la serie empezó a mitad, ver de nuevo lo anterior al inicio no cuenta (2 → 2 tras ver la T1 completa). **Corregido en la 7.4a.** |
| R6 | Reiniciar desde 'En espera' pierde 1: `handleRestart` solo suma +1 si es Terminado, pero el conteo sumaba +1 también en En espera | `SeriesDetailScreen.js:313`, `backlogUtils.js:215`; **C11** (3 → 2) | La categoría pierde un capítulo de progreso. **Corregido en la 7.4a.** |
| R7 | La grilla del detalle mueve el puntero sin escribir historial | `SeriesDetailScreen.js:284-293` | El historial (Registro → vistos) y el conteo pueden no coincidir. **Corregido en la 7.4a.** |
| R8 | Desmarcar en el registro conserva el estado (`status` null) | `ChapterRegistryScreen.js:150-154` | Desmarcar un capítulo de una serie Terminado la deja Terminado con el puntero en ese capítulo, que sigue contando +1. No lo prueba la suite. **Corregido en la 7.4a.** |
| R9 | `sort_order`: el repositorio usa MAX + 1 de todas las series y las flechas renumeran solo las activas; el valor de la pantalla se ignora | `series.ts:63-67`, `SeriesDetailScreen.js:154-172,246-247`; **C2** | Pueden quedar `sort_order` repetidos entre activas y terminadas (inofensivo para la cola, que solo ve activas) |
| R10 | Dos ediciones de cuotas el mismo día dejan un período vacío (fin anterior al inicio) | `entertainment.ts:173-180`; **C4** | Filas inútiles en `entertainment_quotas_history` (y en el servidor) |
| R11 | La comparación de cuotas es por texto JSON | `entertainment.ts:169` | El mismo contenido con otro orden de claves abriría un período nuevo. Hoy el formulario conserva el orden; no se observó |
| R12 | Pausar y reanudar una categoría el mismo día deja una pausa con fin anterior al inicio | `SeriesAnimeScreen.js:262-269`; **C14** | No excluye nada (correcto en la práctica), pero queda una fila sin efecto |
| R13 | Las pantallas de lectura son copias de las de video | punto 6 | Cada arreglo hay que hacerlo dos veces; ya divergen en detalles (texto de alertas, límite solo en el formulario de video) |
| R14 | La lógica de la cola y de orden vive en closures de pantallas | anexo A | Solo se puede probar extrayendo el código (como hace esta suite); conviene moverla a módulos puros, usando las tablas de **C1–C14** como oráculo |
| R15 | Con una temporada de `episode_count` 0, la cola de video genera 1 capítulo y pasa a la siguiente temporada (`seasonObj ? episode_count : 999`), y la de lectura genera hasta 999 (`episode_count \|\| 999`) | `ChapterRegistryScreen.js:114` frente a `ReadingRegistryScreen.js:86` (en `d4bad14`); desde la 7.3, `QueueVariant` en `src/entertainment/queue.ts` | Video y lectura dan colas distintas con los mismos datos. Se conserva en la 7.3. **Corregido en la 7.4a.** Las temporadas de 0 capítulos se saltan igual en los dos (y desde la corrección de la 7.4a el formulario ya no deja crearlas, O4) |
| R16 | Una temporada que falta entre las guardadas (el formulario descartaba la vacía y conservaba la numeración: T1 y T3 con `total_seasons` 2) contaba como de 999 capítulos y la serie nunca llegaba a la temporada siguiente. Igual en video y en lectura | Hallado en la 7.4a; `src/entertainment/queue.ts` (`episodesInSeason`, `maxSeasonOf`) | La cola mostraba T2E1…T2E498 inexistentes y la T3 nunca llegaba. **Corregido en la 7.4a.** La temporada que falta se salta y la serie termina en la de número más alto; 999 solo para una serie sin temporadas guardadas |

---

## Anexo A. Funciones extraídas de las pantallas

Extracción con `@babel/parser` 7.29.13 y `@babel/traverse` 7.29.13: dependencias transitivas de Expo en `node_modules`, no declaradas en `package.json`. El análisis de alcance lo da `@babel/traverse`.

- **"Closures / imports"** son los identificadores libres que la suite tiene que inyectar: el estado de React, los setters, las props y los imports.
- **"db.js"** son los métodos de la fachada que llama cada función.

| Función | Archivo:línea | Closures / imports | db.js |
|---|---|---|---|
| `fetchSeries` | `SeriesDetailScreen.js:51` (lectura `:50`) | `category`, `db`, `setOriginalList` | `getSeriesByCategory`, `getSeasonsBySeries` |
| `handleSave` (serie) | `SeriesDetailScreen.js:199` (lectura `:184`) | `Alert`, `category`, `currentEpisode`, `currentSeason`, `db`, `description`, `editingSeriesId`, `fetchSeries`, `getWatchedCountSinceStart`, `isEditing`, `name`, `originalList`, `resetForm`, `seasons`, `setModalVisible`, `status` | `addSeriesWithSeasons`, `updateSeriesWithSeasons` |
| `updateToChapter` | `SeriesDetailScreen.js:278` (lectura `:263`) | `Alert`, `activeSeries`, `db`, `fetchSeries`, `originalList`, `setActiveSeries` | `updateSeriesProgress` |
| `handleRestart` | `SeriesDetailScreen.js:308` (lectura `:293`) | `Alert`, `activeSeries`, `db`, `fetchSeries`, `getAbsoluteEpisodeCount`, `setProgressModalVisible` | `restartSeries` |
| `handleTogglePauseSeries` | `SeriesDetailScreen.js:330` (lectura `:315`) | `db`, `fetchSeries`, `getWatchedCountSinceStart`, `originalList` | `updateSeriesProgress` |
| `handleAddSeason` | `SeriesDetailScreen.js:116` (lectura `:115`) | `seasons`, `setSeasons` | — |
| `generateInterleavedList` | `ChapterRegistryScreen.js:85` (lectura `ReadingRegistryScreen.js:58`) | `generateEpisodesForSeries`, `getWatchedCountSinceStart` | — |
| `generateEpisodesForSeries` | `ChapterRegistryScreen.js:106` (lectura `:81`) | — | — |
| `onMarkWatched` | `ChapterRegistryScreen.js:122` (lectura `:94`) | `Alert`, `db`, `items`, `loadData`, `rawSeries` | `addHistory` (lectura `addReadingHistory`), `updateSeriesProgress` |
| `handleSave` (categoría) | `SeriesAnimeScreen.js:227` | `Alert`, `db`, `description`, `editingId`, `fetchCategories`, `frequency`, `isEditing`, `name`, `selectedDays`, `seriesCount`, `setModalVisible`, `startDate`, `type`, `user` | `addEntertainmentCategory`, `updateEntertainmentCategory` |
| `openModal` (categoría) | `SeriesAnimeScreen.js:172` | `getLocalDateString`, `setDescription`, `setEditingId`, `setFrequency`, `setIsEditing`, `setModalVisible`, `setName`, `setSelectedDays`, `setSeriesCount`, `setStartDate`, `setType` | — |
| `handleUpdateStatus` | `BacklogScreen.js:137` | `db`, `loadItems` | `updateBacklogStatus` |

También se leyeron, pero no las ejecuta la suite:
- `moveUp`/`moveDown` (`SeriesDetailScreen.js:154,164`): `currentStatusTab`, `getFilteredSeries`, `db.updateSeriesSortOrder` y `fetchSeries`.
- `onUnmarkWatched` (`ChapterRegistryScreen.js:150`): `db.removeHistory` y `db.updateSeriesProgress`.
- `handleTogglePauseCategory` (`SeriesDetailScreen.js:369`) y `handleTogglePause` (`SeriesAnimeScreen.js:259`): `db.pauseCategory` y `db.resumeCategory`.
- `calculateGlobalBacklog` (`ChapterRegistryScreen.js:69`) y `calculateHeaderBacklog` (`SeriesDetailScreen.js:82`): `calculateBacklogV2`.

## Anexo B. La suite `scripts/probar-fase7-2.mjs`
- **Ejecución:** `node scripts/probar-fase7-2.mjs` (con `--descubrir` imprime el resultado actual de cada caso en JSON). 17 OK: los 14 casos, la extracción y 2 pruebas negativas del mecanismo.
- **Mecanismo:** si una función no se encuentra o falta una dependencia, falla con archivo, nombre y línea.
- **Datos y fechas:** solo sintéticos, en una BD nueva en el temporal del sistema (`registro-pruebas-fase7-2`). Fechas relativas a hoy en America/Guayaquil.
- **Oráculo:** las tablas `CASOS` (entrada → resultado actual) están separadas del mecanismo, para servir de oráculo cuando esta lógica pase a módulos puros.

## Anexo C. Datos en producción (último respaldo, "segundo" de la 6.7)
`probar-fase6.mjs --conteos` sobre una copia en el scratchpad (borrada al terminar), solo conteos:

| Tabla | Total | Vivas | Borradas |
|---|---|---|---|
| `entertainment_categories` | 1 | 1 | 0 |
| `entertainment_pauses` | 0 | 0 | 0 |
| `entertainment_quotas_history` | 1 | 1 | 0 |
| `series` | 1 | 1 | 0 |
| `seasons` | 1 | 1 | 0 |
| `watch_history` | 11 | 11 | 0 |
| `reading_history` | 0 | 0 | 0 |
| `backlog` | 4 | 0 | 4 |

La única categoría es de **video**: conteo por `type` sobre la misma copia, 1 de video y 0 de lectura.

**Hay datos reales de entretenimiento** (1 categoría de video con 1 serie, 1 temporada y 11 capítulos registrados), así que el rediseño tendrá que migrarlos o conservarlos. **No hay datos de lectura.** `backlog` solo tiene los 4 tombstones de prueba de la Fase 5, que se quedan por decisión de la 6.8.
