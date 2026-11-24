# Diseño: Pendiente + Series/Anime + Lectura (Fase 7)

Estados: [OK] decidido por el usuario · [PROPUESTA] sugerido, se confirma en la subfase que lo implementa · [PENDIENTE] sin decidir.

Origen: respuestas del usuario del 2026-11-17 y resultados de la 7.2 (commit `d55b5e1`: `docs/ENTRETENIMIENTO-ACTUAL.md` y `scripts/probar-fase7-2.mjs`, 17 OK). R1–R14 y C1–C14 remiten a ese documento y a esa suite.

**Estado: vigente.** 7.5 cerrada (2026-11-23, `c2c42c2` y la corrección `1f1eec8`, app 1.4.1 / vc 15); el orden siguiente está [PENDIENTE de confirmar] (ver Orden de trabajo). Se actualiza al cerrar cada subfase, y cualquier cambio de criterio se marca aquí.

## Alcance y datos
- [OK] Datos existentes de entretenimiento en producción (1 categoría de video, 1 serie, 1 temporada y 11 filas en `watch_history`): el usuario los borra desde la app (borrado lógico) y el rediseño no los migra. Sus tombstones quedan en el celular y en Poguis, igual que los de la 6.8. Las migraciones nuevas tienen que tolerar tombstones.
- [OK] No hay datos de lectura. `backlog` solo tiene los 4 tombstones de prueba.
- [OK] Películas no se conectan con nada; siguen manuales en Pendiente. **[PENDIENTE] O14 propone cambiarlo** (películas con ritmo, ver Observaciones); esta decisión sigue vigente hasta que el usuario lo apruebe.
- [OK] Se conectan: serie/anime de Pendiente ↔ categorías de video; lectura de Pendiente ↔ categorías de lectura.

## Pendiente ↔ Series/Lectura
- [OK] El título puede nacer en los dos lados:
  - creado en Pendiente (estado Pendiente);
  - creado desde Series/Lectura → se crea también en Pendiente, ya vinculado y como Mirando.
- [OK] Al crear una serie/lectura en una categoría: elegir una existente de Pendiente (solo las que están en estado Pendiente y del tipo que corresponde) o crear una nueva. El selector muestra el título, el año de emisión y la fecha de registro, con orden alternable (año, registro, nombre).
- [OK] En Pendiente ya no se puede pasar a Mirando a mano (serie, anime, lectura). El estado lo mueve Series/Lectura. Películas: igual que hoy.
- [OK] Estado en Pendiente de un título vinculado:
  - Mirando mientras la serie está Nueva, Mirando, Pausado o En espera, con una etiqueta que muestra el estado detallado;
  - Terminado cuando la serie termina.
- [OK] Borrar: se borra en los dos lados (borrado lógico), con confirmación que avisa que se pierde el progreso. Desde la 7.5, la excepción es borrar una categoría (D5).
- [OK] Volver a ver: solo en la misma categoría, con el selector de punto de inicio (T1 C1 por defecto). La serie vuelve al final del ciclo actual, como una nueva.
- [OK] Lectura en Pendiente lleva subtipo: libro / cómic / manga. Define la API y si hay tomos.
- Antes de la 7.5 (7.2): no había ningún vínculo; Pendiente permitía títulos repetidos y el botón de estado rotaba Pendiente → Mirando → Terminado (C13).

