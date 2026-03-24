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
            db.getHistory(user.id, category ? category.id : null)
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
            const { start_date, frequency, days_of_week, type } = category;
            let targetTotal = 0;
            const dOfWeek = days_of_week; // Renamed for clarity with new function signature
            const startStr = start_date; // Renamed for clarity with new function signature

            if (type === 'video') {
                targetTotal = calculateQuotasPassed(startStr, dOfWeek, category?.quotas_history);
            } else {
                if (!category?.frequency) return; // Ensure frequency exists for reading type
                const scheduleCalc = calculateScheduleDays(startStr, dOfWeek, category?.quotas_history);
                targetTotal = (frequency > 0) ? (scheduleCalc.validDays * frequency) : Math.floor(scheduleCalc.validDays / Math.abs(frequency || 1));
            }

            let totalWatchedSinceStart = 0;
            seriesList.forEach(s => { totalWatchedSinceStart += getWatchedCountSinceStart(s); });
            const totalBacklogValue = targetTotal - totalWatchedSinceStart;
            totalBacklogItems = totalBacklogValue < 0 ? 0 : totalBacklogValue;
            let totalAdelantoItems = totalBacklogValue < 0 ? Math.abs(totalBacklogValue) : 0;
            
            let bDays = 0;
            let adelantoDays = 0;
            const history = category?.quotas_history || [];
            const pauses = category?.pauses || [];
            const dayMap = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

            const todayStr = new Date().toISOString().split('T')[0];
            const workingPauses = pauses.map(p => {
                if (!p.pause_end) return { ...p, pause_end: todayStr };
                return p;
            });

            const getActiveQuotasForDate = (checkDate) => {
                const dStr = checkDate.toISOString().split('T')[0];
                if (dStr < startStr) return {}; // No quota before start_date

                let activeQ = null;
                if (history.length > 0) {
                    const record = history.find(h => dStr >= h.start_date && dStr <= (h.end_date || '9999-12-31'));
                    if (record) activeQ = record.quotas;
                }
                if (!activeQ) {
                    try {
                        const parsed = typeof dOfWeek === 'string' ? JSON.parse(dOfWeek || '[]') : dOfWeek;
                        if (Array.isArray(parsed)) {
                            activeQ = {};
                            parsed.forEach(day => { activeQ[day] = frequency || 0; });
                        } else {
                            activeQ = parsed;
                        }
                    } catch (e) { activeQ = {}; }
                }
                return activeQ;
            };

            const getQuotaForDate = (checkDate, activeQ) => {
                const dayName = dayMap[checkDate.getDay()];
                let quota = 0;
                if (type === 'video') {
                    quota = activeQ?.[dayName] || 0;
                } else {
                    let isActive = false;
                    if (Array.isArray(activeQ)) {
                        isActive = activeQ.includes(dayName);
                    } else {
                        isActive = activeQ?.[dayName] > 0;
                    }
                    if (isActive) {
                        quota = frequency > 0 ? frequency : (1 / Math.abs(frequency || 1));
                    }
                }
                return quota;
            };

            if (totalBacklogItems > 0) {
                let tempBacklog = totalBacklogItems;
                let checkDate = new Date();
                checkDate.setHours(0, 0, 0, 0);
                const safetyMax = 3650;
                let safety = 0;

                while (tempBacklog > 0 && safety < safetyMax) {
                    if (!isDatePaused(checkDate, workingPauses)) {
                        const activeQuotas = getActiveQuotasForDate(checkDate);
                        const quota = getQuotaForDate(checkDate, activeQuotas);

                        if (quota > 0) {
                            tempBacklog -= quota;
                            bDays++;
                        }
                    }
                    checkDate.setDate(checkDate.getDate() - 1);
                    safety++;
                    if (checkDate.toISOString().split('T')[0] < startStr) break;
                }
            } else if (totalAdelantoItems > 0) {
                let tempAdelanto = totalAdelantoItems;
                let checkDate = new Date();
                checkDate.setHours(0, 0, 0, 0);
                checkDate.setDate(checkDate.getDate() + 1); // Start checking from tomorrow
                const safetyMax = 3650;
                let safety = 0;

                while (tempAdelanto > 0 && safety < safetyMax) {
                    if (!isDatePaused(checkDate, workingPauses)) {
                        const activeQuotas = getActiveQuotasForDate(checkDate);
                        const quota = getQuotaForDate(checkDate, activeQuotas);

                        if (quota > 0) {
                            tempAdelanto -= quota;
                            adelantoDays++;
                        }
                    }
                    checkDate.setDate(checkDate.getDate() + 1);
                    safety++;
                }
            }
            totalBacklogDays = Math.ceil(bDays);
            setHeaderBacklog({ days: totalBacklogDays, items: totalBacklogItems, adelantoDays: Math.ceil(adelantoDays), adelantoItems: totalAdelantoItems });
        } else {
            // Global without category
            let globalAdelantoDays = 0;
            let globalAdelantoItems = 0;
            seriesList.forEach(s => {
                const b = calculateBacklogCount(s);
                totalBacklogItems += b.items;
                if (s.frequency) totalBacklogDays += Math.ceil(b.items / s.frequency);
                
                globalAdelantoItems += b.adelantoItems;
                if (s.frequency) globalAdelantoDays += Math.ceil(b.adelantoItems / s.frequency);
            });
            setHeaderBacklog({ days: totalBacklogDays, items: totalBacklogItems, adelantoDays: globalAdelantoDays, adelantoItems: globalAdelantoItems });
        }
    };


    const calculateQuotasPassed = (startStr, currentQuotas, history = []) => {
        if (!startStr) return 0;
        const now = new Date();
        now.setHours(0, 0, 0, 0);
        const [y, m, d] = startStr.split('-').map(Number);
        const current = new Date(y, m - 1, d);
        if (current > now) return 0;
        let total = 0;
        const dayMap = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const pauses = category?.pauses || [];
        while (current <= now) {
            if (!isDatePaused(current, pauses)) {
                const dayName = dayMap[current.getDay()];
                const dStr = current.toISOString().split('T')[0];
                
                let activeQuotas = null;
                if (history && history.length > 0) {
                    const record = history.find(h => dStr >= h.start_date && dStr <= (h.end_date || '9999-12-31'));
                    if (record) activeQuotas = record.quotas;
                }

                if (!activeQuotas) {
                    if (dStr < startStr) {
                        activeQuotas = {};
                    } else {
                        activeQuotas = {};
                        try {
                            const parsed = typeof currentQuotas === 'string' ? JSON.parse(currentQuotas || '[]') : currentQuotas;
                            if (Array.isArray(parsed)) {
                                parsed.forEach(day => { activeQuotas[day] = category?.frequency || 0; });
                            } else if (parsed && typeof parsed === 'object') {
                                activeQuotas = { ...parsed };
                            }
                        } catch (e) {}
                    }
                }
                total += activeQuotas[dayName] || 0;
            }
            current.setDate(current.getDate() + 1);
        }
        return total;
    };

    const isDatePaused = (date, pauses) => {
        if (!pauses || pauses.length === 0) return false;
        const dStr = date.toISOString().split('T')[0];
        return pauses.some(p => {
            const start = p.pause_start;
            const end = p.pause_end || '9999-12-31';
            return dStr >= start && dStr <= end;
        });
    };

    const calculateScheduleDays = (startStr, daysOfWeek, history = []) => {
        if (!startStr) return { validDays: 0 };
        
        const now = new Date();
        now.setHours(0, 0, 0, 0);
        const [y, m, d] = startStr.split('-').map(Number);
        const start = new Date(y, m - 1, d);
        if (start > now) return { validDays: 0 };
        
        let count = 0;
        let current = new Date(start);
        const pauses = category?.pauses || [];
        const dayMap = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

        while (current <= now) {
            if (!isDatePaused(current, pauses)) {
                const dStr = current.toISOString().split('T')[0];
                let activeQuotas = null;

                if (history && history.length > 0) {
                    const record = history.find(h => dStr >= h.start_date && dStr <= (h.end_date || '9999-12-31'));
                    if (record) activeQuotas = record.quotas;
                }

                if (!activeQuotas) {
                    if (dStr < startStr) {
                        activeQuotas = [];
                    } else {
                        try {
                            activeQuotas = typeof daysOfWeek === 'string' ? JSON.parse(daysOfWeek || '[]') : daysOfWeek;
                        } catch (e) { activeQuotas = []; }
                    }
                }

                const dayName = dayMap[current.getDay()];
                if (Array.isArray(activeQuotas)) {
                    if (activeQuotas.includes(dayName)) count++;
                } else if (activeQuotas && activeQuotas[dayName] > 0) {
                    count++;
                }
            }
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
        const diff = targetCount - watchedSinceStart;
        return { 
            items: Math.max(0, diff), 
            adelantoItems: Math.max(0, -diff) 
        };
    };

    const generateInterleavedList = (seriesList) => {
        let allEpisodes = [];
        seriesList.forEach((series, sIndex) => {
            const seriesEpisodes = generateEpisodesForSeries(series);
            const baseCount = getWatchedCountSinceStart(series);
            seriesEpisodes.forEach((ep, index) => {
                const BATCH_SIZE = 1000000;
                // Use (baseCount + index) to align with global cycle
                ep.interleavedOrder = ((baseCount + index) * BATCH_SIZE + sIndex);
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
        if (status === 'Terminado' || status === 'En espera' || status === 'Pausado') return [];
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
        const res = await db.updateSeriesProgress(item.seriesId, item.season, item.episode, null, null, 0);
        if (res.success) loadData();
    };

    const renderItem = ({ item, index }) => {
        const isW = item.status === 'watched';
        const isB = !isW && headerBacklog && index < headerBacklog.items;
        return (
            <View style={[styles.card, { backgroundColor: theme.card, borderLeftColor: isB ? '#EF6C00' : 'transparent', paddingVertical: 12 }, isB && { backgroundColor: isDarkMode ? '#3e2723' : '#FFFDE7' }]}>
                <View style={styles.cardContent}>
                    {/* Series Name - Top Row */}
                    <Text
                        style={[styles.seriesName, { color: theme.text, fontSize: 17, marginBottom: 4 }]}
                    >
                        {item.seriesName}
                    </Text>

                    {/* Metadata Row */}
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <Text style={[styles.episodeInfo, { color: theme.subText, marginTop: 0 }]}>
                            T{item.season} - E{item.episode}
                        </Text>
                        {isB && (
                            <View style={[styles.backlogBadge, { marginLeft: 10, marginTop: 0 }]}>
                                <Text style={styles.backlogBadgeText}>ATRASO</Text>
                            </View>
                        )}
                    </View>

                    {isW && (
                        <Text style={[styles.watchedLabel, { marginTop: 4 }]}>
                            Visto el {new Date(item.watchedAt).toLocaleDateString()}
                        </Text>
                    )}
                </View>

                {/* Action Button */}
                <View style={{ marginLeft: 10 }}>
                    {!isW ? (
                        <TouchableOpacity
                            style={[styles.checkButton, { backgroundColor: isB ? (isDarkMode ? '#5d4037' : '#FFF3E0') : theme.inputBackground }]}
                            onPress={() => onMarkWatched(item)}
                        >
                            <Text style={[styles.checkText, isB && { color: '#EF6C00' }]}>✓</Text>
                        </TouchableOpacity>
                    ) : (
                        index === 0 ? (
                            <TouchableOpacity
                                style={[styles.checkButton, { backgroundColor: '#FFEBEE' }]}
                                onPress={() => onUnmarkWatched(item)}
                            >
                                <Text style={[styles.checkText, { color: '#F44336' }]}>✕</Text>
                            </TouchableOpacity>
                        ) : <View style={{ width: 40 }} />
                    )}
                </View>
            </View >
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
                            <Text style={[styles.headerSubtitle, (headerBacklog.days <= 0 && headerBacklog.items <= 0 && headerBacklog.adelantoItems <= 0) && { color: '#4CAF50' }, headerBacklog.adelantoItems > 0 && { color: '#2E7D32' }]}>
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
