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

export default function ChapterRegistryScreen({ user, category, onBack }) {
    const [loading, setLoading] = useState(true);
    const [items, setItems] = useState([]); // The interleaved list
    const [tab, setTab] = useState('pending'); // 'pending' | 'watched'
    const [counts, setCounts] = useState({ pending: 0, watched: 0 });
    const [rawSeries, setRawSeries] = useState([]);
    const [headerBacklog, setHeaderBacklog] = useState(null);

    useEffect(() => {
        loadData();
    }, [tab]);

    const loadData = async () => {
        setLoading(true);
        // Pass category ID if available
        const result = await db.getFullWatchlist(user.id, category ? category.id : null);

        if (result.success) {
            setRawSeries(result.data);
            calculateGlobalBacklog(result.data);

            // Generate both lists to get counts
            const pendingList = generateInterleavedList(result.data, 'pending');
            const watchedList = generateInterleavedList(result.data, 'watched');

            setCounts({
                pending: pendingList.length,
                watched: watchedList.length
            });

            setItems(tab === 'pending' ? pendingList : watchedList);
        }
        setLoading(false);
    };

    const calculateGlobalBacklog = (seriesList) => {
        let totalBacklogDays = 0;
        let totalBacklogItems = 0;

        if (category) {
            // Single Category Mode
            const { start_date, frequency, days_of_week } = category;

            const scheduleCalc = calculateScheduleDays(start_date, days_of_week);
            const targetTotal = scheduleCalc.validDays * frequency;

            // Calculate Actual Watched Total (Since Start) across all series
            let totalWatchedSinceStart = 0;
            seriesList.forEach(s => {
                totalWatchedSinceStart += getWatchedCountSinceStart(s);
            });

            totalBacklogItems = targetTotal - totalWatchedSinceStart;
            if (totalBacklogItems < 0) totalBacklogItems = 0;

            // Days based on items
            totalBacklogDays = Math.ceil(totalBacklogItems / frequency);

        } else {
            // Global Mode
            seriesList.forEach(s => {
                const b = calculateBacklogCount(s);
                totalBacklogItems += b;
                if (s.frequency) {
                    totalBacklogDays += Math.ceil(b / s.frequency);
                }
            });
        }

        setHeaderBacklog({ days: totalBacklogDays, items: totalBacklogItems });
    };

    const calculateScheduleDays = (startStr, daysOfWeek) => {
        if (!startStr) return { validDays: 0 };
        let daysArray = [];
        try {
            daysArray = typeof daysOfWeek === 'string' ? JSON.parse(daysOfWeek) : daysOfWeek;
        } catch (e) { daysArray = []; }

        const now = new Date();
        now.setHours(0, 0, 0, 0);
        const [y, m, d] = startStr.split('-').map(Number);
        const start = new Date(y, m - 1, d);

        if (start > now) return { validDays: 0 };

        let count = 0;
        let current = new Date(start);
        while (current <= now) {
            const dayIndex = current.getDay();
            const dayMap = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
            const dayName = dayMap[dayIndex];
            if (daysArray.includes(dayName)) count++;
            current.setDate(current.getDate() + 1);
        }
        return { validDays: count };
    };

    const getWatchedCountSinceStart = (series) => {
        const currentAbsolute = getAbsoluteEpisodeCount(series, series.current_season, series.current_episode);
        const initS = series.initial_season || 1;
        const initE = series.initial_episode || 1;
        const initialAbsolute = getAbsoluteEpisodeCount(series, initS, initE);
        let diff = currentAbsolute - initialAbsolute;
        return diff < 0 ? 0 : diff;
    };

    const getAbsoluteEpisodeCount = (series, seasonNum, episodeNum) => {
        let count = 0;
        for (let i = 1; i < seasonNum; i++) {
            const sobj = series.seasons.find(sea => sea.season_number === i);
            count += sobj ? sobj.episode_count : 0;
        }
        count += episodeNum;
        return count;
    };

    const generateInterleavedList = (seriesList, currentTab) => {
        let allEpisodes = [];

        seriesList.forEach(series => {
            const seriesEpisodes = generateEpisodesForSeries(series, currentTab);

            // Calculamos el rango base según el tipo de tab
            // Para 'pending', el primer item es el progreso actual.
            // Para 'watched', el primer item es el inicio (capítulo 1).
            const baseOffset = currentTab === 'pending' ? getWatchedCountSinceStart(series) : 0;
            const cycleOffset = series.cycle_offset || 0;

            seriesEpisodes.forEach((ep, index) => {
                // Asignamos el rango global para poder intercalar series
                ep.globalRank = baseOffset + cycleOffset + index;
                ep.sortOrder = series.sort_order || 0;
                allEpisodes.push(ep);
            });
        });

        if (currentTab === 'pending') {
            // Pendientes: El que tiene menor rango (el más viejo/atrasado) va primero
            allEpisodes.sort((a, b) => {
                if (a.globalRank !== b.globalRank) return a.globalRank - b.globalRank;
                return a.sortOrder - b.sortOrder;
            });
        } else {
            // Vistos: El que tiene mayor rango (el más reciente/adelantado) va primero
            // Dentro del mismo turno de ciclo, el de mayor prioridad va arriba (fue el último del ciclo)
            allEpisodes.sort((a, b) => {
                if (a.globalRank !== b.globalRank) return b.globalRank - a.globalRank;
                return b.sortOrder - a.sortOrder;
            });
        }

        return allEpisodes;
    };

    const generateEpisodesForSeries = (series, currentTab) => {
        const episodes = [];

        if (currentTab === 'watched') {
            const initS = series.initial_season || 1;
            const initE = series.initial_episode || 1;
            let s = initS;
            let e = initE;
            const endS = series.current_season;
            const endE = series.current_episode;
            let loopCount = 0;

            while ((s < endS || (s === endS && e < endE)) && loopCount < 5000) {
                const seasonObj = series.seasons.find(sea => sea.season_number === s);
                const maxEp = seasonObj ? seasonObj.episode_count : 999;

                episodes.push({
                    uniqueId: `${series.s_id}-s${s}-e${e}-watched`,
                    seriesId: series.s_id,
                    seriesName: series.s_name,
                    season: s,
                    episode: e,
                    status: 'watched'
                });

                e++;
                if (e > maxEp) {
                    e = 1;
                    s++;
                }
                loopCount++;
            }
            return episodes; // NO REVERSE AQUÍ, el sort global se encarga
        }

        let limit = Infinity;
        if (currentTab === 'pending') {
            const backlogCalc = calculateBacklogCount(series);
            if (backlogCalc <= 0) return [];
            limit = backlogCalc;
        }

        let { current_season, current_episode, total_seasons } = series;
        let count = 0;
        let s = current_season;
        let e = current_episode;

        while (s <= total_seasons && count < limit) {
            const seasonObj = series.seasons.find(sea => sea.season_number === s);
            const maxEp = seasonObj ? seasonObj.episode_count : 999;

            episodes.push({
                uniqueId: `${series.s_id}-s${s}-e${e}`,
                seriesId: series.s_id,
                seriesName: series.s_name,
                season: s,
                episode: e,
                status: 'pending'
            });

            count++;
            e++;
            if (e > maxEp) {
                e = 1;
                s++;
            }
        }

        return episodes;
    };

    const calculateBacklogCount = (series) => {
        if (!series.start_date || !series.frequency) return 0;
        const calc = calculateScheduleDays(series.start_date, series.days_of_week);
        const targetCount = calc.validDays * series.frequency;
        const watchedSinceStart = getWatchedCountSinceStart(series);
        const backlog = targetCount - watchedSinceStart;
        return backlog > 0 ? backlog : 0;
    };

    const onMarkWatched = async (item) => {
        const series = rawSeries.find(s => s.s_id === item.seriesId);
        if (!series) return;

        // VALIDACIÓN: Verificar si este item es el PRIMER episodio pendiente de ESTA serie en la lista actual
        const firstOccurrenceOfThisSeries = items.find(i => i.seriesId === item.seriesId && i.status === 'pending');

        if (firstOccurrenceOfThisSeries && firstOccurrenceOfThisSeries.uniqueId !== item.uniqueId) {
            Alert.alert(
                'Orden incorrecto',
                `Para ${item.seriesName}, debes ver primero el capítulo T${firstOccurrenceOfThisSeries.season} - E${firstOccurrenceOfThisSeries.episode}.`
            );
            return;
        }

        const currentSeasonObj = series.seasons.find(s => s.season_number === item.season);
        const maxEpisodes = currentSeasonObj ? currentSeasonObj.episode_count : 999;

        let nextS = item.season;
        let nextE = item.episode + 1;
        let isFinalEpisode = false;

        if (nextE > maxEpisodes) {
            if (item.season >= series.total_seasons) {
                // Era el último capítulo de la última temporada
                isFinalEpisode = true;
                nextE = item.episode;
                nextS = item.season;
            } else {
                nextE = 1;
                nextS++;
            }
        }

        const performUpdate = async (newStatus = 'Mirando') => {
            const result = await db.updateSeriesProgress(item.seriesId, nextS, nextE, newStatus);
            if (result.success) {
                loadData();
            }
        };

        if (isFinalEpisode) {
            Alert.alert(
                '¡Serie Completada!',
                'Has llegado al final de esta serie. ¿A dónde quieres moverla?',
                [
                    { text: 'En espera (Próx. temp)', onPress: () => performUpdate('En espera') },
                    { text: 'Terminado (Fin total)', onPress: () => performUpdate('Terminado') },
                    { text: 'Cancelar', style: 'cancel' }
                ]
            );
        } else {
            performUpdate('Mirando');
        }
    };

    const onUnmarkWatched = async (item) => {
        const result = await db.updateSeriesProgress(item.seriesId, item.season, item.episode);
        if (result.success) {
            loadData();
        }
    };

    const renderItem = ({ item, index }) => {
        const isWatched = item.status === 'watched';
        // Determinar si este ítem es parte del atraso (solo en pestaña pendientes)
        const isBacklogItem = !isWatched && headerBacklog && index < headerBacklog.items;

        return (
            <View style={[styles.card, isBacklogItem && styles.backlogCard]}>
                <View style={styles.cardContent}>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <Text style={styles.seriesName}>{item.seriesName}</Text>
                        {isBacklogItem && (
                            <View style={styles.backlogBadge}>
                                <Text style={styles.backlogBadgeText}>ATRASO</Text>
                            </View>
                        )}
                    </View>
                    <Text style={styles.episodeInfo}>T{item.season} - E{item.episode}</Text>
                    {isWatched && <Text style={styles.watchedLabel}>Visto</Text>}
                </View>
                {!isWatched ? (
                    <TouchableOpacity
                        style={[styles.checkButton, isBacklogItem && { backgroundColor: '#FFF3E0' }]}
                        onPress={() => onMarkWatched(item)}
                    >
                        <Text style={[styles.checkText, isBacklogItem && { color: '#EF6C00' }]}>✓</Text>
                    </TouchableOpacity>
                ) : (
                    <TouchableOpacity
                        style={[styles.checkButton, { backgroundColor: '#FFEBEE' }]}
                        onPress={() => onUnmarkWatched(item)}
                    >
                        <Text style={[styles.checkText, { color: '#F44336' }]}>✕</Text>
                    </TouchableOpacity>
                )}
            </View>
        );
    };

    return (
        <SafeAreaView style={styles.container}>
            <StatusBar style="dark" />
            <View style={styles.header}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <TouchableOpacity onPress={onBack} style={styles.backButton}>
                        <Text style={styles.backButtonText}>←</Text>
                    </TouchableOpacity>
                    <View style={{ marginLeft: 10 }}>
                        <Text style={styles.headerTitle}>Registro - {category ? category.name : 'Global'}</Text>
                        {headerBacklog && (
                            <Text style={styles.headerSubtitle}>
                                Atraso: {headerBacklog.days} días, {headerBacklog.items} Caps
                            </Text>
                        )}
                    </View>
                </View>
            </View>

            <View style={styles.tabContainer}>
                <TouchableOpacity
                    style={[styles.tab, tab === 'pending' && styles.tabActive]}
                    onPress={() => setTab('pending')}
                >
                    <Text style={[styles.tabText, tab === 'pending' && styles.tabTextActive]}>
                        Pendientes ({counts.pending})
                    </Text>
                </TouchableOpacity>
                <TouchableOpacity
                    style={[styles.tab, tab === 'watched' && styles.tabActive]}
                    onPress={() => setTab('watched')}
                >
                    <Text style={[styles.tabText, tab === 'watched' && styles.tabTextActive]}>
                        Vistos ({counts.watched})
                    </Text>
                </TouchableOpacity>
            </View>

            {loading ? (
                <ActivityIndicator size="large" color="#2196F3" style={{ marginTop: 50 }} />
            ) : (
                <FlatList
                    data={items}
                    keyExtractor={item => item.uniqueId}
                    renderItem={renderItem}
                    contentContainerStyle={styles.list}
                    ListEmptyComponent={
                        <Text style={styles.emptyText}>
                            {tab === 'watched' ? 'No has visto ningún capítulo aún.' : 'No hay capítulos pendientes.'}
                        </Text>
                    }
                />
            )}
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#F5F5F5' },
    header: {
        paddingHorizontal: 15, paddingVertical: 15, backgroundColor: '#fff', borderBottomWidth: 1, borderColor: '#eee'
    },
    backButton: { padding: 5 },
    backButtonText: { fontSize: 24, color: '#333' },
    headerTitle: { fontSize: 18, fontWeight: 'bold' },
    headerSubtitle: { fontSize: 13, color: '#EF6C00', fontWeight: 'bold', marginTop: 2 },

    tabContainer: { flexDirection: 'row', backgroundColor: '#fff', padding: 5, margin: 15, borderRadius: 10 },
    tab: { flex: 1, padding: 10, alignItems: 'center', borderRadius: 8 },
    tabActive: { backgroundColor: '#E3F2FD' },
    tabText: { color: '#666', fontWeight: '600' },
    tabTextActive: { color: '#2196F3', fontWeight: 'bold' },

    list: { paddingHorizontal: 15 },
    card: {
        backgroundColor: '#fff', padding: 15, borderRadius: 12, marginBottom: 10,
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        shadowColor: '#000', shadowOffset: { height: 2 }, shadowOpacity: 0.1, elevation: 2,
        borderLeftWidth: 5, borderLeftColor: 'transparent'
    },
    backlogCard: {
        backgroundColor: '#FFFDE7', // Un amarillo muy tenue
        borderLeftColor: '#EF6C00', // El naranja de atraso en el borde izquierdo
    },
    backlogBadge: {
        backgroundColor: '#EF6C00',
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 4,
        marginLeft: 8
    },
    backlogBadgeText: {
        color: '#fff',
        fontSize: 10,
        fontWeight: 'bold'
    },
    cardContent: { flex: 1 },
    seriesName: { fontSize: 16, fontWeight: 'bold', color: '#333' },
    episodeInfo: { fontSize: 14, color: '#666', marginTop: 4 },
    watchedLabel: { fontSize: 12, color: '#4CAF50', fontWeight: 'bold', marginTop: 2 },

    checkButton: {
        width: 40, height: 40, borderRadius: 20, backgroundColor: '#E8F5E9',
        alignItems: 'center', justifyContent: 'center'
    },
    checkText: { fontSize: 20, color: '#4CAF50', fontWeight: 'bold' },

    emptyText: { textAlign: 'center', marginTop: 50, color: '#999' }
});