### Decisiones de la 7.5 [OK] (aplicadas: `c2c42c2` y la corrección `1f1eec8`, 1.4.1 / vc 15)
- [OK] **D1.** El vínculo es `series.backlog_id` (la serie es la hija). En el servidor es una FK compuesta (`backlog_id`, `user_id`) diferida y sin on delete; en local **no hay FK**: lo valida el repositorio, porque una FK local diferida rompería el pull cuando una serie llega antes que su título. Un título tiene como máximo una serie viva vinculada (regla del repositorio y del selector), sin UNIQUE, y puede tener N tombstones. "Volver a ver" (7.6) reutiliza la misma serie.
- [OK] **D2.** `backlog.status` de un título vinculado se guarda y se escribe en la misma transacción que la serie, por un único punto (`writeBacklogStatus`, llamado solo desde el reflejo, la liberación de la D5 y la reconciliación). La etiqueta detallada ("En «Categoría» · Estado") se lee de la serie.
  - Con series vivas: alguna en Nueva, Mirando, Pausado o En espera → Mirando; todas en Terminado → Terminado.
  - **Reconciliación** (tras el pull completo de `series`): un título en **Mirando** sin series vivas y con **al menos una serie vinculada borrada** vuelve a Pendiente. Un Terminado sin serie viva no se toca (puede ser a mano, D6), ni un Mirando que nunca tuvo serie vinculada (anterior a la 7.5).
- [OK] **D3.** Sin acción "Vincular": las series sin vínculo quedan heredadas y funcionan como en la 1.3.9.
- [OK] **D4.** Editar el nombre de una serie vinculada actualiza el título de Pendiente y al revés, en la misma transacción. Aplica también al alta "De Pendiente" con el nombre editado en el formulario.
- [OK] **D5 (versión final, tras la prueba del celular).** Borrar una categoría borra sus series u obras vinculadas con su progreso, y sus títulos **vuelven a Pendiente sin vínculo** (también desde Terminado) y otra vez son candidatos del selector. Borrar una serie u obra desde su detalle, o un título desde Pendiente, sigue borrando los dos lados. Texto de la confirmación al borrar una categoría con vinculadas: "Se borrará su serie vinculada con todo su progreso y su título volverá a Pendiente, sin vínculo." / "Se borrarán sus N series vinculadas con todo su progreso y sus títulos volverán a Pendiente, sin vínculo." (en lectura, "obra"/"obras"). Sin vinculadas, el texto de siempre.
- [OK] **D6.** Serie, anime y lectura sin vínculo: el botón alterna Pendiente ↔ Terminado (desde Mirando, a Terminado), nunca Mirando a mano. Pasar a Terminado pide confirmación con la hoja "Marcar como Terminado" («título», Terminado / Cancelar); de Terminado a Pendiente no pregunta. Un vinculado no cambia a mano (hoja "Vinculado": el estado lo cambia la serie o la obra). Las películas, igual que antes.
- [OK] **D7.** `backlog.subtype`: `book` / `comic` / `manga` (en pantalla, Libro / Cómic / Manga). Es obligatorio al crear o editar lectura y se edita. La lectura de antes queda "Sin subtipo" hasta editarla. Hay filtro por subtipo en la pestaña Lectura.
- [OK] **D8.** "Nuevo título" desde Series/Lectura: el título (el nombre de la serie), el tipo (Serie / Anime) o el subtipo en lectura, y el año de inicio opcional; formato y franquicia con los valores por defecto de Pendiente. Nace vinculado y en Mirando.
- [OK] **D9.** Los datos de prueba de Registro Dev (7.4b y 7.5) se borraron desde la app al cerrar la 7.5; sus tombstones quedan.
- **Límite conocido:** si se borra una serie mientras su título todavía no llegó al celular (solo con dos dispositivos), la reconciliación devuelve el título a Pendiente sin vínculo. No se pierde nada.

## Estados de la serie
- [OK] Nueva al crear; Mirando tras el primer capítulo visto; Pausado manual en cualquier momento; al reanudar, el ciclo se adapta.
- [OK] Al marcar el último capítulo de la última temporada, la app pregunta: Terminar o En espera. **Ya existe** (C6).
- [OK] Reanudar desde Terminado y desde En espera, con una acción explícita "Reanudar":
  - capítulos nuevos en la última temporada → continúa en el siguiente (6×20 → 6×21);
  - temporada nueva → empieza en ella;
  - la serie reanudada vuelve al final del ciclo actual.

  Hoy está roto (C7, R4).
