import React, { useEffect, useRef } from 'react';
import { Animated, View, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from './AppText';
import { useTheme, FONT, RADIUS } from '../contexts/ThemeContext';

// Aviso breve (O6) para los mensajes informativos de éxito: hasta 2 líneas (título y mensaje,
// cada uno en 1 línea), se anuncia a los lectores de pantalla y desaparece solo. Admite un botón
// opcional (`accion`, p. ej. "Deshacer"), que en esta subfase no se usa (llega en la 7.6).
// Se dibuja en la raíz: quien lo muestra cierra antes su formulario modal (un Modal abierto lo
// taparía).

export default function Toast({ aviso, onOcultar }) {
    const { theme } = useTheme();
    const insets = useSafeAreaInsets();
    const opacidad = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        if (!aviso) return undefined;
        opacidad.setValue(0);
        Animated.timing(opacidad, { toValue: 1, duration: 180, useNativeDriver: true }).start();
        const t = setTimeout(() => {
            Animated.timing(opacidad, { toValue: 0, duration: 180, useNativeDriver: true }).start(() => onOcultar(aviso.id));
        }, aviso.duracion || 3000);
        return () => clearTimeout(t);
    }, [aviso]);

    if (!aviso) return null;
    return (
        <Animated.View
            pointerEvents="box-none"
            style={[styles.capa, { bottom: 16 + insets.bottom, opacity: opacidad }]}
        >
            <View
                accessibilityLiveRegion="polite"
                accessible
                style={[styles.aviso, { backgroundColor: theme.surface, borderColor: theme.line, shadowColor: theme.shadow }]}
            >
                <View style={styles.textos}>
                    {aviso.titulo ? <Text style={[styles.titulo, { color: theme.ink }]} numberOfLines={1} ellipsizeMode="tail">{aviso.titulo}</Text> : null}
                    {aviso.mensaje ? <Text style={[styles.mensaje, { color: theme.muted }]} numberOfLines={1} ellipsizeMode="tail">{aviso.mensaje}</Text> : null}
                </View>
                {aviso.accion ? (
                    <Pressable accessibilityRole="button" onPress={() => { aviso.accion.onPress(); onOcultar(aviso.id); }} style={styles.accion}>
                        <Text style={[styles.accionTexto, { color: theme.accent }]} numberOfLines={1}>{aviso.accion.texto}</Text>
                    </Pressable>
                ) : null}
            </View>
        </Animated.View>
    );
}

const styles = StyleSheet.create({
    capa: { position: 'absolute', left: 16, right: 16 },
    aviso: {
        flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: RADIUS.base,
        paddingHorizontal: 16, paddingVertical: 12, elevation: 4, shadowOpacity: 0.15, shadowRadius: 8, shadowOffset: { width: 0, height: 2 },
    },
    textos: { flex: 1, minWidth: 0 },
    titulo: { fontFamily: FONT.semibold, fontSize: 14 },
    mensaje: { fontFamily: FONT.regular, fontSize: 13, marginTop: 2 },
    accion: { flexShrink: 0, marginLeft: 12, paddingVertical: 4, paddingHorizontal: 6 },
    accionTexto: { fontFamily: FONT.bold, fontSize: 14 },
});
