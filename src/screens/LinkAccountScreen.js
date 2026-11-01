import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../contexts/ThemeContext';

// Confirmación de la vinculación (Fase 3): muestra el email de Google ANTES de reescribir
// los datos locales. Es una operación única; tras confirmarla, los datos pertenecen a esa
// cuenta y otra cuenta de Google queda bloqueada en este dispositivo.
export default function LinkAccountScreen({ email, localUsername, busy, onConfirm, onCancel }) {
    const { theme } = useTheme();
    return (
        <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
            <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
                <Text style={[styles.title, { color: theme.text }]}>Vincular tus datos</Text>
                <Text style={[styles.body, { color: theme.subText }]}>
                    Los datos de la cuenta local "{localUsername}" quedarán vinculados a:
                </Text>
                <Text style={[styles.email, { color: theme.accent }]}>{email}</Text>
                <Text style={[styles.body, { color: theme.subText }]}>
                    No se borra nada: antes se hace una copia de seguridad interna. Después, este dispositivo solo
                    aceptará esta cuenta de Google.
                </Text>
                {busy ? (
                    <ActivityIndicator color={theme.accent} style={{ marginTop: 20 }} />
                ) : (
                    <>
                        <TouchableOpacity style={[styles.button, { backgroundColor: theme.accent }]} onPress={onConfirm}>
                            <Text style={styles.buttonText}>Vincular con {email}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.cancel} onPress={onCancel}>
                            <Text style={[styles.cancelText, { color: theme.subText }]}>Ahora no</Text>
                        </TouchableOpacity>
                    </>
                )}
            </View>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, justifyContent: 'center', padding: 20 },
    card: { borderRadius: 20, padding: 25, borderWidth: 1 },
    title: { fontSize: 24, fontWeight: 'bold', marginBottom: 15 },
    body: { fontSize: 15, marginBottom: 12 },
    email: { fontSize: 17, fontWeight: 'bold', marginBottom: 15 },
    button: { padding: 16, borderRadius: 15, alignItems: 'center', marginTop: 10 },
    buttonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
    cancel: { marginTop: 15, alignItems: 'center' },
    cancelText: { fontSize: 15, fontWeight: '600' },
});
