import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, FlatList, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import db from '../services/db';
import { useTheme } from '../contexts/ThemeContext';

export default function ReadingRegistryScreen({ user, category, onBack }) {
    const { theme, isDarkMode } = useTheme();
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [currentTab, setCurrentTab] = useState('pending');
    const [rawSeries, setRawSeries] = useState([]);
    const [backlogInfo, setBacklogInfo] = useState({ items: 0, days: 0 });
    const [counts, setCounts] = useState({ pending: 0, watched: 0 });

    const loadData = useCallback(async () => {
        setLoading(true);
        try {
            const [seriesResult, historyResult] = await Promise.all([
                db.getFullWatchlist(user.id, category ? category.id : null),
                db.getReadingHistory(user.id, category ? category.id : null)
            ]);
            if (seriesResult.success) {
                setRawSeries(seriesResult.data);
                const freq = category.frequency, startStr = category.start_date, dOfWeek = category.days_of_week;
                const getValidDays = (s, dw) => {
                    if (!s) return 0;
                    const now = new Date(); now.setHours(0, 0, 0, 0);
                    const [y, m, d] = s.split('-').map(Number);
                    const start = new Date(y, m - 1, d);
                    if (start > now) return 0;
                    let c = 0, curr = new Date(start);
                    while (curr <= now) {
                        const dayName = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][curr.getDay()];
                        if (dw.includes(dayName)) c++;
                        curr.setDate(curr.getDate() + 1);
                    }
                    return c;
                };
                const validDays = getValidDays(startStr, dOfWeek);
                let targetTotal = freq > 0 ? (validDays * freq) : Math.floor(validDays / Math.abs(freq));
                let totalRead = 0;
                seriesResult.data.forEach(s => {
                    const getAbs = (sn, en) => {
                        let c = 0;
                        for (let i = 1; i < sn; i++) c += s.seasons.find(se => se.season_number === i)?.episode_count || 0;
                        return c + (en - 1);
                    };
                    const diff = getAbs(s.current_season, s.current_episode) - getAbs(s.initial_season || 1, s.initial_episode || 1);
                    totalRead += Math.max(0, diff) + (s.cycle_offset || 0) + (s.status === 'Terminado' || s.status === 'En espera' ? 1 : 0);
                });
                const bItems = Math.max(0, targetTotal - totalRead);
                setBacklogInfo({ items: bItems, days: freq > 0 ? Math.ceil(bItems / freq) : bItems * Math.abs(freq) });
                const pendingList = generateInterleavedList(seriesResult.data);
                let watchedList = historyResult.success ? historyResult.data.map(h => ({ uniqueId: `${h.series_id}-s${h.season_number}-e${h.episode_number}-rh${h.id}`, seriesId: h.series_id, seriesName: h.s_name, season: h.season_number, episode: h.episode_number, status: 'watched', readAt: h.read_at })) : [];
                setCounts({ pending: pendingList.length, watched: watchedList.length });
                setItems(currentTab === 'pending' ? pendingList : watchedList);
            }
        } catch (e) { console.error(e); } finally { setLoading(false); }
    }, [category, currentTab]);

    useEffect(() => { loadData(); }, [loadData]);

    const generateInterleavedList = (list) => {
        let episodes = [];
        list.forEach((s, sIdx) => {
            if (s.status === 'Terminado' || s.status === 'En espera') return;
            const seriesEps = generateEpisodesForSeries(s);

            // Calculate baseCount inline
            const getAbs = (sn, en) => {
                let c = 0;
                for (let i = 1; i < sn; i++) c += s.seasons.find(se => se.season_number === i)?.episode_count || 0;
                return c + (en - 1);
            };
            const diff = getAbs(s.current_season, s.current_episode) - getAbs(s.initial_season || 1, s.initial_episode || 1);
            const baseCount = Math.max(0, diff) + (s.cycle_offset || 0);

            seriesEps.forEach((ep, idx) => {
                // Use (baseCount + idx) to align with global cycle
                ep.interleavedOrder = ((baseCount + idx) * 1000000) + sIdx;
                ep.sortOrder = s.sort_order || 0;
                episodes.push(ep);
            });
        });
        episodes.sort((a, b) => a.interleavedOrder !== b.interleavedOrder ? a.interleavedOrder - b.interleavedOrder : a.sortOrder - b.sortOrder);
        return episodes;
    };

    const generateEpisodesForSeries = (s) => {
        const eps = []; let { current_season: sn, current_episode: en, total_seasons: ts } = s;
        let c = 0, currS = sn || 1, currE = en || 1;
        const maxS = ts || (s.seasons?.length ? s.seasons[s.seasons.length - 1].season_number : 1);
        while (currS <= maxS && c < 500) {
            const maxE = s.seasons.find(sea => sea.season_number === currS)?.episode_count || 999;
            eps.push({ uniqueId: `${s.s_id}-s${currS}-e${currE}`, seriesId: s.s_id, seriesName: s.s_name, season: currS, episode: currE, status: 'pending' });
            c++; currE++;
            if (currE > maxE) { currE = 1; currS++; }
        }
        return eps;
    };

    const onMarkWatched = async (item) => {
        const series = rawSeries.find(s => s.s_id === item.seriesId);
        if (!series) return;
        const first = items.find(i => i.seriesId === item.seriesId && i.status === 'pending');
        if (first && first.uniqueId !== item.uniqueId) return Alert.alert('Orden incorrecto', `Lee primero el Tomo ${first.episode}.`);
        const maxE = series.seasons.find(s => s.season_number === item.season)?.episode_count || 999;
        let nS = item.season, nE = item.episode + 1, isFinal = false;
        if (nE > maxE) { if (item.season >= series.total_seasons) { isFinal = true; nE = item.episode; nS = item.season; } else { nE = 1; nS++; } }
        const performUpdate = async (st = 'Mirando') => { await db.addReadingHistory(item.seriesId, item.season, item.episode); const res = await db.updateSeriesProgress(item.seriesId, nS, nE, st); if (res.success) loadData(); };
        if (isFinal) {
            Alert.alert('¡Completado!', 'Mover a:', [
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
        const isW = item.status === 'watched', isB = !isW && backlogInfo.items > 0 && index < backlogInfo.items;
        return (
            <View style={[styles.card, { backgroundColor: theme.card, borderLeftColor: isB ? '#EF6C00' : 'transparent' }, isB && { backgroundColor: isDarkMode ? '#3e2723' : '#FFFDE7' }]}>
                <View style={styles.cardContent}>
                    <Text style={[styles.seriesName, { color: theme.text, marginBottom: 4 }]}>
                        {item.seriesName}
                    </Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <Text style={[styles.episodeInfo, { color: isB ? '#EF6C00' : theme.accent, marginTop: 0 }]}>
                            Tomo {item.episode}
                        </Text>
                        {isB && (
                            <View style={[styles.backlogBadge, { marginLeft: 10 }]}>
                                <Text style={styles.backlogBadgeText}>ATRASO</Text>
                            </View>
                        )}
                    </View>
                    {isW && <Text style={[styles.watchedLabel, { color: theme.subText }]}>Leído el {new Date(item.readAt).toLocaleDateString()}</Text>}
                </View>
                {!isW ? (
                    <TouchableOpacity style={[styles.checkButton, { backgroundColor: isB ? (isDarkMode ? '#5d4037' : '#FFF3E0') : theme.inputBackground }]} onPress={() => onMarkWatched(item)}>
                        <Text style={[styles.checkText, isB && { color: '#EF6C00' }]}>✓</Text>
                    </TouchableOpacity>
                ) : (
                    index === 0 ? (
                        <TouchableOpacity style={[styles.checkButton, { backgroundColor: '#FFEBEE' }]} onPress={() => onUnmarkWatched(item)}>
                            <Text style={[styles.checkText, { color: '#F44336' }]}>✕</Text>
                        </TouchableOpacity>
                    ) : <View style={{ width: 40 }} />
                )}
            </View>
        );
    };

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
            <StatusBar style={isDarkMode ? "light" : "dark"} />
            <View style={[styles.header, { backgroundColor: theme.header, borderBottomColor: theme.border }]}>
                <TouchableOpacity onPress={onBack} style={styles.backButton}><Text style={[styles.backStatus, { color: theme.text }]}>←</Text></TouchableOpacity>
                <View style={{ flex: 1, alignItems: 'center' }}>
                    <Text style={[styles.headerTitle, { color: theme.text }]}>Registro - {category?.name || 'Lectura'}</Text>
                    {!loading && <Text style={[styles.allDone, backlogInfo.items > 0 ? { color: '#EF6C00' } : { color: '#4CAF50' }]}>{backlogInfo.items <= 0 ? '¡Al día! 🎉' : `Atraso: ${backlogInfo.items} Tomos`}</Text>}
                </View>
                <View style={{ width: 40 }} />
            </View>
            <View style={[styles.tabBar, { backgroundColor: theme.header }]}>
                <TouchableOpacity style={[styles.tab, { backgroundColor: theme.inputBackground }, currentTab === 'pending' && { backgroundColor: theme.accent + '22' }]} onPress={() => setCurrentTab('pending')}>
                    <Text style={[styles.tabText, { color: theme.subText }, currentTab === 'pending' && { color: theme.accent, fontWeight: 'bold' }]}>Pendientes ({counts.pending})</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.tab, { backgroundColor: theme.inputBackground }, currentTab === 'watched' && { backgroundColor: theme.accent + '22' }]} onPress={() => setCurrentTab('watched')}>
                    <Text style={[styles.tabText, { color: theme.subText }, currentTab === 'watched' && { color: theme.accent, fontWeight: 'bold' }]}>Leídos ({counts.watched})</Text>
                </TouchableOpacity>
            </View>
            {loading ? <ActivityIndicator size="large" color={theme.accent} style={{ marginTop: 50 }} /> : (
                <FlatList data={items} keyExtractor={it => it.uniqueId} renderItem={renderItem} contentContainerStyle={{ padding: 15 }} ListEmptyComponent={
                    <View style={styles.emptyContainer}><Text style={[styles.emptyText, { color: theme.subText }]}>{currentTab === 'pending' ? 'No tienes tomos pendientes.' : 'No hay historial.'}</Text></View>
                } />
            )}
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    header: { flexDirection: 'row', alignItems: 'center', padding: 15, borderBottomWidth: 1 },
    backButton: { padding: 5 },
    backStatus: { fontSize: 24, fontWeight: 'bold' },
    headerTitle: { fontSize: 18, fontWeight: 'bold' },
    allDone: { fontSize: 12, fontWeight: 'bold' },
    tabBar: { flexDirection: 'row', padding: 10, gap: 10 },
    tab: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 10 },
    tabText: { fontWeight: '600' },
    card: { flexDirection: 'row', borderRadius: 12, padding: 15, marginBottom: 10, alignItems: 'center', elevation: 2, borderLeftWidth: 5 },
    backlogBadge: { backgroundColor: '#EF6C00', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, marginLeft: 8 },
    backlogBadgeText: { color: '#fff', fontSize: 10, fontWeight: 'bold' },
    cardContent: { flex: 1 },
    seriesName: { fontSize: 16, fontWeight: 'bold' },
    episodeInfo: { fontSize: 14, fontWeight: '600', marginTop: 2 },
    watchedLabel: { fontSize: 11, marginTop: 4 },
    checkButton: { width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center' },
    checkText: { color: '#4CAF50', fontSize: 20, fontWeight: 'bold' },
    emptyContainer: { alignItems: 'center', marginTop: 100 },
    emptyText: { fontSize: 16, textAlign: 'center' }
});
