import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { useTheme } from '../contexts/ThemeContext';
import { useSync } from '../sync/useSync';
import { describeSyncStatus } from '../sync/syncStatusText';

// Indicador de sincronización (no bloqueante). Solo existe donde la sync está habilitada
// (las dos variantes desde la Fase 5). "pendientes" = filas distintas con cambios sin subir.
const TABLE_LABELS = {
    finance_contacts: 'Contactos', finance_transactions: 'Deudas y préstamos', balance_history: 'Movimientos',
    finance_categories: 'Categorías', services: 'Servicios', entertainment_categories: 'Categorías de series',
    entertainment_pauses: 'Pausas', entertainment_quotas_history: 'Cuotas', series: 'Series', seasons: 'Temporadas',
    watch_history: 'Vistos', reading_history: 'Leídos', backlog: 'Pendientes', work_people: 'Trabajo', cards: 'Tarjetas',
};

// El texto lo decide describeSyncStatus (src/sync/syncStatusText.ts, función pura con pruebas).
export default function SyncStatus() {
    const { theme } = useTheme();
    const { enabled, status, syncing, outcome, connected, syncNow, retryBlocked } = useSync();
    if (!enabled) return null;

    const blocked = status ? status.blocked : [];
    const { text } = describeSyncStatus({
        connected,
        pending: status ? status.pending : 0,
        syncing,
        outcome,
        lastSuccessAt: status ? status.lastSuccessAt : null,
        nowMs: Date.now(),
    });

    const showBlocked = () => {
        const lines = blocked.slice(0, 6).map((b) => `• ${TABLE_LABELS[b.table] || b.table}: ${b.reason}`).join('\n');
        Alert.alert(
            `${blocked.length} ${blocked.length === 1 ? 'cambio con error' : 'cambios con error'}`,
            `${lines}${blocked.length > 6 ? '\n…' : ''}\n\nMientras un cambio tenga error, lo que llegue del servidor para ese registro no se aplica. "Reintentar" lo vuelve a subir en la próxima sincronización.`,
            [{ text: 'Cerrar', style: 'cancel' }, { text: 'Reintentar', onPress: retryBlocked }]
        );
    };

    return (
        <View style={[styles.box, { backgroundColor: theme.card, borderColor: theme.border }]}>
            <View style={{ flex: 1 }}>
                <Text style={[styles.text, { color: theme.text }]}>{text}</Text>
                {blocked.length > 0 && (
                    <TouchableOpacity onPress={showBlocked}>
                        <Text style={styles.error}>{blocked.length} {blocked.length === 1 ? 'cambio con error' : 'cambios con error'} · ver detalle</Text>
                    </TouchableOpacity>
                )}
            </View>
            <TouchableOpacity style={[styles.button, { backgroundColor: theme.accent }]} onPress={syncNow} disabled={syncing}>
                {syncing ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.buttonText}>Sincronizar ahora</Text>}
            </TouchableOpacity>
        </View>
    );
}

const styles = StyleSheet.create({
    box: { marginHorizontal: 20, marginBottom: 10, padding: 12, borderRadius: 15, borderWidth: 1, flexDirection: 'row', alignItems: 'center' },
    text: { fontSize: 13 },
    error: { color: '#e94560', fontSize: 13, fontWeight: '600', marginTop: 4 },
    button: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, marginLeft: 10, minWidth: 110, alignItems: 'center' },
    buttonText: { color: '#fff', fontWeight: 'bold', fontSize: 13 },
});
