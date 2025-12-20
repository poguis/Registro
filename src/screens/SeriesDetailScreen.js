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

    // Progress Grid Modal
    const [progressModalVisible, setProgressModalVisible] = useState(false);
    const [activeSeries, setActiveSeries] = useState(null);

    // Form Progress State (for creation)
    const [currentSeason, setCurrentSeason] = useState(1);
    const [currentEpisode, setCurrentEpisode] = useState(1);

    const [backlogInfo, setBacklogInfo] = useState(null);

    // Edit State
    const [isEditing, setIsEditing] = useState(false);
    const [editingSeriesId, setEditingSeriesId] = useState(null);

    // Tab State
    const [currentStatusTab, setCurrentStatusTab] = useState('Viendo'); // 'Viendo' | 'En espera' | 'Terminado'
    const [originalList, setOriginalList] = useState([]);

    const fetchSeries = async () => {
        if (category?.id) {
            try {
                // Fetch all series for the category (Status: Nueva, Mirando, Finished)
                const result = await db.getSeriesByCategory(category.id);

                if (result.success) {
                    const list = result.series;
                    // Enriched list with seasons
                    const enrichedList = await Promise.all(list.map(async (series) => {
                        const seasonsRes = await db.getSeasonsBySeries(series.id);
                        return {
                            ...series,
                            seasons: seasonsRes.success ? seasonsRes.seasons : []
                        };
                    }));

                    setOriginalList(enrichedList);

                    // We still calculate backlog for the header based on everything
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

    const handleEdit = (series) => {
        setIsEditing(true);
        setEditingSeriesId(series.id);
        setName(series.name);
        setDescription(series.description || '');
        setStatus(series.status);
        setCurrentSeason(series.current_season);
        setCurrentEpisode(series.current_episode);

        // Map seasons data to form state
        if (series.seasons && series.seasons.length > 0) {
            setSeasons(series.seasons.map(s => ({
                number: s.season_number,
                episodes: String(s.episode_count)
            })));
        } else {
            setSeasons([{ number: 1, episodes: '' }]);
        }

        setModalVisible(true);
    };

    const moveUp = async (index) => {
        if (currentStatusTab !== 'Viendo' || index === 0) return;

        const filteredData = getFilteredSeries();
        const newList = [...filteredData];
        const [movedItem] = newList.splice(index, 1);
        newList.splice(index - 1, 0, movedItem);

        // Update all sort_orders in DB based on the new order in this group
        await Promise.all(newList.map((item, idx) =>
            db.updateSeriesSortOrder(item.id, idx + 1)
        ));

        fetchSeries();
    };

    const moveDown = async (index) => {
        const filteredData = getFilteredSeries();
        if (currentStatusTab !== 'Viendo' || index === filteredData.length - 1) return;

        const newList = [...filteredData];
        const [movedItem] = newList.splice(index, 1);
        newList.splice(index + 1, 0, movedItem);

        await Promise.all(newList.map((item, idx) =>
            db.updateSeriesSortOrder(item.id, idx + 1)
        ));

        fetchSeries();
    };

    const getFilteredSeries = () => {
        if (currentStatusTab === 'Viendo') {
            return originalList.filter(s => s.status === 'Nueva' || s.status === 'Mirando');
        }
        return originalList.filter(s => s.status === currentStatusTab);
    };

    const handleDelete = (seriesId) => {
        Alert.alert(
            'Eliminar Serie',
            '¿Estás seguro de que quieres eliminar esta serie? Se borrarán también sus temporadas y progreso.',
            [
                { text: 'Cancelar', style: 'cancel' },
                {
                    text: 'Eliminar',
                    style: 'destructive',
                    onPress: async () => {
                        const result = await db.deleteSeries(seriesId);
                        if (result.success) {
                            fetchSeries();
                            Alert.alert('Éxito', 'Serie eliminada');
                        }
                    }
                }
            ]
        );
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

        if (originalList.length >= category.series_count) {
            return Alert.alert('Límite Alcanzado', `Solo puedes agregar hasta ${category.series_count} series en esta categoría.`);
        }

        const seasonsData = validSeasons.map(s => ({
            season_number: s.number,
            episode_count: parseInt(s.episodes)
        }));

        let result;
        if (isEditing) {
            const seriesData = {
                name,
                description,
                total_seasons: validSeasons.length
            };
            result = await db.updateSeriesWithSeasons(editingSeriesId, seriesData, seasonsData);
        } else {
            const seriesData = {
                category_id: category.id,
                name,
                description,
                status: 'Mirando',
                current_season: status === 'Nueva' ? 1 : parseInt(currentSeason),
                current_episode: status === 'Nueva' ? 1 : parseInt(currentEpisode),
                total_seasons: validSeasons.length
            };
            result = await db.addSeriesWithSeasons(seriesData, seasonsData);
        }

        if (result.success) {
            setModalVisible(false);
            fetchSeries();
            resetForm();
            Alert.alert('Éxito', isEditing ? 'Serie actualizada' : 'Serie agregada');
        } else {
            Alert.alert('Error', 'No se pudo guardar la serie');
        }
    };

    const openProgressGrid = (series) => {
        setActiveSeries(series);
        setProgressModalVisible(true);
    };

    const updateToChapter = async (seriesId, sNum, eNum) => {
        const series = activeSeries || originalList.find(x => x.id === seriesId);
        if (!series) return;

        // Check if it's the last episode of the last season
        const lastSeason = series.seasons.find(s => s.season_number === series.total_seasons);
        const isLastPossible = (sNum === series.total_seasons && eNum === (lastSeason?.episode_count || 0));

        const performUpdate = async (newStatus = series.status) => {
            const finalStatus = (series.status === 'Nueva' && (sNum > 1 || eNum > 1)) ? 'Mirando' : newStatus;
            const result = await db.updateSeriesProgress(seriesId, sNum, eNum, finalStatus);
            if (result.success) {
                fetchSeries();
                if (activeSeries && activeSeries.id === seriesId) {
                    setActiveSeries(prev => ({ ...prev, current_season: sNum, current_episode: eNum, status: finalStatus }));
                }
            }
        };

        if (isLastPossible) {
            Alert.alert(
                '¡Serie Completada!',
                'Has llegado al final. ¿A dónde quieres enviar esta serie?',
                [
                    { text: 'En espera (Próx. temp)', onPress: () => performUpdate('En espera') },
                    { text: 'Terminado (Fin total)', onPress: () => performUpdate('Terminado') },
                    { text: 'Cancelar', style: 'cancel' }
                ]
            );
        } else {
            // Normal update (if it was En espera/Terminado and we touch a grid item, maybe it goes back to Mirando?)
            let targetStatus = series.status;
            if (series.status === 'En espera' || series.status === 'Terminado') {
                targetStatus = 'Mirando';
            }
            performUpdate(targetStatus);
        }
    };

    const resetForm = () => {
        setIsEditing(false);
        setEditingSeriesId(null);
        setName('');
        setDescription('');
        setStatus('Nueva');
        setSeasons([{ number: 1, episodes: '' }]);
        setCurrentSeason(1);
        setCurrentEpisode(1);
    };

    const renderSeriesItem = ({ item, index }) => {
        let badgeStyle = styles.badgeWatching;
        if (item.status === 'Nueva') badgeStyle = styles.badgeNew;
        if (item.status === 'En espera') badgeStyle = styles.badgeHold;
        if (item.status === 'Terminado') badgeStyle = styles.badgeFinished;

        const isViendo = currentStatusTab === 'Viendo';

        return (
            <TouchableOpacity style={styles.card} activeOpacity={0.9} onPress={() => openProgressGrid(item)}>
                <View style={styles.cardHeader}>
                    <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4, flexWrap: 'wrap' }}>
                            <Text style={styles.cardTitle}>{item.name}</Text>
                            <View style={[styles.badge, badgeStyle]}>
                                <Text style={styles.badgeText}>{item.status}</Text>
                            </View>
                        </View>
                        <Text style={styles.cardProgress}>
                            T{item.current_season} - E{item.current_episode} <Text style={{ fontWeight: 'normal', color: '#999' }}>de {item.total_seasons} Temp.</Text>
                        </Text>
                    </View>
                    <View style={styles.cardActions}>
                        <TouchableOpacity onPress={() => openProgressGrid(item)} style={styles.gridBtn}>
                            <Text style={{ fontSize: 18 }}>👁️</Text>
                        </TouchableOpacity>

                        {isViendo && (
                            <View style={styles.orderButtons}>
                                <TouchableOpacity onPress={(e) => { e.stopPropagation(); moveUp(index); }} style={styles.orderBtn}>
                                    <Text style={styles.orderBtnText}>↑</Text>
                                </TouchableOpacity>
                                <TouchableOpacity onPress={(e) => { e.stopPropagation(); moveDown(index); }} style={styles.orderBtn}>
                                    <Text style={styles.orderBtnText}>↓</Text>
                                </TouchableOpacity>
                            </View>
                        )}

                        <TouchableOpacity onPress={(e) => { e.stopPropagation(); handleEdit(item); }} style={styles.editBtn}>
                            <Text style={{ fontSize: 16 }}>✏️</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={(e) => { e.stopPropagation(); handleDelete(item.id); }} style={styles.deleteBtn}>
                            <Text style={{ fontSize: 16 }}>🗑️</Text>
                        </TouchableOpacity>
                    </View>
                </View>
                {item.description ? <Text style={styles.cardDesc} numberOfLines={2}>{item.description}</Text> : null}
            </TouchableOpacity>
        );
    };

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
                        Series: {originalList.length} / {category?.series_count || 0}
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

            <View style={styles.tabContainer}>
                {['Viendo', 'En espera', 'Terminado'].map(tab => (
                    <TouchableOpacity
                        key={tab}
                        style={[styles.tabButton, currentStatusTab === tab && styles.tabButtonActive]}
                        onPress={() => setCurrentStatusTab(tab)}
                    >
                        <Text style={[styles.tabText, currentStatusTab === tab && styles.tabTextActive]}>
                            {tab === 'Viendo' ? '📺 Viendo' : tab === 'En espera' ? '⏳ Espera' : '✅ Fin'}
                        </Text>
                    </TouchableOpacity>
                ))}
            </View>

            <FlatList
                data={getFilteredSeries()}
                keyExtractor={item => item.id.toString()}
                renderItem={renderSeriesItem}
                contentContainerStyle={styles.listContent}
                ListEmptyComponent={<Text style={styles.emptyText}>No hay series en esta sección.</Text>}
            />

            {/* MODAL ADD/EDIT SERIES */}
            <Modal animationType="slide" visible={modalVisible} onRequestClose={() => setModalVisible(false)}>
                <SafeAreaView style={styles.modalContainer}>
                    <View style={styles.modalHeader}>
                        <Text style={styles.modalTitle}>{isEditing ? 'Editar Serie' : 'Nueva Serie'}</Text>
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

                        {isEditing && (
                            <View style={styles.editInfoBanner}>
                                <Text style={styles.editInfoText}>
                                    Nota: Solo puedes editar nombre, descripción y temporadas. El progreso se actualiza desde el registro.
                                </Text>
                            </View>
                        )}

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

                        {!isEditing && status === 'Mirando' && (
                            <View>
                                <Text style={styles.sectionTitle}>Progreso Inicial</Text>
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
                            <Text style={styles.saveButtonText}>{isEditing ? 'Actualizar' : 'Guardar Serie'}</Text>
                        </TouchableOpacity>
                        <View style={{ height: 50 }} />
                    </ScrollView>
                </SafeAreaView>
            </Modal>

            {/* PROGRESS GRID MODAL */}
            <Modal animationType="fade" transparent={true} visible={progressModalVisible} onRequestClose={() => setProgressModalVisible(false)}>
                <View style={styles.overlay}>
                    <View style={styles.progressModalContent}>
                        <View style={styles.progressHeader}>
                            <View style={{ flex: 1 }}>
                                <Text style={styles.progressSeriesName}>{activeSeries?.name}</Text>
                                <Text style={styles.progressStatus}>
                                    Viendo: Temporada {activeSeries?.current_season}, Capítulo {activeSeries?.current_episode}
                                </Text>
                            </View>
                            <TouchableOpacity onPress={() => setProgressModalVisible(false)} style={styles.closeGridBtn}>
                                <Text style={styles.closeGridText}>✕</Text>
                            </TouchableOpacity>
                        </View>

                        <ScrollView style={{ padding: 15 }}>
                            {activeSeries?.seasons.map(season => (
                                <View key={season.season_number} style={styles.seasonGroup}>
                                    <Text style={styles.seasonTitle}>Temporada {season.season_number}</Text>
                                    <View style={styles.episodeGrid}>
                                        {Array.from({ length: season.episode_count }).map((_, i) => {
                                            const epNum = i + 1;
                                            const isWatched = (season.season_number < activeSeries.current_season) ||
                                                (season.season_number === activeSeries.current_season && epNum < activeSeries.current_episode);
                                            const isCurrent = (season.season_number === activeSeries.current_season && epNum === activeSeries.current_episode);

                                            return (
                                                <TouchableOpacity
                                                    key={epNum}
                                                    style={[
                                                        styles.episodeBox,
                                                        isWatched && styles.episodeWatched,
                                                        isCurrent && styles.episodeCurrent
                                                    ]}
                                                    onPress={() => {
                                                        // When clicking, we want to update progress to NEXT chapter.
                                                        // Actually, common UX is: click chapter X to MARK X AS SEEN (meaning progress becomes X+1)
                                                        // Or: click chapter X to SET progress TO X.
                                                        // Let's go with: click X to mark as CURRENT.
                                                        updateToChapter(activeSeries.id, season.season_number, epNum);
                                                    }}
                                                >
                                                    <Text style={[styles.episodeNum, (isWatched || isCurrent) && { color: '#fff' }]}>{epNum}</Text>
                                                </TouchableOpacity>
                                            );
                                        })}
                                    </View>
                                </View>
                            ))}
                            <View style={{ height: 30 }} />
                        </ScrollView>

                        <View style={styles.gridFooter}>
                            <View style={styles.legend}>
                                <View style={[styles.legendBox, styles.episodeWatched]} /><Text style={styles.legendText}>Visto</Text>
                                <View style={[styles.legendBox, styles.episodeCurrent]} /><Text style={styles.legendText}>Siguiente</Text>
                                <View style={[styles.legendBox]} /><Text style={styles.legendText}>Pendiente</Text>
                            </View>
                        </View>
                    </View>
                </View>
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

    card: { backgroundColor: '#fff', padding: 15, borderRadius: 16, marginBottom: 12, elevation: 3, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 4 },
    cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
    cardTitle: { fontSize: 18, fontWeight: 'bold', color: '#1A237E' },
    cardProgress: { fontSize: 13, color: '#3F51B5', fontWeight: 'bold' },
    cardDesc: { fontSize: 12, color: '#7986CB', marginTop: 8, lineHeight: 16 },

    badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, marginLeft: 8 },
    badgeNew: { backgroundColor: '#E0F2F1' },
    badgeWatching: { backgroundColor: '#E3F2FD' },
    badgeHold: { backgroundColor: '#FFF3E0' },
    badgeFinished: { backgroundColor: '#E8F5E9' },
    badgeText: { fontSize: 10, fontWeight: 'bold', color: '#455A64', textTransform: 'uppercase' },

    modalContainer: { flex: 1, backgroundColor: '#fff' },
    modalHeader: { flexDirection: 'row', justifyContent: 'space-between', padding: 20, alignItems: 'center', borderBottomWidth: 1, borderColor: '#f0f0f0' },
    modalTitle: { fontSize: 22, fontWeight: 'bold', color: '#1A237E' },
    closeText: { color: '#FF5252', fontSize: 16, fontWeight: 'bold' },
    modalForm: { padding: 20 },

    label: { fontSize: 14, color: '#5C6BC0', marginBottom: 5, marginTop: 10, fontWeight: '600' },
    input: { borderWidth: 1, borderColor: '#E8EAF6', borderRadius: 10, padding: 12, fontSize: 16, backgroundColor: '#F5F5F7' },

    statusContainer: { flexDirection: 'row', marginTop: 10, gap: 10 },
    statusOption: { flex: 1, padding: 12, alignItems: 'center', borderWidth: 1, borderColor: '#E8EAF6', borderRadius: 10, backgroundColor: '#fff' },
    statusSelected: { backgroundColor: '#3F51B5', borderColor: '#3F51B5' },
    statusText: { color: '#7986CB', fontWeight: '600' },
    statusTextSelected: { color: '#fff', fontWeight: 'bold' },

    sectionTitle: { fontSize: 18, fontWeight: 'bold', marginTop: 25, marginBottom: 15, color: '#1A237E' },
    seasonRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12, backgroundColor: '#F8F9FE', padding: 10, borderRadius: 10 },
    seasonLabel: { flex: 1, fontSize: 15, color: '#333', fontWeight: '500' },
    seasonInput: { width: 90, borderWidth: 1, borderColor: '#E1E4F3', borderRadius: 8, padding: 8, textAlign: 'center', backgroundColor: '#fff' },

    seasonActions: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 15 },
    addSeasonBtn: { padding: 10 },
    addSeasonText: { color: '#3F51B5', fontWeight: 'bold' },
    removeSeasonBtn: { padding: 10 },
    removeSeasonText: { color: '#FF5252', fontWeight: 'bold' },

    row: { flexDirection: 'row' },
    saveButton: { backgroundColor: '#3F51B5', padding: 18, borderRadius: 12, alignItems: 'center', marginTop: 35, elevation: 4 },
    saveButtonText: { color: '#fff', fontSize: 18, fontWeight: 'bold' },

    cardActions: { flexDirection: 'row', alignItems: 'center' },
    gridBtn: { backgroundColor: '#E8EAF6', padding: 8, borderRadius: 10, marginRight: 8 },
    orderButtons: { flexDirection: 'row', marginRight: 8 },
    orderBtn: { backgroundColor: '#F5F5F7', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, marginHorizontal: 2, borderWidth: 1, borderColor: '#E8EAF6' },
    orderBtnText: { fontSize: 14, color: '#3F51B5', fontWeight: 'bold' },
    editBtn: { backgroundColor: '#E3F2FD', padding: 8, borderRadius: 10, marginRight: 8 },
    deleteBtn: { backgroundColor: '#FFEBEE', padding: 8, borderRadius: 10 },

    editInfoBanner: { backgroundColor: '#E3F2FD', padding: 12, borderRadius: 10, marginTop: 20, borderLeftWidth: 4, borderLeftColor: '#3F51B5' },
    editInfoText: { fontSize: 12, color: '#3F51B5', textAlign: 'left', fontWeight: '500' },

    // Progress Grid Styles
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
    progressModalContent: { backgroundColor: '#fff', borderTopLeftRadius: 30, borderTopRightRadius: 30, height: '85%' },
    progressHeader: { flexDirection: 'row', padding: 25, borderBottomWidth: 1, borderColor: '#f0f0f0', alignItems: 'center' },
    progressSeriesName: { fontSize: 22, fontWeight: 'bold', color: '#1A237E' },
    progressStatus: { fontSize: 14, color: '#7986CB', marginTop: 4 },
    closeGridBtn: { backgroundColor: '#F5F5F7', width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
    closeGridText: { fontSize: 18, color: '#333' },

    seasonGroup: { marginBottom: 25 },
    seasonTitle: { fontSize: 16, fontWeight: 'bold', color: '#1A237E', marginBottom: 12, marginLeft: 5 },
    episodeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    episodeBox: {
        width: 42, height: 42, borderRadius: 10, backgroundColor: '#F5F5F7',
        alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#E8EAF6'
    },
    episodeWatched: { backgroundColor: '#4CAF50', borderColor: '#43A047' },
    episodeCurrent: { backgroundColor: '#3F51B5', borderColor: '#3949AB' },
    episodeNum: { fontSize: 14, fontWeight: 'bold', color: '#5C6BC0' },

    gridFooter: { padding: 20, borderTopWidth: 1, borderColor: '#f0f0f0', backgroundColor: '#FAFAFA' },
    legend: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 15 },
    legendBox: { width: 14, height: 14, borderRadius: 4, backgroundColor: '#F5F5F7', borderWidth: 1, borderColor: '#E8EAF6' },
    legendText: { fontSize: 12, color: '#666', fontWeight: '500' },

    sectionHeader: {
        backgroundColor: '#E8EAF6',
        paddingVertical: 10,
        paddingHorizontal: 15,
        marginTop: 20,
        marginBottom: 10,
        borderRadius: 12,
        flexDirection: 'row',
        alignItems: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.1,
        shadowRadius: 2,
        elevation: 2
    },
    sectionHeaderText: { fontSize: 16, fontWeight: 'bold', color: '#3F51B5', letterSpacing: 0.5 },

    // Tabs Styles
    tabContainer: {
        flexDirection: 'row',
        backgroundColor: '#fff',
        paddingHorizontal: 15,
        paddingVertical: 10,
        borderBottomWidth: 1,
        borderBottomColor: '#f0f0f0',
        gap: 10
    },
    tabButton: {
        flex: 1,
        paddingVertical: 8,
        borderRadius: 12,
        backgroundColor: '#F5F5F7',
        alignItems: 'center',
        borderWidth: 1,
        borderColor: '#f0f0f0'
    },
    tabButtonActive: {
        backgroundColor: '#3F51B5',
        borderColor: '#3F51B5',
    },
    tabText: {
        fontSize: 13,
        fontWeight: 'bold',
        color: '#7986CB'
    },
    tabTextActive: {
        color: '#fff'
    }
});
