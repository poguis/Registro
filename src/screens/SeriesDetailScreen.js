import React, { useState, useEffect } from 'react';
import { View, TouchableOpacity, StyleSheet, FlatList, Modal, ScrollView } from 'react-native';
import { useSheet } from '../hooks/useSheet';
import { Text, TextInput } from '../components/AppText';
import { SafeAreaView } from 'react-native-safe-area-context';
import db from '../services/db';
import { useSyncRefresh } from '../sync/useSyncRefresh';
import { calculateBacklog, calculateBacklogV2, getLocalDateString, getAbsoluteEpisodeCount, getWatchedCountSinceStart } from '../services/backlogUtils';
import { useTheme, FONT, RADIUS } from '../contexts/ThemeContext';
// Fase 7.3: las decisiones (validación, límite, orden, pausa, grilla, reinicio) viven en el
// motor puro (src/entertainment/); aquí quedan los textos, las alertas y las escrituras.
// Fase 7.4a: la grilla marca/desmarca vistos con filas de historial, el límite se avisa al tocar
// "Agregar" y una serie nueva o reanudada entra al final del ciclo actual.
import {
    filterSeriesByTab, reorderActive, validateSeriesForm, isActiveLimitReached, canAddSeries, buildSeriesSave, appendSeasonRow, removeSeasonRow,
    planChapterTap, restartWatchedCount, decideTogglePause, categoryPauseDates, seriesWatchedTotal, activeLimit,
} from '../entertainment/seriesDetail';
import { watchedCount } from '../entertainment/queue';
// Fase 7.5: vínculo con Pendiente (alta "De Pendiente" o "Nuevo título"; borrado en los dos lados).
import { validateNewTitle, SUBTYPE_LABELS } from '../entertainment/link';
import PendientePicker from '../components/PendientePicker';
import HojaConTeclado, { ScrollDeHoja } from '../components/HojaConTeclado';

