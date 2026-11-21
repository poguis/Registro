# Diseño: Pendiente + Series/Anime + Lectura (Fase 7)

Estados: [OK] decidido por el usuario · [PROPUESTA] sugerido, se confirma en la subfase que lo implementa · [PENDIENTE] sin decidir.

Origen: respuestas del usuario del 2026-11-17 y resultados de la 7.2 (commit `d55b5e1`: `docs/ENTRETENIMIENTO-ACTUAL.md` y `scripts/probar-fase7-2.mjs`, 17 OK). R1–R14 y C1–C14 remiten a ese documento y a esa suite.

**Estado: vigente.** 7.4b cerrada; sigue la dirección visual y después la 7.5. Se actualiza al cerrar cada subfase, y cualquier cambio de criterio se marca aquí.

## Alcance y datos
- [OK] Datos existentes de entretenimiento en producción (1 categoría de video, 1 serie, 1 temporada y 11 filas en `watch_history`): el usuario los borra desde la app (borrado lógico) y el rediseño no los migra. Sus tombstones quedan en el celular y en Poguis, igual que los de la 6.8. Las migraciones nuevas tienen que tolerar tombstones.
- [OK] No hay datos de lectura. `backlog` solo tiene los 4 tombstones de prueba.
- [OK] Películas no se conectan con nada; siguen manuales en Pendiente.
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
- [OK] Borrar: se borra en los dos lados (borrado lógico), con confirmación que avisa que se pierde el progreso.
- [OK] Volver a ver: solo en la misma categoría, con el selector de punto de inicio (T1 C1 por defecto). La serie vuelve al final del ciclo actual, como una nueva.
- [OK] Lectura en Pendiente lleva subtipo: libro / cómic / manga. Define la API y si hay tomos.
- Hoy (7.2): no hay ningún vínculo; Pendiente permite títulos repetidos y el botón de estado rota Pendiente → Mirando → Terminado (C13).

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
- O5 (prueba 7.4a): el tema claro es demasiado blanco; usar un fondo claro cálido (beige o hueso), no blanco puro, en toda la app. → dirección visual.

## Ideas nuevas [OK] (aceptadas por el usuario el 2026-11-18, todas con un diseño visual mejorado)
- I1 "Hoy te toca" en el inicio: lo que toca ver y leer hoy en todas las categorías, para marcar con un toque. → 7.9.
- I2 Fecha estimada de fin por serie y por categoría según el ritmo actual. → 7.9.
- I3 Progreso con portada: barra de % visto y "T3 · C5 de 22". → 7.8.
- I4 Rachas y mapa de calor del historial. → 7.10.
- I5 Recordatorio diario local (notificación) si no se cumplió la cuota; funciona sin internet; suma un módulo nativo. → subfase propia (7.11).
- I6 Deslizar para marcar visto en el Registro, con "Deshacer". → 7.6.
- [PROPUESTA] Dirección visual: antes de las subfases con mucha interfaz (7.5 en adelante), maquetas de las pantallas clave (inicio con "Hoy te toca", categoría con "Ritmo", Registro, detalle de serie con portada) para elegir el estilo; después se aplica como tema común.

## Orden de trabajo [OK]
Cada subfase con su plan, su aprobación y su ciclo completo. Si surge algo nuevo, se agrega.

1. 7.2 Análisis: cerrada (`d55b5e1`).
2. Este documento en el repo: cerrado (`758e7de`).
3. 7.3 Motor puro: cerrada (`241c26e`, cierre `45f5cda`).
4. 7.4 Correcciones del motor, en dos subfases (un APK cada una):
   - 7.4a: **cerrada** (`90ea3b5`, `47f358c` y el commit de este cierre). Sin migración: historial como conteo (incluye R1, R5–R8 y la grilla como "marcar vistos hasta aquí"); C2 al final del ciclo actual (la pausada que se reanuda entra en la vuelta en curso conservando su lugar); R15; O1 (y R2); O2; corrección tras la prueba del celular: E3 conservando el lugar y O4 (temporadas de al menos 1 capítulo), con APK 1.3.7 / vc 11;
   - 7.4b: **cerrada** (`20ad1cb` y el commit de este cierre). Con migración (primero en Supabase): historial de todo el ritmo desde mañana, sin períodos vacíos (R10), con comparación por contenido (R11); fecha de inicio fija con registros; R12.
5. 7.5 Vínculo Pendiente↔Series/Lectura y subtipo de lectura (migración en Supabase y la migración local siguiente).
6. 7.6 Punto de inicio (T0/C0), "Continuar" y "Volver a ver" desde En espera y Terminado (O3), deslizar para marcar con "Deshacer" (I6).
7. 7.7 Lectura por capítulos, tomo opcional y K.
8. 7.8 API, portadas y progreso con portada (I3).
9. 7.9 Visualización del ritmo, "Hoy te toca" (I1) y fecha estimada de fin (I2).
10. 7.10 Estadísticas de entretenimiento, rachas y mapa de calor (I4).
11. 7.11 Recordatorio diario local (I5).

Antes de la 7.5: dirección visual con maquetas (ver Ideas nuevas).
