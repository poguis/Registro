import React from 'react';
import { Modal, View, Pressable, ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from './AppText';
import { useTheme, FONT, RADIUS, TYPE } from '../contexts/ThemeContext';

// Hoja inferior de la app (O6): reemplaza al diálogo del sistema. Solo presentación; la cola, la promesa y
// el descarte los maneja SheetContext. Título en 1 línea; el mensaje SIEMPRE completo (con scroll
// si es muy largo); botones apilados a lo ancho, de al menos 52 de alto, el de cancelar al final.

const ORDEN = { primaria: 0, destructiva: 0, secundaria: 1, cancelar: 2 };

export default function BottomSheet({ hoja, onElegir, onDescartar }) {
    const { theme } = useTheme();
    const insets = useSafeAreaInsets();
    if (!hoja) return null;
    const acciones = [...(hoja.acciones || [])]
        .map((a, i) => ({ ...a, i }))
        .sort((a, b) => (ORDEN[a.variante] ?? 0) - (ORDEN[b.variante] ?? 0) || a.i - b.i);

    const estiloBoton = (variante) => {
        if (variante === 'primaria') return { bg: theme.accent, fg: theme.onAccent };
        if (variante === 'destructiva') return { bg: theme.danger, fg: theme.onDanger };
        return { bg: theme.raised, fg: theme.ink };
    };

    return (
        <Modal
            visible
            transparent
            animationType="slide"
            statusBarTranslucent
            navigationBarTranslucent
            onRequestClose={onDescartar}
        >
            <View style={styles.contenedor}>
                <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: theme.overlay }]} onPress={onDescartar} accessibilityLabel="Cerrar" />
                <View style={[styles.hoja, { backgroundColor: theme.surface, paddingBottom: 16 + insets.bottom }]}>
                    <View style={[styles.asa, { backgroundColor: theme.line }]} />
                    {hoja.titulo ? (
                        <Text style={[styles.titulo, { color: theme.ink }]} numberOfLines={1} ellipsizeMode="tail" accessibilityRole="header">
                            {hoja.titulo}
                        </Text>
                    ) : null}
                    {hoja.mensaje ? (
                        <ScrollView style={styles.mensajeScroll} contentContainerStyle={{ flexGrow: 0 }}>
                            <Text style={[styles.mensaje, { color: theme.muted }]}>{hoja.mensaje}</Text>
                        </ScrollView>
                    ) : null}
                    <View style={styles.botones}>
                        {acciones.map((a) => {
                            const c = estiloBoton(a.variante);
                            return (
                                <Pressable
                                    key={`${a.clave}-${a.i}`}
                                    accessibilityRole="button"
                                    accessibilityLabel={a.texto}
                                    onPress={() => onElegir(a.clave)}
                                    style={({ pressed }) => [styles.boton, { backgroundColor: c.bg, opacity: pressed ? 0.85 : 1 }]}
                                >
                                    <Text style={[styles.botonTexto, { color: c.fg }]} numberOfLines={1}>{a.texto}</Text>
                                </Pressable>
                            );
                        })}
                    </View>
                </View>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    contenedor: { flex: 1, justifyContent: 'flex-end' },
    hoja: {
        borderTopLeftRadius: RADIUS.sheet,
        borderTopRightRadius: RADIUS.sheet,
        paddingHorizontal: 20,
        paddingTop: 10,
        maxHeight: '85%',
    },
    asa: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 14 },
    titulo: { ...TYPE.tituloHoja, marginBottom: 8 },
    mensajeScroll: { flexGrow: 0, marginBottom: 18 },
    mensaje: { ...TYPE.mensaje },
    botones: { gap: 10 },
    boton: { minHeight: 52, borderRadius: RADIUS.sm, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
    botonTexto: { fontFamily: FONT.semibold, fontSize: 16 },
});
