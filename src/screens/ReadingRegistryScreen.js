import React, { useState, useEffect, useCallback } from 'react';
import { View, TouchableOpacity, StyleSheet, FlatList, ActivityIndicator } from 'react-native';
import { useSheet } from '../hooks/useSheet';
import { Text } from '../components/AppText';
import { SafeAreaView } from 'react-native-safe-area-context';
import db from '../services/db';
import { useSyncRefresh } from '../sync/useSyncRefresh';
import { calculateBacklog, calculateBacklogV2, getAbsoluteEpisodeCount, getWatchedCountSinceStart } from '../services/backlogUtils';
// Fase 7.3: la cola y la decisión de "marcar leído" viven en el motor puro (src/entertainment/).
// Fase 7.4a: los vistos salen del historial; la cabecera relee el total de la categoría de la BD.
import { buildQueue, decideMarkWatched, statusAfterUnmark, watchedCount } from '../entertainment/queue';
import { useTheme, FONT, RADIUS } from '../contexts/ThemeContext';

export default function ReadingRegistryScreen({ user, category, onBack }) {
    const { theme } = useTheme();
    const { confirm, informar } = useSheet();
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
            const [seriesResult, historyResult, categoriesResult, totalResult] = await Promise.all([
                db.getFullWatchlist(user.id, category ? category.id : null),
                db.getReadingHistory(user.id, category ? category.id : null),
                db.getEntertainmentCategories(user.id),
                category ? db.getCategoryWatchedTotal(category.id) : Promise.resolve(null)
            ]);
            if (seriesResult.success) {
                setRawSeries(seriesResult.data);
                const refreshedCategory = categoriesResult.success && category
                    ? categoriesResult.categories.find(c => c.id === category.id)
                    : null;
                const effectiveCategory = refreshedCategory || category || null;
                setCurrentCategory(effectiveCategory);

                // Vistos de la categoría recién leídos de la BD (historial, todas las obras: R1).
                const total = totalResult && totalResult.success
                    ? totalResult.total
                    : seriesResult.data.reduce((a, s) => a + watchedCount(s), 0);
                const calc = effectiveCategory ? calculateBacklog(effectiveCategory, total) : null;
                if (calc) {
                    setBacklogInfo({
                        items: calc.backlogItems,
                        days: calc.diffDays,
                        adelantoItems: calc.adelantoItems,
                        adelantoDays: calc.adelantoDays
                    });
                }
                const pendingList = buildQueue(seriesResult.data);
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
        if (decision.kind === 'outOfOrder') { informar('Orden incorrecto', `Lee primero el Tomo ${decision.first.episode}.`); return; }
        const { next, isFinal } = decision;

        const performUpdate = async (newStatus = 'Mirando') => {
            await db.addReadingHistory(item.seriesId, item.season, item.episode);
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
        // R8: si la obra estaba En espera o Terminado, vuelve a Mirando.
        const series = rawSeries.find(s => s.s_id === item.seriesId);
        const status = series ? statusAfterUnmark(series.status) : null;
        await db.removeReadingHistory(item.seriesId, item.season, item.episode);
        const res = await db.updateSeriesProgress(item.seriesId, item.season, item.episode, status, null, 0);
        if (res.success) loadData();
    };

    const renderItem = ({ item, index }) => {
        const isWatched = item.status === 'watched';
        const isBacklog = !isWatched && backlogInfo && index < backlogInfo.items;

        return (
            <View style={[
                styles.card,
                { backgroundColor: theme.surface, shadowColor: theme.shadow, borderLeftColor: isBacklog ? theme.behindFg : 'transparent' },
                isBacklog && { backgroundColor: theme.behindBg }
            ]}>
                <View style={styles.cardContent}>
                    <Text style={[styles.seriesName, { color: theme.ink }]} numberOfLines={2} ellipsizeMode="tail">{item.seriesName}</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <Text style={[styles.episodeInfo, { color: theme.muted, flexShrink: 1 }]} numberOfLines={1} ellipsizeMode="tail">Tomo {item.episode} (Parte {item.season})</Text>
                        {isBacklog && (
                            <View style={[styles.backlogBadge, { backgroundColor: theme.behindFg }]}><Text style={[styles.backlogBadgeText, { color: theme.onDanger }]}>ATRASO</Text></View>
                        )}
                    </View>
                    {isWatched && <Text style={[styles.watchedLabel, { color: theme.tones.verde.fg }]} numberOfLines={1}>Leído el {new Date(item.readAt).toLocaleDateString()}</Text>}
                </View>

                {!isWatched ? (
                    <TouchableOpacity style={[styles.checkButton, { backgroundColor: isBacklog ? theme.surface : theme.raised }]} onPress={() => onMarkWatched(item)}>
                        <Text style={[styles.checkText, { color: isBacklog ? theme.behindFg : theme.tones.verde.fg }]}>✓</Text>
                    </TouchableOpacity>
                ) : (
                    index === 0 && (
                        <TouchableOpacity style={[styles.checkButton, { backgroundColor: theme.tones.rojo.bg }]} onPress={() => onUnmarkWatched(item)}>
                            <Text style={[styles.checkText, { color: theme.tones.rojo.fg }]}>✕</Text>
                        </TouchableOpacity>
                    )
                )}
            </View>
        );
    };

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: theme.bg }]}>
            <View style={[styles.header, { backgroundColor: theme.surface, borderBottomColor: theme.line }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <TouchableOpacity onPress={onBack} style={styles.backButton}><Text style={[styles.backButtonText, { color: theme.ink }]}>←</Text></TouchableOpacity>
                    <View style={{ marginLeft: 10, flex: 1, minWidth: 0 }}>
                        <Text style={[styles.headerTitle, { color: theme.ink }]} numberOfLines={2} ellipsizeMode="tail">Registro Lectura - {currentCategory?.name || category?.name}</Text>
                        {backlogInfo && (
                            <Text numberOfLines={1} ellipsizeMode="tail" style={[styles.headerSubtitle, { color: theme.behindFg }, (backlogInfo.days <= 0 && backlogInfo.items <= 0 && backlogInfo.adelantoItems <= 0) && { color: theme.okFg }, backlogInfo.adelantoItems > 0 && { color: theme.aheadFg }]}>
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

            {/* O2 (7.4a): la barra usa el tema (antes fondo blanco fijo, ilegible en modo oscuro),
                con el mismo estilo de pestañas que el Registro de capítulos. */}
            <View style={[styles.tabContainer, { backgroundColor: theme.surface }]}>
                <TouchableOpacity style={[styles.tab, currentTab === 'pending' && { backgroundColor: theme.soft }]} onPress={() => setCurrentTab('pending')}>
                    <Text style={[styles.tabText, { color: theme.muted }, currentTab === 'pending' && { color: theme.accent, fontFamily: FONT.bold }]}>Pendientes ({counts.pending})</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.tab, currentTab === 'watched' && { backgroundColor: theme.soft }]} onPress={() => setCurrentTab('watched')}>
                    <Text style={[styles.tabText, { color: theme.muted }, currentTab === 'watched' && { color: theme.accent, fontFamily: FONT.bold }]}>Leídos ({counts.watched})</Text>
                </TouchableOpacity>
            </View>

            {loading ? <ActivityIndicator size="large" color={theme.accent} style={{ marginTop: 50 }} /> : (
                <FlatList
                    data={items}
                    renderItem={renderItem}
                    keyExtractor={it => it.uniqueId}
                    contentContainerStyle={{ padding: 15 }}
                    ListEmptyComponent={<Text style={[styles.emptyText, { color: theme.muted }]}>No hay registros.</Text>}
                />
            )}
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    header: { padding: 15, borderBottomWidth: 1 },
    backButton: { padding: 5 },
    backButtonText: { fontSize: 24, fontFamily: FONT.bold },
    headerTitle: { fontSize: 18, fontFamily: FONT.bold },
    headerSubtitle: { fontSize: 13, fontFamily: FONT.bold },
    tabContainer: { flexDirection: 'row', padding: 5, margin: 15, borderRadius: RADIUS.sm },
    tab: { flex: 1, padding: 10, alignItems: 'center', borderRadius: RADIUS.sm },
    tabText: { fontFamily: FONT.semibold },
    card: { padding: 15, borderRadius: RADIUS.base, marginBottom: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', elevation: 2, borderLeftWidth: 5 },
    cardContent: { flex: 1, minWidth: 0 },
    seriesName: { fontSize: 16, fontFamily: FONT.bold },
    episodeInfo: { fontSize: 14, marginTop: 4 },
    backlogBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, marginLeft: 8, flexShrink: 0 },
    backlogBadgeText: { fontSize: 10, fontFamily: FONT.bold },
    watchedLabel: { fontSize: 12, marginTop: 4, fontFamily: FONT.bold },
    checkButton: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginLeft: 10 },
    checkText: { fontSize: 20, fontFamily: FONT.bold },
    emptyText: { textAlign: 'center', marginTop: 50 }
});
