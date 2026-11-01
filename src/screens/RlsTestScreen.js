import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../contexts/ThemeContext';
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
        <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
            <View style={styles.header}>
                <TouchableOpacity onPress={onBack}><Text style={[styles.back, { color: theme.accent }]}>‹ Volver</Text></TouchableOpacity>
                <Text style={[styles.title, { color: theme.text }]}>Prueba de RLS (dev)</Text>
            </View>
            <ScrollView contentContainerStyle={{ padding: 20 }}>
                <TouchableOpacity style={[styles.button, { backgroundColor: theme.accent }]} onPress={run} disabled={running}>
                    {running ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Ejecutar prueba</Text>}
                </TouchableOpacity>
                {error && <Text style={[styles.error]}>{error}</Text>}
                {steps && steps.map((s) => (
                    <View key={s.step} style={[styles.step, { borderColor: s.pass ? '#4CAF50' : '#e94560', backgroundColor: theme.card }]}>
                        <Text style={[styles.stepTitle, { color: theme.text }]}>{s.pass ? '✅' : '❌'} {s.step}</Text>
                        <Text style={{ color: theme.subText }}>esperado: {s.expected} · HTTP {String(s.status)} · código {String(s.code)}</Text>
                        <Text style={{ color: theme.subText }}>{s.message}</Text>
                    </View>
                ))}
            </ScrollView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    header: { padding: 20, paddingBottom: 0 },
    back: { fontSize: 16, fontWeight: '600', marginBottom: 10 },
    title: { fontSize: 22, fontWeight: 'bold' },
    button: { padding: 16, borderRadius: 15, alignItems: 'center', marginBottom: 20 },
    buttonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
    error: { color: '#e94560', marginBottom: 15 },
    step: { borderLeftWidth: 5, borderRadius: 10, padding: 12, marginBottom: 12 },
    stepTitle: { fontWeight: 'bold', marginBottom: 4 },
});
