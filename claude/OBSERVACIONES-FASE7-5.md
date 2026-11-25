# Observaciones de la prueba de la 7.5 (2026-11-23)

Estados: [OK] decidido · [PROPUESTA] sugerido · [PENDIENTE] sin decidir.

Estas notas salen de las pruebas en el celular de la 7.5 (Registro Dev 1.4.0 y 1.4.1). En el commit de cierre de la 7.5 se pasan a `claude/DISENO-ENTRETENIMIENTO.md` (las observaciones siguen la numeración de O1–O7) y a `claude/TRASPASO-FASE7.md`.

## Aplicado en la corrección de la 7.5 (`1f1eec8`, 1.4.1 / vc 15)
- [OK] **D5 cambia.** Al borrar una categoría, sus series vinculadas se borran con su progreso y sus títulos vuelven a Pendiente sin vínculo. Borrar desde el detalle o desde Pendiente sigue borrando los dos lados.
- [OK] **Reconciliación.** Un título en Mirando sin ninguna serie viva y con al menos una serie vinculada borrada vuelve a Pendiente. Un título en Terminado no se toca, ni uno en Mirando que nunca tuvo serie vinculada.
- [OK] **D6, confirmación.** Pasar a Terminado una serie, anime o lectura sin vínculo pide confirmación con la hoja "Marcar como Terminado". De Terminado a Pendiente no pregunta. Las películas, igual que antes.
- Prueba en Registro Dev 1.4.1: todo OK (pasos 1–12).

## Hallazgos para el cierre (los anota Claude Code)
- **FK local `seasons → series` en el pull:**
  - si una serie llega en el mismo ciclo que sus temporadas pero después de ellas, la página falla y el error solo sale en la consola;
  - ese ciclo no deja `last_error` ni baja las tablas siguientes;
  - se corrige solo en el ciclo siguiente.

  Es anterior a la 7.5. → backlog, sin corregir.
- **Dos reglas nuevas del motor:**
  - el pull aplica y compara solo las columnas que trae la fila remota;
  - "Reintentar" (`unblockAll`) libera también las entradas que esperan a un padre bloqueado.
- **Límite conocido:** si se borra una serie mientras su título todavía no llegó al celular, el título vuelve a Pendiente sin vínculo. No se pierde nada.
- **Respaldo "antes" de Registro Dev perdido.** Sin impacto: era solo Dev. En producción el "antes" sigue siendo obligatorio.
- **Formulario de categorías de lectura:** el límite (`series_count`) aparece dos veces, como "Límite (Viendo)" y como "Límite Simultáneo (Viendo)". → 7.7.

## Observaciones nuevas del usuario
- **O8 (visual):** en Pendiente, el "+" del botón de agregar queda más abajo del centro. → 7.5b.
- **O9 (visual):** en el formulario de Pendiente, el texto de las chips de franquicia ("Otros", "Marvel") queda más arriba del centro. → 7.5b.
- **O10. Selector "De Pendiente" dinámico**, en video y en lectura:
  - orden ascendente o descendente por año y por fecha de registro;
  - filtro por año, con un selector de los años que existen;
  - búsqueda por nombre;
  - filtro por tipo (Serie / Anime), con el tipo elegido desde el inicio;
  - filtro por franquicia o etiqueta.

  → 7.5b.
- **O11. Franquicias / etiquetas por sección** (Películas, Series, Anime, Lectura), creadas por el usuario:
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
- **O12. Pendiente más compacto:** la cabecera ocupa mucho espacio.
  - tipos con íconos en una fila fija, sin desplazamiento horizontal;
  - etiquetas en un filtro desplegable;
  - estado (Pendiente / Mirando / Terminado / Total) que también cambie deslizando, sin depender solo del botón;
  - formulario y filtros mejorados.

  Adelanta, solo para Pendiente, parte del rediseño que iba después de la 7.11. → 7.5b.
- **O13. Lectura (7.7):**
  - el ritmo pasa a dos modos en el formulario, "N capítulos por día" o "1 capítulo cada N días", sin números negativos en la pantalla;
  - la agrupación K ya estaba decidida en el diseño;
  - **nuevo:** cada obra puede "leer completa" en vez de seguir la agrupación, respetando el atraso y el adelanto. Si K es mayor o igual al número de capítulos, la opción no se ofrece.

  [PENDIENTE]
  - ¿Generalizarlo a "agrupación de la categoría / completa / número propio"?
  - ¿Se oculta cuando K ≥ el total de capítulos, o cuando K ≥ los que faltan?
  - ¿El capítulo que pasa de la meta del día cuenta como adelanto?
- **O14. Películas con ritmo.** Cambia la decisión [OK] "Películas no se conectan con nada".

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

## Orden propuesto [PENDIENTE de confirmar]
1. Cierre de la 7.5.
2. 7.5b Pendiente: O8–O12.
3. 7.6 tal como está planificada.
4. 7.7 Lectura, con O13 y el límite repetido.
5. 7.7b Películas: O14.
6. 7.8 en adelante, sin cambios.

La subfase de pulido (O7, B1, B2) sigue sin lugar fijo.

## Datos de prueba
- Registro Dev: al cerrar la 7.5 se borran desde la app las categorías y los títulos de prueba de la 7.4b y de la 7.5. Sus tombstones se quedan.
- Producción: no hay nada que borrar.