- Hoy (R8): desmarcar el último capítulo de una serie Terminado la deja Terminado, con el puntero en ese capítulo y contando +1. Se corrige.

## Punto de inicio
- [OK] Al crear y al volver a ver, se elige desde dónde empieza: T1 C1 (base), T1 C0, T0 C1, T0 C2, etc.
- [OK] Orden T0 → T1 → T2…; cualquier temporada puede tener capítulo 0.
- Hoy no existe (C10): T0 y C0 se guardan, pero se tratan como T1E1. Empezar a mitad (por ejemplo T2E1) sí funciona.

## Ciclo de video
- [OK] N capítulos por día (nunca "1 cada N días" en video).
- [OK] Rotación de un capítulo por serie: el bloque K no aplica a video (K = 1 fijo).
- [OK] Una serie que entra a mitad de ciclo (nueva, reanudada o vuelta a ver) se pone al final del ciclo actual, sin salir atrasada. Hoy entra al final del ciclo siguiente (C2): se corrige.
- [OK] (prueba 7.4a, cambia la opción A elegida en el plan) Una serie **pausada que se reanuda conserva su lugar** en la lista (`sort_order`) y entra en la vuelta en curso con su propio progreso: dentro de esa vuelta sale en el orden que siempre tuvo. Solo las series nuevas van al final.
- Hoy:
  - la cola es un round-robin de un capítulo por serie según el progreso + `interleave_offset`, con `sort_order` como desempate dentro de la vuelta;
  - N solo decide cuántos se pintan como atraso;
  - la pantalla calcula un `sort_order` que el repositorio ignora (R9).

## Lectura
- [OK] Unidad principal: capítulo. Opción secundaria: tomo/volumen, elegible. Hoy la unidad es el tomo y la temporada hace de "parte" (C8).
- [OK] Ritmo: "N capítulos por día" o "1 capítulo cada N días".
- [OK] "1 cada N días" cuenta solo los días seleccionados como activos en la categoría (como hoy). Ejemplo: lunes a viernes activos y N = 2 → lunes, miércoles, viernes, martes…
- [OK] Bloque de alternancia K, independiente del ritmo. Ejemplo: 3 por día con K = 4 → lunes A1–A3; martes A4, B1, B2.
- [OK] Unidad, ritmo y K son por categoría. Para ritmos distintos se usa una categoría por tipo (por ejemplo "Libros" con 1 capítulo cada 2 días y "Cómics" con 3 por día y K = 3).
- [OK] Video y lectura comparten un solo motor. Hoy las pantallas de lectura son copias de las de video (R13).

## Cuotas y cambios de ritmo
- [OK] Todo parámetro de ritmo (días activos, cuotas por día, frecuencia, K, unidad) va en un historial con fecha de vigencia. Cada cambio aplica **desde mañana**. Nunca se recalculan los pendientes ni el adelanto pasados. El adelantado se mantiene.
- [OK] La fecha de inicio de la categoría solo se puede editar mientras la categoría no tiene registros; después queda fija. Lo que cambia es el ritmo (días, frecuencia) y las pausas.
- Hoy (7.2), **corregido en la 7.4b** (ritmo desde mañana con historial, también de la frecuencia; R10–R12; fecha de inicio fija con registros):
  - las cuotas de video rigen ya para hoy (C4); dos ediciones el mismo día dejan un período vacío (R10); la comparación es por texto JSON (R11);
  - la frecuencia de lectura (R3) y la fecha de inicio (lectura y video, C9) no tienen historial y recalculan todo el pasado;
  - adelanto (C5): vistos − meta; los días de adelanto se cuentan desde mañana.

