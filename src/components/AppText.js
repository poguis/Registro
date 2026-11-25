import React, { forwardRef } from 'react';
import { Text as RNText, TextInput as RNTextInput, StyleSheet } from 'react-native';
import { FONT, useTheme } from '../contexts/ThemeContext';

// Text y TextInput de la app (dirección visual, Fase 7): misma API que los de React Native, con
// Plus Jakarta Sans por defecto. En Android fontWeight NO elige el archivo de una fuente propia
// (cada peso es su propia familia), así que si un estilo trae fontWeight se convierte a la
// familia de ese peso y se quita. Todas las pantallas importan Text/TextInput de aquí.
// El TextInput toma del tema, si no se indican, el color del placeholder, de la selección y del
// cursor (ninguna pantalla los fija con colores propios).

const WEIGHT_TO_FAMILY = {
    normal: FONT.regular, '100': FONT.regular, '200': FONT.regular, '300': FONT.regular, '400': FONT.regular,
    '500': FONT.medium,
    '600': FONT.semibold,
    bold: FONT.bold, '700': FONT.bold, '800': FONT.bold, '900': FONT.bold,
};

export function fontStyle(style) {
    const flat = StyleSheet.flatten(style) || {};
    const { fontWeight, fontFamily, ...rest } = flat;
    const family = fontFamily || (fontWeight != null ? WEIGHT_TO_FAMILY[String(fontWeight)] : null) || FONT.regular;
    return { ...rest, fontFamily: family };
}

export const Text = forwardRef(function Text({ style, ...props }, ref) {
    return <RNText ref={ref} {...props} style={fontStyle(style)} />;
});

// Campo de texto con el foco ahora mismo (TextInput.State de React Native), o null. Lo usa
// HojaConTeclado para llevarlo a la vista; vive aquí porque este es el único archivo que importa
// TextInput de react-native.
export const inputConFoco = () => (RNTextInput.State && RNTextInput.State.currentlyFocusedInput ? RNTextInput.State.currentlyFocusedInput() : null);

export const TextInput = forwardRef(function TextInput({ style, placeholderTextColor, selectionColor, cursorColor, ...props }, ref) {
    const { theme } = useTheme();
    return (
        <RNTextInput
            ref={ref}
            {...props}
            placeholderTextColor={placeholderTextColor ?? theme.muted}
            selectionColor={selectionColor ?? theme.soft}
            cursorColor={cursorColor ?? theme.accent}
            style={fontStyle(style)}
        />
    );
});
