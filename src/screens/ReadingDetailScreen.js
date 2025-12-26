import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, FlatList, Modal, TextInput, Alert, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import db from '../services/db';

export default function ReadingDetailScreen({ user, category, onBack, onNavigateRegistry }) {
    const [seriesList, setSeriesList] = useState([]);
    const [modalVisible, setModalVisible] = useState(false);

    // Form State
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [status, setStatus] = useState('Nueva'); // 'Nueva' | 'Mirando'

    // Volume State (Replacing Seasons)
    // We retain the internal structure of "seasons" logic but map it to Volume logic
    // We will assume 1 "Season" = 1 set of volumes if needed, or treated as Volumes directly.
    // However, the user specifically mentioned "Tomos".
    // Usually manga has "Volumes" and "Chapters".
    // Based on user request "en serie puedes poner mejor Tomos", and frequency "-3: en 3 días 1 tomo".
    // This implies we are tracking VOLUMES, not chapters within volumes. Or that "Season" concept maps to "Volume" and "Episodes" maps to 1?
    // User said: "Agregar más capitulos a la última temporada. Agregar más temporadas obvio con sus respectivos capitulos."
    // BUT for reading: "hare el registro de leer tomos, no capitulos."
    // This implies the unit of progress is the Volume itself? Or pages?
    // "3 días, 1 tomo".
    // If I read "1 tomo", is that one tick?
    // Let's assume the hierarchy is: Series -> Titles? No.
    // Let's assume for Reading:
    // Season -> "Año" or "Arco"?
    // Episode -> "Tomo"?
    // OR:
    // Season 1 (only 1 season always?) -> Episode X = Tomo X?
    // Let's look at the UI request. "Agregar más capitulos a la última temporada".
    // In Reading context: "Agregar más tomos".
    // So "Season" = Collection/Box Set? And "Episode" = Tomo?
    // Or simpler: Just one list of Tomos?
    // The user said: "en serie puedes poner mejor Tomos".
    // Let's stick to the structure:
    // Visual Label: "Temporada" -> "Colección" or Hidden?
    // Visual Label: "Capítulo" -> "Tomo".

    // Actually, looking at the standard manga structure: Users often track Chapters OR Volumes.
    // The user said explicitly: "hare el registro de leer tomos".
    // So "Chapter 1" in DB = "Tomo 1".
    // "Season 1" in DB = "Main Series" (usually just 1 season).
    // If the user adds "More seasons" for manga, maybe they mean "Part 2", "Part 3"? (e.g. Naruto vs Shippuden, or Jojo parts).
    // Let's adapt labels: "Temporada" -> "Parte/Arco", "Capítulo" -> "Tomo".

    const [seasons, setSeasons] = useState([{ number: 1, episodes: '' }]); // Array of {number, episodes (Tomos)}

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

    const calculateHeaderBacklog = (currentSeriesList = originalList) => {
        if (!category?.start_date || !category?.frequency) return;

        const startStr = category.start_date;
        const freq = category.frequency;
        const daysOfWeek = category.days_of_week;

        const scheduleCalc = calculateScheduleDays(startStr, daysOfWeek);
        const validDaysPassed = scheduleCalc.validDays;

        let targetTotal = 0;
        if (freq > 0) {
            targetTotal = validDaysPassed * freq;
        } else if (freq < 0) {
            const daysPerItem = Math.abs(freq);
            targetTotal = Math.floor(validDaysPassed / daysPerItem);
        }

        let totalWatchedSinceStart = 0;
        currentSeriesList.forEach(s => {
            totalWatchedSinceStart += getWatchedCountSinceStart(s);
        });

        const backlogValue = Math.max(0, targetTotal - totalWatchedSinceStart);

        let backlogDays = 0;
        if (freq > 0) {
            backlogDays = Math.ceil(backlogValue / freq);
        } else if (freq < 0) {
            backlogDays = backlogValue * Math.abs(freq);
        }

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
            const newSeasons = seasons.slice(0, -1);
            setSeasons(newSeasons);
        } else {
            Alert.alert('Aviso', 'Debe haber al menos una parte/temporada.');
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
            'Eliminar Lectura',
            '¿Estás seguro de que quieres eliminar? Se borrarán también sus registros.',
            [
                { text: 'Cancelar', style: 'cancel' },
                {
                    text: 'Eliminar',
                    style: 'destructive',
                    onPress: async () => {
                        const result = await db.deleteSeries(seriesId);
                        if (result.success) {
                            fetchSeries();
                            Alert.alert('Éxito', 'Eliminado correctamente');
                        }
                    }
                }
            ]
        );
    };

    const handleSave = async () => {
        if (!name.trim()) return Alert.alert('Error', 'El nombre es obligatorio');
        const validSeasons = seasons.filter(s => parseInt(s.episodes) > 0);
        if (validSeasons.length === 0) return Alert.alert('Error', 'Debes añadir al menos una parte con tomos válidos');

        if (status === 'Mirando') {
            const seasonNum = parseInt(currentSeason);
            const episodeNum = parseInt(currentEpisode);
            if (isNaN(seasonNum) || isNaN(episodeNum)) return Alert.alert('Error', 'Valores inválidos');
            if (seasonNum < 1 || seasonNum > validSeasons.length) return Alert.alert('Error', `La parte actual debe estar entre 1 y ${validSeasons.length}`);
            const maxEpisodes = parseInt(validSeasons[seasonNum - 1].episodes);
            if (episodeNum < 1 || episodeNum > maxEpisodes) return Alert.alert('Error', `El tomo actual debe estar entre 1 y ${maxEpisodes}`);
        }

        const activeCount = originalList.filter(s => s.status === 'Nueva' || s.status === 'Mirando').length;
        if (!isEditing && activeCount >= category.series_count) {
            return Alert.alert('Límite Alcanzado', `Solo puedes tener hasta ${category.series_count} lecturas activas.`);
        }

        const seasonsData = validSeasons.map(s => ({
            season_number: s.number,
            episode_count: parseInt(s.episodes)
        }));

        let result;
        if (isEditing) {
            // Apply logic for adding content (same as SeriesDetailScreen but adapted context if needed)
            const currentSeries = originalList.find(s => s.id === editingSeriesId);
            const seriesData = {
                name,
                description,
                total_seasons: validSeasons.length
            };
            if (currentSeries && (currentSeries.status === 'En espera' || currentSeries.status === 'Terminado')) {
                seriesData.status = 'Mirando';
                let nextS = currentSeries.current_season;
                let nextE = currentSeries.current_episode;
                const prevSeasonObj = currentSeries.seasons.find(s => s.season_number === nextS);
                const prevMax = prevSeasonObj ? prevSeasonObj.episode_count : 0;
                const wasAtEnd = (nextE >= prevMax) || (currentSeries.status === 'Terminado');
                if (wasAtEnd) {
                    const newSeasonObj = seasonsData.find(s => s.season_number === nextS);
                    const newMax = newSeasonObj ? newSeasonObj.episode_count : 0;
                    if (newMax > prevMax) {
                        nextE = prevMax + 1;
                    } else if (seasonsData.length > currentSeries.total_seasons || seasonsData.length > nextS) {
                        const nextSeasonData = seasonsData.find(s => s.season_number === nextS + 1);
                        if (nextSeasonData) {
                            nextS += 1;
                            nextE = 1;
                        }
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
            Alert.alert('Éxito', isEditing ? 'Actualizado' : 'Agregado');
        } else {
            Alert.alert('Error', 'No se pudo guardar');
        }
    };

    const openProgressGrid = (series) => {
        setActiveSeries(series);
        setProgressModalVisible(true);
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
            Alert.alert(
                '¡Lectura Completada!',
                'Has llegado al final. ¿A dónde quieres enviar esto?',
                [
                    { text: 'En espera (Próx. contenido)', onPress: () => performUpdate('En espera') },
                    { text: 'Terminado (Fin total)', onPress: () => performUpdate('Terminado') },
                    { text: 'Cancelar', style: 'cancel' }
                ]
            );
        } else {
            let targetStatus = series.status;
            if (series.status === 'En espera' || series.status === 'Terminado') {
                targetStatus = 'Mirando';
            }
            performUpdate(targetStatus);
        }
    };

    const handleRestart = async () => {
        if (!activeSeries) return;
        const currentAbsolute = getAbsoluteEpisodeCount(activeSeries, activeSeries.current_season, activeSeries.current_episode);
        const initS = activeSeries.initial_season || 1;
        const initE = activeSeries.initial_episode || 1;
        const initialAbsolute = getAbsoluteEpisodeCount(activeSeries, initS, initE);
        let watchedInThisCycle = Math.max(0, currentAbsolute - initialAbsolute);
        if (activeSeries.status === 'Terminado') {
            watchedInThisCycle += 1;
        }

        Alert.alert(
            'Reiniciar Lectura',
            `¿Quieres empezar desde cero? Los ${watchedInThisCycle} tomos leídos se guardarán en tu historial.`,
            [
                { text: 'Cancelar', style: 'cancel' },
                {
                    text: 'Reiniciar',
                    onPress: async () => {
                        const result = await db.restartSeries(activeSeries.id, watchedInThisCycle);
                        if (result.success) {
                            fetchSeries();
                            setProgressModalVisible(false);
                            Alert.alert('Éxito', 'Reiniciado y movido a "Viendo"');
                        }
                    }
                }
            ]
        );
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
                                <Text style={styles.badgeText}>
                                    {item.status === 'Mirando' ? 'Leyendo' : (item.status === 'Nueva' ? 'Nuevo Tomo' : item.status)}
                                </Text>
                            </View>
                        </View>
                        <Text style={styles.cardProgress}>
                            {item.total_seasons > 1 ? `Parte ${item.current_season} -` : ''} Tomo {item.current_episode} <Text style={{ fontWeight: 'normal', color: '#999' }}>de {item.total_seasons} Partes</Text>
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
                <View style={{ marginLeft: 10 }}>
                    <Text style={styles.headerTitle}>{category.name}</Text>
                    <Text style={styles.headerSubtitle}>
                        Lecturas: {originalList.filter(s => s.status === 'Nueva' || s.status === 'Mirando').length} / {category?.series_count || 0}
                    </Text>
                    {backlogInfo && (
                        <Text style={[styles.headerSubtitle, { marginTop: 2 }, (backlogInfo.days <= 0 && backlogInfo.items <= 0) ? { color: '#4CAF50', fontWeight: 'bold' } : { color: '#EF6C00', fontWeight: 'bold' }]}>
                            {(backlogInfo.days <= 0 && backlogInfo.items <= 0)
                                ? '¡Estás al día! 🎉'
                                : `Atraso: ${backlogInfo.days} días, ${backlogInfo.items} Tomos`}
                        </Text>
                    )}
                </View>
                <View style={{ flexDirection: 'row' }}>
                    <TouchableOpacity onPress={() => onNavigateRegistry('READING_REGISTRY')} style={[styles.addButton, { backgroundColor: '#FFF3E0', marginRight: 10 }]}>
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
                <TouchableOpacity
                    style={[styles.tabButton, currentStatusTab === 'Viendo' && styles.tabButtonActive]}
                    onPress={() => setCurrentStatusTab('Viendo')}
                >
                    <Text style={[styles.tabText, currentStatusTab === 'Viendo' && styles.tabTextActive]}>
                        📖 Leyendo ({originalList.filter(s => s.status === 'Nueva' || s.status === 'Mirando').length})
                    </Text>
                </TouchableOpacity>
                <TouchableOpacity
                    style={[styles.tabButton, currentStatusTab === 'En espera' && styles.tabButtonActive]}
                    onPress={() => setCurrentStatusTab('En espera')}
                >
                    <Text style={[styles.tabText, currentStatusTab === 'En espera' && styles.tabTextActive]}>
                        ⏳ Espera ({originalList.filter(s => s.status === 'En espera').length})
                    </Text>
                </TouchableOpacity>
                <TouchableOpacity
                    style={[styles.tabButton, currentStatusTab === 'Terminado' && styles.tabButtonActive]}
                    onPress={() => setCurrentStatusTab('Terminado')}
                >
                    <Text style={[styles.tabText, currentStatusTab === 'Terminado' && styles.tabTextActive]}>
                        ✅ Fin ({originalList.filter(s => s.status === 'Terminado').length})
                    </Text>
                </TouchableOpacity>
            </View>

            <FlatList
                data={getFilteredSeries()}
                keyExtractor={item => item.id.toString()}
                renderItem={renderSeriesItem}
                contentContainerStyle={styles.listContent}
                ListEmptyComponent={<Text style={styles.emptyText}>No hay lecturas en esta sección.</Text>}
            />

            {/* MODAL ADD/EDIT */}
            <Modal animationType="slide" visible={modalVisible} onRequestClose={() => setModalVisible(false)}>
                <SafeAreaView style={styles.modalContainer}>
                    <View style={styles.modalHeader}>
                        <Text style={styles.modalTitle}>{isEditing ? 'Editar Lectura' : 'Nueva Lectura'}</Text>
                        <TouchableOpacity onPress={() => setModalVisible(false)}>
                            <Text style={styles.closeText}>Cerrar</Text>
                        </TouchableOpacity>
                    </View>
                    <ScrollView style={styles.modalForm}>
                        <Text style={styles.label}>Nombre</Text>
                        <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Ej: One Piece" />

                        <Text style={styles.label}>Descripción (Opcional)</Text>
                        <TextInput style={styles.input} value={description} onChangeText={setDescription} placeholder="Notas..." />

                        <Text style={styles.label}>Estado</Text>
                        <View style={styles.statusContainer}>
                            <TouchableOpacity
                                style={[styles.statusOption, status === 'Nueva' && styles.statusSelected]}
                                onPress={() => setStatus('Nueva')}
                            >
                                <Text style={[styles.statusText, status === 'Nueva' && styles.statusTextSelected]}>Nuevo Tomo</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[styles.statusOption, status === 'Mirando' && styles.statusSelected]}
                                onPress={() => setStatus('Mirando')}
                            >
                                <Text style={[styles.statusText, status === 'Mirando' && styles.statusTextSelected]}>Leyendo</Text>
                            </TouchableOpacity>
                        </View>

                        <Text style={styles.sectionTitle}>Estructura (Partes/Tomos)</Text>
                        <Text style={{ fontSize: 12, color: '#888', marginBottom: 10 }}>Puedes usar "Parte 1" si solo tienes una secuencia de tomos.</Text>
                        {seasons.map((season, index) => (
                            <View key={index} style={styles.seasonRow}>
                                <Text style={styles.seasonLabel}>Parte {season.number}:</Text>
                                <TextInput
                                    style={styles.seasonInput}
                                    placeholder="N° Tomos"
                                    keyboardType="numeric"
                                    value={season.episodes}
                                    onChangeText={(text) => updateSeasonEpisodes(index, text)}
                                />
                            </View>
                        ))}
                        <View style={styles.seasonActions}>
                            <TouchableOpacity style={styles.addSeasonBtn} onPress={handleAddSeason}>
                                <Text style={styles.addSeasonText}>+ Agregar Parte</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={styles.removeSeasonBtn} onPress={handleRemoveSeason}>
                                <Text style={styles.removeSeasonText}>- Quitar</Text>
                            </TouchableOpacity>
                        </View>

                        {!isEditing && status === 'Mirando' && (
                            <View>
                                <Text style={styles.sectionTitle}>Progreso Inicial</Text>
                                <View style={styles.row}>
                                    <View style={{ flex: 1, marginRight: 5 }}>
                                        <Text style={styles.label}>Parte</Text>
                                        <TextInput
                                            style={styles.input}
                                            keyboardType="numeric"
                                            value={String(currentSeason)}
                                            onChangeText={setCurrentSeason}
                                        />
                                    </View>
                                    <View style={{ flex: 1, marginLeft: 5 }}>
                                        <Text style={styles.label}>Tomo</Text>
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
                            <Text style={styles.saveButtonText}>{isEditing ? 'Actualizar' : 'Guardar'}</Text>
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
                                    {activeSeries?.status === 'Terminado'
                                        ? '✅ Lectura Terminada'
                                        : activeSeries?.status === 'En espera'
                                            ? '⏳ En espera de contenido'
                                            : `Leyendo: Parte ${activeSeries?.current_season}, Tomo ${activeSeries?.current_episode}`}
                                </Text>
                            </View>
                            <TouchableOpacity onPress={() => setProgressModalVisible(false)} style={styles.closeGridBtn}>
                                <Text style={styles.closeGridText}>✕</Text>
                            </TouchableOpacity>
                        </View>

                        <ScrollView style={{ padding: 15 }}>
                            {activeSeries?.seasons.map(season => (
                                <View key={season.season_number} style={styles.seasonGroup}>
                                    <Text style={styles.seasonTitle}>Parte {season.season_number}</Text>
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
                                <View style={[styles.legendBox, styles.episodeWatched]} /><Text style={styles.legendText}>Leído</Text>
                                <View style={[styles.legendBox, styles.episodeCurrent]} /><Text style={styles.legendText}>Siguiente</Text>
                                <View style={[styles.legendBox]} /><Text style={styles.legendText}>Pendiente</Text>
                            </View>

                            {activeSeries?.status === 'Terminado' && (
                                <TouchableOpacity style={styles.restartBtn} onPress={handleRestart}>
                                    <Text style={styles.restartBtnText}>🔄 Releer</Text>
                                </TouchableOpacity>
                            )}
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
    statusTextSelected: { color: '#fff' },

    editInfoBanner: { marginTop: 15, padding: 10, backgroundColor: '#E8EAF6', borderRadius: 8 },
    editInfoText: { fontSize: 12, color: '#3F51B5' },

    sectionTitle: { fontSize: 18, fontWeight: 'bold', color: '#1A237E', marginTop: 25, marginBottom: 10 },
    seasonRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
    seasonLabel: { fontSize: 16, marginRight: 10, width: 100, color: '#333' },
    seasonInput: { flex: 1, borderWidth: 1, borderColor: '#E8EAF6', borderRadius: 8, padding: 10, backgroundColor: '#F5F5F7' },
    seasonActions: { flexDirection: 'row', marginTop: 10, gap: 10 },
    addSeasonBtn: { padding: 10, backgroundColor: '#E8EAF6', borderRadius: 8 },
    addSeasonText: { color: '#3F51B5', fontWeight: 'bold' },
    removeSeasonBtn: { padding: 10, backgroundColor: '#FFEBEE', borderRadius: 8 },
    removeSeasonText: { color: '#F44336', fontWeight: 'bold' },

    row: { flexDirection: 'row' },
    saveButton: { backgroundColor: '#2196F3', padding: 16, borderRadius: 12, alignItems: 'center', marginTop: 30, elevation: 4 },
    saveButtonText: { color: '#fff', fontSize: 18, fontWeight: 'bold' },

    cardActions: { flexDirection: 'row', alignItems: 'center' },
    gridBtn: { padding: 8, marginRight: 5, backgroundColor: '#E3F2FD', borderRadius: 20 },
    editBtn: { padding: 8, marginRight: 5 },
    deleteBtn: { padding: 8 },

    orderButtons: { flexDirection: 'row', marginRight: 5 },
    orderBtn: { padding: 8, backgroundColor: '#F5F5F5', borderRadius: 15, marginHorizontal: 2 },
    orderBtnText: { fontSize: 16, fontWeight: 'bold', color: '#555' },

    tabContainer: { flexDirection: 'row', paddingHorizontal: 15, marginBottom: 15, marginTop: 10, gap: 8 },
    tabButton: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 20, backgroundColor: '#F0F0F0', borderWidth: 1, borderColor: '#E0E0E0' },
    tabButtonActive: { backgroundColor: '#E8EAF6', borderColor: '#3F51B5' },
    tabText: { fontSize: 13, color: '#757575', fontWeight: '500' },
    tabTextActive: { color: '#3F51B5', fontWeight: 'bold' },

    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'center', padding: 20 },
    progressModalContent: { backgroundColor: '#fff', borderRadius: 20, maxHeight: '85%', overflow: 'hidden' },
    progressHeader: { flexDirection: 'row', justifyContent: 'space-between', padding: 20, backgroundColor: '#FAFAFA', borderBottomWidth: 1, borderBottomColor: '#eee' },
    progressSeriesName: { fontSize: 20, fontWeight: 'bold', color: '#333' },
    progressStatus: { fontSize: 14, color: '#666', marginTop: 4 },
    closeGridBtn: { padding: 5 },
    closeGridText: { fontSize: 24, color: '#999' },
    seasonGroup: { marginBottom: 20 },
    seasonTitle: { fontSize: 16, fontWeight: 'bold', marginBottom: 10, color: '#555' },
    episodeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    episodeBox: { width: 45, height: 45, borderRadius: 12, backgroundColor: '#F0F0F0', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#eee' },
    episodeWatched: { backgroundColor: '#4CAF50', borderColor: '#4CAF50' },
    episodeCurrent: { backgroundColor: '#2196F3', borderColor: '#2196F3', transform: [{ scale: 1.1 }] },
    episodeNum: { fontSize: 16, fontWeight: 'bold', color: '#555' },
    gridFooter: { padding: 20, borderTopWidth: 1, borderTopColor: '#eee', backgroundColor: '#FAFAFA' },
    legend: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 15, marginBottom: 15 },
    legendBox: { width: 15, height: 15, borderRadius: 4, backgroundColor: '#F0F0F0', borderWidth: 1, borderColor: '#ccc' },
    legendText: { fontSize: 12, color: '#666' },
    restartBtn: { backgroundColor: '#FF5722', padding: 12, borderRadius: 10, alignItems: 'center' },
    restartBtnText: { color: '#fff', fontWeight: 'bold' }
});