## Arquitectura
- [OK] La lógica del ciclo, las cuotas y el saldo sale de las pantallas a módulos puros (estilo `backlogUtils.js`), compartidos por video y lectura. Las tablas de casos de `probar-fase7-2` son el oráculo: en la 7.3 el comportamiento tiene que dar idéntico, y en la 7.4 cada cambio deseado se justifica caso por caso.
- [OK] **El historial es la fuente de verdad del progreso.**
  - Vistos = filas de historial (`watch_history` / `reading_history`); el puntero solo indica cuál es el siguiente.
  - Desaparecen las correcciones de la aritmética actual (puntero − inicial, +1 si está cerrada, `cycle_offset`), que explican R5, R6, R7 y R8.
  - La grilla pasa a ser "marcar vistos hasta aquí": escribe las filas de historial con fecha.
  - Los datos actuales se borran (ver Alcance), así que no hace falta conciliar puntero e historial.
- [PROPUESTA] El modelo concreto (columnas nuevas, si se reutilizan `seasons` y la tabla para los tomos opcionales, el historial de ritmo) se define en el plan de la subfase que lo necesita. Todo cambio de esquema va en una migración de Supabase aplicada antes del APK, más la migración local correspondiente; nunca borra datos.

## Bugs del comportamiento actual (7.2), a corregir en la 7.4 salvo que se indique otra subfase
- R1/C3: el Registro no cuenta el progreso de las series pausadas (10 frente a 12). **Corregido en la 7.4a.**
- R2/C12: un límite de 0 bloquea todas las series nuevas; además, el 0 se muestra vacío y se guarda como NULL. **Corregido en la 7.4a.** (O1)
- R5/R6/C11: reiniciar no actualiza el punto inicial, y reiniciar desde En espera pierde 1 (se resuelve con el historial como fuente de verdad). **Corregido en la 7.4a.**
- R7: la grilla mueve el puntero sin escribir historial. **Corregido en la 7.4a.**
- R8: desmarcar en una serie Terminado la deja Terminado. **Corregido en la 7.4a.**
- R10/R11: períodos de cuota vacíos y comparación por texto. **Corregido en la 7.4b.**
- R12/C14: pausa de categoría con inicio y fin el mismo día queda como una fila sin efecto. **Corregido en la 7.4b.**
- R15 y R16 (temporadas de 0 capítulos y temporadas que faltan entre las guardadas): **Corregido en la 7.4a.** Ver Observaciones.

## API de búsqueda (7.8)
- [OK] Títulos en inglés. Anime/manga: nombre en alfabeto latino (inglés o romaji; "One Piece" tal cual).
- [OK] Se consulta solo al crear. Guarda además si está en emisión o finalizada.
- [OK] Portadas en Pendiente y en Series/Anime: se descargan la primera vez y después se ven sin internet.
- [OK] APIs sin clave: TVmaze (series), AniList (anime y manga), Open Library (libros; los capítulos se ponen a mano).
- [OK] Cómics: entrada manual por ahora (Comic Vine exige una clave en la app; no se usa).
- [OK] La búsqueda nunca es obligatoria: sin red, el formulario manual funciona igual.
- [PROPUESTA] Guardar la fuente y el id externos.

## Visualización del ritmo (7.9)
- [OK] Sección "Ritmo" en cada categoría:
  - "Hoy": cuota de hoy, hechos, faltantes y saldo (+N adelantado / −N atrasado / al día);
  - "Próximos 7 días": qué toca cada día (serie y capítulo, con K aplicado en lectura), calculado con el mismo motor;
  - "Historial de ritmo": períodos con fechas y el vigente resaltado; pausas como franjas;
  - "¿Cómo se calcula?": debías X desde la fecha de inicio, hiciste Y, saldo Z, días en pausa;
  - al guardar un cambio de ritmo, confirmación: desde mañana cambia tal cosa, el saldo no se recalcula, cuota semanal antes y después.

## Estadísticas de entretenimiento (7.10, idea)
- [OK] Ver la tendencia de lo que se ve y se lee (por ejemplo capítulos por semana o mes por categoría, rachas, atraso y adelanto en el tiempo), a partir del historial. Se diseña al llegar a esa subfase.

