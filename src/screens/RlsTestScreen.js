import React, { useState } from 'react';
import { View, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { Text } from '../components/AppText';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme, FONT, RADIUS } from '../contexts/ThemeContext';
import { runRlsProbe } from '../auth/rlsProbe';

// SOLO variante dev (Home no la muestra en producción y runRlsProbe se niega fuera de dev).
// Prueba RLS contra el Supabase real con la sesión de Google y muestra los códigos reales.
export default function RlsTestScreen({ onBack }) {
    const { theme } = useTheme();
    const [steps, setSteps] = useState(null);
    const [error, setError] = useState(null);
    const [running, setRunning] = useState(false);

    const run = async () => {
        setRunning(true);
        setError(null);
        try {
            setSteps(await runRlsProbe());
        } catch (e) {
            setError(e.message);
        } finally {
            setRunning(false);
        }
    };

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: theme.bg }]}>
            <View style={styles.header}>
                <TouchableOpacity onPress={onBack}><Text style={[styles.back, { color: theme.accent }]}>‹ Volver</Text></TouchableOpacity>
                <Text style={[styles.title, { color: theme.ink }]}>Prueba de RLS (dev)</Text>
            </View>
            <ScrollView contentContainerStyle={{ padding: 20 }}>
                <TouchableOpacity style={[styles.button, { backgroundColor: theme.accent }]} onPress={run} disabled={running}>
                    {running ? <ActivityIndicator color={theme.onAccent} /> : <Text style={[styles.buttonText, { color: theme.onAccent }]}>Ejecutar prueba</Text>}
                </TouchableOpacity>
                {error && <Text style={[styles.error, { color: theme.danger }]}>{error}</Text>}
                {steps && steps.map((s) => (
                    <View key={s.step} style={[styles.step, { borderColor: s.pass ? theme.tones.verde.fg : theme.danger, backgroundColor: theme.surface }]}>
                        <Text style={[styles.stepTitle, { color: theme.ink }]} numberOfLines={2}>{s.pass ? '✅' : '❌'} {s.step}</Text>
                        <Text style={{ color: theme.muted }}>esperado: {s.expected} · HTTP {String(s.status)} · código {String(s.code)}</Text>
                        <Text style={{ color: theme.muted }}>{s.message}</Text>
                    </View>
                ))}
            </ScrollView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    header: { padding: 20, paddingBottom: 0 },
    back: { fontSize: 16, fontFamily: FONT.semibold, marginBottom: 10 },
    title: { fontSize: 22, fontFamily: FONT.bold },
    button: { padding: 16, borderRadius: RADIUS.sm, alignItems: 'center', marginBottom: 20, minHeight: 52, justifyContent: 'center' },
    buttonText: { fontSize: 16, fontFamily: FONT.bold },
    error: { marginBottom: 15 },
    step: { borderLeftWidth: 5, borderRadius: RADIUS.sm, padding: 12, marginBottom: 12 },
    stepTitle: { fontFamily: FONT.bold, marginBottom: 4 },
});
