import React from 'react';
import { View, TouchableOpacity, StyleSheet, ActivityIndicator, Dimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '../components/AppText';
import { useTheme, FONT, RADIUS } from '../contexts/ThemeContext';

const { width } = Dimensions.get('window');

// Entrada a la app (Fase 3: sin usuario/contraseña).
// - Instalación sin datos locales: "Continuar con Google" (necesita internet).
// - Varias cuentas locales sin vincular (solo BD de prueba): se elige una, sin contraseña.
// La lógica de login vive en App.js / src/auth; esta pantalla solo presenta.
export default function LoginScreen({ onGoogle, signingIn, configured, localUsers, onChooseLocal }) {
    const { theme, isDarkMode } = useTheme();
    const choosing = Array.isArray(localUsers) && localUsers.length > 0;
    // Borde a borde: los círculos decorativos van detrás de las barras; el contenido respeta los márgenes seguros.
    const insets = useSafeAreaInsets();

    return (
        <View style={[styles.container, { backgroundColor: theme.bg, paddingTop: insets.top, paddingBottom: insets.bottom }]}>
            <View style={[styles.circle1, { backgroundColor: theme.accent, opacity: isDarkMode ? 0.2 : 0.1 }]} />
            <View style={[styles.circle2, { backgroundColor: theme.soft, opacity: isDarkMode ? 0.6 : 0.5 }]} />

            <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.line, shadowColor: theme.shadow }]}>
                <Text style={[styles.headerTitle, { color: theme.ink }]}>Bienvenido</Text>
                <Text style={[styles.subHeader, { color: theme.muted }]}>
                    {choosing ? 'Elige tu cuenta local' : 'Ingresa a tu espacio personal'}
                </Text>

                {choosing ? (
                    localUsers.map((u) => (
                        <TouchableOpacity
                            key={u.id}
                            style={[styles.localButton, { borderColor: theme.line, backgroundColor: theme.raised }]}
                            onPress={() => onChooseLocal(u)}
                        >
                            <Text style={[styles.localText, { color: theme.ink }]} numberOfLines={1} ellipsizeMode="tail">{u.username}</Text>
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
                                <ActivityIndicator color={theme.onAccent} />
                            ) : (
                                <Text style={[styles.buttonText, { color: theme.onAccent }]} numberOfLines={1}>Continuar con Google</Text>
                            )}
                        </TouchableOpacity>
                        <Text style={[styles.hint, { color: theme.muted }]}>
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
    card: { width: width * 0.85, borderRadius: RADIUS.base, padding: 30, borderWidth: 1, elevation: 10, shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.1, shadowRadius: 20 },
    headerTitle: { fontSize: 32, fontFamily: FONT.bold, marginBottom: 5, textAlign: 'center' },
    subHeader: { fontSize: 16, marginBottom: 30, textAlign: 'center' },
    button: { padding: 18, borderRadius: RADIUS.sm, minHeight: 52, justifyContent: 'center', alignItems: 'center', marginTop: 10, elevation: 5, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8 },
    buttonText: { fontSize: 18, fontFamily: FONT.bold },
    hint: { marginTop: 20, fontSize: 13, textAlign: 'center' },
    localButton: { padding: 16, borderRadius: RADIUS.sm, borderWidth: 1, marginBottom: 12 },
    localText: { fontSize: 16, fontFamily: FONT.semibold, textAlign: 'center' },
});