## Observaciones del usuario en las pruebas del celular
Lista viva. Cada observación se asigna a una subfase cuando se planifica; las de UX sin subfase obvia van a la 7.4 o a una subfase de pulido.
- O1 (prueba 7.3): el límite de series activas es obligatorio al crear o editar una categoría, de video y de lectura (no puede quedar vacío; mínimo 1). Dentro de la categoría no se puede superar, y el aviso "Límite Alcanzado" sale al tocar "Agregar", antes de abrir el formulario. Reemplaza R2 (el 0 que bloquea todo). → 7.4a. **Cerrada en la 7.4a.**
- O2 (prueba 7.3): en el Registro de lectura, las etiquetas o los contadores "Pendiente" y "Visto" se muestran mal. Revisar con la captura del usuario y el código. → 7.4a. **Cerrada en la 7.4a** (la barra de pestañas tenía fondo blanco fijo).
- O3 (prueba 7.3): En espera y Terminado ofrecen las mismas dos acciones: "Continuar" (reanudar donde quedó, tras agregar capítulos o una temporada) y "Volver a ver" con el selector de punto de inicio (también desde la mitad, no solo desde T1C1). → 7.6.
- R15 (7.3): con una temporada de 0 capítulos, video genera 1 capítulo y pasa a la siguiente, y lectura genera hasta 999. Conservado en la 7.3 (`QueueVariant`); en la 7.4a se salta igual en los dos. **Corregido en la 7.4a.**
- R16 (hallado en la 7.4a): una temporada que falta entre las guardadas (el formulario descartaba la vacía y conservaba la numeración) contaba como de 999 capítulos y la serie nunca llegaba a la siguiente. **Corregido en la 7.4a.** Se salta, y la serie termina en la temporada de número más alto; 999 solo para una serie sin temporadas.
- O4 (prueba 7.4a): el formulario permite crear una temporada (o parte) con 0 capítulos (o tomos), que no tiene sentido. Cada temporada debe tener al menos 1. La cola sigue saltando las de 0 que ya existan. → corrección de la 7.4a. **Cerrada en la 7.4a.**
- O5 (prueba 7.4a): el tema claro es demasiado blanco; usar un fondo claro cálido (beige o hueso), no blanco puro, en toda la app. → dirección visual. **Cerrada en la dirección visual** (fondo hueso `#F6F1E8`, tema A).
- O6 (dirección visual): reemplazar los diálogos del sistema (`Alert.alert`) por una hoja inferior propia, más un aviso breve para los mensajes de éxito, con el estilo de la app en los dos modos. **Cerrada en la dirección visual:** `BottomSheet`, `Toast`, `SheetProvider` (cola) y `useSheet` reemplazan los 78 `Alert.alert`, con los mismos textos y sin excepciones.
- O7 (dirección visual): textos de las alertas que se pueden mejorar y que **no se cambiaron** en la dirección visual: "¿Estás seguro?" al eliminar una serie u obra (no dice qué se borra), "Mover a:" en "¡Completada!", y 'Error' + "Falta categoría" / "Selecciona persona" en Dinero (muy secos). → subfase de pulido.
- B1 (dirección visual): en Dinero, "Seleccionar Rango" usa `now`, que no está definido; si el año queda vacío, la pantalla lanza un error. Es previo a la subfase y no se corrigió (era solo visual). → subfase de pulido.
- B2 (dirección visual): el formulario de Trabajo no tiene `onRequestClose`, así que Atrás no lo cierra (igual que antes). → subfase de pulido.
- Hallazgo (7.5): en el formulario de categorías de lectura, el límite (`series_count`) aparece dos veces, como "Límite (Viendo)" y como "Límite Simultáneo (Viendo)". Es el mismo campo. → 7.7.
- O8 (prueba 7.5, visual): en Pendiente, el "+" del botón de agregar queda más abajo del centro. → 7.5b.
- O9 (prueba 7.5, visual): en el formulario de Pendiente, el texto de las chips de franquicia ("Otros", "Marvel") queda más arriba del centro. → 7.5b.
- O10 (prueba 7.5). Selector "De Pendiente" dinámico, en video y en lectura:
  - orden ascendente o descendente por año y por fecha de registro;
  - filtro por año, con un selector de los años que existen;
  - búsqueda por nombre;
  - filtro por tipo (Serie / Anime), con el tipo elegido desde el inicio;
  - filtro por franquicia o etiqueta.

  → 7.5b.
