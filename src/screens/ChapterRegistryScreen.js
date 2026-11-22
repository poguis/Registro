import React, { useState, useEffect } from 'react';
import { View, TouchableOpacity, StyleSheet, FlatList, ActivityIndicator } from 'react-native';
import { useSheet } from '../hooks/useSheet';
import { Text } from '../components/AppText';
import { SafeAreaView } from 'react-native-safe-area-context';
import db from '../services/db';
import { useSyncRefresh } from '../sync/useSyncRefresh';
import { useTheme, FONT, RADIUS } from '../contexts/ThemeContext';
import { calculateBacklog, calculateBacklogV2, getLocalDateString, isDatePaused, getAbsoluteEpisodeCount, getWatchedCountSinceStart } from '../services/backlogUtils';
// Fase 7.3: la cola y la decisión de "marcar visto" viven en el motor puro (src/entertainment/).
// Fase 7.4a: los vistos salen del historial; la cabecera relee el total de la categoría de la BD.
import { buildQueue, decideMarkWatched, statusAfterUnmark, watchedCount } from '../entertainment/queue';

export default function ChapterRegistryScreen({ user, category, onBack }) {
    const { theme } = useTheme();
    const { confirm, informar } = useSheet();
    const [loading, setLoading] = useState(true);
    const [items, setItems] = useState([]);
    const [tab, setTab] = useState('pending');
    const [counts, setCounts] = useState({ pending: 0, watched: 0 });
    const [rawSeries, setRawSeries] = useState([]);
    const [headerBacklog, setHeaderBacklog] = useState(null);
    const [currentCategory, setCurrentCategory] = useState(category || null);

    useEffect(() => {
        loadData();
    }, [tab]);
    // Recarga si la sync trae cambios del servidor (sin tocar formularios, filtros ni scroll).
    useSyncRefresh(() => loadData({ silent: true }));

    // silent: recarga sin indicador de carga (no desmonta la lista ni pierde el scroll).
    const loadData = async ({ silent = false } = {}) => {
        if (!silent) setLoading(true);
        const [watchlistResult, historyResult, categoriesResult, totalResult] = await Promise.all([
            db.getFullWatchlist(user.id, category ? category.id : null),
            db.getHistory(user.id, category ? category.id : null),
            db.getEntertainmentCategories(user.id),
            category ? db.getCategoryWatchedTotal(category.id) : Promise.resolve(null)
        ]);
        if (watchlistResult.success) {
            setRawSeries(watchlistResult.data);
            const refreshedCategory = categoriesResult.success && category
                ? categoriesResult.categories.find(c => c.id === category.id)
                : null;
            const effectiveCategory = refreshedCategory || category || null;
            setCurrentCategory(effectiveCategory);
            // Vistos de la categoría recién leídos de la BD (historial, todas las series: R1).
            const total = totalResult && totalResult.success
                ? totalResult.total
                : watchlistResult.data.reduce((a, s) => a + watchedCount(s), 0);
            calculateGlobalBacklog(total, effectiveCategory);
            const pendingList = buildQueue(watchlistResult.data);
            let watchedList = [];
            if (historyResult.success) {
                watchedList = historyResult.data.map(h => ({
                    uniqueId: `${h.series_id}-s${h.season_number}-e${h.episode_number}-w${h.id}`,
                    seriesId: h.series_id,
                    seriesName: h.s_name,
                    season: h.season_number,
                    episode: h.episode_number,
                    status: 'watched',
                    watchedAt: h.watched_at
                }));
            }
            setCounts({ pending: pendingList.length, watched: watchedList.length });
            setItems(tab === 'pending' ? pendingList : watchedList);
        }
        setLoading(false);
    };

    const calculateGlobalBacklog = (totalWatched, categoryData = currentCategory) => {
        if (!categoryData) {
            setHeaderBacklog(null);
            return;
        }
        const calc = calculateBacklog(categoryData, totalWatched);
        if (calc) {
            setHeaderBacklog({
                days: calc.diffDays,
                items: calc.backlogItems,
                adelantoDays: calc.adelantoDays,
                adelantoItems: calc.adelantoItems
            });
        }
    };

    const onMarkWatched = async (item) => {
        const decision = decideMarkWatched(item, items, rawSeries);
        if (decision.kind === 'noSeries') return;
        if (decision.kind === 'outOfOrder') { informar('Orden incorrecto', `Mira primero T${decision.first.season}-E${decision.first.episode}`); return; }
        const { next, isFinal } = decision;

        const performUpdate = async (newStatus = 'Mirando') => {
            await db.addHistory(item.seriesId, item.season, item.episode);
            const res = await db.updateSeriesProgress(item.seriesId, next.season, next.episode, newStatus);
            if (res.success) loadData();
        };

        if (isFinal) {
            const clave = await confirm({
                titulo: '¡Completada!',
                mensaje: 'Mover a:',
                acciones: [
                    { clave: 'espera', texto: 'En espera', variante: 'secundaria' },
                    { clave: 'terminado', texto: 'Terminado', variante: 'primaria' },
                    { clave: 'cancelar', texto: 'Cancelar', variante: 'cancelar' },
                ],
            });
            if (clave === 'espera') await performUpdate('En espera');
            else if (clave === 'terminado') await performUpdate('Terminado');
        } else performUpdate('Mirando');
    };

    const onUnmarkWatched = async (item) => {
        // R8: si la serie estaba En espera o Terminado, vuelve a Mirando.
        const series = rawSeries.find(s => s.s_id === item.seriesId);
        const status = series ? statusAfterUnmark(series.status) : null;
        await db.removeHistory(item.seriesId, item.season, item.episode);
        const res = await db.updateSeriesProgress(item.seriesId, item.season, item.episode, status, null, 0);
        if (res.success) loadData();
    };

    const renderItem = ({ item, index }) => {
        const isW = item.status === 'watched';
        const isB = !isW && headerBacklog && index < headerBacklog.items;
        return (
            <View style={[styles.card, { backgroundColor: theme.surface, shadowColor: theme.shadow, borderLeftColor: isB ? theme.behindFg : 'transparent', paddingVertical: 12 }, isB && { backgroundColor: theme.behindBg }]}>
                <View style={styles.cardContent}>
                    {/* Series Name - Top Row */}
                    <Text
                        style={[styles.seriesName, { color: theme.ink, fontSize: 17, marginBottom: 4 }]}
                        numberOfLines={2}
                        ellipsizeMode="tail"
                    >
                        {item.seriesName}
                    </Text>

                    {/* Metadata Row */}
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <Text style={[styles.episodeInfo, { color: theme.muted, marginTop: 0, flexShrink: 1 }]} numberOfLines={1} ellipsizeMode="tail">
                            T{item.season} - E{item.episode}
                        </Text>
                        {isB && (
                            <View style={[styles.backlogBadge, { backgroundColor: theme.behindFg, marginLeft: 10, marginTop: 0 }]}>
                                <Text style={[styles.backlogBadgeText, { color: theme.onDanger }]}>ATRASO</Text>
                            </View>
                        )}
                    </View>

                    {isW && (
                        <Text style={[styles.watchedLabel, { color: theme.tones.verde.fg, marginTop: 4 }]} numberOfLines={1}>
                            Visto el {new Date(item.watchedAt).toLocaleDateString()}
                        </Text>
                    )}
                </View>

                {/* Action Button */}
                <View style={{ marginLeft: 10, flexShrink: 0 }}>
                    {!isW ? (
                        <TouchableOpacity
                            style={[styles.checkButton, { backgroundColor: isB ? theme.surface : theme.raised }]}
                            onPress={() => onMarkWatched(item)}
                        >
                            <Text style={[styles.checkText, { color: isB ? theme.behindFg : theme.tones.verde.fg }]}>✓</Text>
                        </TouchableOpacity>
                    ) : (
                        index === 0 ? (
                            <TouchableOpacity
                                style={[styles.checkButton, { backgroundColor: theme.tones.rojo.bg }]}
                                onPress={() => onUnmarkWatched(item)}
                            >
                                <Text style={[styles.checkText, { color: theme.tones.rojo.fg }]}>✕</Text>
                            </TouchableOpacity>
                        ) : <View style={{ width: 40 }} />
                    )}
                </View>
            </View >
        );
    };

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: theme.bg }]}>
            <View style={[styles.header, { backgroundColor: theme.surface, borderBottomColor: theme.line }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <TouchableOpacity onPress={onBack} style={styles.backButton}><Text style={[styles.backButtonText, { color: theme.ink }]}>←</Text></TouchableOpacity>
                    <View style={{ marginLeft: 10, flex: 1, minWidth: 0 }}>
                        <Text style={[styles.headerTitle, { color: theme.ink }]} numberOfLines={2} ellipsizeMode="tail">Registro - {currentCategory?.name || category?.name || 'Global'}</Text>
                        {headerBacklog && (
                            <Text numberOfLines={1} ellipsizeMode="tail" style={[styles.headerSubtitle, { color: theme.behindFg }, (headerBacklog.days <= 0 && headerBacklog.items <= 0 && headerBacklog.adelantoItems <= 0) && { color: theme.okFg }, headerBacklog.adelantoItems > 0 && { color: theme.aheadFg }]}>
                                {headerBacklog.adelantoItems > 0 
                                    ? `Adelantado: ${headerBacklog.adelantoDays}d, ${headerBacklog.adelantoItems} Caps`
                                    : (headerBacklog.days <= 0 && headerBacklog.items <= 0) 
                                        ? '¡Al día! 🎉' 
                                        : `Atraso: ${headerBacklog.days}d, ${headerBacklog.items} Caps`}
                            </Text>
                        )}
                    </View>
                </View>
            </View>
            <View style={[styles.tabContainer, { backgroundColor: theme.surface }]}>
                <TouchableOpacity style={[styles.tab, tab === 'pending' && { backgroundColor: theme.soft }]} onPress={() => setTab('pending')}>
                    <Text style={[styles.tabText, { color: theme.muted }, tab === 'pending' && { color: theme.accent, fontFamily: FONT.bold }]}>Pendientes ({counts.pending})</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.tab, tab === 'watched' && { backgroundColor: theme.soft }]} onPress={() => setTab('watched')}>
                    <Text style={[styles.tabText, { color: theme.muted }, tab === 'watched' && { color: theme.accent, fontFamily: FONT.bold }]}>Vistos ({counts.watched})</Text>
                </TouchableOpacity>
            </View>
            {loading ? <ActivityIndicator size="large" color={theme.accent} style={{ marginTop: 50 }} /> : (
                <FlatList data={items} renderItem={renderItem} keyExtractor={it => it.uniqueId} contentContainerStyle={{ padding: 15 }} ListEmptyComponent={
                    <View style={styles.emptyContainer}>
                        <Text style={[styles.emptyText, { color: theme.muted }]}>{tab === 'pending' ? 'No hay pendientes.' : 'No has visto nada.'}</Text>
                    </View>
                } />
            )}
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    header: { paddingHorizontal: 15, paddingVertical: 15, borderBottomWidth: 1 },
    backButton: { padding: 5 },
    backButtonText: { fontSize: 24, fontFamily: FONT.bold },
    headerTitle: { fontSize: 18, fontFamily: FONT.bold },
    headerSubtitle: { fontSize: 13, fontFamily: FONT.bold, marginTop: 2 },
    tabContainer: { flexDirection: 'row', padding: 5, margin: 15, borderRadius: RADIUS.sm },
    tab: { flex: 1, padding: 10, alignItems: 'center', borderRadius: RADIUS.sm },
    tabText: { fontFamily: FONT.semibold },
    card: { padding: 15, borderRadius: RADIUS.base, marginBottom: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.1, shadowRadius: 2.22, elevation: 2, borderLeftWidth: 5 },
    backlogBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, marginLeft: 8, flexShrink: 0 },
    backlogBadgeText: { fontSize: 10, fontFamily: FONT.bold },
    cardContent: { flex: 1, minWidth: 0 },
    seriesName: { fontSize: 16, fontFamily: FONT.bold },
    episodeInfo: { fontSize: 14, marginTop: 4 },
    watchedLabel: { fontSize: 12, fontFamily: FONT.bold, marginTop: 2 },
    checkButton: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
    checkText: { fontSize: 20, fontFamily: FONT.bold },
    emptyText: { textAlign: 'center', marginTop: 50 },
    emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' }
});
