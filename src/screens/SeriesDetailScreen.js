import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, FlatList, Modal, TextInput, Alert, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import db from '../services/db';
import { calculateBacklog, calculateBacklogV2, getLocalDateString, getAbsoluteEpisodeCount, getWatchedCountSinceStart } from '../services/backlogUtils';
import { useTheme } from '../contexts/ThemeContext';

export default function SeriesDetailScreen({ user, category, onBack, onNavigateRegistry }) {
    const { theme, isDarkMode } = useTheme();
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
    const [seasonVisibleCounts, setSeasonVisibleCounts] = useState({});

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
    const [currentCategory, setCurrentCategory] = useState(category);

    const refreshCategory = async () => {
        const result = await db.getEntertainmentCategories(user.id);
        if (result.success) {
            const updated = result.categories.find(c => c.id === category.id);
            if (updated) setCurrentCategory(updated);
        }
    };

    const fetchSeries = async () => {
        if (category?.id) {
            try {
                const result = await db.getSeriesByCategory(category.id);
                if (result.success) {
                    const list = result.series;
                    const enrichedList = await Promise.all(list.map(async (series) => {
                        const seasonsRes = await db.getSeasonsBySeries(series.id);
                        return {
                            ...series,
                            seasons: seasonsRes.success ? seasonsRes.seasons : []
                        };
                    }));
                    setOriginalList(enrichedList);
                }
            } catch (error) {
                console.error("Error fetching series:", error);
            }
        }
    };

    useEffect(() => {
        fetchSeries();
    }, [category]);

    useEffect(() => {
        setCurrentCategory(category);
    }, [category]);

    const calculateHeaderBacklog = (currentSeriesList = originalList, targetCategory = currentCategory) => {
        const calc = calculateBacklogV2(targetCategory, currentSeriesList);
        if (calc) {
            setBacklogInfo({ 
                items: calc.items, 
                days: calc.days, 
                adelantoItems: calc.adelantoItems, 
                adelantoDays: calc.adelantoDays 
            });
        }
    };

    useEffect(() => {
        if (originalList.length > 0 || currentCategory) {
            calculateHeaderBacklog(originalList, currentCategory);
        }
    }, [originalList, currentCategory]);

    useEffect(() => {
        if (!activeSeries?.seasons) {
            setSeasonVisibleCounts({});
            return;
        }

        const initialCounts = {};
        activeSeries.seasons.forEach((season) => {
            const isCurrentSeason = season.season_number === activeSeries.current_season;
            const currentPointer = isCurrentSeason ? (activeSeries.current_episode || 1) : 1;
            const baseVisible = isCurrentSeason ? Math.max(120, currentPointer + 20) : 120;
            initialCounts[season.season_number] = Math.min(season.episode_count, baseVisible);
        });
        setSeasonVisibleCounts(initialCounts);
    }, [activeSeries]);

    const handleAddSeason = () => {
        setSeasons([...seasons, { number: seasons.length + 1, episodes: '' }]);
    };

    const handleRemoveSeason = () => {
        if (seasons.length > 1) {
            setSeasons(seasons.slice(0, -1));
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
        await Promise.all(newList.map((item, idx) => db.updateSeriesSortOrder(item.id, idx + 1)));
        fetchSeries();
    };

    const moveDown = async (index) => {
        const filteredData = getFilteredSeries();
        if (currentStatusTab !== 'Viendo' || index === filteredData.length - 1) return;
        const newList = [...filteredData];
        const [movedItem] = newList.splice(index, 1);
        newList.splice(index + 1, 0, movedItem);
        await Promise.all(newList.map((item, idx) => db.updateSeriesSortOrder(item.id, idx + 1)));
        fetchSeries();
    };

    const getFilteredSeries = () => {
        if (currentStatusTab === 'Viendo') {
            return originalList.filter(s => s.status === 'Nueva' || s.status === 'Mirando' || s.status === 'Pausado');
        }
        return originalList.filter(s => s.status === currentStatusTab);
    };

    const handleDelete = (seriesId) => {
        Alert.alert(
            'Eliminar Serie',
            '¿Estás seguro?',
            [
                { text: 'Cancelar', style: 'cancel' },
                {
                    text: 'Eliminar',
                    style: 'destructive',
                    onPress: async () => {
                        const result = await db.deleteSeries(seriesId);
                        if (result.success) fetchSeries();
                    }
                }
            ]
        );
    };

    const handleSave = async () => {
        if (!name.trim()) return Alert.alert('Error', 'El nombre es obligatorio');
        const validSeasons = seasons.filter(s => parseInt(s.episodes) > 0);
        if (validSeasons.length === 0) return Alert.alert('Error', 'Capítulos inválidos');

        if (status === 'Mirando') {
            const seasonNum = parseInt(currentSeason);
            const episodeNum = parseInt(currentEpisode);
            if (isNaN(seasonNum) || isNaN(episodeNum)) return Alert.alert('Error', 'Números inválidos');
            if (seasonNum < 1 || seasonNum > validSeasons.length) return Alert.alert('Error', 'Temporada fuera de rango');
            const maxEpisodes = parseInt(validSeasons[seasonNum - 1].episodes);
            if (episodeNum < 1 || episodeNum > maxEpisodes) return Alert.alert('Error', 'Capítulo fuera de rango');
        }

        const activeSeriesItems = originalList.filter(s => s.status === 'Nueva' || s.status === 'Mirando' || s.status === 'Pausado');
        const activeCount = activeSeriesItems.length;
        const isCurrentlyActive = isEditing && activeSeriesItems.some(s => s.id === editingSeriesId);
        const willBeActive = status === 'Nueva' || status === 'Mirando' || status === 'Pausado';

        if (willBeActive && (!isCurrentlyActive || !isEditing)) {
            // Enforce limit strictly if not null
            if (category.series_count !== null && category.series_count !== undefined) {
                if (activeCount >= category.series_count) {
                    return Alert.alert('Límite Alcanzado', `Máximo ${category.series_count} series activas.`);
                }
            }
        }

        const seriesDataObj = {
            category_id: category.id,
            name,
            description,
            status,
            current_season: parseInt(currentSeason),
            current_episode: parseInt(currentEpisode),
            total_seasons: validSeasons.length
        };

        const seasonsData = validSeasons.map(s => ({
            season_number: s.number,
            episode_count: parseInt(s.episodes)
        }));

        let result;
        if (isEditing) {
            result = await db.updateSeriesWithSeasons(editingSeriesId, seriesDataObj, seasonsData);
        } else {
            const nextOrder = activeSeriesItems.length + 1;
            seriesDataObj.sort_order = nextOrder;
            // Interleave logic: next items should match current category pace
            let maxInterleave = 0;
            activeSeriesItems.forEach(s => {
                const progress = getWatchedCountSinceStart(s) + (s.interleave_offset || 0);
                if (progress > maxInterleave) maxInterleave = progress;
            });
            seriesDataObj.interleave_offset = maxInterleave;
            result = await db.addSeriesWithSeasons(seriesDataObj, seasonsData);
        }

        if (result.success) {
            setModalVisible(false);
            fetchSeries();
            resetForm();
        } else {
            Alert.alert('Error', 'No se pudo guardar');
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

    const updateToChapter = async (seriesId, sNum, eNum) => {
        const series = activeSeries || originalList.find(x => x.id === seriesId);
        if (!series) return;
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
            Alert.alert('¡Serie Completada!', 'Elige destino:', [
                { text: 'En espera', onPress: () => performUpdate('En espera') },
                { text: 'Terminado', onPress: () => performUpdate('Terminado') },
                { text: 'Cancelar', style: 'cancel' }
            ]);
        } else {
            let targetStatus = series.status;
            if (series.status === 'En espera' || series.status === 'Terminado' || series.status === 'Pausado') targetStatus = 'Mirando';
            performUpdate(targetStatus);
        }
    };

    const handleRestart = async () => {
        if (!activeSeries) return;
        const currentAbsolute = getAbsoluteEpisodeCount(activeSeries, activeSeries.current_season, activeSeries.current_episode);
        const initialAbsolute = getAbsoluteEpisodeCount(activeSeries, activeSeries.initial_season || 1, activeSeries.initial_episode || 1);
        let watchedInThisCycle = Math.max(0, currentAbsolute - initialAbsolute);
        if (activeSeries.status === 'Terminado') watchedInThisCycle += 1;

        Alert.alert('Reiniciar', `¿Empezar de cero? (${watchedInThisCycle} vistos)`, [
            { text: 'Cancelar', style: 'cancel' },
            {
                text: 'Reiniciar',
                onPress: async () => {
                    const result = await db.restartSeries(activeSeries.id, watchedInThisCycle);
                    if (result.success) {
                        fetchSeries();
                        setProgressModalVisible(false);
                    }
                }
            }
        ]);
    };

    const handleTogglePauseSeries = async (series) => {
        let newStatus;

        if (series.status === 'Pausado') {
            newStatus = 'Mirando';
            const activeItems = originalList.filter(
                s => (s.status === 'Nueva' || s.status === 'Mirando' || s.status === 'Pausado') && s.id !== series.id
            );

            let maxInterleave = 0;
            activeItems.forEach(s => {
                const progress = getWatchedCountSinceStart(s) + (s.interleave_offset || 0);
                if (progress > maxInterleave) maxInterleave = progress;
            });

            const myInterleave = getWatchedCountSinceStart(series) + (series.interleave_offset || 0);
            const additionalInterleave = Math.max(0, maxInterleave - myInterleave);
            const newInterleaveOffset = (series.interleave_offset || 0) + additionalInterleave;

            const result = await db.updateSeriesProgress(
                series.id,
                series.current_season,
                series.current_episode,
                newStatus,
                null,
                undefined,
                undefined,
                newInterleaveOffset
            );
            if (result.success) fetchSeries();
            return;
        }
        else if (series.status === 'Mirando' || series.status === 'Nueva') newStatus = 'Pausado';
        else return;

        const result = await db.updateSeriesProgress(series.id, series.current_season, series.current_episode, newStatus);
        if (result.success) fetchSeries();
    };

    const handleTogglePauseCategory = async () => {
        const todayStr = getLocalDateString();
        let result;
        if (currentCategory.is_paused) {
            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);
            const yesterdayStr = getLocalDateString(yesterday);
            result = await db.resumeCategory(currentCategory.id, yesterdayStr);
        } else {
            result = await db.pauseCategory(currentCategory.id, todayStr);
        }

        if (result.success) {
            await refreshCategory();
        } else {
            Alert.alert('Error', 'No se pudo cambiar el estado de pausa de la categoría');
        }
    };

    const renderSeriesItem = ({ item, index }) => {
        let badgeStyle = styles.badgeWatching;
        if (item.status === 'Nueva') badgeStyle = styles.badgeNew;
        if (item.status === 'En espera') badgeStyle = styles.badgeHold;
        if (item.status === 'Terminado') badgeStyle = styles.badgeFinished;
        if (item.status === 'Pausado') badgeStyle = { backgroundColor: '#FFF9C4' };
        const isViendo = currentStatusTab === 'Viendo';

        return (
            <TouchableOpacity
                style={[styles.card, { backgroundColor: theme.card }]}
                activeOpacity={0.9}
                onPress={() => {
                    setActiveSeries(item);
                    setProgressModalVisible(true);
                }}
            >
                <View style={styles.cardHeader}>
                    <View style={styles.cardHeaderLeft}>
                        <Text style={[styles.seriesName, { color: theme.text }]}>{item.name}</Text>
                        <View style={[styles.badge, badgeStyle]}>
                            <Text style={styles.badgeText}>{item.status}</Text>
                        </View>
                    </View>
                    <View style={styles.actionButtons}>
                        {isViendo && (
                            <>
                                <TouchableOpacity onPress={() => moveUp(index)} style={styles.iconButton}>
                                    <Text style={{ fontSize: 20, color: theme.accent }}>↑</Text>
                                </TouchableOpacity>
                                <TouchableOpacity onPress={() => moveDown(index)} style={styles.iconButton}>
                                    <Text style={{ fontSize: 20, color: theme.accent }}>↓</Text>
                                </TouchableOpacity>
                                <TouchableOpacity onPress={() => handleTogglePauseSeries(item)} style={styles.iconButton}>
                                    <Text style={{ fontSize: 20 }}>{item.status === 'Pausado' ? '▶️' : '⏸️'}</Text>
                                </TouchableOpacity>
                            </>
                        )}
                        <TouchableOpacity onPress={() => handleEdit(item)} style={styles.iconButton}>
                            <Text style={{ fontSize: 18 }}>✏️</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => handleDelete(item.id)} style={styles.iconButton}>
                            <Text style={{ fontSize: 18 }}>🗑️</Text>
                        </TouchableOpacity>
                    </View>
                </View>
                <Text style={[styles.seriesDescription, { color: theme.subText }]}>{item.description || 'Sin descripción'}</Text>
                <View style={styles.cardProgress}>
                    <Text style={[styles.progressText, { color: theme.text }]}>T{item.current_season} - E{item.current_episode}</Text>
                    <Text style={[styles.totalText, { color: theme.subText }]}>Total Caps: {item.total_episodes || 0}</Text>
                </View>
            </TouchableOpacity>
        );
    };

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
            <StatusBar style={isDarkMode ? 'light' : 'dark'} />
            <View style={[styles.header, { borderBottomColor: theme.border }]}>
                <View style={styles.headerTop}>
                    <TouchableOpacity onPress={onBack} style={styles.backButton}>
                        <Text style={[styles.backText, { color: theme.text }]}>←</Text>
                    </TouchableOpacity>
                    <View style={{ flex: 1, marginLeft: 10 }}>
                        <Text style={[styles.headerTitle, { color: theme.text }]}>{currentCategory.name}</Text>
                        <Text style={[styles.headerSubtitle, { color: theme.subText }]}>
                            {backlogInfo 
                                ? (backlogInfo.items > 0 
                                    ? `Atraso: ${backlogInfo.days}d (${backlogInfo.items} Caps)`
                                    : (backlogInfo.adelantoItems > 0 
                                        ? `Adelanto: ${backlogInfo.adelantoDays}d (${backlogInfo.adelantoItems} Caps)`
                                        : '¡Al día! 🎉'))
                                : 'Calculando...'}
                        </Text>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <TouchableOpacity onPress={handleTogglePauseCategory} style={[styles.pauseCategoryBtn, currentCategory.is_paused && { backgroundColor: '#FFCDD2' }]}>
                            <Text style={{ fontSize: 20 }}>{currentCategory.is_paused ? '▶️' : '⏸️'}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity 
                            onPress={() => onNavigateRegistry(currentCategory)}
                            style={styles.registryButton}
                        >
                            <Text style={styles.registryButtonText}>Registro</Text>
                        </TouchableOpacity>
                    </View>
                </View>

                <View style={styles.tabContainer}>
                    {['Viendo', 'En espera', 'Terminado'].map((t) => (
                        <TouchableOpacity
                            key={t}
                            onPress={() => setCurrentStatusTab(t)}
                            style={[styles.tab, currentStatusTab === t && { borderBottomColor: theme.accent, borderBottomWidth: 3 }]}
                        >
                            <Text style={[styles.tabTextHeader, { color: currentStatusTab === t ? theme.accent : theme.subText }]}>{t}</Text>
                        </TouchableOpacity>
                    ))}
                </View>
            </View>

            <FlatList
                data={getFilteredSeries()}
                renderItem={renderSeriesItem}
                keyExtractor={(item) => item.id.toString()}
                contentContainerStyle={styles.listContent}
                ListHeaderComponent={() => (
                    currentStatusTab === 'Viendo' && (
                        <TouchableOpacity style={[styles.addButton, { backgroundColor: theme.accent }]} onPress={() => { resetForm(); setModalVisible(true); }}>
                            <Text style={styles.addButtonText}>+ Nueva Serie</Text>
                        </TouchableOpacity>
                    )
                )}
            />

            {/* Creation/Edit Modal */}
            <Modal visible={modalVisible} animationType="slide" transparent={true}>
                <View style={styles.modalOverlay}>
                    <View style={[styles.modalContent, { backgroundColor: theme.card }]}>
                        <Text style={[styles.modalTitle, { color: theme.text }]}>{isEditing ? 'Editar Serie' : 'Añadir Serie'}</Text>
                        <ScrollView style={{ maxHeight: 400 }}>
                            <TextInput placeholder="Nombre" style={[styles.input, { color: theme.text, backgroundColor: theme.inputBackground, borderColor: theme.border }]} placeholderTextColor={theme.subText} value={name} onChangeText={setName} />
                            <TextInput placeholder="Descripción" style={[styles.input, { color: theme.text, backgroundColor: theme.inputBackground, borderColor: theme.border }]} placeholderTextColor={theme.subText} value={description} onChangeText={setDescription} />
                            
                            <Text style={[styles.modalSubtitle, { color: theme.text, marginTop: 10 }]}>Temporadas y Capítulos</Text>
                            {seasons.map((s, idx) => (
                                <View key={idx} style={styles.seasonRow}>
                                    <Text style={{ color: theme.text, width: 30 }}>T{s.number}</Text>
                                    <TextInput
                                        placeholder="Caps"
                                        keyboardType="numeric"
                                        style={[styles.inputSeason, { color: theme.text, backgroundColor: theme.inputBackground, borderColor: theme.border }]}
                                        placeholderTextColor={theme.subText}
                                        value={s.episodes}
                                        onChangeText={(val) => updateSeasonEpisodes(idx, val)}
                                    />
                                </View>
                            ))}
                            <View style={{ flexDirection: 'row', gap: 10 }}>
                                <TouchableOpacity onPress={handleAddSeason} style={styles.smallButton}><Text style={{ color: '#fff' }}>+ Temporada</Text></TouchableOpacity>
                                <TouchableOpacity onPress={handleRemoveSeason} style={[styles.smallButton, { backgroundColor: '#EF5350' }]}><Text style={{ color: '#fff' }}>- Temporada</Text></TouchableOpacity>
                            </View>

                            <Text style={[styles.modalSubtitle, { color: theme.text, marginTop: 20 }]}>Progreso Actual</Text>
                            <View style={styles.progressInputRow}>
                                <View style={{ flex: 1 }}>
                                    <Text style={{ color: theme.subText, fontSize: 12 }}>Temp.</Text>
                                    <TextInput keyboardType="numeric" style={[styles.input, { color: theme.text, backgroundColor: theme.inputBackground, borderColor: theme.border }]} value={String(currentSeason)} onChangeText={setCurrentSeason} />
                                </View>
                                <View style={{ flex: 1 }}>
                                    <Text style={{ color: theme.subText, fontSize: 12 }}>Cap.</Text>
                                    <TextInput keyboardType="numeric" style={[styles.input, { color: theme.text, backgroundColor: theme.inputBackground, borderColor: theme.border }]} value={String(currentEpisode)} onChangeText={setCurrentEpisode} />
                                </View>
                            </View>
                        </ScrollView>

                        <View style={styles.modalButtons}>
                            <TouchableOpacity style={[styles.modalButton, { backgroundColor: theme.border }]} onPress={() => setModalVisible(false)}>
                                <Text style={{ color: theme.text }}>Cancelar</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={[styles.modalButton, { backgroundColor: theme.accent }]} onPress={handleSave}>
                                <Text style={styles.modalButtonText}>Guardar</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            </Modal>

            {/* Progress Grid Modal */}
            <Modal visible={progressModalVisible} animationType="fade" transparent={true}>
                <View style={styles.modalOverlay}>
                    <View style={[styles.gridModalContent, { backgroundColor: theme.card }]}>
                        <View style={styles.gridHeader}>
                            <Text style={[styles.modalTitle, { color: theme.text }]}>{activeSeries?.name}</Text>
                            <TouchableOpacity onPress={handleRestart} style={[styles.restartBtn, { backgroundColor: theme.accent + '22' }]}>
                                <Text style={{ color: theme.accent, fontWeight: 'bold' }}>Reiniciar</Text>
                            </TouchableOpacity>
                            <TouchableOpacity onPress={() => setProgressModalVisible(false)}>
                                <Text style={{ fontSize: 20, color: theme.text }}>✕</Text>
                            </TouchableOpacity>
                        </View>

                        <FlatList
                            data={activeSeries?.seasons || []}
                            keyExtractor={(s) => s.id.toString()}
                            renderItem={({ item: season }) => (
                                <View style={styles.seasonGridContainer}>
                                    <Text style={[styles.seasonGridTitle, { color: theme.text }]}>Temporada {season.season_number}</Text>
                                    <View style={styles.grid}>
                                        {Array.from({ length: seasonVisibleCounts[season.season_number] || 0 }).map((_, i) => {
                                            const epNum = i + 1;
                                            const isWatched = (season.season_number < activeSeries.current_season) || 
                                                              (season.season_number === activeSeries.current_season && epNum < activeSeries.current_episode) ||
                                                              (activeSeries.status === 'Terminado');
                                            const isCurrent = season.season_number === activeSeries.current_season && epNum === activeSeries.current_episode && activeSeries.status !== 'Terminado';

                                            return (
                                                <TouchableOpacity
                                                    key={i}
                                                    style={[
                                                        styles.gridItem,
                                                        { backgroundColor: theme.inputBackground },
                                                        isWatched && { backgroundColor: theme.accent },
                                                        isCurrent && { borderWidth: 2, borderColor: theme.accent }
                                                    ]}
                                                    onPress={() => updateToChapter(activeSeries.id, season.season_number, epNum)}
                                                >
                                                    <Text style={[styles.gridItemText, { color: theme.text }, isWatched && { color: '#fff' }]}>{epNum}</Text>
                                                </TouchableOpacity>
                                            );
                                        })}
                                    </View>
                                    {season.episode_count > (seasonVisibleCounts[season.season_number] || 0) && (
                                        <TouchableOpacity 
                                            onPress={() => setSeasonVisibleCounts(prev => ({ ...prev, [season.season_number]: Math.min(season.episode_count, prev[season.season_number] + 100) }))}
                                            style={{ marginTop: 10, alignSelf: 'center' }}
                                        >
                                            <Text style={{ color: theme.accent }}>Cargar más...</Text>
                                        </TouchableOpacity>
                                    )}
                                </View>
                            )}
                        />
                    </View>
                </View>
            </Modal>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    header: { padding: 15, borderBottomWidth: 1 },
    headerTop: { flexDirection: 'row', alignItems: 'center' },
    backButton: { padding: 5 },
    backText: { fontSize: 24, fontWeight: 'bold' },
    headerTitle: { fontSize: 20, fontWeight: 'bold' },
    headerSubtitle: { fontSize: 13 },
    registryButton: { backgroundColor: '#4CAF50', paddingHorizontal: 15, paddingVertical: 8, borderRadius: 8, marginLeft: 10 },
    registryButtonText: { color: '#fff', fontWeight: 'bold' },
    pauseCategoryBtn: { padding: 8, borderRadius: 8, backgroundColor: '#f0f0f0' },
    tabContainer: { flexDirection: 'row', marginTop: 15, gap: 20 },
    tab: { paddingVertical: 5 },
    tabTextHeader: { fontWeight: 'bold', fontSize: 15 },
    listContent: { padding: 15, paddingBottom: 100 },
    addButton: { padding: 15, borderRadius: 12, alignItems: 'center', marginBottom: 20 },
    addButtonText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
    card: { padding: 15, borderRadius: 15, marginBottom: 15, elevation: 3, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 4 },
    cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
    cardHeaderLeft: { flex: 1 },
    seriesName: { fontSize: 18, fontWeight: 'bold' },
    badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 5, alignSelf: 'flex-start', marginTop: 5 },
    badgeText: { fontSize: 10, fontWeight: 'bold', color: '#fff' },
    badgeWatching: { backgroundColor: '#2196F3' },
    badgeNew: { backgroundColor: '#4CAF50' },
    badgeHold: { backgroundColor: '#FF9800' },
    badgeFinished: { backgroundColor: '#9C27B0' },
    actionButtons: { flexDirection: 'row', gap: 10 },
    iconButton: { padding: 5 },
    seriesDescription: { fontSize: 14, marginVertical: 10 },
    cardProgress: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    progressText: { fontWeight: 'bold' },
    totalText: { fontSize: 12 },
    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 20 },
    modalContent: { borderRadius: 20, padding: 20, elevation: 5 },
    modalTitle: { fontSize: 20, fontWeight: 'bold', marginBottom: 20 },
    modalSubtitle: { fontSize: 14, fontWeight: 'bold', marginBottom: 10 },
    input: { borderWidth: 1, borderRadius: 10, padding: 12, marginBottom: 15 },
    seasonRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
    inputSeason: { flex: 1, borderWidth: 1, borderRadius: 8, padding: 8 },
    smallButton: { backgroundColor: '#2196F3', padding: 8, borderRadius: 8 },
    progressInputRow: { flexDirection: 'row', gap: 15 },
    modalButtons: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 20 },
    modalButton: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10 },
    modalButtonText: { color: '#fff', fontWeight: 'bold' },
    gridModalContent: { flex: 0.9, borderRadius: 20, padding: 20 },
    gridHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
    restartBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
    seasonGridContainer: { marginBottom: 25 },
    seasonGridTitle: { fontSize: 16, fontWeight: 'bold', marginBottom: 15 },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    gridItem: { width: 45, height: 45, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
    gridItemText: { fontWeight: 'bold' }
});
