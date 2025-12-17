import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, FlatList, Modal, TextInput, Alert, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import db from '../services/db';

export default function SeriesDetailScreen({ user, category, onBack, onNavigateRegistry }) {
    const [seriesList, setSeriesList] = useState([]);
    const [modalVisible, setModalVisible] = useState(false);

    // Form State
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [status, setStatus] = useState('Nueva'); // 'Nueva' | 'Mirando'

    // Season State
    const [seasons, setSeasons] = useState([{ number: 1, episodes: '' }]); // Array of {number, episodes}

    // Progress State (Only for 'Mirando')
    const [currentSeason, setCurrentSeason] = useState(1);
    const [currentEpisode, setCurrentEpisode] = useState(1);
    const [backlogInfo, setBacklogInfo] = useState(null);

    const fetchSeries = async () => {
        if (category?.id) {
            try {
                // Fetch all series for the category (Status: Nueva, Mirando, Finished)
                const result = await db.getSeriesByCategory(category.id);

                if (result.success) {
                    const list = result.series;
                    // Enriched list with seasons for backlog calculation
                    const enrichedList = await Promise.all(list.map(async (series) => {
                        const seasonsRes = await db.getSeasonsBySeries(series.id);
                        return {
                            ...series,
                            seasons: seasonsRes.success ? seasonsRes.seasons : []
                        };
                    }));

                    setSeriesList(enrichedList);
                    calculateHeaderBacklog(enrichedList);
                }
            } catch (error) {
                console.error("Error fetching series:", error);
            }
        }
    };

    useEffect(() => {
        fetchSeries();
        // We can call calculateHeaderBacklog here but it depends on seriesList state which might be empty initially.
        // fetchSeries calls it with new data, so that covers it.
        // But if we want to recalc on category change? fetchSeries does it.
    }, [category]);

    const calculateHeaderBacklog = (currentSeriesList = seriesList) => {
        if (!currentSeriesList || !currentSeriesList.length) return;
        if (!category?.start_date || !category?.frequency) return;

        const startStr = category.start_date;
        const freq = category.frequency;
        const daysOfWeek = category.days_of_week;

        const scheduleCalc = calculateScheduleDays(startStr, daysOfWeek);
        const targetTotal = scheduleCalc.validDays * freq;

        let totalWatchedSinceStart = 0;
        currentSeriesList.forEach(s => {
            totalWatchedSinceStart += getWatchedCountSinceStart(s);
        });

        const totalBacklogItems = targetTotal - totalWatchedSinceStart;
        const backlogValue = totalBacklogItems < 0 ? 0 : totalBacklogItems;
        const backlogDays = Math.ceil(backlogValue / freq);

        setBacklogInfo({
            diffDays: backlogDays,
            backlogItems: backlogValue
        });
    };

    // Helper Functions
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
        if (!series.seasons || !Array.isArray(series.seasons)) return 0;

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

    const handleAddSeason = () => {
        setSeasons([...seasons, { number: seasons.length + 1, episodes: '' }]);
    };

    const handleRemoveSeason = () => {
        if (seasons.length > 1) {
            const newSeasons = seasons.slice(0, -1);
            setSeasons(newSeasons);
        } else {
            Alert.alert('Aviso', 'Debe haber al menos una temporada.');
        }
    };

    const updateSeasonEpisodes = (index, value) => {
        const newSeasons = [...seasons];
        newSeasons[index].episodes = value;
        setSeasons(newSeasons);
    };

    const handleSave = async () => {
        if (!name.trim()) return Alert.alert('Error', 'El nombre es obligatorio');

        // Validate Seasons
        const validSeasons = seasons.filter(s => parseInt(s.episodes) > 0);
        if (validSeasons.length === 0) return Alert.alert('Error', 'Debes añadir al menos una temporada con capítulos válidos');

        if (status === 'Mirando') {
            const seasonNum = parseInt(currentSeason);
            const episodeNum = parseInt(currentEpisode);

            if (isNaN(seasonNum) || isNaN(episodeNum)) {
                return Alert.alert('Error', 'Temporada y Capítulo actuales deben ser números');
            }

            if (seasonNum < 1 || seasonNum > validSeasons.length) {
                return Alert.alert('Error', `La temporada actual debe estar entre 1 y ${validSeasons.length}`);
            }

            const maxEpisodes = parseInt(validSeasons[seasonNum - 1].episodes);
            if (episodeNum < 1 || episodeNum > maxEpisodes) {
                return Alert.alert('Error', `El capítulo actual debe estar entre 1 y ${maxEpisodes} para la temporada ${seasonNum}`);
            }
        }

        if (seriesList.length >= category.series_count) {
            return Alert.alert('Límite Alcanzado', `Solo puedes agregar hasta ${category.series_count} series en esta categoría.`);
        }

        const seriesData = {
            category_id: category.id,
            name,
            description,
            status: 'Mirando',
            current_season: status === 'Nueva' ? 1 : parseInt(currentSeason),
            current_episode: status === 'Nueva' ? 1 : parseInt(currentEpisode),
            total_seasons: validSeasons.length
        };

        const seasonsData = validSeasons.map(s => ({
            season_number: s.number,
            episode_count: parseInt(s.episodes)
        }));

        const result = await db.addSeriesWithSeasons(seriesData, seasonsData);
        if (result.success) {
            setModalVisible(false);
            fetchSeries();
            resetForm();
            Alert.alert('Éxito', 'Serie agregada correctamente');
        } else {
            Alert.alert('Error', 'No se pudo guardar la serie');
        }
    };

    const resetForm = () => {
        setName('');
        setDescription('');
        setStatus('Nueva');
        setSeasons([{ number: 1, episodes: '' }]);
        setCurrentSeason(1);
        setCurrentEpisode(1);
    };

    const renderSeriesItem = ({ item }) => (
        <View style={styles.card}>
            <View style={styles.cardHeader}>
                <Text style={styles.cardTitle}>{item.name}</Text>
                <View style={[styles.badge, item.status === 'Nueva' ? styles.badgeNew : styles.badgeWatching]}>
                    <Text style={styles.badgeText}>{item.status}</Text>
                </View>
            </View>
            <Text style={styles.cardProgress}>
                Progreso: T{item.current_season} - E{item.current_episode} / {item.total_seasons} Temporadas
            </Text>
            {item.description ? <Text style={styles.cardDesc}>{item.description}</Text> : null}
        </View>
    );

    return (
        <SafeAreaView style={styles.container}>
            <StatusBar style="dark" />
            <View style={styles.header}>
                <TouchableOpacity onPress={onBack} style={styles.backButton}>
                    <Text style={styles.backButtonText}>←</Text>
                </TouchableOpacity>
                <View>
                    <Text style={styles.headerTitle}>{category?.name}</Text>
                    <Text style={styles.headerSubtitle}>
                        Series: {seriesList.length} / {category?.series_count || 0}
                    </Text>
                    {backlogInfo && (
                        <Text style={styles.headerBacklog}>
                            Atraso: {backlogInfo.diffDays} días, {backlogInfo.backlogItems} Caps
                        </Text>
                    )}
                </View>
                <View style={{ flexDirection: 'row' }}>
                    <TouchableOpacity onPress={onNavigateRegistry} style={[styles.addButton, { backgroundColor: '#FFF3E0', marginRight: 10 }]}>
                        <Text style={{ fontSize: 20 }}>📋</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                        style={styles.addButton}
                        onPress={() => {
                            resetForm();
                            setModalVisible(true);
                        }}
                    >
                        <Text style={styles.addButtonText}>+</Text>
                    </TouchableOpacity>
                </View>
            </View>

            <FlatList
                data={seriesList}
                keyExtractor={item => item.id.toString()}
                renderItem={renderSeriesItem}
                contentContainerStyle={styles.listContent}
                ListEmptyComponent={<Text style={styles.emptyText}>No hay series registradas.</Text>}
            />

            {/* MODAL ADD SERIES */}
            <Modal animationType="slide" visible={modalVisible} onRequestClose={() => setModalVisible(false)}>
                <SafeAreaView style={styles.modalContainer}>
                    <View style={styles.modalHeader}>
                        <Text style={styles.modalTitle}>Nueva Serie</Text>
                        <TouchableOpacity onPress={() => setModalVisible(false)}>
                            <Text style={styles.closeText}>Cerrar</Text>
                        </TouchableOpacity>
                    </View>
                    <ScrollView style={styles.modalForm}>
                        <Text style={styles.label}>Nombre de la Serie</Text>
                        <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Ej: Breaking Bad" />

                        <Text style={styles.label}>Descripción (Opcional)</Text>
                        <TextInput style={styles.input} value={description} onChangeText={setDescription} placeholder="Ej: Serie de crimen..." />

                        <Text style={styles.label}>Estado</Text>
                        <View style={styles.statusContainer}>
                            <TouchableOpacity
                                style={[styles.statusOption, status === 'Nueva' && styles.statusSelected]}
                                onPress={() => setStatus('Nueva')}
                            >
                                <Text style={[styles.statusText, status === 'Nueva' && styles.statusTextSelected]}>Nueva</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[styles.statusOption, status === 'Mirando' && styles.statusSelected]}
                                onPress={() => setStatus('Mirando')}
                            >
                                <Text style={[styles.statusText, status === 'Mirando' && styles.statusTextSelected]}>Mirando</Text>
                            </TouchableOpacity>
                        </View>

                        <Text style={styles.sectionTitle}>Temporadas</Text>
                        {seasons.map((season, index) => (
                            <View key={index} style={styles.seasonRow}>
                                <Text style={styles.seasonLabel}>Temporada {season.number}:</Text>
                                <TextInput
                                    style={styles.seasonInput}
                                    placeholder="N° Caps"
                                    keyboardType="numeric"
                                    value={season.episodes}
                                    onChangeText={(text) => updateSeasonEpisodes(index, text)}
                                />
                            </View>
                        ))}
                        <View style={styles.seasonActions}>
                            <TouchableOpacity style={styles.addSeasonBtn} onPress={handleAddSeason}>
                                <Text style={styles.addSeasonText}>+ Agregar Temporada</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={styles.removeSeasonBtn} onPress={handleRemoveSeason}>
                                <Text style={styles.removeSeasonText}>- Quitar Temporada</Text>
                            </TouchableOpacity>
                        </View>

                        {status === 'Mirando' && (
                            <View>
                                <Text style={styles.sectionTitle}>Progreso Actual</Text>
                                <View style={styles.row}>
                                    <View style={{ flex: 1, marginRight: 5 }}>
                                        <Text style={styles.label}>Temporada</Text>
                                        <TextInput
                                            style={styles.input}
                                            keyboardType="numeric"
                                            value={String(currentSeason)}
                                            onChangeText={setCurrentSeason}
                                        />
                                    </View>
                                    <View style={{ flex: 1, marginLeft: 5 }}>
                                        <Text style={styles.label}>Capítulo</Text>
                                        <TextInput
                                            style={styles.input}
                                            keyboardType="numeric"
                                            value={String(currentEpisode)}
                                            onChangeText={setCurrentEpisode}
                                        />
                                    </View>
                                </View>
                            </View>
                        )}

                        <TouchableOpacity style={styles.saveButton} onPress={handleSave}>
                            <Text style={styles.saveButtonText}>Guardar Serie</Text>
                        </TouchableOpacity>
                        <View style={{ height: 50 }} />
                    </ScrollView>
                </SafeAreaView>
            </Modal>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#F5F5F5' },
    header: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: 20, paddingVertical: 15, backgroundColor: '#fff',
        borderBottomWidth: 1, borderBottomColor: '#eee'
    },
    backButton: { padding: 5 },
    backButtonText: { fontSize: 24, color: '#333' },
    headerTitle: { fontSize: 18, fontWeight: 'bold', color: '#333' },
    headerSubtitle: { fontSize: 13, color: '#666' },
    headerBacklog: { fontSize: 12, color: '#EF6C00', fontWeight: 'bold' },
    addButton: { backgroundColor: '#2196F3', width: 35, height: 35, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
    addButtonText: { color: '#fff', fontSize: 24, paddingBottom: 2 },

    listContent: { padding: 15 },
    emptyText: { textAlign: 'center', marginTop: 20, color: '#999' },

    card: { backgroundColor: '#fff', padding: 15, borderRadius: 10, marginBottom: 10, elevation: 2 },
    cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    cardTitle: { fontSize: 16, fontWeight: 'bold', color: '#333' },
    cardProgress: { fontSize: 14, color: '#2196F3', marginTop: 5, fontWeight: '600' },
    cardDesc: { fontSize: 12, color: '#777', marginTop: 5 },

    badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 5 },
    badgeNew: { backgroundColor: '#E8F5E9' },
    badgeWatching: { backgroundColor: '#FFF3E0' },
    badgeText: { fontSize: 10, fontWeight: 'bold', color: '#333' },

    modalContainer: { flex: 1, backgroundColor: '#fff' },
    modalHeader: { flexDirection: 'row', justifyContent: 'space-between', padding: 20, borderBottomWidth: 1, borderColor: '#eee' },
    modalTitle: { fontSize: 20, fontWeight: 'bold' },
    closeText: { color: 'red', fontSize: 16 },
    modalForm: { padding: 20 },

    label: { fontSize: 14, color: '#555', marginBottom: 5, marginTop: 10 },
    input: { borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 10, fontSize: 16, backgroundColor: '#fafafa' },

    statusContainer: { flexDirection: 'row', marginTop: 5 },
    statusOption: { flex: 1, padding: 10, alignItems: 'center', borderWidth: 1, borderColor: '#ddd', borderRadius: 8, marginHorizontal: 2 },
    statusSelected: { backgroundColor: '#2196F3', borderColor: '#2196F3' },
    statusText: { color: '#666' },
    statusTextSelected: { color: '#fff', fontWeight: 'bold' },

    sectionTitle: { fontSize: 16, fontWeight: 'bold', marginTop: 20, marginBottom: 10 },
    seasonRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
    seasonLabel: { flex: 1, fontSize: 16 },
    seasonInput: { width: 80, borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 8, textAlign: 'center' },

    seasonActions: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginTop: 10,
    },
    addSeasonBtn: { alignItems: 'center', padding: 10 },
    addSeasonText: { color: '#2196F3', fontWeight: 'bold' },
    removeSeasonBtn: { alignItems: 'center', padding: 10 },
    removeSeasonText: { color: '#FF5252', fontWeight: 'bold' },

    row: { flexDirection: 'row' },
    saveButton: { backgroundColor: '#4CAF50', padding: 15, borderRadius: 10, alignItems: 'center', marginTop: 30 },
    saveButtonText: { color: '#fff', fontSize: 18, fontWeight: 'bold' }
}
);
