import React from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    StyleSheet,
    ActivityIndicator,
    Dimensions
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useTheme } from '../contexts/ThemeContext';

const { width } = Dimensions.get('window');

// Entrada a la app (Fase 3: sin usuario/contraseña).
// - Instalación sin datos locales: "Continuar con Google" (necesita internet).
// - Varias cuentas locales sin vincular (solo BD de prueba): se elige una, sin contraseña.
// La lógica de login vive en App.js / src/auth; esta pantalla solo presenta.
export default function LoginScreen({ onGoogle, signingIn, configured, localUsers, onChooseLocal }) {
    const { theme, isDarkMode } = useTheme();
    const choosing = Array.isArray(localUsers) && localUsers.length > 0;

    return (
        <View style={[styles.container, { backgroundColor: theme.background }]}>
            <StatusBar style={isDarkMode ? "light" : "dark"} />
            <View style={[styles.circle1, { backgroundColor: theme.accent, opacity: isDarkMode ? 0.2 : 0.1 }]} />
            <View style={[styles.circle2, { backgroundColor: isDarkMode ? '#0f3460' : theme.accent, opacity: isDarkMode ? 0.3 : 0.05 }]} />

            <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
                <Text style={[styles.headerTitle, { color: theme.text }]}>Bienvenido</Text>
                <Text style={[styles.subHeader, { color: theme.subText }]}>
                    {choosing ? 'Elige tu cuenta local' : 'Ingresa a tu espacio personal'}
                </Text>

                {choosing ? (
                    localUsers.map((u) => (
                        <TouchableOpacity
                            key={u.id}
                            style={[styles.localButton, { borderColor: theme.border, backgroundColor: theme.inputBackground }]}
                            onPress={() => onChooseLocal(u)}
                        >
                            <Text style={[styles.localText, { color: theme.text }]}>{u.username}</Text>
                        </TouchableOpacity>
                    ))
                ) : (
                    <>
                        <TouchableOpacity
                            style={[styles.button, { backgroundColor: theme.accent, shadowColor: theme.accent, opacity: configured ? 1 : 0.6 }]}
                            onPress={onGoogle}
                            disabled={signingIn || !configured}
                        >
                            {signingIn ? (
                                <ActivityIndicator color="#fff" />
                            ) : (
                                <Text style={styles.buttonText}>Continuar con Google</Text>
                            )}
                        </TouchableOpacity>
                        <Text style={[styles.hint, { color: theme.subText }]}>
                            {configured
                                ? 'Necesitas internet para el primer inicio de sesión. Después la app funciona sin conexión.'
                                : 'Esta compilación no tiene configurado Supabase (.env).'}
                        </Text>
                    </>
                )}
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    circle1: { position: 'absolute', top: -50, left: -50, width: 200, height: 200, borderRadius: 100 },
    circle2: { position: 'absolute', bottom: -50, right: -50, width: 250, height: 250, borderRadius: 125 },
    card: { width: width * 0.85, borderRadius: 25, padding: 30, borderWidth: 1, elevation: 10, shadowColor: '#000', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.1, shadowRadius: 20 },
    headerTitle: { fontSize: 32, fontWeight: 'bold', marginBottom: 5, textAlign: 'center' },
    subHeader: { fontSize: 16, marginBottom: 30, textAlign: 'center' },
    button: { padding: 18, borderRadius: 15, alignItems: 'center', marginTop: 10, elevation: 5, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8 },
    buttonText: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
    hint: { marginTop: 20, fontSize: 13, textAlign: 'center' },
    localButton: { padding: 16, borderRadius: 15, borderWidth: 1, marginBottom: 12 },
    localText: { fontSize: 16, fontWeight: '600', textAlign: 'center' },
});
