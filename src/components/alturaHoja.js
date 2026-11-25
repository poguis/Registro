// Alturas de una hoja con teclado (Fase 7.5b1, corrección 1.4.4). Función pura: sin React ni
// react-native, se prueba en Node (scripts/probar-fase7-5b1.mjs).
//
// Entrada (en dp):
//   ventana  alto de la ventana (lo mide HojasHost con onLayout en la raíz de la app);
//   insets   { top, bottom } de react-native-safe-area-context;
//   teclado  alto del teclado de keyboardDidShow (e.endCoordinates.height; 0 si está cerrado);
//   variante 'inferior' (anclada abajo) o 'centrada';
//   contenido (opcional) alto natural del contenido de la tarjeta.
// Salida:
//   tope     espacio de arriba: insets.top + 24 (nunca bajo la barra de estado);
//   relleno  espacio de abajo: con el teclado cerrado insets.bottom (del color de la hoja en la
//            inferior, así llega al borde); abierto, teclado + insets.bottom (justo bajo el teclado);
//   maxAlto  alto máximo de la tarjeta: con el teclado cerrado, el 85 % de la ventana (el que tenía
//            la hoja de etiquetas en 1d8d756) sin pasar el área libre; abierto, el área libre;
//   alto / scroll (si viene contenido) alto final de la tarjeta y si su lista hace scroll.

export const MARGEN_ARRIBA = 24;
export const MARGEN_CENTRADA = 20;
export const FRACCION_MAXIMA = 0.85;

export function alturaHoja({ ventana, insets = {}, teclado = 0, variante = 'inferior', contenido } = {}) {
    const arriba = Math.max(0, Number(insets.top) || 0);
    const abajo = Math.max(0, Number(insets.bottom) || 0);
    const tecla = Math.max(0, Number(teclado) || 0);
    const v = Math.max(0, Number(ventana) || 0);
    const tope = arriba + MARGEN_ARRIBA;
    const relleno = tecla > 0 ? tecla + abajo : abajo;
    const libre = Math.max(0, v - tope - relleno - (variante === 'centrada' ? MARGEN_CENTRADA : 0));
    const maxAlto = tecla > 0 ? libre : Math.min(Math.round(FRACCION_MAXIMA * v), libre);
    const salida = { tope, relleno, maxAlto };
    if (contenido !== undefined && contenido !== null) {
        const c = Math.max(0, Number(contenido) || 0);
        salida.alto = Math.min(c, maxAlto);
        salida.scroll = c > maxAlto;
    }
    return salida;
}
