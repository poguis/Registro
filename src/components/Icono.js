import React from 'react';
import { Lucide } from '@react-native-vector-icons/lucide/static';

// Íconos de la app (Fase 7.5b2a, F4). ÚNICO archivo que importa @react-native-vector-icons/lucide,
// y siempre la entrada estática (/static): la fuente Lucide.ttf la embebe en el APK la tarea
// copyFonts del Gradle del paquete (el plugin de app.json solo toca iOS), así que está disponible
// sin red desde el primer frame. No se agrega al plugin de expo-font (la duplicaría).
//
// El color es obligatorio y sale del tema (theme.*); sin color no se dibuja nada. El ícono es
// decorativo: el texto accesible lo da el botón que lo contiene.

// Nombre semántico → glifo de Lucide (en un solo lugar; probar-fase7-5b2a comprueba que cada
// glifo exista en el Lucide.json instalado).
export const ICONOS = {
    peliculas: 'clapperboard',
    series: 'tv',
    anime: 'sparkles',
    lectura: 'book-open',
    mas: 'plus',
    filtros: 'sliders-horizontal',
    buscar: 'search',
    orden: 'arrow-up-down',
    cerrar: 'x',
    etiquetas: 'tags',
    atras: 'arrow-left',
};

export default function Icono({ nombre, tamano = 20, color, style }) {
    const glifo = ICONOS[nombre];
    if (!glifo || !color) return null;
    return <Lucide name={glifo} size={tamano} color={color} style={style} accessible={false} importantForAccessibility="no" />;
}