- O11 (prueba 7.5). Franquicias / etiquetas por sección (Películas, Series, Anime, Lectura), creadas por el usuario:
  - se quitan Marvel y DC Comics fijas;
  - al crear un título se ofrecen las etiquetas de su sección y se sugieren las de las otras secciones;
  - los filtros usan las etiquetas creadas en cada sección.

  [PROPUESTA]
  - Llamarlas "Etiqueta", para que no choquen con "Categoría", que ya es el contenedor con ritmo.
  - Una tabla sincronizada nueva con clave natural (usuario, sección, nombre), para que dos dispositivos no creen duplicados.

  [PENDIENTE]
  - ¿Una etiqueta por título o varias (por ejemplo Shounen + Isekai)?
  - ¿Empezar sin etiquetas, o con Marvel y DC creadas pero vacías?

  → 7.5b.
- O12 (prueba 7.5). Pendiente más compacto: la cabecera ocupa mucho espacio.
  - tipos con íconos en una fila fija, sin desplazamiento horizontal;
  - etiquetas en un filtro desplegable;
  - estado (Pendiente / Mirando / Terminado / Total) que también cambie deslizando, sin depender solo del botón;
  - formulario y filtros mejorados.

  Adelanta, solo para Pendiente, parte del rediseño que iba después de la 7.11. → 7.5b.
- O13 (prueba 7.5). Lectura (7.7):
  - el ritmo pasa a dos modos en el formulario, "N capítulos por día" o "1 capítulo cada N días", sin números negativos en la pantalla;
  - la agrupación K ya estaba decidida en el diseño;
  - **nuevo:** cada obra puede "leer completa" en vez de seguir la agrupación, respetando el atraso y el adelanto. Si K es mayor o igual al número de capítulos, la opción no se ofrece.

  [PENDIENTE]
  - ¿Generalizarlo a "agrupación de la categoría / completa / número propio"?
  - ¿Se oculta cuando K ≥ el total de capítulos, o cuando K ≥ los que faltan?
  - ¿El capítulo que pasa de la meta del día cuenta como adelanto?
- O14 (prueba 7.5). Películas con ritmo. **Cambia la decisión [OK] "Películas no se conectan con nada"** (Alcance), que sigue vigente hasta que se apruebe.

  [PROPUESTA]
  - **Categoría:** de tipo Películas, sin límite. Contiene sola todas las películas en estado Pendiente, con los filtros de Pendiente.
  - **Ritmo:** "N películas por semana" (lunes a domingo) o "N por día". El atraso se calcula por semanas cerradas, y aparte se muestra "esta semana: X de N". Con pausas e historial de ritmo.
  - **Estados:** "Empezar" la pasa a Mirando (puede haber varias a la vez). "Vista" la pasa a Terminado y cuenta para el ritmo; también se puede marcar directamente.
  - **Por dentro:** cada película empezada o vista crea una serie vinculada de 1 unidad. Así reutiliza el vínculo, el historial, el ritmo, "Hoy te toca" y las notificaciones.
  - **Esquema:** migración para el tipo nuevo de categoría y para el ritmo semanal.

  [PENDIENTE]
  - ¿Una sola categoría de Películas o varias?
  - Aprobar la propuesta.

  → 7.7b, antes de la 7.9 y la 7.11.

