import React, { useState } from 'react';
import {
    View,
    Text,
    TextInput,
    TouchableOpacity,
    StyleSheet,
    Alert,
    KeyboardAvoidingView,
    Platform,
    ActivityIndicator,
    Dimensions
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import db from '../services/db';
import { useTheme } from '../contexts/ThemeContext';

const { width } = Dimensions.get('window');

export default function LoginScreen({ onLoginSuccess }) {
    const { theme, isDarkMode } = useTheme();
    const [isRegistering, setIsRegistering] = useState(false);
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);

    const handleSubmit = async () => {
        if (!username.trim() || !password.trim()) {
            Alert.alert('Error', 'Por favor completa todos los campos');
            return;
        }

        setLoading(true);
        try {
            if (isRegistering) {
                const result = await db.registerUser(username, password);
                if (result.success) {
                    Alert.alert('Éxito', 'Cuenta creada. Ahora puedes iniciar sesión.');
                    setIsRegistering(false);
                    setPassword('');
                } else Alert.alert('Error', result.error);
            } else {
                const result = await db.loginUser(username, password);
                if (result.success) onLoginSuccess(result.user);
                else Alert.alert('Error', result.error);
            }
        } catch (error) {
            Alert.alert('Error', 'Ocurrió un error');
        } finally {
            setLoading(false);
        }
    };

    return (
        <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={[styles.container, { backgroundColor: theme.background }]}
        >
            <StatusBar style={isDarkMode ? "light" : "dark"} />
            <View style={[styles.circle1, { backgroundColor: theme.accent, opacity: isDarkMode ? 0.2 : 0.1 }]} />
            <View style={[styles.circle2, { backgroundColor: isDarkMode ? '#0f3460' : theme.accent, opacity: isDarkMode ? 0.3 : 0.05 }]} />

            <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
                <Text style={[styles.headerTitle, { color: theme.text }]}>
                    {isRegistering ? 'Crear Cuenta' : 'Bienvenido'}
                </Text>
                <Text style={[styles.subHeader, { color: theme.subText }]}>
                    {isRegistering ? 'Regístrate para comenzar' : 'Ingresa a tu espacio personal'}
                </Text>

                <View style={styles.inputContainer}>
                    <Text style={[styles.label, { color: theme.accent }]}>Usuario</Text>
                    <TextInput
                        style={[styles.input, { backgroundColor: theme.inputBackground, color: theme.text, borderColor: theme.border }]}
                        placeholder="Nombre de usuario"
                        placeholderTextColor={theme.subText}
                        value={username}
                        onChangeText={setUsername}
                        autoCapitalize="none"
                    />
                </View>

                <View style={styles.inputContainer}>
                    <Text style={[styles.label, { color: theme.accent }]}>Contraseña</Text>
                    <TextInput
                        style={[styles.input, { backgroundColor: theme.inputBackground, color: theme.text, borderColor: theme.border }]}
                        placeholder="••••••••"
                        placeholderTextColor={theme.subText}
                        value={password}
                        onChangeText={setPassword}
                        secureTextEntry
                    />
                </View>

                <TouchableOpacity
                    style={[styles.button, { backgroundColor: theme.accent, shadowColor: theme.accent }]}
                    onPress={handleSubmit}
                    disabled={loading}
                >
                    {loading ? (
                        <ActivityIndicator color="#fff" />
                    ) : (
                        <Text style={styles.buttonText}>
                            {isRegistering ? 'Registrarse' : 'Iniciar Sesión'}
                        </Text>
                    )}
                </TouchableOpacity>

                <TouchableOpacity
                    style={styles.switchButton}
                    onPress={() => setIsRegistering(!isRegistering)}
                >
                    <Text style={[styles.switchText, { color: theme.accent }]}>
                        {isRegistering
                            ? '¿Ya tienes cuenta? Iniciar Sesión'
                            : '¿No tienes cuenta? Regístrate'}
                    </Text>
                </TouchableOpacity>
            </View>
        </KeyboardAvoidingView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    circle1: { position: 'absolute', top: -50, left: -50, width: 200, height: 200, borderRadius: 100 },
    circle2: { position: 'absolute', bottom: -50, right: -50, width: 250, height: 250, borderRadius: 125 },
    card: { width: width * 0.85, borderRadius: 25, padding: 30, borderWidth: 1, elevation: 10, shadowColor: '#000', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.1, shadowRadius: 20 },
    headerTitle: { fontSize: 32, fontWeight: 'bold', marginBottom: 5, textAlign: 'center' },
    subHeader: { fontSize: 16, marginBottom: 30, textAlign: 'center' },
    inputContainer: { marginBottom: 20 },
    label: { marginBottom: 8, fontSize: 14, fontWeight: '700' },
    input: { borderRadius: 15, padding: 15, fontSize: 16, borderWidth: 1 },
    button: { padding: 18, borderRadius: 15, alignItems: 'center', marginTop: 10, elevation: 5, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8 },
    buttonText: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
    switchButton: { marginTop: 20, alignItems: 'center' },
    switchText: { fontSize: 14, fontWeight: '600' }
});
