import React, { useEffect, useState } from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { Text } from './AppText';
import { useTheme, FONT, RADIUS } from '../contexts/ThemeContext';
import { SUBTYPE_LABELS } from '../entertainment/link';
import { EMPTY_FILTERS } from '../entertainment/backlogList';
import EtiquetasFiltro from './EtiquetasFiltro';
import HojaConTeclado, { ScrollDeHoja } from './HojaConTeclado';

// Hoja "Filtros" de Pendiente (Fase 7.5b2a, F8.1): subtipo (solo lectura), etiquetas (E8), año
// (los de la sección completa, P4) y el orden (P9; no suma al contador del botón). Trabaja con un
// borrador: "Aplicar" lo devuelve a la pantalla; "Limpiar" quita los filtros (no el orden) y
// cierra. Sin campos de texto, pero usa HojaConTeclado (P10): HojasHost, la pila de Atrás y
// alturaHoja (85 % de la ventana, después scroll), igual que las demás hojas del módulo.

const ORDENES = [
    { field: 'created_at', label: 'Registro' },
    { field: 'year', label: 'Año' },
    { field: 'title', label: 'Título' },
];
const DIRECCIONES = [
    { dir: 'asc', label: 'Ascendente' },
    { dir: 'desc', label: 'Descendente' },
];

export default function FiltrosPendienteHoja({ visible, section, sectionLabel, catalog, years, filtros, orden, onAplicar, onClose }) {
    const { theme } = useTheme();
    const [subtype, setSubtype] = useState('Todos');
    const [tags, setTags] = useState({ keys: [], none: false });
    const [year, setYear] = useState(null);
    const [ord, setOrd] = useState(orden);

    useEffect(() => {
        if (!visible) return;
        setSubtype(filtros.subtype || 'Todos');
        setTags({ keys: (filtros.tags && filtros.tags.keys) || [], none: !!(filtros.tags && filtros.tags.none) });
        setYear(filtros.year ?? null);
        setOrd(orden);
    }, [visible]);

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

    const listaAnios = (years && years.years) || [];
    // Un año elegido que ya no existe en la sección se sigue mostrando (para poder quitarlo).
    const anios = typeof year === 'number' && !listaAnios.includes(year) ? [year, ...listaAnios] : listaAnios;

    return (
        <HojaConTeclado visible={!!visible} onClose={onClose}>
            <View style={[styles.hoja, { backgroundColor: theme.surface }]}>
                <View style={[styles.asa, { backgroundColor: theme.line }]} />
                <Text style={[styles.titulo, { color: theme.ink }]} numberOfLines={1} ellipsizeMode="tail" accessibilityRole="header">
                    Filtros de {sectionLabel || ''}
                </Text>
                <ScrollDeHoja>
                    {section === 'reading' && (
                        <>
                            <Text style={[styles.seccion, { color: theme.accent }]}>Subtipo</Text>
                            <View style={styles.fila}>
                                {['Todos', ...Object.keys(SUBTYPE_LABELS)].map((s) => chip(s === 'Todos' ? 'Todos' : SUBTYPE_LABELS[s], subtype === s, () => setSubtype(s), `s-${s}`))}
                            </View>
                        </>
                    )}

                    <Text style={[styles.seccion, { color: theme.accent }]}>Etiquetas</Text>
                    <EtiquetasFiltro catalog={catalog} section={section} keys={tags.keys} none={tags.none} onChange={setTags} />

                    <Text style={[styles.seccion, { color: theme.accent }]}>Año</Text>
                    <View style={styles.fila}>
                        {chip('Todos', year === null, () => setYear(null), 'y-todos')}
                        {anios.map((y) => chip(String(y), year === y, () => setYear(y), `y-${y}`))}
                        {years && years.hasNone ? chip('Sin año', year === 'none', () => setYear('none'), 'y-none') : null}
                    </View>

                    <Text style={[styles.seccion, { color: theme.accent }]}>Ordenar por</Text>
                    <View style={styles.fila}>
                        {ORDENES.map((o) => chip(o.label, ord.field === o.field, () => setOrd({ ...ord, field: o.field }), `o-${o.field}`))}
                    </View>
                    <View style={[styles.fila, styles.filaDir]}>
                        {DIRECCIONES.map((d) => chip(d.label, ord.dir === d.dir, () => setOrd({ ...ord, dir: d.dir }), `d-${d.dir}`))}
                    </View>
                </ScrollDeHoja>

                <View style={styles.botones}>
                    <TouchableOpacity
                        accessibilityRole="button"
                        onPress={() => onAplicar({ filtros: { ...filtros, subtype: EMPTY_FILTERS.subtype, tags: EMPTY_FILTERS.tags, year: EMPTY_FILTERS.year }, orden: ord })}
                        style={[styles.boton, { backgroundColor: theme.raised }]}
                    >
                        <Text style={[styles.botonTexto, { color: theme.ink }]}>Limpiar</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                        accessibilityRole="button"
                        onPress={() => onAplicar({ filtros: { ...filtros, subtype, tags, year }, orden: ord })}
                        style={[styles.boton, { backgroundColor: theme.accent }]}
                    >
                        <Text style={[styles.botonTexto, { color: theme.onAccent }]}>Aplicar</Text>
                    </TouchableOpacity>
                </View>
            </View>
        </HojaConTeclado>
    );
}

const styles = StyleSheet.create({
    // Sin alto fijo ni porcentaje: el máximo lo pone HojaConTeclado (alturaHoja).
    hoja: { borderTopLeftRadius: RADIUS.sheet, borderTopRightRadius: RADIUS.sheet, paddingHorizontal: 20, paddingTop: 10, paddingBottom: 16, flexShrink: 1 },
    asa: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, marginBottom: 14 },
    titulo: { fontFamily: FONT.bold, fontSize: 22, lineHeight: 28, marginBottom: 4 },
    seccion: { fontFamily: FONT.bold, fontSize: 14, marginTop: 14, marginBottom: 8 },
    fila: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    filaDir: { marginTop: 8 },
    chip: {
        minHeight: 40, maxWidth: '100%', paddingHorizontal: 14, borderRadius: RADIUS.sm, borderWidth: 1,
        alignItems: 'center', justifyContent: 'center', flexShrink: 1,
    },
    chipTexto: { fontFamily: FONT.semibold, fontSize: 14, lineHeight: 18, textAlign: 'center', textAlignVertical: 'center', includeFontPadding: false },
    botones: { flexDirection: 'row', gap: 10, marginTop: 16 },
    boton: { flex: 1, minHeight: 52, borderRadius: RADIUS.sm, alignItems: 'center', justifyContent: 'center' },
    botonTexto: { fontFamily: FONT.semibold, fontSize: 16 },
});
