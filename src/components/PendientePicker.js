import React, { useState, useMemo } from 'react';
import { Modal, View, Pressable, TouchableOpacity, FlatList, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from './AppText';
import { useTheme, FONT, RADIUS } from '../contexts/ThemeContext';
import { sortCandidates, SUBTYPE_LABELS } from '../entertainment/link';

// Selector "De Pendiente" (Fase 7.5): lista los títulos candidatos (vivos, en Pendiente, de tipo
// compatible y sin serie vinculada; los filtra el repositorio) con orden alternable por año de
// inicio, fecha de registro o nombre (sortCandidates). Solo presentación: elegir llama a onPick.

const ORDENES = [
    { clave: 'year', texto: 'Año' },
    { clave: 'created', texto: 'Registro' },
    { clave: 'title', texto: 'Nombre' },
];
const TIPOS = { series: 'Serie', anime: 'Anime' };

const tipoDe = (item) => (item.type === 'reading' ? (SUBTYPE_LABELS[item.subtype] || 'Sin subtipo') : (TIPOS[item.type] || ''));
const fechaDe = (iso) => {
    const d = iso ? new Date(iso) : null;
    return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString('es-ES') : '';
};

export default function PendientePicker({ visible, candidates, titulo, onPick, onClose }) {
    const { theme } = useTheme();
    const insets = useSafeAreaInsets();
    const [orden, setOrden] = useState('created');
    const lista = useMemo(() => sortCandidates(candidates || [], orden), [candidates, orden]);

    return (
        <Modal visible={!!visible} transparent animationType="slide" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
            <View style={styles.contenedor}>
                <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: theme.overlay }]} onPress={onClose} accessibilityLabel="Cerrar" />
                <View style={[styles.hoja, { backgroundColor: theme.surface, paddingBottom: 16 + insets.bottom }]}>
                    <View style={[styles.asa, { backgroundColor: theme.line }]} />
                    <Text style={[styles.titulo, { color: theme.ink }]} numberOfLines={1} ellipsizeMode="tail" accessibilityRole="header">{titulo}</Text>
                    <View style={styles.ordenes}>
                        {ORDENES.map((o) => {
                            const activo = orden === o.clave;
                            return (
                                <TouchableOpacity
                                    key={o.clave}
                                    accessibilityRole="button"
                                    onPress={() => setOrden(o.clave)}
                                    style={[styles.chip, { backgroundColor: activo ? theme.accent : theme.raised, borderColor: activo ? theme.accent : theme.lineStrong }]}
                                >
                                    <Text style={[styles.chipTexto, { color: activo ? theme.onAccent : theme.ink }]} numberOfLines={1}>{o.texto}</Text>
                                </TouchableOpacity>
                            );
                        })}
                    </View>
                    <FlatList
                        data={lista}
                        keyExtractor={(item) => String(item.id)}
                        style={styles.lista}
                        renderItem={({ item }) => (
                            <TouchableOpacity
                                accessibilityRole="button"
                                onPress={() => onPick(item)}
                                style={[styles.fila, { borderBottomColor: theme.line }]}
                            >
                                <View style={styles.filaTextos}>
                                    <Text style={[styles.filaTitulo, { color: theme.ink }]} numberOfLines={2} ellipsizeMode="tail">{item.title}</Text>
                                    <Text style={[styles.filaMeta, { color: theme.muted }]} numberOfLines={1} ellipsizeMode="tail">
                                        {[tipoDe(item), item.start_year ? String(item.start_year) : 'Sin año', `Registrado ${fechaDe(item.created_at)}`].filter(Boolean).join(' · ')}
                                    </Text>
                                </View>
                            </TouchableOpacity>
                        )}
                    />
                    <TouchableOpacity accessibilityRole="button" onPress={onClose} style={[styles.boton, { backgroundColor: theme.raised }]}>
                        <Text style={[styles.botonTexto, { color: theme.ink }]}>Cancelar</Text>
                    </TouchableOpacity>
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
    ordenes: { flexDirection: 'row', gap: 8, marginBottom: 8 },
    chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: RADIUS.sm, borderWidth: 1, flexShrink: 0 },
    chipTexto: { fontFamily: FONT.semibold, fontSize: 13 },
    lista: { flexGrow: 0 },
    fila: { paddingVertical: 12, borderBottomWidth: 1, minHeight: 52, justifyContent: 'center' },
    filaTextos: { flex: 1, minWidth: 0 },
    filaTitulo: { fontFamily: FONT.semibold, fontSize: 16 },
    filaMeta: { fontFamily: FONT.regular, fontSize: 13, marginTop: 2 },
    boton: { minHeight: 52, borderRadius: RADIUS.sm, alignItems: 'center', justifyContent: 'center', marginTop: 12 },
    botonTexto: { fontFamily: FONT.semibold, fontSize: 16 },
});