## Ideas nuevas [OK] (aceptadas por el usuario el 2026-11-18, todas con un diseño visual mejorado)
- I1 "Hoy te toca" en el inicio: lo que toca ver y leer hoy en todas las categorías, para marcar con un toque. → 7.9.
- I2 Fecha estimada de fin por serie y por categoría según el ritmo actual. → 7.9.
- I3 Progreso con portada: barra de % visto y "T3 · C5 de 22". → 7.8.
- I4 Rachas y mapa de calor del historial. → 7.10.
- I5 Recordatorio diario local (notificación) si no se cumplió la cuota; funciona sin internet; suma un módulo nativo. → subfase propia (7.11).
- I6 Deslizar para marcar visto en el Registro, con "Deshacer". → 7.6.
- [OK] Dirección visual: antes de las subfases con mucha interfaz (7.5 en adelante), maquetas de las pantallas clave para elegir el estilo; después se aplica como tema común. El usuario eligió la dirección A "Hueso y petróleo" (ver Dirección visual A). **Aplicada como base en la dirección visual.**

## Dirección visual A "Hueso y petróleo" [OK] (aplicada el 2026-11-22, `c8eb200`)
- **Decisión del usuario (2026-11-22):** esta subfase aplicó solo la base visual (tema A, tipografía, hojas, nombres largos). El rediseño completo de las pantallas se hace al final, después de que toda la lógica esté terminada (después de la 7.11). 'Hoy te toca' sigue en la 7.9.
- **Tokens** (`src/contexts/ThemeContext.js`, única fuente de colores; `scripts/probar-tema.mjs` verifica los contrastes):

  | Token | Claro | Oscuro | Uso |
  |---|---|---|---|
  | `bg` | `#F6F1E8` | `#181614` | fondo de pantalla (hueso, O5) |
  | `surface` | `#FFFDF8` | `#221F1C` | tarjetas, cabeceras, hojas |
  | `raised` | `#EFE8DC` | `#2D2925` | campos, chips inactivos, botón secundario |
  | `ink` / `muted` | `#24211D` / `#6B6359` | `#F1EBE2` / `#B3A899` | texto / texto secundario |
  | `line` / `lineStrong` | `#E3D9CA` / `#8C8275` | `#3A352F` / `#807769` | separadores decorativos / bordes de campos (≥ 3:1) |
  | `accent` / `onAccent` / `soft` | `#1F6B73` / `#FFFFFF` / `#DCEBEA` | `#62B5BC` / `#0D2325` / `#1D3436` | petróleo: acción principal, texto sobre ella, fondo suave |
  | `aheadFg`/`Bg` | `#1D5FA8` / `#E1EBF7` | `#93BEF2` / `#1B2C42` | adelanto |
  | `behindFg`/`Bg` | `#9A4A00` / `#FAE3CD` | `#F2A866` / `#3B2716` | atraso |
  | `okFg`/`Bg` | `#4F4A44` / `#EAE4DA` | `#CFC7BC` / `#2F2B27` | al día |
  | `danger` / `onDanger` | `#9A4A00` / `#FFFFFF` | `#F2A866` / `#24211D` | botón destructivo |
  | `overlay` · `shadow` | `rgba(36,33,29,0.48)` · `#24211D` | `rgba(0,0,0,0.60)` · `#000000` | fondo de hojas y modales · sombras |
  | `money.ingreso/gasto/deuda` | `#2E6B34` / `#B3261E` / `#7A3E9D` | `#7CC48A` / `#F2948C` / `#C9A2E6` | Dinero, Estadísticas |
  | `tones.*` (fg/bg) | verde, azul, morado, naranja, rojo, pizarra | ídem | colores de identidad (módulos de Inicio, tipos y estados, crédito/débito, turnos) |

