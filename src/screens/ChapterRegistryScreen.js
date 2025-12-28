import React, { useState, useEffect } from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    StyleSheet,
    FlatList,
    ActivityIndicator,
    Alert
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import db from '../services/db';
import { useTheme } from '../contexts/ThemeContext';

export default function ChapterRegistryScreen({ user, category, onBack }) {
    const { theme, isDarkMode } = useTheme();
    const [loading, setLoading] = useState(true);
    const [items, setItems] = useState([]);
    const [tab, setTab] = useState('pending');
    const [counts, setCounts] = useState({ pending: 0, watched: 0 });
    const [rawSeries, setRawSeries] = useState([]);
    const [headerBacklog, setHeaderBacklog] = useState(null);

    useEffect(() => {
        loadData();
    }, [tab]);

    const loadData = async () => {
        setLoading(true);
        const [watchlistResult, historyResult] = await Promise.all([
            db.getFullWatchlist(user.id, category ? category.id : null),
            db.getHistory(category ? category.id : null)
        ]);
        if (watchlistResult.success) {
            setRawSeries(watchlistResult.data);
            calculateGlobalBacklog(watchlistResult.data);
            const pendingList = generateInterleavedList(watchlistResult.data);
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

    const calculateGlobalBacklog = (seriesList) => {
        let totalBacklogDays = 0;
        let totalBacklogItems = 0;
        if (category) {
            const { start_date, frequency, days_of_week } = category;
            const scheduleCalc = calculateScheduleDays(start_date, days_of_week);
            const targetTotal = scheduleCalc.validDays * frequency;
            let totalWatchedSinceStart = 0;
            seriesList.forEach(s => { totalWatchedSinceStart += getWatchedCountSinceStart(s); });
            totalBacklogItems = Math.max(0, targetTotal - totalWatchedSinceStart);
            totalBacklogDays = Math.ceil(totalBacklogItems / frequency);
        } else {
            seriesList.forEach(s => {
                const b = calculateBacklogCount(s);
                totalBacklogItems += b;
                if (s.frequency) totalBacklogDays += Math.ceil(b / s.frequency);
            });
        }
        setHeaderBacklog({ days: totalBacklogDays, items: totalBacklogItems });
    };

    const calculateScheduleDays = (startStr, daysOfWeek) => {
        if (!startStr) return { validDays: 0 };
        let daysArray = [];
        try { daysArray = typeof daysOfWeek === 'string' ? JSON.parse(daysOfWeek) : daysOfWeek; } catch (e) { daysArray = []; }
        const now = new Date();
        now.setHours(0, 0, 0, 0);
        const [y, m, d] = startStr.split('-').map(Number);
        const start = new Date(y, m - 1, d);
        if (start > now) return { validDays: 0 };
        let count = 0;
        let current = new Date(start);
        while (current <= now) {
            const dayMap = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
            if (daysArray.includes(dayMap[current.getDay()])) count++;
            current.setDate(current.getDate() + 1);
        }
        return { validDays: count };
    };

    const getWatchedCountSinceStart = (series) => {
        const currentAbsolute = getAbsoluteEpisodeCount(series, series.current_season, series.current_episode);
        const initialAbsolute = getAbsoluteEpisodeCount(series, series.initial_season || 1, series.initial_episode || 1);
        let diff = currentAbsolute - initialAbsolute;
        if (series.status === 'Terminado' || series.status === 'En espera') diff += 1;
        return Math.max(0, diff) + (series.cycle_offset || 0);
    };

    const getAbsoluteEpisodeCount = (series, seasonNum, episodeNum) => {
        let count = 0;
        for (let i = 1; i < seasonNum; i++) {
            const sobj = series.seasons.find(sea => sea.season_number === i);
            count += sobj ? sobj.episode_count : 0;
        }
        count += (episodeNum - 1);
        return count;
    };

    const calculateBacklogCount = (series) => {
        if (!series.start_date || !series.frequency) return 0;
        const calc = calculateScheduleDays(series.start_date, series.days_of_week);
        const targetCount = calc.validDays * series.frequency;
        const watchedSinceStart = getWatchedCountSinceStart(series);
        return Math.max(0, targetCount - watchedSinceStart);
    };

    const generateInterleavedList = (seriesList) => {
        let allEpisodes = [];
        seriesList.forEach((series, sIndex) => {
            const seriesEpisodes = generateEpisodesForSeries(series);
            seriesEpisodes.forEach((ep, index) => {
                const BATCH_SIZE = 1000000;
                ep.interleavedOrder = (index * BATCH_SIZE + sIndex);
                ep.sortOrder = series.sort_order || 0;
                allEpisodes.push(ep);
            });
        });
        allEpisodes.sort((a, b) => {
            if (a.interleavedOrder !== b.interleavedOrder) return a.interleavedOrder - b.interleavedOrder;
            return a.sortOrder - b.sortOrder;
        });
        return allEpisodes;
    };

    const generateEpisodesForSeries = (series) => {
        const episodes = [];
        let { current_season, current_episode, status, total_seasons } = series;
        if (status === 'Terminado' || status === 'En espera') return [];
        let count = 0, s = current_season || 1, e = current_episode || 1;
        const maxSeason = total_seasons || (series.seasons?.length ? series.seasons[series.seasons.length - 1].season_number : 1);
        while (s <= maxSeason && count < 500) {
            const seasonObj = series.seasons.find(sea => sea.season_number === s);
            const maxEp = seasonObj ? seasonObj.episode_count : 999;
            episodes.push({ uniqueId: `${series.s_id}-s${s}-e${e}`, seriesId: series.s_id, seriesName: series.s_name, season: s, episode: e, status: 'pending' });
            count++; e++;
            if (e > maxEp) { e = 1; s++; }
        }
        return episodes;
    };

    const onMarkWatched = async (item) => {
        const series = rawSeries.find(s => s.s_id === item.seriesId);
        if (!series) return;
        const first = items.find(i => i.seriesId === item.seriesId && i.status === 'pending');
        if (first && first.uniqueId !== item.uniqueId) return Alert.alert('Orden incorrecto', `Mira primero T${first.season}-E${first.episode}`);

        const maxEpisodes = series.seasons.find(s => s.season_number === item.season)?.episode_count || 999;
        let nextS = item.season, nextE = item.episode + 1, isFinal = false;
        if (nextE > maxEpisodes) {
            if (item.season >= series.total_seasons) { isFinal = true; nextE = item.episode; nextS = item.season; }
            else { nextE = 1; nextS++; }
        }

        const performUpdate = async (newStatus = 'Mirando') => {
            await db.addHistory(item.seriesId, item.season, item.episode);
            const res = await db.updateSeriesProgress(item.seriesId, nextS, nextE, newStatus);
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
        await db.removeHistory(item.seriesId, item.season, item.episode);
        const res = await db.updateSeriesProgress(item.seriesId, item.season, item.episode, null, 1);
        if (res.success) loadData();
    };

    const renderItem = ({ item, index }) => {
        const isW = item.status === 'watched';
        const isB = !isW && headerBacklog && index < headerBacklog.items;
        return (
            <View style={[styles.card, { backgroundColor: theme.card, borderLeftColor: isB ? '#EF6C00' : 'transparent' }, isB && { backgroundColor: isDarkMode ? '#3e2723' : '#FFFDE7' }]}>
                <View style={styles.cardContent}>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <Text style={[styles.seriesName, { color: theme.text }]}>{item.seriesName}</Text>
                        {isB && <View style={styles.backlogBadge}><Text style={styles.backlogBadgeText}>ATRASO</Text></View>}
                    </View>
                    <Text style={[styles.episodeInfo, { color: theme.subText }]}>T{item.season} - E{item.episode}</Text>
                    {isW && <Text style={styles.watchedLabel}>Visto el {new Date(item.watchedAt).toLocaleDateString()}</Text>}
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
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <TouchableOpacity onPress={onBack} style={styles.backButton}><Text style={[styles.backButtonText, { color: theme.text }]}>←</Text></TouchableOpacity>
                    <View style={{ marginLeft: 10 }}>
                        <Text style={[styles.headerTitle, { color: theme.text }]}>Registro - {category?.name || 'Global'}</Text>
                        {headerBacklog && (
                            <Text style={[styles.headerSubtitle, (headerBacklog.days <= 0 && headerBacklog.items <= 0) && { color: '#4CAF50' }]}>
                                {(headerBacklog.days <= 0 && headerBacklog.items <= 0) ? '¡Al día! 🎉' : `Atraso: ${headerBacklog.days}d, ${headerBacklog.items} Caps`}
                            </Text>
                        )}
                    </View>
                </View>
            </View>
            <View style={[styles.tabContainer, { backgroundColor: theme.card }]}>
                <TouchableOpacity style={[styles.tab, tab === 'pending' && { backgroundColor: theme.accent + '22' }]} onPress={() => setTab('pending')}>
                    <Text style={[styles.tabText, { color: theme.subText }, tab === 'pending' && { color: theme.accent, fontWeight: 'bold' }]}>Pendientes ({counts.pending})</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.tab, tab === 'watched' && { backgroundColor: theme.accent + '22' }]} onPress={() => setTab('watched')}>
                    <Text style={[styles.tabText, { color: theme.subText }, tab === 'watched' && { color: theme.accent, fontWeight: 'bold' }]}>Vistos ({counts.watched})</Text>
                </TouchableOpacity>
            </View>
            {loading ? <ActivityIndicator size="large" color={theme.accent} style={{ marginTop: 50 }} /> : (
                <FlatList data={items} renderItem={renderItem} keyExtractor={it => it.uniqueId} contentContainerStyle={{ padding: 15 }} ListEmptyComponent={
                    <View style={styles.emptyContainer}>
                        <Text style={[styles.emptyText, { color: theme.subText }]}>{tab === 'pending' ? 'No hay pendientes.' : 'No has visto nada.'}</Text>
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
    backButtonText: { fontSize: 24, fontWeight: 'bold' },
    headerTitle: { fontSize: 18, fontWeight: 'bold' },
    headerSubtitle: { fontSize: 13, color: '#EF6C00', fontWeight: 'bold', marginTop: 2 },
    tabContainer: { flexDirection: 'row', padding: 5, margin: 15, borderRadius: 10 },
    tab: { flex: 1, padding: 10, alignItems: 'center', borderRadius: 8 },
    tabText: { fontWeight: '600' },
    card: { padding: 15, borderRadius: 12, marginBottom: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', elevation: 2, borderLeftWidth: 5 },
    backlogBadge: { backgroundColor: '#EF6C00', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, marginLeft: 8 },
    backlogBadgeText: { color: '#fff', fontSize: 10, fontWeight: 'bold' },
    cardContent: { flex: 1 },
    seriesName: { fontSize: 16, fontWeight: 'bold' },
    episodeInfo: { fontSize: 14, marginTop: 4 },
    watchedLabel: { fontSize: 12, color: '#4CAF50', fontWeight: 'bold', marginTop: 2 },
    checkButton: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
    checkText: { fontSize: 20, color: '#4CAF50', fontWeight: 'bold' },
    emptyText: { textAlign: 'center', marginTop: 50 }
});
