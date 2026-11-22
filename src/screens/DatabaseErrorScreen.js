import React, { useState } from 'react';
import { View, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { Text } from '../components/AppText';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme, FONT, RADIUS } from '../contexts/ThemeContext';
import { useSheet } from '../hooks/useSheet';
import { backupAndShare } from '../services/backup';
import { showBackupResult } from './backupResult';

// Se muestra si la base de datos no se pudo abrir o migrar. No deja entrar a la app
// (nunca se trabaja con un esquema a medias), pero sí permite sacar un respaldo:
// backup.js usa su propia conexión y no depende de las migraciones.
export default function DatabaseErrorScreen({ errorMessage, onRetry }) {
    const { theme } = useTheme();
    const { confirm, informar } = useSheet();
    const [isBackingUp, setIsBackingUp] = useState(false);

    const handleBackup = async () => {
        if (isBackingUp) return;
        setIsBackingUp(true);
        try {
            const summary = await backupAndShare();
            showBackupResult(confirm, summary, 'Guárdalos fuera del teléfono antes de reintentar.');
        } catch (error) {
            console.error('Error creating backup from error screen:', error);
            informar('Error', `No se pudo generar el respaldo.\n\n${error.message}`);
        } finally {
            setIsBackingUp(false);
        }
    };

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: theme.bg }]}>
            <ScrollView contentContainerStyle={styles.content}>
                <Text style={[styles.title, { color: theme.ink }]}>No se pudo preparar la base de datos</Text>
                <Text style={[styles.body, { color: theme.muted }]}>
                    Tus datos no se modificaron. Antes de reintentar, saca un respaldo y guárdalo fuera del teléfono.
                    No desinstales la app: perderías los datos.
                </Text>
                {errorMessage ? (
                    <Text style={[styles.detail, { color: theme.muted, backgroundColor: theme.raised }]}>
                        {errorMessage}
                    </Text>
                ) : null}

                <TouchableOpacity
                    style={[styles.button, { backgroundColor: theme.accent, opacity: isBackingUp ? 0.6 : 1 }]}
                    onPress={handleBackup}
                    disabled={isBackingUp}
                >
                    <Text style={[styles.buttonText, { color: theme.onAccent }]} numberOfLines={1}>{isBackingUp ? 'Generando respaldo…' : 'Respaldar datos'}</Text>
                </TouchableOpacity>

                <TouchableOpacity
                    style={[styles.button, { backgroundColor: theme.raised }]}
                    onPress={onRetry}
                    disabled={isBackingUp}
                >
                    <Text style={[styles.buttonText, { color: theme.ink }]} numberOfLines={1}>Reintentar</Text>
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
        fontFamily: FONT.bold,
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
        borderRadius: RADIUS.sm,
        marginBottom: 24,
    },
    button: {
        paddingVertical: 14,
        minHeight: 52,
        justifyContent: 'center',
        borderRadius: RADIUS.sm,
        alignItems: 'center',
        marginBottom: 12,
    },
    buttonText: {
        fontSize: 16,
        fontFamily: FONT.semibold,
    },
});