export default function SeriesDetailScreen({ user, category, onBack, onNavigateRegistry }) {
    const { theme } = useTheme();
    const { confirm, informar } = useSheet();
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

    // Fase 7.5: de dónde sale la serie nueva. null (edición) | { mode: 'pendiente', backlogId, title }
    // | { mode: 'nuevo' }; en "Nuevo título", el tipo (serie/anime o el subtipo de lectura) y el año.
    const [link, setLink] = useState(null);
    const [newType, setNewType] = useState(null);
    const [newStartYear, setNewStartYear] = useState('');
    const [pickerVisible, setPickerVisible] = useState(false);
    const [candidates, setCandidates] = useState([]);

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
    // Recarga si la sync trae cambios del servidor (sin tocar formularios, filtros ni scroll).
    useSyncRefresh(() => Promise.all([refreshCategory(), fetchSeries()]));

    useEffect(() => {
        setCurrentCategory(category);
    }, [category]);

    // Vistos = filas de historial de TODAS las series de la categoría (watched_count, recién leído
    // por fetchSeries tras cada cambio).
    const calculateHeaderBacklog = (currentSeriesList = originalList, targetCategory = currentCategory) => {
        const calc = targetCategory ? calculateBacklog(targetCategory, seriesWatchedTotal(currentSeriesList)) : null;
        if (calc) {
            setBacklogInfo({
                items: calc.backlogItems,
                days: calc.diffDays,
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
        setSeasons(appendSeasonRow(seasons));
    };

    const handleRemoveSeason = () => {
        const remaining = removeSeasonRow(seasons);
        if (remaining) {
            setSeasons(remaining);
        } else {
            informar('Aviso', 'Debe haber al menos una temporada.');
        }
    };

    const updateSeasonEpisodes = (index, value) => {
        const newSeasons = [...seasons];
        newSeasons[index].episodes = value;
        setSeasons(newSeasons);
    };

    const handleEdit = (series) => {
        clearLinkChoice(); // Fase 7.5: la edición nunca arrastra la elección de "Agregar"
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
        const newList = reorderActive(getFilteredSeries(), index, 'up', currentStatusTab);
        if (!newList) return;
        await Promise.all(newList.map((item, idx) => db.updateSeriesSortOrder(item.id, idx + 1)));
        fetchSeries();
    };

    const moveDown = async (index) => {
        const newList = reorderActive(getFilteredSeries(), index, 'down', currentStatusTab);
        if (!newList) return;
        await Promise.all(newList.map((item, idx) => db.updateSeriesSortOrder(item.id, idx + 1)));
        fetchSeries();
    };

    const getFilteredSeries = () => filterSeriesByTab(originalList, currentStatusTab);

    const handleDelete = (seriesId) => {
        // Vinculada solo si su título de Pendiente ya está en el celular (linked_title_alive).
        const linked = !!(originalList.find((s) => s.id === seriesId) || {}).linked_title_alive;
        confirm({
            titulo: 'Eliminar Serie',
            mensaje: linked ? 'Se borrarán la serie y su título en Pendiente. Se pierde el progreso.' : '¿Estás seguro?',
            acciones: [
                { clave: 'cancelar', texto: 'Cancelar', variante: 'cancelar' },
                { clave: 'eliminar', texto: 'Eliminar', variante: 'destructiva' },
            ],
        }).then(async (clave) => {
            if (clave !== 'eliminar') return;
            const result = await db.deleteSeries(seriesId);
            if (result.success) fetchSeries();
        });
    };

    const handleSave = async () => {
        const formErrors = {
            nombre: 'El nombre es obligatorio',
            temporadaVacia: 'Cada temporada debe tener al menos 1 capítulo.',
            unidades: 'Capítulos inválidos',
            numeros: 'Números inválidos',
            temporadaRango: 'Temporada fuera de rango',
            capituloRango: 'Capítulo fuera de rango',
        };
        const validation = validateSeriesForm({ name, seasons, status, currentSeason, currentEpisode });
        if (validation.error) { informar('Error', formErrors[validation.error]); return; }
        const { validSeasons } = validation;

        if (isActiveLimitReached({ originalList, status, isEditing, editingSeriesId, category: currentCategory || category })) {
            informar('Límite Alcanzado', `Máximo ${activeLimit(currentCategory || category)} series activas.`);
            return;
        }

        // Fase 7.5: el vínculo con Pendiente (solo al crear). "Nuevo título" valida su tipo y año.
        let linkArg = null;
        if (!isEditing && link && link.mode === 'pendiente') linkArg = { backlogId: link.backlogId };
        if (!isEditing && link && link.mode === 'nuevo') {
            const linkErrors = {
                titulo: 'El nombre es obligatorio',
                tipo: 'Elige si es serie o anime.',
                subtipo: 'Elige el subtipo: libro, cómic o manga.',
                anio: 'El año de inicio debe tener 4 cifras.',
            };
            const nt = validateNewTitle({ categoryType: category.type, title: name, type: newType, subtype: newType, startYear: newStartYear });
            if (nt.error) { informar('Error', linkErrors[nt.error]); return; }
            linkArg = { newTitle: nt.newTitle };
        }

        const { seriesData, seasonsData } = buildSeriesSave({
            category, name, description, status, currentSeason, currentEpisode, validSeasons, isEditing, originalList,
        });

        let result;
        if (isEditing) {
            result = await db.updateSeriesWithSeasons(editingSeriesId, seriesData, seasonsData);
        } else {
            result = await db.addSeriesWithSeasons(seriesData, seasonsData, linkArg);
        }

        if (result.success) {
            setModalVisible(false);
            fetchSeries();
            resetForm();
        } else {
            informar('Error', linkArg ? (result.error || 'No se pudo guardar') : 'No se pudo guardar');
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
        clearLinkChoice();
    };

    // Fase 7.5: la elección de "Agregar" (De Pendiente / Nuevo título) vale solo para ese alta: se
    // limpia al guardar (resetForm), al editar y al cerrar o cancelar el formulario.
    const clearLinkChoice = () => {
        setLink(null);
        setNewType(null);
        setNewStartYear('');
    };
    const closeForm = () => {
        setModalVisible(false);
        clearLinkChoice();
    };

    // Qué muestra el formulario sobre el vínculo. Al editar nunca se usa `link`: solo cuenta si la
    // serie editada está vinculada y su título ya está en el celular.
    const formLinkView = () => {
        if (isEditing) {
            const s = originalList.find((x) => x.id === editingSeriesId);
            return s && s.linked_title_alive
                ? { chip: true, texto: 'El nombre se cambia también en Pendiente', tipos: false }
                : { chip: false, texto: null, tipos: false };
        }
        if (link && link.mode === 'pendiente') return { chip: true, texto: `De Pendiente: ${link.title}`, tipos: false };
        if (link && link.mode === 'nuevo') return { chip: false, texto: null, tipos: true };
        return { chip: false, texto: null, tipos: false };
    };

    const updateToChapter = async (seriesId, sNum, eNum) => {
        const series = activeSeries || originalList.find(x => x.id === seriesId);
        if (!series) return;
        const plan = planChapterTap(series, sNum, eNum);
        if (plan.kind === 'none') return;
        const label = (ep) => `T${ep.season}C${ep.episode}`;
        const refresh = (pointer, status) => {
            fetchSeries();
            if (activeSeries && activeSeries.id === seriesId) {
                setActiveSeries(prev => ({ ...prev, current_season: pointer.season, current_episode: pointer.episode, status }));
            }
        };

        // Hacia atrás: desmarca desde el tocado (borrado lógico de las filas de historial).
        if (plan.kind === 'backward') {
            const clave = await confirm({
                titulo: 'Desmarcar',
                mensaje: `¿Desmarcar desde ${label(plan.pointer)}?`,
                acciones: [
                    { clave: 'cancelar', texto: 'Cancelar', variante: 'cancelar' },
                    { clave: 'desmarcar', texto: 'Desmarcar', variante: 'destructiva' },
                ],
            });
            if (clave !== 'desmarcar') return;
            const result = await db.unmarkEpisodes(seriesId, category.type, plan.episodes, { ...plan.pointer, status: plan.status });
            if (result.success) refresh(plan.pointer, plan.status);
            return;
        }

        // Hacia adelante: marca vistos hasta el tocado (una fila de historial por capítulo).
        const mark = async (status) => {
            const result = await db.markEpisodesWatched(seriesId, category.type, plan.episodes, { ...plan.pointer, status }, Date.now());
            if (result.success) refresh(plan.pointer, status);
        };
        // Más de un capítulo: se confirma antes; con uno, directo.
        if (plan.episodes.length > 1) {
            const first = plan.episodes[0], last = plan.episodes[plan.episodes.length - 1];
            const clave = await confirm({
                titulo: 'Marcar vistos',
                mensaje: `¿Marcar ${plan.episodes.length} capítulos como vistos (${label(first)} → ${label(last)})?`,
                acciones: [
                    { clave: 'cancelar', texto: 'Cancelar', variante: 'cancelar' },
                    { clave: 'marcar', texto: 'Marcar', variante: 'primaria' },
                ],
            });
            if (clave !== 'marcar') return;
        }

        if (plan.isFinal) {
            const destino = await confirm({
                titulo: '¡Serie Completada!',
                mensaje: 'Elige destino:',
                acciones: [
                    { clave: 'espera', texto: 'En espera', variante: 'secundaria' },
                    { clave: 'terminado', texto: 'Terminado', variante: 'primaria' },
                    { clave: 'cancelar', texto: 'Cancelar', variante: 'cancelar' },
                ],
            });
            if (destino === 'espera') await mark('En espera');
            else if (destino === 'terminado') await mark('Terminado');
        } else {
            await mark(plan.status);
        }
    };

    const handleRestart = async () => {
        if (!activeSeries) return;
        // cycle_offset se sigue escribiendo, pero ya no cuenta: los vistos salen del historial.
        const watchedInThisCycle = restartWatchedCount(activeSeries);

        const clave = await confirm({
            titulo: 'Reiniciar',
            mensaje: `¿Empezar de cero? (${watchedCount(activeSeries)} vistos)`,
            acciones: [
                { clave: 'cancelar', texto: 'Cancelar', variante: 'cancelar' },
                { clave: 'reiniciar', texto: 'Reiniciar', variante: 'primaria' },
            ],
        });
        if (clave !== 'reiniciar') return;
        const result = await db.restartSeries(activeSeries.id, watchedInThisCycle);
        if (result.success) {
            fetchSeries();
            setProgressModalVisible(false);
        }
    };

    // "+ Nueva Serie": con el límite alcanzado, el aviso sale antes de abrir el formulario (O1).
    const handleAddPress = async () => {
        const check = canAddSeries(originalList, currentCategory || category);
        if (!check.ok) { informar('Límite Alcanzado', `Máximo ${check.limit} series activas.`); return; }
        // Fase 7.5: elegir un título de Pendiente o crear uno nuevo (que nace vinculado).
        const modo = await confirm({
            titulo: 'Agregar serie',
            mensaje: 'Elige un título que ya está en Pendiente o crea uno nuevo.',
            acciones: [
                { clave: 'pendiente', texto: 'De Pendiente', variante: 'primaria' },
                { clave: 'nuevo', texto: 'Nuevo título', variante: 'secundaria' },
                { clave: 'cancelar', texto: 'Cancelar', variante: 'cancelar' },
            ],
        });
        if (modo === 'pendiente') {
            const res = await db.getBacklogCandidates(user.id, category.type);
            const list = res.success ? res.data : [];
            if (list.length === 0) { informar('Sin títulos en Pendiente', 'No hay series ni anime en estado Pendiente. Usa "Nuevo título".'); return; }
            setCandidates(list);
            setPickerVisible(true);
            return;
        }
        if (modo !== 'nuevo') return;
        resetForm();
        setLink({ mode: 'nuevo' });
        setModalVisible(true);
    };

    // Elegido en el selector: el formulario de siempre, con el nombre del título (editable; el
    // título de Pendiente se actualiza igual, D4).
    const handlePickCandidate = (item) => {
        setPickerVisible(false);
        resetForm();
        setLink({ mode: 'pendiente', backlogId: item.id, title: item.title });
        setName(item.title);
        setModalVisible(true);
    };

    const handleTogglePauseSeries = async (series) => {
        const decision = decideTogglePause(series, originalList);

        if (decision.action === 'resume') {
            const result = await db.updateSeriesProgress(
                series.id,
                series.current_season,
                series.current_episode,
                decision.status,
                null, // E3 opción B: conserva su sort_order
                undefined,
                undefined,
                decision.interleaveOffset
            );
            if (result.success) fetchSeries();
            return;
        }
        if (decision.action === 'none') return;

        const result = await db.updateSeriesProgress(series.id, series.current_season, series.current_episode, decision.status);
        if (result.success) fetchSeries();
    };

    const handleTogglePauseCategory = async () => {
        const { pauseDate, resumeDate } = categoryPauseDates(new Date());
        let result;
        if (currentCategory.is_paused) {
            result = await db.resumeCategory(currentCategory.id, resumeDate);
        } else {
            result = await db.pauseCategory(currentCategory.id, pauseDate);
        }

        if (result.success) {
            await refreshCategory();
        } else {
            informar('Error', 'No se pudo cambiar el estado de pausa de la categoría');
        }
    };

    const renderSeriesItem = ({ item, index }) => {
        let tone = theme.tones.azul;
        if (item.status === 'Nueva') tone = theme.tones.verde;
        if (item.status === 'En espera') tone = theme.tones.naranja;
        if (item.status === 'Terminado') tone = theme.tones.morado;
        if (item.status === 'Pausado') tone = theme.tones.pizarra;
        const badgeStyle = { backgroundColor: tone.bg };
        const isViendo = currentStatusTab === 'Viendo';

        let percentDisplay = null;
        if (item.seasons && item.seasons.length > 0) {
            let totalEp = 0;
            item.seasons.forEach(s => totalEp += s.episode_count);
            if (totalEp > 0) {
                let watched = getAbsoluteEpisodeCount(item, item.current_season, item.current_episode);
                let percent = 0;
                if (item.status === 'Terminado') {
                    percent = 100;
                    watched = totalEp;
                } else {
                    percent = Math.round((watched / totalEp) * 100);
                }
                percentDisplay = `${percent}% (${watched}/${totalEp})`;
            }
        }

        return (
            <TouchableOpacity
                style={[styles.card, { backgroundColor: theme.surface, shadowColor: theme.shadow }]}
                activeOpacity={0.9}
                onPress={() => {
                    setActiveSeries(item);
                    setProgressModalVisible(true);
                }}
            >
                <View style={styles.cardHeader}>
                    <View style={[styles.cardHeaderLeft, { marginRight: 10 }]}>
                        <Text style={[styles.seriesName, { color: theme.ink, fontSize: 16, lineHeight: 22 }]} numberOfLines={2} ellipsizeMode="tail">{item.name}</Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8, gap: 15 }}>
                            <View style={[styles.badge, badgeStyle, { marginTop: 0 }]}>
                                <Text style={[styles.badgeText, { color: tone.fg }]} numberOfLines={1}>{item.status}</Text>
                            </View>
                            {isViendo && (
                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 15, marginLeft: 5 }}>
                                    <TouchableOpacity onPress={() => handleTogglePauseSeries(item)} hitSlop={{top: 10, bottom: 10, left: 10, right: 10}}>
                                        <Text style={{ fontSize: 18 }}>{item.status === 'Pausado' ? '▶️' : '⏸️'}</Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity onPress={() => moveUp(index)} hitSlop={{top: 10, bottom: 10, left: 10, right: 10}}>
                                        <Text style={{ fontSize: 18, color: theme.accent, fontFamily: FONT.bold }}>↑</Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity onPress={() => moveDown(index)} hitSlop={{top: 10, bottom: 10, left: 10, right: 10}}>
                                        <Text style={{ fontSize: 18, color: theme.accent, fontFamily: FONT.bold }}>↓</Text>
                                    </TouchableOpacity>
                                </View>
                            )}
                        </View>
                    </View>
                    <View style={styles.actionButtons}>
                        <TouchableOpacity onPress={() => handleEdit(item)} style={styles.iconButton}>
                            <Text style={{ fontSize: 18 }}>✏️</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => handleDelete(item.id)} style={styles.iconButton}>
                            <Text style={{ fontSize: 18 }}>🗑️</Text>
                        </TouchableOpacity>
                    </View>
                </View>
                <Text style={[styles.seriesDescription, { color: theme.muted }]} numberOfLines={1} ellipsizeMode="tail">{item.description || 'Sin descripción'}</Text>
                <View style={styles.cardProgress}>
                    <Text style={[styles.progressText, { color: theme.ink }]} numberOfLines={1}>T{item.current_season} - E{item.current_episode}</Text>
                    {percentDisplay && (
                        <Text style={[styles.totalText, { color: theme.muted }]} numberOfLines={1}>{percentDisplay}</Text>
                    )}
                </View>
            </TouchableOpacity>
        );
    };

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: theme.bg }]}>
            <View style={[styles.header, { borderBottomColor: theme.line }]}>
                <View style={styles.headerTop}>
                    <TouchableOpacity onPress={onBack} style={styles.backButton}>
                        <Text style={[styles.backText, { color: theme.ink }]}>←</Text>
                    </TouchableOpacity>
                    <View style={{ flex: 1, minWidth: 0, marginLeft: 10 }}>
                        <Text style={[styles.headerTitle, { color: theme.ink }]} numberOfLines={2} ellipsizeMode="tail">{currentCategory.name}</Text>
                        <Text style={[styles.headerSubtitle, { color: theme.muted }]} numberOfLines={1} ellipsizeMode="tail">
                            {backlogInfo 
                                ? (backlogInfo.items > 0 
                                    ? `Atraso: ${backlogInfo.days}d (${backlogInfo.items} Caps)`
                                    : (backlogInfo.adelantoItems > 0 
                                        ? `Adelanto: ${backlogInfo.adelantoDays}d (${backlogInfo.adelantoItems} Caps)`
                                        : '¡Al día! 🎉'))
                                : 'Calculando...'}
                        </Text>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', flexShrink: 0 }}>
                        <TouchableOpacity onPress={handleTogglePauseCategory} style={[styles.pauseCategoryBtn, { backgroundColor: currentCategory.is_paused ? theme.behindBg : theme.raised }]}>
                            <Text style={{ fontSize: 20 }}>{currentCategory.is_paused ? '▶️' : '⏸️'}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity 
                            onPress={() => onNavigateRegistry(currentCategory)}
                            style={[styles.registryButton, { backgroundColor: theme.accent }]}
                        >
                            <Text style={[styles.registryButtonText, { color: theme.onAccent }]}>Registro</Text>
                        </TouchableOpacity>
                    </View>
                </View>

                <View style={styles.tabContainer}>
                    {['Viendo', 'En espera', 'Terminado'].map((t) => {
                        let label = t;
                        if (originalList) {
                            if (t === 'Viendo') {
                                const activeCount = originalList.filter(s => ['Nueva', 'Mirando', 'Pausado'].includes(s.status)).length;
                                const limit = currentCategory?.series_count;
                                label = limit ? `Viendo (${activeCount}/${limit})` : `Viendo (${activeCount})`;
                            } else {
                                const count = originalList.filter(s => s.status === t).length;
                                label = `${t} (${count})`;
                            }
                        }

                        return (
                            <TouchableOpacity
                                key={t}
                                onPress={() => setCurrentStatusTab(t)}
                                style={[styles.tab, currentStatusTab === t && { borderBottomColor: theme.accent, borderBottomWidth: 3 }]}
                            >
                                <Text style={[styles.tabTextHeader, { color: currentStatusTab === t ? theme.accent : theme.muted }]} numberOfLines={1}>{label}</Text>
                            </TouchableOpacity>
                        );
                    })}
                </View>
            </View>

            <FlatList
                data={getFilteredSeries()}
                renderItem={renderSeriesItem}
                keyExtractor={(item) => item.id.toString()}
                contentContainerStyle={styles.listContent}
                ListHeaderComponent={() => (
                    currentStatusTab === 'Viendo' && (
                        <TouchableOpacity style={[styles.addButton, { backgroundColor: theme.accent }]} onPress={handleAddPress}>
                            <Text style={[styles.addButtonText, { color: theme.onAccent }]}>+ Nueva Serie</Text>
                        </TouchableOpacity>
                    )
                )}
            />

            {/* Fase 7.5: selector "De Pendiente" */}
            <PendientePicker
                visible={pickerVisible}
                candidates={candidates}
                titulo="Elegir de Pendiente"
                onPick={handlePickCandidate}
                onClose={() => setPickerVisible(false)}
            />

            {/* Formulario de alta/edición (1.4.3: hoja con teclado; ningún campo queda tapado) */}
            <HojaConTeclado visible={modalVisible} onClose={closeForm} centrada>
                    <View style={[styles.modalContent, styles.formCard, { backgroundColor: theme.surface }]}>
                        <Text style={[styles.modalTitle, { color: theme.ink }]}>{isEditing ? 'Editar Serie' : 'Añadir Serie'}</Text>
                        <ScrollDeHoja>
                            {formLinkView().chip ? (
                                <View style={styles.linkRow}>
                                    <View style={[styles.linkChip, { backgroundColor: theme.soft }]}>
                                        <Text style={[styles.linkChipText, { color: theme.accent }]} numberOfLines={1}>Vinculado</Text>
                                    </View>
                                    <Text style={[styles.linkText, { color: theme.muted }]} numberOfLines={1} ellipsizeMode="tail">
                                        {formLinkView().texto}
                                    </Text>
                                </View>
                            ) : null}
                            <TextInput placeholder="Nombre" style={[styles.input, { color: theme.ink, backgroundColor: theme.raised, borderColor: theme.lineStrong }]} placeholderTextColor={theme.muted} value={name} onChangeText={setName} />
                            {formLinkView().tipos ? (
                                <View>
                                    <Text style={[styles.modalSubtitle, { color: theme.ink }]}>Tipo en Pendiente</Text>
                                    <View style={styles.typeRow}>
                                        {[['series', 'Serie'], ['anime', 'Anime']].map(([clave, texto]) => {
                                            const activo = newType === clave;
                                            return (
                                                <TouchableOpacity
                                                    key={clave}
                                                    accessibilityRole="button"
                                                    onPress={() => setNewType(clave)}
                                                    style={[styles.typeChip, { backgroundColor: activo ? theme.accent : theme.raised, borderColor: activo ? theme.accent : theme.lineStrong }]}
                                                >
                                                    <Text style={[styles.typeChipText, { color: activo ? theme.onAccent : theme.ink }]} numberOfLines={1}>{texto}</Text>
                                                </TouchableOpacity>
                                            );
                                        })}
                                    </View>
                                    <TextInput placeholder="Año de inicio (opcional)" keyboardType="numeric" maxLength={4} style={[styles.input, { color: theme.ink, backgroundColor: theme.raised, borderColor: theme.lineStrong }]} placeholderTextColor={theme.muted} value={newStartYear} onChangeText={setNewStartYear} />
                                </View>
                            ) : null}
                            <TextInput placeholder="Descripción" style={[styles.input, { color: theme.ink, backgroundColor: theme.raised, borderColor: theme.lineStrong }]} placeholderTextColor={theme.muted} value={description} onChangeText={setDescription} />
                            
                            <Text style={[styles.modalSubtitle, { color: theme.ink, marginTop: 10 }]}>Temporadas y Capítulos</Text>
                            {seasons.map((s, idx) => (
                                <View key={idx} style={styles.seasonRow}>
                                    <Text style={{ color: theme.ink, width: 30 }}>T{s.number}</Text>
                                    <TextInput
                                        placeholder="Caps"
                                        keyboardType="numeric"
                                        style={[styles.inputSeason, { color: theme.ink, backgroundColor: theme.raised, borderColor: theme.lineStrong }]}
                                        placeholderTextColor={theme.muted}
                                        value={s.episodes}
                                        onChangeText={(val) => updateSeasonEpisodes(idx, val)}
                                    />
                                </View>
                            ))}
                            <View style={{ flexDirection: 'row', gap: 10 }}>
                                <TouchableOpacity onPress={handleAddSeason} style={[styles.smallButton, { backgroundColor: theme.accent }]}><Text style={{ color: theme.onAccent }}>+ Temporada</Text></TouchableOpacity>
                                <TouchableOpacity onPress={handleRemoveSeason} style={[styles.smallButton, { backgroundColor: theme.danger }]}><Text style={{ color: theme.onDanger }}>- Temporada</Text></TouchableOpacity>
                            </View>

                            <Text style={[styles.modalSubtitle, { color: theme.ink, marginTop: 20 }]}>Progreso Actual</Text>
                            <View style={styles.progressInputRow}>
                                <View style={{ flex: 1 }}>
                                    <Text style={{ color: theme.muted, fontSize: 12 }}>Temp.</Text>
                                    <TextInput keyboardType="numeric" style={[styles.input, { color: theme.ink, backgroundColor: theme.raised, borderColor: theme.lineStrong }]} value={String(currentSeason)} onChangeText={setCurrentSeason} />
                                </View>
                                <View style={{ flex: 1 }}>
                                    <Text style={{ color: theme.muted, fontSize: 12 }}>Cap.</Text>
                                    <TextInput keyboardType="numeric" style={[styles.input, { color: theme.ink, backgroundColor: theme.raised, borderColor: theme.lineStrong }]} value={String(currentEpisode)} onChangeText={setCurrentEpisode} />
                                </View>
                            </View>
                        </ScrollDeHoja>

                        <View style={styles.modalButtons}>
                            <TouchableOpacity style={[styles.modalButton, { backgroundColor: theme.raised }]} onPress={closeForm}>
                                <Text style={{ color: theme.ink }}>Cancelar</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={[styles.modalButton, { backgroundColor: theme.accent }]} onPress={handleSave}>
                                <Text style={[styles.modalButtonText, { color: theme.onAccent }]}>Guardar</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
            </HojaConTeclado>

            {/* Progress Grid Modal */}
            <Modal visible={progressModalVisible} animationType="fade" transparent={true}>
                <View style={[styles.modalOverlay, { backgroundColor: theme.overlay }]}>
                    <View style={[styles.gridModalContent, { backgroundColor: theme.surface }]}>
                        <View style={[styles.gridHeader, { alignItems: 'flex-start' }]}>
                            <View style={{ flex: 1, minWidth: 0, paddingRight: 10 }}>
                                <Text style={[styles.modalTitle, { color: theme.ink, marginBottom: 0, fontSize: 18, lineHeight: 24 }]} numberOfLines={3} ellipsizeMode="tail">{activeSeries?.name}</Text>
                            </View>
                            <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: 2, flexShrink: 0 }}>
                                <TouchableOpacity onPress={handleRestart} style={[styles.restartBtn, { backgroundColor: theme.soft, marginRight: 15 }]}>
                                    <Text style={{ color: theme.accent, fontFamily: FONT.bold }}>Reiniciar</Text>
                                </TouchableOpacity>
                                <TouchableOpacity onPress={() => setProgressModalVisible(false)} style={{ padding: 5 }}>
                                    <Text style={{ fontSize: 20, color: theme.ink }}>✕</Text>
                                </TouchableOpacity>
                            </View>
                        </View>

                        <FlatList
                            data={activeSeries?.seasons || []}
                            keyExtractor={(s) => s.id.toString()}
                            renderItem={({ item: season }) => (
                                <View style={styles.seasonGridContainer}>
                                    <Text style={[styles.seasonGridTitle, { color: theme.ink }]}>Temporada {season.season_number}</Text>
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
                                                        { backgroundColor: theme.raised },
                                                        isWatched && { backgroundColor: theme.accent },
                                                        isCurrent && { borderWidth: 2, borderColor: theme.accent }
                                                    ]}
                                                    onPress={() => updateToChapter(activeSeries.id, season.season_number, epNum)}
                                                >
                                                    <Text style={[styles.gridItemText, { color: theme.ink }, isWatched && { color: theme.onAccent }]}>{epNum}</Text>
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
    backText: { fontSize: 24, fontFamily: FONT.bold },
    headerTitle: { fontSize: 20, fontFamily: FONT.bold },
    headerSubtitle: { fontSize: 13 },
    registryButton: { paddingHorizontal: 15, paddingVertical: 8, borderRadius: RADIUS.sm, marginLeft: 10 },
    registryButtonText: { fontFamily: FONT.bold },
    pauseCategoryBtn: { padding: 8, borderRadius: RADIUS.sm },
    tabContainer: { flexDirection: 'row', marginTop: 15, gap: 20 },
    tab: { paddingVertical: 5 },
    tabTextHeader: { fontFamily: FONT.bold, fontSize: 15 },
    listContent: { padding: 15, paddingBottom: 100 },
    addButton: { padding: 15, borderRadius: RADIUS.sm, alignItems: 'center', marginBottom: 20, minHeight: 52, justifyContent: 'center' },
    addButtonText: { fontFamily: FONT.bold, fontSize: 16 },
    card: { padding: 15, borderRadius: RADIUS.base, marginBottom: 15, elevation: 3, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 4 },
    cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
    cardHeaderLeft: { flex: 1, minWidth: 0 },
    seriesName: { fontSize: 18, fontFamily: FONT.bold },
    badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 5, alignSelf: 'flex-start', marginTop: 5, flexShrink: 0 },
    badgeText: { fontSize: 10, fontFamily: FONT.bold },
    actionButtons: { flexDirection: 'row', gap: 10, flexShrink: 0 },
    iconButton: { padding: 5 },
    seriesDescription: { fontSize: 14, marginVertical: 10 },
    cardProgress: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    progressText: { fontFamily: FONT.bold },
    totalText: { fontSize: 12 },
    modalOverlay: { flex: 1, justifyContent: 'center', padding: 20 },
    modalContent: { borderRadius: RADIUS.base, padding: 20, elevation: 5 },
    formCard: { flexShrink: 1 }, // 1.4.3: dentro de HojaConTeclado, encoge con el teclado abierto
    modalTitle: { fontSize: 20, fontFamily: FONT.bold, marginBottom: 20 },
    // Fase 7.5: marca "Vinculado" y tipo del nuevo título.
    linkRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
    linkChip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: RADIUS.sm, flexShrink: 0 },
    linkChipText: { fontFamily: FONT.semibold, fontSize: 12 },
    linkText: { flex: 1, minWidth: 0, fontSize: 13 },
    typeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6, marginBottom: 10 },
    typeChip: { minHeight: 44, paddingHorizontal: 16, borderRadius: RADIUS.sm, borderWidth: 1, justifyContent: 'center', flexShrink: 0 },
    typeChipText: { fontFamily: FONT.semibold, fontSize: 14 },
    modalSubtitle: { fontSize: 14, fontFamily: FONT.bold, marginBottom: 10 },
    input: { borderWidth: 1, borderRadius: RADIUS.sm, padding: 12, marginBottom: 15 },
    seasonRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
    inputSeason: { flex: 1, borderWidth: 1, borderRadius: 8, padding: 8 },
    smallButton: { padding: 8, borderRadius: RADIUS.sm },
    progressInputRow: { flexDirection: 'row', gap: 15 },
    modalButtons: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 20 },
    modalButton: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: RADIUS.sm },
    modalButtonText: { fontFamily: FONT.bold },
    gridModalContent: { flex: 0.9, borderRadius: RADIUS.base, padding: 20 },
    gridHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
    restartBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: RADIUS.sm },
    seasonGridContainer: { marginBottom: 25 },
    seasonGridTitle: { fontSize: 16, fontFamily: FONT.bold, marginBottom: 15 },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    gridItem: { width: 45, height: 45, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
    gridItemText: { fontFamily: FONT.bold }
});