- **Contraste:** ≥ 4.5 de todo texto sobre `bg` y `surface` y de cada par fg/bg; ≥ 3 de `lineStrong` y del texto destructivo. `line` es decorativo.
- **Tipografía:** Plus Jakarta Sans 400/500/600/700, embebida, una familia por peso (`AppText`). Radios: 18 (base), 11 (pequeño) y 24 (hoja).
- **Hojas (O6):** `confirm` (variantes primaria / secundaria / destructiva / cancelar; Atrás y el fondo cancelan, y una hoja de solo "OK" se cierra igual que con OK), `informar` (hoja con "OK") y `avisar` (aviso de hasta 2 líneas, que se muestra después de cerrar el formulario modal).
- **Nombres largos:** 2 líneas en filas y tarjetas; 3 en el título del detalle; 2 en la categoría de una cabecera; 1 con elipsis en subtítulos, metadatos y títulos de hoja o aviso; los mensajes de las hojas, completos. Contenedor con `flex: 1` y `minWidth: 0`; chips, contadores y botones con `flexShrink: 0`.

## Orden de trabajo [OK]
Cada subfase con su plan, su aprobación y su ciclo completo. Si surge algo nuevo, se agrega.

1. 7.2 Análisis: cerrada (`d55b5e1`).
2. Este documento en el repo: cerrado (`758e7de`).
3. 7.3 Motor puro: cerrada (`241c26e`, cierre `45f5cda`).
4. 7.4 Correcciones del motor, en dos subfases (un APK cada una):
   - 7.4a: **cerrada** (`90ea3b5`, `47f358c` y el commit de este cierre). Sin migración: historial como conteo (incluye R1, R5–R8 y la grilla como "marcar vistos hasta aquí"); C2 al final del ciclo actual (la pausada que se reanuda entra en la vuelta en curso conservando su lugar); R15; O1 (y R2); O2; corrección tras la prueba del celular: E3 conservando el lugar y O4 (temporadas de al menos 1 capítulo), con APK 1.3.7 / vc 11;
   - 7.4b: **cerrada** (`20ad1cb`, cierre `bd17bb9`). Con migración (primero en Supabase): historial de todo el ritmo desde mañana, sin períodos vacíos (R10), con comparación por contenido (R11); fecha de inicio fija con registros; R12.
   - Dirección visual (antes de la 7.5): **cerrada** (`c8eb200` y el commit de este cierre). Tema A, Plus Jakarta Sans, hojas propias (O5 y O6) y nombres largos, con APK 1.3.9 / vc 13. Solo la base visual.
5. 7.5 Vínculo Pendiente↔Series/Lectura y subtipo de lectura: **cerrada** (`c2c42c2`, corrección `1f1eec8` con D5 final y la confirmación de D6, y el commit de este cierre). Migración 6 de Supabase y local 7, con APK 1.4.1 / vc 15.
6. 7.6 Punto de inicio (T0/C0), "Continuar" y "Volver a ver" desde En espera y Terminado (O3), deslizar para marcar con "Deshacer" (I6).
7. 7.7 Lectura por capítulos, tomo opcional y K.
8. 7.8 API, portadas y progreso con portada (I3).
9. 7.9 Visualización del ritmo, "Hoy te toca" (I1) y fecha estimada de fin (I2).
10. 7.10 Estadísticas de entretenimiento, rachas y mapa de calor (I4).
11. 7.11 Recordatorio diario local (I5).
12. Rediseño completo de las pantallas, después de la 7.11, cuando toda la lógica esté terminada (decisión del usuario, 2026-11-22; ver Dirección visual A).

Subfase de pulido (O7, B1 y B2): sin lugar decidido en el orden; se planifica aparte.

### Orden propuesto tras la 7.5 [PENDIENTE de confirmar]
1. Cierre de la 7.5 (hecho).
2. 7.5b Pendiente: O8–O12.
3. 7.6 tal como está planificada.
4. 7.7 Lectura, con O13 y el límite repetido del formulario.
5. 7.7b Películas: O14 (si se aprueba).
6. 7.8 en adelante, sin cambios.

La subfase de pulido (O7, B1, B2) sigue sin lugar fijo. Hasta que el usuario lo confirme, rige el Orden de trabajo de arriba.
