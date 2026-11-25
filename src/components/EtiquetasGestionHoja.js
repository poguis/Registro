import React, { useEffect, useMemo, useState } from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { Text, TextInput } from './AppText';
import { useTheme, FONT, RADIUS } from '../contexts/ThemeContext';
import { liveTagsOf, sortForDisplay, TAG_MAX_LENGTH } from '../entertainment/tags';
import HojaConTeclado, { ListaDeHoja } from './HojaConTeclado';

// Gestión de las etiquetas de una sección (Fase 7.5b1, E6): crear, renombrar en línea y borrar.
// Solo presentación: las acciones (con sus validaciones, mensajes y la confirmación de borrado) las
// hace la pantalla (onCreate / onRename / onDelete devuelven true si se aplicaron).
// 1.4.3 (C2): es una HojaConTeclado: el campo de crear y el de renombrar en línea nunca quedan
// debajo del teclado (con pocas etiquetas, o al renombrar una de las primeras).

export default function EtiquetasGestionHoja({ visible, catalog, section, sectionLabel, usage, onCreate, onRename, onDelete, onClose }) {
    const { theme } = useTheme();
    const [nombre, setNombre] = useState('');
    const [editando, setEditando] = useState(null); // { id, texto }
    useEffect(() => { if (!visible) { setNombre(''); setEditando(null); } }, [visible]);
    const filas = useMemo(() => {
        const live = liveTagsOf(catalog || [], section);
        const porNombre = new Map(live.map((r) => [r.name, r]));
        return sortForDisplay(live.map((r) => r.name)).map((n) => porNombre.get(n));
    }, [catalog, section]);

    const crear = async () => {
        if (await onCreate(nombre)) setNombre('');
    };
    const guardar = async (tag) => {
        if (await onRename(tag, editando.texto)) setEditando(null);
    };

    const renderFila = ({ item }) => {
        const n = (usage && usage[item.name_key]) || 0;
        if (editando && editando.id === item.id) {
            return (
                <View style={[styles.filaEdicion, { borderBottomColor: theme.line }]}>
                    <TextInput
                        style={[styles.input, { backgroundColor: theme.raised, color: theme.ink, borderColor: theme.lineStrong }]}
                        value={editando.texto}
                        onChangeText={(texto) => setEditando({ id: item.id, texto })}
                        maxLength={TAG_MAX_LENGTH + 10}
                        autoFocus
                        onSubmitEditing={() => guardar(item)}
                    />
                    <View style={styles.botones}>
                        <TouchableOpacity accessibilityRole="button" onPress={() => setEditando(null)} style={[styles.boton, { backgroundColor: theme.raised }]}>
                            <Text style={[styles.botonTexto, { color: theme.ink }]}>Cancelar</Text>
                        </TouchableOpacity>
                        <TouchableOpacity accessibilityRole="button" onPress={() => guardar(item)} style={[styles.boton, { backgroundColor: theme.accent }]}>
                            <Text style={[styles.botonTexto, { color: theme.onAccent }]}>Guardar</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            );
        }
        return (
            <View style={[styles.fila, { borderBottomColor: theme.line }]}>
                <View style={styles.filaTextos}>
                    <Text style={[styles.filaNombre, { color: theme.ink }]} numberOfLines={1} ellipsizeMode="tail">{item.name}</Text>
                    <Text style={[styles.filaMeta, { color: theme.muted }]} numberOfLines={1}>{n === 1 ? '1 título' : `${n} títulos`}</Text>
                </View>
                <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Renombrar ${item.name}`} onPress={() => setEditando({ id: item.id, texto: item.name })} style={styles.icono}>
                    <Text style={styles.iconoTexto}>✏️</Text>
                </TouchableOpacity>
                <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Borrar ${item.name}`} onPress={() => onDelete(item)} style={styles.icono}>
                    <Text style={styles.iconoTexto}>🗑️</Text>
                </TouchableOpacity>
            </View>
        );
    };

    return (
        <HojaConTeclado visible={!!visible} onClose={onClose}>
                <View style={[styles.hoja, { backgroundColor: theme.surface }]}>
                    <View style={[styles.asa, { backgroundColor: theme.line }]} />
                    <Text style={[styles.titulo, { color: theme.ink }]} numberOfLines={1} ellipsizeMode="tail" accessibilityRole="header">
                        Etiquetas de {sectionLabel || ''}
                    </Text>
                    <TextInput
                        style={[styles.input, { backgroundColor: theme.raised, color: theme.ink, borderColor: theme.lineStrong }]}
                        value={nombre}
                        onChangeText={setNombre}
                        placeholder="Nueva etiqueta"
                        placeholderTextColor={theme.muted}
                        maxLength={TAG_MAX_LENGTH + 10}
                        onSubmitEditing={crear}
                    />
                    <TouchableOpacity accessibilityRole="button" onPress={crear} style={[styles.botonAncho, { backgroundColor: theme.accent }]}>
                        <Text style={[styles.botonTexto, { color: theme.onAccent }]}>Crear</Text>
                    </TouchableOpacity>
                    <ListaDeHoja
                        data={filas}
                        keyExtractor={(item) => String(item.id)}
                        style={styles.lista}
                        renderItem={renderFila}
                        ListEmptyComponent={<Text style={[styles.vacio, { color: theme.muted }]}>Esta sección todavía no tiene etiquetas.</Text>}
                    />
                    <TouchableOpacity accessibilityRole="button" onPress={onClose} style={[styles.botonAncho, { backgroundColor: theme.raised }]}>
                        <Text style={[styles.botonTexto, { color: theme.ink }]}>Cerrar</Text>
                    </TouchableOpacity>
                </View>
        </HojaConTeclado>
    );
}

const styles = StyleSheet.create({
    hoja: { borderTopLeftRadius: RADIUS.sheet, borderTopRightRadius: RADIUS.sheet, paddingHorizontal: 20, paddingTop: 10, paddingBottom: 16, maxHeight: '85%', flexShrink: 1 },
    asa: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, marginBottom: 14 },
    titulo: { fontFamily: FONT.bold, fontSize: 22, lineHeight: 28, marginBottom: 12 },
    input: { borderRadius: RADIUS.sm, padding: 15, borderWidth: 1, fontSize: 16 },
    lista: { flexGrow: 0, marginTop: 8 },
    fila: { flexDirection: 'row', alignItems: 'center', minHeight: 52, borderBottomWidth: 1, gap: 4 },
    filaEdicion: { paddingVertical: 10, borderBottomWidth: 1 },
    filaTextos: { flex: 1, minWidth: 0 },
    filaNombre: { fontFamily: FONT.semibold, fontSize: 16 },
    filaMeta: { fontFamily: FONT.regular, fontSize: 13, marginTop: 2 },
    icono: { width: 52, height: 52, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
    iconoTexto: { fontSize: 18 },
    vacio: { fontFamily: FONT.regular, fontSize: 14, marginTop: 8 },
    botones: { flexDirection: 'row', gap: 10, marginTop: 10 },
    boton: { flex: 1, minHeight: 52, borderRadius: RADIUS.sm, alignItems: 'center', justifyContent: 'center' },
    botonAncho: { minHeight: 52, borderRadius: RADIUS.sm, alignItems: 'center', justifyContent: 'center', marginTop: 10 },
    botonTexto: { fontFamily: FONT.semibold, fontSize: 16 },
});
