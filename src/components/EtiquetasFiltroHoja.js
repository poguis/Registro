import React, { useEffect, useMemo, useState } from 'react';
import { Modal, View, Pressable, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from './AppText';
import { useTheme, FONT, RADIUS } from '../contexts/ThemeContext';
import { liveTagsOf, sortForDisplay, tagKey } from '../entertainment/tags';

// Filtro por etiquetas de la sección (Fase 7.5b1, E8). Con varias elegidas se muestran los títulos
// que tienen TODAS; "Sin etiquetas" muestra los que no tienen ninguna y excluye las demás. Solo
// presentación: "Aplicar" devuelve { keys, none } a la pantalla, que lo combina con el estado y el
// subtipo y lo limpia al cambiar de sección.

export default function EtiquetasFiltroHoja({ visible, catalog, section, sectionLabel, filter, onApply, onClose }) {
    const { theme } = useTheme();
    const insets = useSafeAreaInsets();
    const [keys, setKeys] = useState([]);
    const [none, setNone] = useState(false);
    useEffect(() => {
        if (visible) { setKeys((filter && filter.keys) || []); setNone(!!(filter && filter.none)); }
    }, [visible]);
    const opciones = useMemo(() => sortForDisplay(liveTagsOf(catalog || [], section).map((r) => r.name)), [catalog, section]);

    const alternar = (name) => {
        const k = tagKey(name);
        setNone(false);
        setKeys((prev) => (prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]));
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
        <Modal visible={!!visible} transparent animationType="slide" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
            <View style={styles.contenedor}>
                <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: theme.overlay }]} onPress={onClose} accessibilityLabel="Cerrar" />
                <View style={[styles.hoja, { backgroundColor: theme.surface, paddingBottom: 16 + insets.bottom }]}>
                    <View style={[styles.asa, { backgroundColor: theme.line }]} />
                    <Text style={[styles.titulo, { color: theme.ink }]} numberOfLines={1} ellipsizeMode="tail" accessibilityRole="header">
                        Filtrar {sectionLabel || ''} por etiquetas
                    </Text>
                    <ScrollView style={styles.lista} contentContainerStyle={styles.fila}>
                        {chip('Sin etiquetas', none, () => { setNone(!none); setKeys([]); }, '__ninguna')}
                        {opciones.map((name) => chip(name, keys.includes(tagKey(name)), () => alternar(name), `t-${tagKey(name)}`))}
                    </ScrollView>
                    {opciones.length === 0 && (
                        <Text style={[styles.vacio, { color: theme.muted }]}>Esta sección todavía no tiene etiquetas.</Text>
                    )}
                    <View style={styles.botones}>
                        <TouchableOpacity accessibilityRole="button" onPress={() => { onApply({ keys: [], none: false }); }} style={[styles.boton, { backgroundColor: theme.raised }]}>
                            <Text style={[styles.botonTexto, { color: theme.ink }]}>Limpiar</Text>
                        </TouchableOpacity>
                        <TouchableOpacity accessibilityRole="button" onPress={() => onApply({ keys, none })} style={[styles.boton, { backgroundColor: theme.accent }]}>
                            <Text style={[styles.botonTexto, { color: theme.onAccent }]}>Aplicar</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    contenedor: { flex: 1, justifyContent: 'flex-end' },
    hoja: { borderTopLeftRadius: RADIUS.sheet, borderTopRightRadius: RADIUS.sheet, paddingHorizontal: 20, paddingTop: 10, maxHeight: '85%' },
    asa: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, marginBottom: 14 },
    titulo: { fontFamily: FONT.bold, fontSize: 22, lineHeight: 28, marginBottom: 12 },
    lista: { flexGrow: 0 },
    fila: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: {
        minHeight: 40, maxWidth: '100%', paddingHorizontal: 14, borderRadius: RADIUS.sm, borderWidth: 1,
        alignItems: 'center', justifyContent: 'center', flexShrink: 1,
    },
    chipTexto: { fontFamily: FONT.semibold, fontSize: 14, lineHeight: 18, textAlign: 'center', textAlignVertical: 'center', includeFontPadding: false },
    vacio: { fontFamily: FONT.regular, fontSize: 14, marginTop: 8 },
    botones: { flexDirection: 'row', gap: 10, marginTop: 16 },
    boton: { flex: 1, minHeight: 52, borderRadius: RADIUS.sm, alignItems: 'center', justifyContent: 'center' },
    botonTexto: { fontFamily: FONT.semibold, fontSize: 16 },
});
