import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../contexts/ThemeContext';
import { backupAndShare } from '../services/backup';
import { showBackupResult } from './backupResult';

// Se muestra si la base de datos no se pudo abrir o migrar. No deja entrar a la app
// (nunca se trabaja con un esquema a medias), pero sí permite sacar un respaldo:
// backup.js usa su propia conexión y no depende de las migraciones.
export default function DatabaseErrorScreen({ errorMessage, onRetry }) {
    const { theme } = useTheme();
    const [isBackingUp, setIsBackingUp] = useState(false);

    const handleBackup = async () => {
        if (isBackingUp) return;
        setIsBackingUp(true);
        try {
            const summary = await backupAndShare();
            showBackupResult(summary, 'Guárdalos fuera del teléfono antes de reintentar.');
        } catch (error) {
            console.error('Error creating backup from error screen:', error);
            Alert.alert('Error', `No se pudo generar el respaldo.\n\n${error.message}`);
        } finally {
            setIsBackingUp(false);
        }
    };

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
            <ScrollView contentContainerStyle={styles.content}>
                <Text style={[styles.title, { color: theme.text }]}>No se pudo preparar la base de datos</Text>
                <Text style={[styles.body, { color: theme.subText }]}>
                    Tus datos no se modificaron. Antes de reintentar, saca un respaldo y guárdalo fuera del teléfono.
                    No desinstales la app: perderías los datos.
                </Text>
                {errorMessage ? (
                    <Text style={[styles.detail, { color: theme.subText, backgroundColor: theme.inputBackground }]}>
                        {errorMessage}
                    </Text>
                ) : null}

                <TouchableOpacity
                    style={[styles.button, styles.primary, { opacity: isBackingUp ? 0.6 : 1 }]}
                    onPress={handleBackup}
                    disabled={isBackingUp}
                >
                    <Text style={styles.buttonText}>{isBackingUp ? 'Generando respaldo…' : 'Respaldar datos'}</Text>
                </TouchableOpacity>

                <TouchableOpacity
                    style={[styles.button, styles.secondary]}
                    onPress={onRetry}
                    disabled={isBackingUp}
                >
                    <Text style={styles.buttonText}>Reintentar</Text>
                </TouchableOpacity>
            </ScrollView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    content: {
        flexGrow: 1,
        justifyContent: 'center',
        padding: 24,
    },
    title: {
        fontSize: 22,
        fontWeight: 'bold',
        marginBottom: 12,
    },
    body: {
        fontSize: 16,
        lineHeight: 22,
        marginBottom: 16,
    },
    detail: {
        fontSize: 13,
        padding: 12,
        borderRadius: 10,
        marginBottom: 24,
    },
    button: {
        paddingVertical: 14,
        borderRadius: 12,
        alignItems: 'center',
        marginBottom: 12,
    },
    primary: {
        backgroundColor: '#607D8B',
    },
    secondary: {
        backgroundColor: '#e94560',
    },
    buttonText: {
        color: '#fff',
        fontSize: 16,
        fontWeight: '600',
    },
});
