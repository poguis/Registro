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
        const [watchlistResult, historyResult] = await Promise.all([
            db.getFullWatchlist(user.id, category ? category.id : null),
            db.getHistory(category ? category.id : null)
        ]);

        if (watchlistResult.success) {
            setRawSeries(watchlistResult.data);
            calculateGlobalBacklog(watchlistResult.data);

            // Generate pending list (interleaved)
            const pendingList = generateInterleavedList(watchlistResult.data);

            // Generate watched list directly from history
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

        // Ajuste para series terminadas/espera: el contador se queda en el último capítulo
        // PERO si vuelve a 'Mirando', ya NO debemos sumar 1 porque el puntero ahora sí apunta al SIGUIENTE.
        if (series.status === 'Terminado' || series.status === 'En espera') {
            diff += 1;
        }

        // INCLUIMOS cycle_offset porque ahora almacena historial de reinicios.
        const cleanDiff = diff < 0 ? 0 : diff;
        return cleanDiff + (series.cycle_offset || 0);
    };

    const getAbsoluteEpisodeCount = (series, seasonNum, episodeNum) => {
        let count = 0;
        for (let i = 1; i < seasonNum; i++) {
            const sobj = series.seasons.find(sea => sea.season_number === i);
            count += sobj ? sobj.episode_count : 0;
        }
        // Restamos 1 porque el puntero indica el SIGUIENTE a ver, no el total visto.
        // Si estoy en T1 E1, he visto 0 capítulos de esta serie.
        count += (episodeNum - 1);
        return count;
    };

    const generateInterleavedList = (seriesList) => {
        let allEpisodes = [];
        const activeSeriesCount = seriesList.length || 1;

        seriesList.forEach((series, sIndex) => {
            const seriesEpisodes = generateEpisodesForSeries(series);

            seriesEpisodes.forEach((ep, index) => {
                // Cálculo de Ranking PENDIENTES:
                // Solo importa el índice local para intercalado perfecto.
                // Todos compiten por el turno "siguiente".
                const BATCH_SIZE = 1000000;
                let orderScore = index;

                ep.interleavedOrder = (orderScore * BATCH_SIZE + sIndex);
                ep.sortOrder = series.sort_order || 0;
                allEpisodes.push(ep);
            });
        });

        // PENDIENTES: Orden intercalado + manual
        allEpisodes.sort((a, b) => {
            if (a.interleavedOrder !== b.interleavedOrder) return a.interleavedOrder - b.interleavedOrder;
            return a.sortOrder - b.sortOrder;
        });

        return allEpisodes;
    };

    const generateEpisodesForSeries = (series) => {
        const episodes = [];
        let { current_season, current_episode, status, total_seasons } = series;

        // Si la serie está terminada o en espera, no tiene capítulos "pendientes" por ver
        if (status === 'Terminado' || status === 'En espera') {
            return [];
        }

        let count = 0;
        let s = current_season || 1;
        let e = current_episode || 1;

        // Fallback para total_seasons
        const maxSeason = total_seasons || (series.seasons && series.seasons.length > 0 ? series.seasons[series.seasons.length - 1].season_number : 1);

        // Mostramos TODO lo que queda pendiente de la serie (máximo 5000 por seguridad)
        while (s <= maxSeason && count < 5000) {
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
            // Guardamos historial primero
            await db.addHistory(item.seriesId, item.season, item.episode);
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
        // Borramos historial
        await db.removeHistory(item.seriesId, item.season, item.episode);
        // Al desmarcar, forzamos que la serie "salte" al principio de la lista de pendientes (sort_order = 1)
        const result = await db.updateSeriesProgress(item.seriesId, item.season, item.episode, null, 1);
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
                    {isWatched && <Text style={styles.watchedLabel}>Visto el {new Date(item.watchedAt).toLocaleDateString()}</Text>}
                </View>
                {!isWatched ? (
                    <TouchableOpacity
                        style={[styles.checkButton, isBacklogItem && { backgroundColor: '#FFF3E0' }]}
                        onPress={() => onMarkWatched(item)}
                    >
                        <Text style={[styles.checkText, isBacklogItem && { color: '#EF6C00' }]}>✓</Text>
                    </TouchableOpacity>
                ) : (
                    // Solo permitimos quitar el visto al PRIMERO de la lista (index 0)
                    index === 0 ? (
                        <TouchableOpacity
                            style={[styles.checkButton, { backgroundColor: '#FFEBEE' }]}
                            onPress={() => onUnmarkWatched(item)}
                        >
                            <Text style={[styles.checkText, { color: '#F44336' }]}>✕</Text>
                        </TouchableOpacity>
                    ) : (
                        <View style={{ width: 40 }} /> // Espaciador para mantener alineación visual
                    )
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
                            <Text style={[styles.headerSubtitle, (headerBacklog.days <= 0 && headerBacklog.items <= 0) && { color: '#4CAF50' }]}>
                                {(headerBacklog.days <= 0 && headerBacklog.items <= 0)
                                    ? '¡Estás al día! 🎉'
                                    : `Atraso: ${headerBacklog.days} días, ${headerBacklog.items} Caps`}
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
                        <View style={styles.emptyContainer}>
                            {tab === 'pending' ? (
                                (!headerBacklog || (headerBacklog.days <= 0 && headerBacklog.items <= 0)) ? (
                                    <>
                                        <Text style={[styles.emptyText, { fontSize: 32, marginBottom: 10 }]}>🎉</Text>
                                        <Text style={[styles.emptyText, { fontWeight: 'bold', fontSize: 18, marginBottom: 5 }]}>¡Estás al día!</Text>
                                        <Text style={[styles.emptyText, { fontSize: 14, opacity: 0.7 }]}>No tienes capítulos pendientes.</Text>
                                    </>
                                ) : (
                                    <Text style={styles.emptyText}>No hay capítulos pendientes</Text>
                                )
                            ) : (
                                <Text style={styles.emptyText}>No has visto ningún capítulo aún.</Text>
                            )}
                        </View>
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
