import React, { useMemo, useState } from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { Text, TextInput } from './AppText';
import { useTheme, FONT, RADIUS } from '../contexts/ThemeContext';
import { formTagView, toggleTag, validateTagName, liveTagsOf, normalizeTagName, TAG_ERROR_TEXTS, TAG_MAX_LENGTH } from '../entertainment/tags';

// Etiquetas en el formulario de Pendiente (Fase 7.5b1, E7). Va DENTRO del formulario (no es una
// hoja encima de otra): chips de selección múltiple con las etiquetas de la sección, las elegidas
// que todavía no existen en ella (nuevas, de otras secciones o huérfanas), "Nueva etiqueta" con un
// campo en línea y la fila "De otras secciones". Solo presentación: el catálogo se escribe al
// guardar el título (P-a), en la misma transacción. Texto de las chips centrado (O9).

export default function EtiquetasCampo({ catalog, section, selected, onChange, informar }) {
    const { theme } = useTheme();
    const [nueva, setNueva] = useState(null); // null = campo cerrado; texto = abierto
    const vista = useMemo(() => formTagView(catalog || [], section, selected || []), [catalog, section, selected]);

    const agregarNueva = () => {
        // Se valida contra las vivas de la sección y contra las ya elegidas (por clave).
        const elegidas = (selected || []).map((name, i) => ({ id: `sel-${i}`, name, name_key: normalizeTagName(name).toLowerCase() }));
        const v = validateTagName(nueva, [...liveTagsOf(catalog || [], section), ...elegidas]);
        if (!v.ok) {
            // Si ya existe en la sección, se marca en vez de avisar.
            const existente = v.error === 'duplicado';
            if (existente) {
                const key = normalizeTagName(nueva).toLowerCase();
                if (!(selected || []).some((n) => normalizeTagName(n).toLowerCase() === key)) {
                    const live = liveTagsOf(catalog || [], section).find((r) => r.name_key === key);
                    onChange(toggleTag(selected || [], live ? live.name : nueva));
                }
                setNueva(null);
                return;
            }
            informar('Etiqueta', TAG_ERROR_TEXTS[v.error]);
            return;
        }
        onChange([...(selected || []), v.name]);
        setNueva(null);
    };

    const chip = (name, activo, onPress, key) => (
        <TouchableOpacity
            key={key || name}
            accessibilityRole="button"
            accessibilityState={{ selected: activo }}
            onPress={onPress}
            style={[styles.chip, { backgroundColor: activo ? theme.accent : theme.raised, borderColor: activo ? theme.accent : theme.lineStrong }]}
        >
            <Text style={[styles.chipTexto, { color: activo ? theme.onAccent : theme.ink }]} numberOfLines={1} ellipsizeMode="tail">{name}</Text>
        </TouchableOpacity>
    );

    return (
        <View>
            <View style={styles.fila}>
                {vista.sectionTags.map((t) => chip(t.name, t.selected, () => onChange(toggleTag(selected || [], t.name)), `s-${t.key}`))}
                {vista.extra.map((name) => chip(name, true, () => onChange(toggleTag(selected || [], name)), `e-${name}`))}
                {nueva === null && chip('＋ Nueva etiqueta', false, () => setNueva(''), 'nueva')}
            </View>
            {nueva !== null && (
                <View style={styles.nuevaFila}>
                    <TextInput
                        style={[styles.input, { backgroundColor: theme.raised, color: theme.ink, borderColor: theme.lineStrong }]}
                        value={nueva}
                        onChangeText={setNueva}
                        placeholder="Nombre de la etiqueta"
                        placeholderTextColor={theme.muted}
                        maxLength={TAG_MAX_LENGTH + 10}
                        autoFocus
                        onSubmitEditing={agregarNueva}
                    />
                    <View style={styles.nuevaBotones}>
                        <TouchableOpacity accessibilityRole="button" onPress={() => setNueva(null)} style={[styles.boton, { backgroundColor: theme.raised }]}>
                            <Text style={[styles.botonTexto, { color: theme.ink }]}>Cancelar</Text>
                        </TouchableOpacity>
                        <TouchableOpacity accessibilityRole="button" onPress={agregarNueva} style={[styles.boton, { backgroundColor: theme.accent }]}>
                            <Text style={[styles.botonTexto, { color: theme.onAccent }]}>Agregar</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            )}
            {vista.others.length > 0 && (
                <>
                    <Text style={[styles.subtitulo, { color: theme.muted }]} numberOfLines={1}>De otras secciones</Text>
                    <View style={styles.fila}>
                        {vista.others.map((name) => chip(name, false, () => onChange(toggleTag(selected || [], name)), `o-${name}`))}
                    </View>
                </>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    fila: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 5 },
    // O9: texto centrado vertical y horizontalmente (sin el relleno de fuente de Android).
    chip: {
        minHeight: 40, maxWidth: '100%', paddingHorizontal: 14, borderRadius: RADIUS.sm, borderWidth: 1,
        alignItems: 'center', justifyContent: 'center', flexShrink: 1,
    },
    chipTexto: { fontFamily: FONT.semibold, fontSize: 14, lineHeight: 18, textAlign: 'center', textAlignVertical: 'center', includeFontPadding: false },
    subtitulo: { fontFamily: FONT.semibold, fontSize: 13, marginTop: 12 },
    nuevaFila: { marginTop: 10 },
    input: { borderRadius: RADIUS.sm, padding: 15, borderWidth: 1, fontSize: 16 },
    nuevaBotones: { flexDirection: 'row', gap: 10, marginTop: 10 },
    boton: { flex: 1, minHeight: 52, borderRadius: RADIUS.sm, alignItems: 'center', justifyContent: 'center' },
    botonTexto: { fontFamily: FONT.semibold, fontSize: 16 },
});
