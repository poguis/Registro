import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, FlatList, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import db from '../services/db';
import { useSyncRefresh } from '../sync/useSyncRefresh';
import { calculateBacklog, calculateBacklogV2, getAbsoluteEpisodeCount, getWatchedCountSinceStart } from '../services/backlogUtils';
// Fase 7.3: la cola y la decisión de "marcar leído" viven en el motor puro (src/entertainment/).
import { buildQueue, decideMarkWatched } from '../entertainment/queue';
import { useTheme } from '../contexts/ThemeContext';

export default function ReadingRegistryScreen({ user, category, onBack }) {
    const { theme, isDarkMode } = useTheme();
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [currentTab, setCurrentTab] = useState('pending');
    const [rawSeries, setRawSeries] = useState([]);
    const [backlogInfo, setBacklogInfo] = useState({ items: 0, days: 0 });
    const [counts, setCounts] = useState({ pending: 0, watched: 0 });
    const [currentCategory, setCurrentCategory] = useState(category || null);

    // silent: recarga sin indicador de carga (no desmonta la lista ni pierde el scroll).
    const loadData = useCallback(async ({ silent = false } = {}) => {
        if (!silent) setLoading(true);
        try {
            const [seriesResult, historyResult, categoriesResult] = await Promise.all([
                db.getFullWatchlist(user.id, category ? category.id : null),
                db.getReadingHistory(user.id, category ? category.id : null),
                db.getEntertainmentCategories(user.id)
            ]);
            if (seriesResult.success) {
                setRawSeries(seriesResult.data);
                const refreshedCategory = categoriesResult.success && category
                    ? categoriesResult.categories.find(c => c.id === category.id)
                    : null;
                const effectiveCategory = refreshedCategory || category || null;
                setCurrentCategory(effectiveCategory);

                const calc = effectiveCategory ? calculateBacklogV2(effectiveCategory, seriesResult.data) : null;
                if (calc) {
                    setBacklogInfo({ 
                        items: calc.items, 
                        days: calc.days, 
                        adelantoItems: calc.adelantoItems, 
                        adelantoDays: calc.adelantoDays 
                    });
                }
                const pendingList = buildQueue(seriesResult.data, 'reading');
                let watchedList = historyResult.success ? historyResult.data.map(h => ({ uniqueId: `${h.series_id}-s${h.season_number}-e${h.episode_number}-rh${h.id}`, seriesId: h.series_id, seriesName: h.s_name, season: h.season_number, episode: h.episode_number, status: 'watched', readAt: h.read_at })) : [];
                setCounts({ pending: pendingList.length, watched: watchedList.length });
                setItems(currentTab === 'pending' ? pendingList : watchedList);
            }
        } catch (e) { console.error(e); } finally { setLoading(false); }
    }, [category, currentTab]);

    useEffect(() => { loadData(); }, [loadData]);
    // Recarga si la sync trae cambios del servidor (sin tocar formularios, filtros ni scroll).
    useSyncRefresh(() => loadData({ silent: true }));

    const onMarkWatched = async (item) => {
        const decision = decideMarkWatched(item, items, rawSeries);
        if (decision.kind === 'noSeries') return;
        if (decision.kind === 'outOfOrder') return Alert.alert('Orden incorrecto', `Lee primero el Tomo ${decision.first.episode}.`);
        const { next, isFinal } = decision;

        const performUpdate = async (newStatus = 'Mirando') => {
            await db.addReadingHistory(item.seriesId, item.season, item.episode);
            const res = await db.updateSeriesProgress(item.seriesId, next.season, next.episode, newStatus);
            if (res.success) loadData();
        };

        if (isFinal) {
            Alert.alert('¡Completada!', 'Mover a:', [
                { text: 'En espera', onPress: () => performUpdate('En espera') },
                { text: 'Terminado', onPress: () => performUpdate('Terminado') },
                { text: 'Cancelar', style: 'cancel' }
            ]);
        } else performUpdate('Mirando');
    };

    const onUnmarkWatched = async (item) => {
        await db.removeReadingHistory(item.seriesId, item.season, item.episode);
        const res = await db.updateSeriesProgress(item.seriesId, item.season, item.episode, null, null, 0);
        if (res.success) loadData();
    };

    const renderItem = ({ item, index }) => {
        const isWatched = item.status === 'watched';
        const isBacklog = !isWatched && backlogInfo && index < backlogInfo.items;

        return (
            <View style={[
                styles.card,
                { backgroundColor: theme.card, borderLeftColor: isBacklog ? '#EF6C00' : 'transparent' },
                isBacklog && { backgroundColor: isDarkMode ? '#3e2723' : '#FFFDE7' }
            ]}>
                <View style={styles.cardContent}>
                    <Text style={[styles.seriesName, { color: theme.text }]}>{item.seriesName}</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <Text style={[styles.episodeInfo, { color: theme.subText }]}>Tomo {item.episode} (Parte {item.season})</Text>
                        {isBacklog && (
                            <View style={styles.backlogBadge}><Text style={styles.backlogBadgeText}>ATRASO</Text></View>
                        )}
                    </View>
                    {isWatched && <Text style={styles.watchedLabel}>Leído el {new Date(item.readAt).toLocaleDateString()}</Text>}
                </View>

                {!isWatched ? (
                    <TouchableOpacity style={[styles.checkButton, { backgroundColor: isBacklog ? (isDarkMode ? '#5d4037' : '#FFF3E0') : theme.inputBackground }]} onPress={() => onMarkWatched(item)}>
                        <Text style={[styles.checkText, isBacklog && { color: '#EF6C00' }]}>✓</Text>
                    </TouchableOpacity>
                ) : (
                    index === 0 && (
                        <TouchableOpacity style={[styles.checkButton, { backgroundColor: '#FFEBEE' }]} onPress={() => onUnmarkWatched(item)}>
                            <Text style={[styles.checkText, { color: '#F44336' }]}>✕</Text>
                        </TouchableOpacity>
                    )
                )}
            </View>
        );
    };

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
            <StatusBar style={isDarkMode ? 'light' : 'dark'} />
            <View style={[styles.header, { backgroundColor: theme.header, borderBottomColor: theme.border }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <TouchableOpacity onPress={onBack} style={styles.backButton}><Text style={[styles.backButtonText, { color: theme.text }]}>←</Text></TouchableOpacity>
                    <View style={{ marginLeft: 10 }}>
                        <Text style={[styles.headerTitle, { color: theme.text }]}>Registro Lectura - {currentCategory?.name || category?.name}</Text>
                        {backlogInfo && (
                            <Text style={[styles.headerSubtitle, (backlogInfo.days <= 0 && backlogInfo.items <= 0 && backlogInfo.adelantoItems <= 0) && { color: '#4CAF50' }, backlogInfo.adelantoItems > 0 && { color: '#2E7D32' }]}>
                                {backlogInfo.adelantoItems > 0 
                                    ? `Adelantado: ${backlogInfo.adelantoDays}d, ${backlogInfo.adelantoItems} Tomos`
                                    : (backlogInfo.days <= 0 && backlogInfo.items <= 0) 
                                        ? '¡Al día! 🎉' 
                                        : `Atraso: ${backlogInfo.days}d, ${backlogInfo.items} Tomos`}
                            </Text>
                        )}
                    </View>
                </View>
            </View>

            <View style={styles.tabContainer}>
                <TouchableOpacity style={[styles.tab, currentTab === 'pending' && { borderBottomColor: theme.accent, borderBottomWidth: 3 }]} onPress={() => setCurrentTab('pending')}>
                    <Text style={[styles.tabText, { color: currentTab === 'pending' ? theme.accent : theme.subText }]}>Pendientes ({counts.pending})</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.tab, currentTab === 'watched' && { borderBottomColor: theme.accent, borderBottomWidth: 3 }]} onPress={() => setCurrentTab('watched')}>
                    <Text style={[styles.tabText, { color: currentTab === 'watched' ? theme.accent : theme.subText }]}>Leídos ({counts.watched})</Text>
                </TouchableOpacity>
            </View>

            {loading ? <ActivityIndicator size="large" color={theme.accent} style={{ marginTop: 50 }} /> : (
                <FlatList
                    data={items}
                    renderItem={renderItem}
                    keyExtractor={it => it.uniqueId}
                    contentContainerStyle={{ padding: 15 }}
                    ListEmptyComponent={<Text style={[styles.emptyText, { color: theme.subText }]}>No hay registros.</Text>}
                />
            )}
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    header: { padding: 15, borderBottomWidth: 1 },
    backButton: { padding: 5 },
    backButtonText: { fontSize: 24, fontWeight: 'bold' },
    headerTitle: { fontSize: 18, fontWeight: 'bold' },
    headerSubtitle: { fontSize: 13, color: '#EF6C00', fontWeight: 'bold' },
    tabContainer: { flexDirection: 'row', backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#eee' },
    tab: { flex: 1, padding: 15, alignItems: 'center' },
    tabText: { fontWeight: 'bold' },
    card: { padding: 15, borderRadius: 12, marginBottom: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', elevation: 2, borderLeftWidth: 5 },
    cardContent: { flex: 1 },
    seriesName: { fontSize: 16, fontWeight: 'bold' },
    episodeInfo: { fontSize: 14, marginTop: 4 },
    backlogBadge: { backgroundColor: '#EF6C00', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, marginLeft: 8 },
    backlogBadgeText: { color: '#fff', fontSize: 10, fontWeight: 'bold' },
    watchedLabel: { fontSize: 12, color: '#4CAF50', marginTop: 4, fontWeight: 'bold' },
    checkButton: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
    checkText: { fontSize: 20, color: '#4CAF50', fontWeight: 'bold' },
    emptyText: { textAlign: 'center', marginTop: 50 }
});
