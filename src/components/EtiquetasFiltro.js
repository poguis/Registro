import React, { useMemo } from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { Text } from './AppText';
import { useTheme, FONT, RADIUS } from '../contexts/ThemeContext';
import { liveTagsOf, sortForDisplay, tagKey } from '../entertainment/tags';

// Filtro por etiquetas de la sección (Fase 7.5b1, E8; desde la 7.5b2a es el bloque de chips de la
// hoja "Filtros", antes era su propia hoja: P-f, "solo cambia de lugar"). Con varias elegidas se
// muestran los títulos que tienen TODAS; "Sin etiquetas" muestra los que no tienen ninguna y
// excluye las demás. Controlado: recibe { keys, none } y devuelve el nuevo con onChange; la hoja
// "Filtros" lo aplica con su botón "Aplicar" y la pantalla lo limpia al cambiar de sección.

export default function EtiquetasFiltro({ catalog, section, keys = [], none = false, onChange }) {
    const { theme } = useTheme();
    const opciones = useMemo(() => sortForDisplay(liveTagsOf(catalog || [], section).map((r) => r.name)), [catalog, section]);

    const alternar = (name) => {
        const k = tagKey(name);
        onChange({ none: false, keys: keys.includes(k) ? keys.filter((x) => x !== k) : [...keys, k] });
    };

    const chip = (texto, activo, onPress, key) => (
        <TouchableOpacity
            key={key}
            accessibilityRole="button"
            accessibilityState={{ selected: activo }}
            onPress={onPress}
            style={[styles.chip, { backgroundColor: activo ? theme.accent : theme.raised, borderColor: activo ? theme.accent : theme.lineStrong }]}
        >
            <Text style={[styles.chipTexto, { color: activo ? theme.onAccent : theme.ink }]} numberOfLines={1} ellipsizeMode="tail">{texto}</Text>
        </TouchableOpacity>
    );

    return (
        <View>
            <View style={styles.fila}>
                {chip('Sin etiquetas', none, () => onChange({ none: !none, keys: [] }), '__ninguna')}
                {opciones.map((name) => chip(name, keys.includes(tagKey(name)), () => alternar(name), `t-${tagKey(name)}`))}
            </View>
            {opciones.length === 0 && (
                <Text style={[styles.vacio, { color: theme.muted }]}>Esta sección todavía no tiene etiquetas.</Text>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    fila: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: {
        minHeight: 40, maxWidth: '100%', paddingHorizontal: 14, borderRadius: RADIUS.sm, borderWidth: 1,
        alignItems: 'center', justifyContent: 'center', flexShrink: 1,
    },
    chipTexto: { fontFamily: FONT.semibold, fontSize: 14, lineHeight: 18, textAlign: 'center', textAlignVertical: 'center', includeFontPadding: false },
    vacio: { fontFamily: FONT.regular, fontSize: 14, marginTop: 8 },
});
