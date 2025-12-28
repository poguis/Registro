import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, FlatList, Modal, TextInput, Alert, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import db from '../services/db';
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
                    calculateHeaderBacklog(enrichedList);
                }
            } catch (error) {
                console.error("Error fetching series:", error);
            }
        }
    };

    useEffect(() => {
        fetchSeries();
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
            days: backlogDays,
            items: backlogValue
        });
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
        if (!series.seasons || !Array.isArray(series.seasons)) return 0;
        const currentAbsolute = getAbsoluteEpisodeCount(series, series.current_season, series.current_episode);
        const initS = series.initial_season || 1;
        const initE = series.initial_episode || 1;
        const initialAbsolute = getAbsoluteEpisodeCount(series, initS, initE);
        let diff = currentAbsolute - initialAbsolute;
        if (series.status === 'Terminado' || series.status === 'En espera') {
            diff += 1;
        }
        const cleanDiff = diff < 0 ? 0 : diff;
        return cleanDiff + (series.cycle_offset || 0);
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
            return originalList.filter(s => s.status === 'Nueva' || s.status === 'Mirando');
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

        const activeCount = originalList.filter(s => s.status === 'Nueva' || s.status === 'Mirando').length;
        if (!isEditing && activeCount >= category.series_count) {
            return Alert.alert('Límite Alcanzado', `Máximo ${category.series_count} series activas.`);
        }

        const seasonsData = validSeasons.map(s => ({
            season_number: s.number,
            episode_count: parseInt(s.episodes)
        }));

        let result;
        if (isEditing) {
            const currentSeries = originalList.find(s => s.id === editingSeriesId);
            const seriesData = { name, description, total_seasons: validSeasons.length };
            if (currentSeries && (currentSeries.status === 'En espera' || currentSeries.status === 'Terminado')) {
                seriesData.status = 'Mirando';
                let nextS = currentSeries.current_season;
                let nextE = currentSeries.current_episode;
                const prevSeasonObj = currentSeries.seasons.find(s => s.season_number === nextS);
                const prevMax = prevSeasonObj ? prevSeasonObj.episode_count : 0;
                const wasAtEnd = (nextE >= prevMax) || (currentSeries.status === 'Terminado');
                if (wasAtEnd) {
                    const newSeasonObj = seasonsData.find(s => s.season_number === nextS);
                    if ((newSeasonObj?.episode_count || 0) > prevMax) {
                        nextE = prevMax + 1;
                    } else if (seasonsData.length > nextS) {
                        nextS += 1;
                        nextE = 1;
                    }
                }
                seriesData.current_season = nextS;
                seriesData.current_episode = nextE;
            }
            result = await db.updateSeriesWithSeasons(editingSeriesId, seriesData, seasonsData);
        } else {
            const seriesData = {
                category_id: category.id,
                name,
                description,
                status: status,
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
            if (series.status === 'En espera' || series.status === 'Terminado') targetStatus = 'Mirando';
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

    const renderSeriesItem = ({ item, index }) => {
        let badgeStyle = styles.badgeWatching;
        if (item.status === 'Nueva') badgeStyle = styles.badgeNew;
        if (item.status === 'En espera') badgeStyle = styles.badgeHold;
        if (item.status === 'Terminado') badgeStyle = styles.badgeFinished;
        const isViendo = currentStatusTab === 'Viendo';

        return (
            <TouchableOpacity style={[styles.card, { backgroundColor: theme.card }]} activeOpacity={0.9} onPress={() => { setActiveSeries(item); setProgressModalVisible(true); }}>
                <View style={styles.cardHeader}>
                    <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4, flexWrap: 'wrap' }}>
                            <Text style={[styles.cardTitle, { color: theme.text }]}>{item.name}</Text>
                            <View style={[styles.badge, badgeStyle]}>
                                <Text style={styles.badgeText}>{item.status}</Text>
                            </View>
                        </View>
                        <Text style={[styles.cardProgress, { color: theme.accent }]}>
                            T{item.current_season} - E{item.current_episode} <Text style={{ fontWeight: 'normal', color: theme.subText }}>de {item.total_seasons} T.</Text>
                        </Text>
                    </View>
                    <View style={styles.cardActions}>
                        <TouchableOpacity onPress={() => { setActiveSeries(item); setProgressModalVisible(true); }} style={[styles.gridBtn, { backgroundColor: theme.inputBackground }]}>
                            <Text style={{ fontSize: 18 }}>👁️</Text>
                        </TouchableOpacity>
                        {isViendo && (
                            <View style={styles.orderButtons}>
                                <TouchableOpacity onPress={() => moveUp(index)} style={[styles.orderBtn, { backgroundColor: theme.inputBackground, borderColor: theme.border }]}>
                                    <Text style={[styles.orderBtnText, { color: theme.accent }]}>↑</Text>
                                </TouchableOpacity>
                                <TouchableOpacity onPress={() => moveDown(index)} style={[styles.orderBtn, { backgroundColor: theme.inputBackground, borderColor: theme.border }]}>
                                    <Text style={[styles.orderBtnText, { color: theme.accent }]}>↓</Text>
                                </TouchableOpacity>
                            </View>
                        )}
                        <TouchableOpacity onPress={() => handleEdit(item)} style={[styles.editBtn, { backgroundColor: theme.accent + '22' }]}>
                            <Text style={{ fontSize: 16 }}>✏️</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => handleDelete(item.id)} style={[styles.deleteBtn, { backgroundColor: '#FFEBEE' }]}>
                            <Text style={{ fontSize: 16 }}>🗑️</Text>
                        </TouchableOpacity>
                    </View>
                </View>
                {item.description ? <Text style={[styles.cardDesc, { color: theme.subText }]} numberOfLines={2}>{item.description}</Text> : null}
            </TouchableOpacity>
        );
    };

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
            <StatusBar style={isDarkMode ? "light" : "dark"} />
            <View style={[styles.header, { backgroundColor: theme.header, borderBottomColor: theme.border }]}>
                <TouchableOpacity onPress={onBack} style={styles.backButton}>
                    <Text style={[styles.backButtonText, { color: theme.text }]}>←</Text>
                </TouchableOpacity>
                <View style={{ flex: 1, marginLeft: 10 }}>
                    <Text style={[styles.headerTitle, { color: theme.text }]}>{category.name}</Text>
                    {backlogInfo && (
                        <Text style={[styles.headerSubtitle, (backlogInfo.days <= 0 && backlogInfo.items <= 0) ? { color: '#4CAF50' } : { color: '#EF6C00' }]}>
                            {(backlogInfo.days <= 0 && backlogInfo.items <= 0) ? '¡Al día! 🎉' : `Atraso: ${backlogInfo.days}d, ${backlogInfo.items}c`}
                        </Text>
                    )}
                </View>
                <View style={{ flexDirection: 'row', gap: 10 }}>
                    <TouchableOpacity onPress={() => onNavigateRegistry('CHAPTER_REGISTRY', { categoryId: category.id })} style={[styles.addButton, { backgroundColor: theme.inputBackground }]}>
                        <Text style={{ fontSize: 20 }}>📋</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.addButton, { backgroundColor: theme.accent }]} onPress={() => { resetForm(); setModalVisible(true); }}>
                        <Text style={styles.addButtonText}>+</Text>
                    </TouchableOpacity>
                </View>
            </View>

            <View style={[styles.tabContainer, { backgroundColor: theme.header, borderBottomColor: theme.border }]}>
                {['Viendo', 'En espera', 'Terminado'].map((tab) => (
                    <TouchableOpacity
                        key={tab}
                        style={[styles.tabButton, { backgroundColor: theme.inputBackground, borderColor: theme.border }, currentStatusTab === tab && { backgroundColor: theme.accent, borderColor: theme.accent }]}
                        onPress={() => setCurrentStatusTab(tab)}
                    >
                        <Text style={[styles.tabText, { color: theme.subText }, currentStatusTab === tab && { color: '#fff' }]}>
                            {tab === 'Viendo' ? '📺 ' : tab === 'En espera' ? '⏳ ' : '✅ '}{tab}
                        </Text>
                    </TouchableOpacity>
                ))}
            </View>

            <FlatList
                data={getFilteredSeries()}
                renderItem={renderSeriesItem}
                keyExtractor={item => item.id.toString()}
                contentContainerStyle={styles.listContent}
                ListEmptyComponent={<Text style={[styles.emptyText, { color: theme.subText }]}>No hay series.</Text>}
            />

            <Modal visible={modalVisible} animationType="slide">
                <SafeAreaView style={[styles.modalContainer, { backgroundColor: theme.background }]}>
                    <View style={[styles.modalHeader, { borderBottomColor: theme.border }]}>
                        <Text style={[styles.modalTitle, { color: theme.text }]}>{isEditing ? 'Editar Serie' : 'Nueva Serie'}</Text>
                        <TouchableOpacity onPress={() => setModalVisible(false)}>
                            <Text style={styles.closeText}>Cerrar</Text>
                        </TouchableOpacity>
                    </View>
                    <ScrollView style={styles.modalForm}>
                        <Text style={[styles.label, { color: theme.accent }]}>Nombre</Text>
                        <TextInput style={[styles.input, { backgroundColor: theme.inputBackground, color: theme.text, borderColor: theme.border }]} value={name} onChangeText={setName} placeholder="Ej: Breaking Bad" placeholderTextColor={theme.subText} />
                        <Text style={[styles.label, { color: theme.accent }]}>Descripción</Text>
                        <TextInput style={[styles.input, { backgroundColor: theme.inputBackground, color: theme.text, borderColor: theme.border }]} value={description} onChangeText={setDescription} placeholder="Opcional" placeholderTextColor={theme.subText} />
                        <Text style={[styles.label, { color: theme.accent }]}>Estado</Text>
                        <View style={styles.statusContainer}>
                            {['Nueva', 'Mirando'].map(opt => (
                                <TouchableOpacity key={opt} style={[styles.statusOption, { backgroundColor: theme.card, borderColor: theme.border }, status === opt && { backgroundColor: theme.accent, borderColor: theme.accent }]} onPress={() => setStatus(opt)}>
                                    <Text style={[styles.statusText, { color: theme.subText }, status === opt && { color: '#fff' }]}>{opt}</Text>
                                </TouchableOpacity>
                            ))}
                        </View>
                        {!isEditing && status === 'Mirando' && (
                            <View style={[styles.row, { gap: 10, marginTop: 15 }]}>
                                <View style={{ flex: 1 }}>
                                    <Text style={[styles.label, { color: theme.accent }]}>Temporada</Text>
                                    <TextInput style={[styles.input, { backgroundColor: theme.inputBackground, color: theme.text, borderColor: theme.border }]} keyboardType="numeric" value={String(currentSeason)} onChangeText={(v) => setCurrentSeason(parseInt(v) || 1)} />
                                </View>
                                <View style={{ flex: 1 }}>
                                    <Text style={[styles.label, { color: theme.accent }]}>Capítulo</Text>
                                    <TextInput style={[styles.input, { backgroundColor: theme.inputBackground, color: theme.text, borderColor: theme.border }]} keyboardType="numeric" value={String(currentEpisode)} onChangeText={(v) => setCurrentEpisode(parseInt(v) || 1)} />
                                </View>
                            </View>
                        )}
                        <Text style={[styles.sectionTitle, { color: theme.text }]}>Temporadas</Text>
                        {seasons.map((s, i) => (
                            <View key={i} style={[styles.seasonRow, { backgroundColor: theme.card }]}>
                                <Text style={[styles.seasonLabel, { color: theme.text }]}>Temporada {s.number}:</Text>
                                <TextInput style={[styles.seasonInput, { backgroundColor: theme.inputBackground, color: theme.text, borderColor: theme.border }]} keyboardType="numeric" value={s.episodes} onChangeText={(v) => updateSeasonEpisodes(i, v)} placeholder="Capítulos" placeholderTextColor={theme.subText} />
                            </View>
                        ))}
                        <View style={styles.seasonActions}>
                            <TouchableOpacity onPress={handleAddSeason}><Text style={{ color: theme.accent, fontWeight: 'bold' }}>+ Agregar</Text></TouchableOpacity>
                            <TouchableOpacity onPress={handleRemoveSeason}><Text style={{ color: '#FF5252', fontWeight: 'bold' }}>- Quitar</Text></TouchableOpacity>
                        </View>
                        <TouchableOpacity style={[styles.saveButton, { backgroundColor: theme.accent }]} onPress={handleSave}><Text style={styles.saveButtonText}>Guardar</Text></TouchableOpacity>
                        <View style={{ height: 50 }} />
                    </ScrollView>
                </SafeAreaView>
            </Modal>

            <Modal transparent visible={progressModalVisible} animationType="fade">
                <View style={[styles.overlay, { backgroundColor: theme.modalOverlay }]}>
                    <View style={[styles.progressModalContent, { backgroundColor: theme.card }]}>
                        <View style={[styles.progressHeader, { borderBottomColor: theme.border }]}>
                            <View style={{ flex: 1 }}>
                                <Text style={[styles.progressSeriesName, { color: theme.text }]}>{activeSeries?.name}</Text>
                                <Text style={[styles.progressStatus, { color: theme.subText }]}>{activeSeries?.status} - T{activeSeries?.current_season} E{activeSeries?.current_episode}</Text>
                            </View>
                            <TouchableOpacity onPress={() => setProgressModalVisible(false)} style={[styles.closeGridBtn, { backgroundColor: theme.inputBackground }]}><Text style={{ color: theme.text }}>✕</Text></TouchableOpacity>
                        </View>
                        <ScrollView style={{ padding: 15 }}>
                            {activeSeries?.seasons.map(s => (
                                <View key={s.season_number} style={styles.seasonGroup}>
                                    <Text style={[styles.seasonTitle, { color: theme.text }]}>Temporada {s.season_number}</Text>
                                    <View style={styles.episodeGrid}>
                                        {Array.from({ length: s.episode_count }).map((_, i) => {
                                            const ep = i + 1;
                                            const isW = (s.season_number < activeSeries.current_season) || (s.season_number === activeSeries.current_season && ep < activeSeries.current_episode);
                                            const isC = (s.season_number === activeSeries.current_season && ep === activeSeries.current_episode);
                                            return (
                                                <TouchableOpacity key={ep} style={[styles.episodeBox, { backgroundColor: theme.inputBackground, borderColor: theme.border }, isW && styles.episodeWatched, isC && { backgroundColor: theme.accent, borderColor: theme.accent }]} onPress={() => updateToChapter(activeSeries.id, s.season_number, ep)}>
                                                    <Text style={[styles.episodeNum, { color: theme.text }, (isW || isC) && { color: '#fff' }]}>{ep}</Text>
                                                </TouchableOpacity>
                                            );
                                        })}
                                    </View>
                                </View>
                            ))}
                        </ScrollView>
                        <View style={[styles.gridFooter, { backgroundColor: theme.header, borderTopColor: theme.border }]}>
                            {activeSeries?.status === 'Terminado' && (
                                <TouchableOpacity style={styles.restartBtn} onPress={handleRestart}><Text style={styles.restartBtnText}>🔄 Reiniciar Serie</Text></TouchableOpacity>
                            )}
                        </View>
                    </View>
                </View>
            </Modal>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 15, borderBottomWidth: 1 },
    backButton: { padding: 5 },
    backButtonText: { fontSize: 24, fontWeight: 'bold' },
    headerTitle: { fontSize: 18, fontWeight: 'bold' },
    headerSubtitle: { fontSize: 13, fontWeight: 'bold' },
    addButton: { width: 35, height: 35, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
    addButtonText: { color: '#fff', fontSize: 24, paddingBottom: 2 },
    tabContainer: { flexDirection: 'row', padding: 10, borderBottomWidth: 1, gap: 10 },
    tabButton: { flex: 1, paddingVertical: 8, borderRadius: 10, alignItems: 'center', borderWidth: 1 },
    tabText: { fontSize: 12, fontWeight: 'bold' },
    listContent: { padding: 15 },
    card: { padding: 15, borderRadius: 16, marginBottom: 12, elevation: 3, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 4 },
    cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
    cardTitle: { fontSize: 17, fontWeight: 'bold' },
    cardProgress: { fontSize: 13, fontWeight: 'bold', marginTop: 2 },
    cardDesc: { fontSize: 12, marginTop: 8, lineHeight: 16 },
    badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, marginLeft: 8 },
    badgeNew: { backgroundColor: '#E0F2F1' },
    badgeWatching: { backgroundColor: '#E3F2FD' },
    badgeHold: { backgroundColor: '#FFF3E0' },
    badgeFinished: { backgroundColor: '#E8F5E9' },
    badgeText: { fontSize: 9, fontWeight: 'bold', color: '#455A64', textTransform: 'uppercase' },
    cardActions: { flexDirection: 'row', gap: 6 },
    gridBtn: { padding: 8, borderRadius: 8 },
    orderButtons: { flexDirection: 'row', gap: 4 },
    orderBtn: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, borderWidth: 1 },
    orderBtnText: { fontSize: 14, fontWeight: 'bold' },
    editBtn: { padding: 8, borderRadius: 8 },
    deleteBtn: { padding: 8, borderRadius: 8 },
    emptyText: { textAlign: 'center', marginTop: 40 },
    modalContainer: { flex: 1 },
    modalHeader: { flexDirection: 'row', justifyContent: 'space-between', padding: 20, alignItems: 'center', borderBottomWidth: 1 },
    modalTitle: { fontSize: 20, fontWeight: 'bold' },
    closeText: { color: '#FF5252', fontSize: 16, fontWeight: 'bold' },
    modalForm: { padding: 20 },
    label: { fontSize: 13, marginBottom: 5, marginTop: 10, fontWeight: 'bold' },
    input: { borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 16 },
    statusContainer: { flexDirection: 'row', gap: 10, marginTop: 5 },
    statusOption: { flex: 1, padding: 10, alignItems: 'center', borderWidth: 1, borderRadius: 10 },
    statusText: { fontWeight: 'bold', fontSize: 13 },
    sectionTitle: { fontSize: 18, fontWeight: 'bold', marginTop: 25, marginBottom: 15 },
    seasonRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10, padding: 10, borderRadius: 10 },
    seasonLabel: { flex: 1, fontSize: 14, fontWeight: 'bold' },
    seasonInput: { width: 80, borderWidth: 1, borderRadius: 8, padding: 6, textAlign: 'center' },
    seasonActions: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10, paddingHorizontal: 5 },
    saveButton: { padding: 15, borderRadius: 12, alignItems: 'center', marginTop: 30 },
    saveButtonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
    overlay: { flex: 1, justifyContent: 'flex-end' },
    progressModalContent: { borderTopLeftRadius: 25, borderTopRightRadius: 25, height: '85%' },
    progressHeader: { flexDirection: 'row', padding: 20, borderBottomWidth: 1, alignItems: 'center' },
    progressSeriesName: { fontSize: 20, fontWeight: 'bold' },
    progressStatus: { fontSize: 13, marginTop: 2 },
    closeGridBtn: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
    seasonGroup: { marginBottom: 20 },
    seasonTitle: { fontSize: 15, fontWeight: 'bold', marginBottom: 10 },
    episodeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    episodeBox: { width: 40, height: 40, borderRadius: 8, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
    episodeWatched: { backgroundColor: '#4CAF50', borderColor: '#4CAF50' },
    episodeNum: { fontSize: 14, fontWeight: 'bold' },
    gridFooter: { padding: 20, borderTopWidth: 1, alignItems: 'center' },
    restartBtn: { backgroundColor: '#E8F5E9', paddingVertical: 10, paddingHorizontal: 20, borderRadius: 10, borderWidth: 1, borderColor: '#C8E6C9' },
    restartBtnText: { color: '#2E7D32', fontWeight: 'bold' },
    row: { flexDirection: 'row' }
});
