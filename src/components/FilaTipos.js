import React from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { Text } from './AppText';
import { useTheme, FONT, RADIUS } from '../contexts/ThemeContext';
import Icono from './Icono';

// Tipos de Pendiente en UNA fila fija (Fase 7.5b2a, O12): 4 columnas de igual ancho, sin
// desplazamiento horizontal, ícono arriba y etiqueta corta en 1 línea; el elegido con
// accent/soft. La usan la cabecera de Pendiente y el formulario (disabled: solo lectura).

export const TIPOS = [
    { id: 'movie', label: 'Películas', icono: 'peliculas' },
    { id: 'series', label: 'Series', icono: 'series' },
    { id: 'anime', label: 'Anime', icono: 'anime' },
    { id: 'reading', label: 'Lectura', icono: 'lectura' },
];

export default function FilaTipos({ value, onChange, disabled = false, compacta = false }) {
    const { theme } = useTheme();
    return (
        <View style={styles.fila} accessibilityRole="tablist">
            {TIPOS.map((t) => {
                const activo = value === t.id;
                const apagado = disabled && !activo;
                return (
                    <TouchableOpacity
                        key={t.id}
                        accessibilityRole="tab"
                        accessibilityLabel={t.label}
                        accessibilityState={{ selected: activo, disabled }}
                        disabled={disabled}
                        onPress={() => onChange && onChange(t.id)}
                        style={[
                            styles.celda,
                            compacta && styles.celdaCompacta,
                            { backgroundColor: activo ? theme.soft : theme.surface, borderColor: activo ? theme.accent : theme.lineStrong },
                            apagado && styles.apagado,
                        ]}
                    >
                        <Icono nombre={t.icono} tamano={20} color={activo ? theme.accent : theme.muted} />
                        <Text
                            style={[styles.etiqueta, { color: activo ? theme.accent : theme.ink }]}
                            numberOfLines={1}
                            ellipsizeMode="tail"
                        >
                            {t.label}
                        </Text>
                    </TouchableOpacity>
                );
            })}
        </View>
    );
}

const styles = StyleSheet.create({
    fila: { flexDirection: 'row', gap: 8 },
    celda: {
        flex: 1, minWidth: 0, minHeight: 56, paddingVertical: 6, paddingHorizontal: 2,
        borderRadius: RADIUS.sm, borderWidth: 1, alignItems: 'center', justifyContent: 'center', gap: 2,
    },
    celdaCompacta: { minHeight: 52 },
    apagado: { opacity: 0.45 },
    etiqueta: { fontFamily: FONT.semibold, fontSize: 12, lineHeight: 16, textAlign: 'center', includeFontPadding: false },
});
