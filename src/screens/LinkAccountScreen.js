import React from 'react';
import { View, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { Text } from '../components/AppText';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme, FONT, RADIUS } from '../contexts/ThemeContext';

// Confirmación de la vinculación (Fase 3): muestra el email de Google ANTES de reescribir
// los datos locales. Es una operación única; tras confirmarla, los datos pertenecen a esa
// cuenta y otra cuenta de Google queda bloqueada en este dispositivo.
export default function LinkAccountScreen({ email, localUsername, busy, onConfirm, onCancel }) {
    const { theme } = useTheme();
    return (
        <SafeAreaView style={[styles.container, { backgroundColor: theme.bg }]}>
            <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.line }]}>
                <Text style={[styles.title, { color: theme.ink }]}>Vincular tus datos</Text>
                <Text style={[styles.body, { color: theme.muted }]}>
                    Los datos de la cuenta local "{localUsername}" quedarán vinculados a:
                </Text>
                <Text style={[styles.email, { color: theme.accent }]} numberOfLines={1} ellipsizeMode="tail">{email}</Text>
                <Text style={[styles.body, { color: theme.muted }]}>
                    No se borra nada: antes se hace una copia de seguridad interna. Después, este dispositivo solo
                    aceptará esta cuenta de Google.
                </Text>
                {busy ? (
                    <ActivityIndicator color={theme.accent} style={{ marginTop: 20 }} />
                ) : (
                    <>
                        <TouchableOpacity style={[styles.button, { backgroundColor: theme.accent }]} onPress={onConfirm}>
                            <Text style={[styles.buttonText, { color: theme.onAccent }]} numberOfLines={1} ellipsizeMode="tail">Vincular con {email}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.cancel} onPress={onCancel}>
                            <Text style={[styles.cancelText, { color: theme.muted }]}>Ahora no</Text>
                        </TouchableOpacity>
                    </>
                )}
            </View>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, justifyContent: 'center', padding: 20 },
    card: { borderRadius: RADIUS.base, padding: 25, borderWidth: 1 },
    title: { fontSize: 24, fontFamily: FONT.bold, marginBottom: 15 },
    body: { fontSize: 15, marginBottom: 12 },
    email: { fontSize: 17, fontFamily: FONT.bold, marginBottom: 15 },
    button: { padding: 16, borderRadius: RADIUS.sm, alignItems: 'center', marginTop: 10, minHeight: 52, justifyContent: 'center' },
    buttonText: { fontSize: 16, fontFamily: FONT.bold },
    cancel: { marginTop: 15, alignItems: 'center' },
    cancelText: { fontSize: 15, fontFamily: FONT.semibold },
});
