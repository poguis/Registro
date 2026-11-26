import React from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { TextInput } from './AppText';
import { useTheme, FONT, RADIUS } from '../contexts/ThemeContext';
import Icono from './Icono';

// Búsqueda por nombre de Pendiente (Fase 7.5b2a, F8.2 / F9): se despliega en la fila del título
// de la cabecera. Es el ÚNICO TextInput del módulo fuera de una HojaConTeclado, y probar-tema
// (sección 8) lo acepta solo por su nativeID "busquedaPendiente": la app es solo vertical, el campo
// queda en la franja de arriba (insets.top + ~56 dp) y el teclado sale desde abajo sin pasar del
// 50–55 % de la ventana, así que no lo puede tapar. Lo que sí puede quedar debajo es el final de
// la lista: la página suma el alto del teclado a su relleno inferior.

export default function BuscarPendiente({ value, onChange, onCerrar }) {
    const { theme } = useTheme();
    return (
        <View style={[styles.caja, { backgroundColor: theme.raised, borderColor: theme.lineStrong }]}>
            <Icono nombre="buscar" tamano={18} color={theme.muted} />
            <TextInput
                nativeID="busquedaPendiente"
                style={[styles.campo, { color: theme.ink }]}
                value={value}
                onChangeText={onChange}
                placeholder="Buscar por título…"
                placeholderTextColor={theme.muted}
                autoFocus
                returnKeyType="search"
                autoCorrect={false}
                accessibilityLabel="Buscar por título"
            />
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Cerrar búsqueda" onPress={onCerrar} style={styles.cerrar}>
                <Icono nombre="cerrar" tamano={20} color={theme.ink} />
            </TouchableOpacity>
        </View>
    );
}

const styles = StyleSheet.create({
    caja: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', minHeight: 44, borderRadius: RADIUS.sm, borderWidth: 1, paddingLeft: 12 },
    campo: { flex: 1, minWidth: 0, fontFamily: FONT.regular, fontSize: 16, paddingVertical: 8, paddingHorizontal: 8 },
    cerrar: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
});
