import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, FlatList, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import db from '../services/db';

export default function ReadingRegistryScreen({ user, category, onBack }) {
    const [items, setItems] = useState([]);
    const [historyGroups, setHistoryGroups] = useState([]);
    const [loading, setLoading] = useState(true);
    const [currentTab, setCurrentTab] = useState('pending'); // 'pending' | 'watched'
    const [rawSeries, setRawSeries] = useState([]);
    const [backlogInfo, setBacklogInfo] = useState({ items: 0, days: 0 });
    const [counts, setCounts] = useState({ pending: 0, watched: 0 });

    const loadData = useCallback(async () => {
        setLoading(true);
        try {
            const [seriesResult, historyResult] = await Promise.all([
                db.getFullWatchlist(category ? category.id : null),
                db.getReadingHistory(category ? category.id : null)
            ]);

            if (seriesResult.success) {
                setRawSeries(seriesResult.data);

                // Backlog Calculation
                const freq = category.frequency;
                const startStr = category.start_date;
                const daysOfWeek = category.days_of_week;

                const getValidDays = (sDate, dOfWeek) => {
                    if (!sDate) return 0;
                    const now = new Date(); now.setHours(0, 0, 0, 0);
                    const [y, m, d] = sDate.split('-').map(Number);
                    const start = new Date(y, m - 1, d);
                    if (start > now) return 0;
                    let c = 0; let curr = new Date(start);
                    while (curr <= now) {
                        const dayName = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][curr.getDay()];
                        if (dOfWeek.includes(dayName) || (Array.isArray(dOfWeek) && dOfWeek.includes(dayName))) c++;
                        curr.setDate(curr.getDate() + 1);
                    }
                    return c;
                };

                const validDays = getValidDays(startStr, daysOfWeek);
                let targetTotal = 0;
                if (freq > 0) targetTotal = validDays * freq;
                else if (freq < 0) targetTotal = Math.floor(validDays / Math.abs(freq));

                let totalRead = 0;
                seriesResult.data.forEach(s => {
                    const getAbs = (sn, en) => {
                        let c = 0;
                        for (let i = 1; i < sn; i++) {
                            const sea = s.seasons.find(se => se.season_number === i);
                            c += sea ? sea.episode_count : 0;
                        }
                        return c + (en - 1);
                    };
                    const diff = getAbs(s.current_season, s.current_episode) - getAbs(s.initial_season || 1, s.initial_episode || 1);
                    totalRead += (diff > 0 ? diff : 0) + (s.cycle_offset || 0) + (s.status === 'Terminado' || s.status === 'En espera' ? 1 : 0);
                });

                const backlogItems = Math.max(0, targetTotal - totalRead);
                setBacklogInfo({
                    items: backlogItems,
                    days: freq > 0 ? Math.ceil(backlogItems / freq) : backlogItems * Math.abs(freq)
                });

                const pendingList = generateInterleavedList(seriesResult.data);

                let watchedList = [];
                if (historyResult.success) {
                    watchedList = historyResult.data.map(h => ({
                        uniqueId: `${h.series_id}-s${h.season_number}-e${h.episode_number}-rh${h.id}`,
                        seriesId: h.series_id,
                        seriesName: h.s_name,
                        season: h.season_number,
                        episode: h.episode_number,
                        status: 'watched',
                        readAt: h.read_at
                    }));
                }

                setCounts({
                    pending: pendingList.length,
                    watched: watchedList.length
                });

                setItems(currentTab === 'pending' ? pendingList : watchedList);
            }
        } catch (error) {
            console.error("Error loading registry data:", error);
        } finally {
            setLoading(false);
        }
    }, [category, currentTab]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    const generateInterleavedList = (seriesList) => {
        let allEpisodes = [];
        const activeSeriesCount = seriesList.length || 1;

        seriesList.forEach((series, sIndex) => {
            // For reading, if status is Finished/Wait, no pending.
            if (series.status === 'Terminado' || series.status === 'En espera') return;

            const episodes = generateEpisodesForSeries(series);

            episodes.forEach((ep, index) => {
                const BATCH_SIZE = 1000000;
                // Interleaving formula: (Position * TotalSeries) + SeriesPriorityIndex
                ep.interleavedOrder = (index * BATCH_SIZE) + sIndex;
                ep.sortOrder = series.sort_order || 0;
                allEpisodes.push(ep);
            });
        });

        // Sort by interleaved order
        allEpisodes.sort((a, b) => {
            if (a.interleavedOrder !== b.interleavedOrder) return a.interleavedOrder - b.interleavedOrder;
            return a.sortOrder - b.sortOrder;
        });

        return allEpisodes;
    };

    const generateEpisodesForSeries = (series) => {
        const episodes = [];
        let { current_season, current_episode, total_seasons } = series;

        let s = current_season || 1;
        let e = current_episode || 1;
        let count = 0;

        const maxSeason = total_seasons || (series.seasons?.length > 0 ? series.seasons[series.seasons.length - 1].season_number : 1);

        while (s <= maxSeason && count < 1000) {
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

    const onMarkWatched = async (item) => {
        const series = rawSeries.find(s => s.s_id === item.seriesId);
        if (!series) return;

        // Check order within this series
        const firstPending = items.find(i => i.seriesId === item.seriesId && i.status === 'pending');
        if (firstPending && firstPending.uniqueId !== item.uniqueId) {
            Alert.alert('Orden incorrecto', `Para ${item.seriesName}, debes leer primero el Tomo ${firstPending.episode}.`);
            return;
        }

        const currentSeasonObj = series.seasons.find(s => s.season_number === item.season);
        const maxEpisodes = currentSeasonObj ? currentSeasonObj.episode_count : 999;

        let nextS = item.season;
        let nextE = item.episode + 1;
        let isFinal = false;

        if (nextE > maxEpisodes) {
            if (item.season >= series.total_seasons) {
                isFinal = true;
                nextE = item.episode;
                nextS = item.season;
            } else {
                nextE = 1;
                nextS++;
            }
        }

        const performUpdate = async (newStatus = 'Mirando') => {
            // Add to history
            await db.addReadingHistory(item.seriesId, item.season, item.episode);
            // Update progress
            const result = await db.updateSeriesProgress(item.seriesId, nextS, nextE, newStatus);
            if (result.success) {
                loadData();
            }
        };

        if (isFinal) {
            Alert.alert('¡Lectura Completada!', 'Has llegado al final. ¿A dónde quieres moverla?', [
                { text: 'En espera', onPress: () => performUpdate('En espera') },
                { text: 'Terminado', onPress: () => performUpdate('Terminado') },
                { text: 'Cancelar', style: 'cancel' }
            ]);
        } else {
            performUpdate('Mirando');
        }
    };

    const onUnmarkWatched = async (item) => {
        await db.removeReadingHistory(item.seriesId, item.season, item.episode);
        // Desmarcar forzado al principio (sort_order = 1)
        const result = await db.updateSeriesProgress(item.seriesId, item.season, item.episode, null, 1);
        if (result.success) {
            loadData();
        }
    };

    const renderItem = ({ item, index }) => {
        const isWatched = item.status === 'watched';
        const isBacklogItem = !isWatched && backlogInfo.items > 0 && index < backlogInfo.items;

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
                    <Text style={[styles.episodeInfo, isBacklogItem && { color: '#EF6C00' }]}>
                        {category?.total_seasons > 1 || item.season > 1 ? `Parte ${item.season} - ` : ''}Tomo {item.episode}
                    </Text>
                    {isWatched && <Text style={styles.watchedLabel}>Leído el {new Date(item.readAt).toLocaleDateString()}</Text>}
                </View>

                {!isWatched ? (
                    <TouchableOpacity style={[styles.checkButton, isBacklogItem && { backgroundColor: '#FFF3E0' }]} onPress={() => onMarkWatched(item)}>
                        <Text style={[styles.checkText, isBacklogItem && { color: '#EF6C00' }]}>✓</Text>
                    </TouchableOpacity>
                ) : (
                    index === 0 ? (
                        <TouchableOpacity style={[styles.checkButton, { backgroundColor: '#FFEBEE' }]} onPress={() => onUnmarkWatched(item)}>
                            <Text style={[styles.checkText, { color: '#F44336' }]}>✕</Text>
                        </TouchableOpacity>
                    ) : (
                        <View style={{ width: 40 }} />
                    )
                )}
            </View>
        );
    };

    return (
        <SafeAreaView style={styles.container}>
            <StatusBar style="dark" />
            <View style={styles.header}>
                <TouchableOpacity onPress={onBack} style={styles.backButton}>
                    <Text style={styles.backStatus}>←</Text>
                </TouchableOpacity>
                <View style={{ flex: 1, alignItems: 'center' }}>
                    <Text style={styles.headerTitle}>Registro - {category?.name || 'Lectura'}</Text>
                    {backlogInfo.items <= 0 && !loading && <Text style={styles.allDone}>¡Estás al día! 🎉</Text>}
                    {backlogInfo.items > 0 && !loading && <Text style={[styles.allDone, { color: '#EF6C00' }]}>Atraso: {backlogInfo.items} Tomos</Text>}
                </View>
                <View style={{ width: 40 }} />
            </View>

            <View style={styles.tabBar}>
                <TouchableOpacity style={[styles.tab, currentTab === 'pending' && styles.activeTab]} onPress={() => setCurrentTab('pending')}>
                    <Text style={[
                        styles.tabText,
                        currentTab === 'pending' && styles.activeTabText,
                        (currentTab === 'pending' && backlogInfo.items > 0) && { color: '#EF6C00' }
                    ]}>
                        Pendientes ({counts.pending})
                    </Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.tab, currentTab === 'watched' && styles.activeTab]} onPress={() => setCurrentTab('watched')}>
                    <Text style={[styles.tabText, currentTab === 'watched' && styles.activeTabText]}>Leídos ({counts.watched})</Text>
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
                            <Text style={styles.emptyText}>{currentTab === 'pending' ? 'No tienes tomos pendientes.' : 'No hay historial de lectura.'}</Text>
                            {currentTab === 'pending' && <Text style={{ fontSize: 40, marginTop: 20 }}>🥳</Text>}
                        </View>
                    }
                />
            )}
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#F8F9FA' },
    header: { flexDirection: 'row', alignItems: 'center', padding: 15, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#eee' },
    backButton: { padding: 5 },
    backStatus: { fontSize: 24, color: '#333' },
    headerTitle: { fontSize: 18, fontWeight: 'bold' },
    allDone: { fontSize: 12, color: '#4CAF50', fontWeight: 'bold' },
    tabBar: { flexDirection: 'row', padding: 10, backgroundColor: '#fff' },
    tab: { flex: 1, paddingVertical: 10, alignItems: 'center', marginHorizontal: 5, borderRadius: 8, backgroundColor: '#F0F2F5' },
    activeTab: { backgroundColor: '#E3F2FD' },
    tabText: { fontWeight: '600', color: '#666' },
    activeTabText: { color: '#2196F3' },
    list: { padding: 15 },
    card: {
        flexDirection: 'row', backgroundColor: '#fff', borderRadius: 12, padding: 15,
        marginBottom: 10, alignItems: 'center', elevation: 2, shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.1, shadowRadius: 2,
        borderLeftWidth: 5, borderLeftColor: 'transparent'
    },
    backlogCard: {
        backgroundColor: '#FFFDE7',
        borderLeftColor: '#EF6C00'
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
    episodeInfo: { fontSize: 14, color: '#2196F3', fontWeight: '600', marginTop: 2 },
    watchedLabel: { fontSize: 11, color: '#999', marginTop: 4 },
    checkButton: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#E8F5E9', justifyContent: 'center', alignItems: 'center' },
    checkText: { color: '#4CAF50', fontSize: 20, fontWeight: 'bold' },
    emptyContainer: { alignItems: 'center', marginTop: 100 },
    emptyText: { color: '#999', fontSize: 16, textAlign: 'center' }
});
