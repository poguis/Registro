# Diseño: Pendiente + Series/Anime + Lectura (Fase 7)

Estados: [OK] decidido por el usuario · [PROPUESTA] sugerido, se confirma en la subfase que lo implementa · [PENDIENTE] sin decidir.

Origen: respuestas del usuario del 2026-11-17 y resultados de la 7.2 (commit `d55b5e1`: `docs/ENTRETENIMIENTO-ACTUAL.md` y `scripts/probar-fase7-2.mjs`, 17 OK). R1–R14 y C1–C14 remiten a ese documento y a esa suite.

**Estado: cerrado para empezar la 7.3.** Se actualiza al cerrar cada subfase, y cualquier cambio de criterio se marca aquí.

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
- Hoy (7.2):
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
- R1/C3: el Registro no cuenta el progreso de las series pausadas (10 frente a 12).
- R2/C12: un límite de 0 bloquea todas las series nuevas; además, el 0 se muestra vacío y se guarda como NULL.
- R5/R6/C11: reiniciar no actualiza el punto inicial, y reiniciar desde En espera pierde 1 (se resuelve con el historial como fuente de verdad).
- R7: la grilla mueve el puntero sin escribir historial.
- R8: desmarcar en una serie Terminado la deja Terminado.
- R10/R11: períodos de cuota vacíos y comparación por texto.
- R12/C14: pausa de categoría con inicio y fin el mismo día queda como una fila sin efecto.

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

## Orden de trabajo [OK]
Cada subfase con su plan, su aprobación y su ciclo completo. Si surge algo nuevo, se agrega.

1. 7.2 Análisis: cerrada (`d55b5e1`).
2. Este documento en el repo (commit de documentación).
3. 7.3 Motor puro: mover la lógica de las pantallas a módulos, con comportamiento idéntico según el oráculo. Con APK.
4. 7.4 Correcciones del motor y fuente de verdad: historial como conteo; C2 al final del ciclo actual; R1; cuotas desde mañana sin períodos vacíos; R2; R8; historial de todo el ritmo; fecha de inicio fija con registros. Con migración si hace falta.
5. 7.5 Vínculo Pendiente↔Series/Lectura y subtipo de lectura (migración en Supabase y migración local 6).
6. 7.6 Punto de inicio (T0/C0), "Reanudar" y volver a ver.
7. 7.7 Lectura por capítulos, tomo opcional y K.
8. 7.8 API y portadas.
9. 7.9 Visualización del ritmo.
10. 7.10 Estadísticas de entretenimiento.
