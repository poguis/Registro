import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { View, TouchableOpacity, StyleSheet, FlatList, Modal, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { useSheet } from '../hooks/useSheet';
import { Text, TextInput } from '../components/AppText';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme, FONT, RADIUS } from '../contexts/ThemeContext';
import db from '../services/db';
import { useSyncRefresh } from '../sync/useSyncRefresh';
import { calculateBacklog, getLocalDateString } from '../services/backlogUtils';
// Fase 7.4a (O1): el límite de activas es obligatorio (entero ≥ 1), en video y en lectura.
import { validateCategoryForm, canEditStartDate } from '../entertainment/category';
import HojaConTeclado, { ScrollDeHoja } from '../components/HojaConTeclado';

const DAYS = [
    { key: 'Monday', label: 'L' },
    { key: 'Tuesday', label: 'M' },
    { key: 'Wednesday', label: 'M' },
    { key: 'Thursday', label: 'J' },
    { key: 'Friday', label: 'V' },
    { key: 'Saturday', label: 'S' },
    { key: 'Sunday', label: 'D' },
];

// --- Custom Calendar Component ---
const CustomCalendar = ({ visible, onClose, onSelectDate, initialDate }) => {
    const { theme } = useTheme();
    const styles = useMemo(() => makeStyles(theme), [theme]);
    // Helper to parse date string "YYYY-MM-DD" safely as local date
    const parseDate = (dateStr) => {
        if (!dateStr) return new Date();
        const [y, m, d] = dateStr.split('-').map(Number);
        return new Date(y, m - 1, d);
    };

    const [viewDate, setViewDate] = useState(new Date());
    const [selectedDate, setSelectedDate] = useState(new Date());

    useEffect(() => {
        if (visible) {
            const dateObj = parseDate(initialDate);
            setViewDate(dateObj);
            setSelectedDate(dateObj);
        }
    }, [visible, initialDate]);

    const getDaysInMonth = (year, month) => new Date(year, month + 1, 0).getDate();
    const getFirstDayOfMonth = (year, month) => {
        const day = new Date(year, month, 1).getDay();
        return day === 0 ? 6 : day - 1;
    };

    const monthNames = [
        "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
        "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
    ];

    const changeMonth = (increment) => {
        const newDate = new Date(viewDate);
        newDate.setMonth(newDate.getMonth() + increment);
        setViewDate(newDate);
    };

    const handleSelect = (day) => {
        const newDate = new Date(viewDate.getFullYear(), viewDate.getMonth(), day);
        setSelectedDate(newDate);
    };

    const handleConfirm = () => {
        const dateString = `${selectedDate.getFullYear()}-${String(selectedDate.getMonth() + 1).padStart(2, '0')}-${String(selectedDate.getDate()).padStart(2, '0')}`;
        onSelectDate(dateString);
        onClose();
    };

    const renderCalendar = () => {
        const year = viewDate.getFullYear();
        const month = viewDate.getMonth();
        const daysInMonth = getDaysInMonth(year, month);
        const firstDay = getFirstDayOfMonth(year, month);

        const days = [];
        for (let i = 0; i < firstDay; i++) {
            days.push(<View key={`empty-${i}`} style={styles.calendarDay} />);
        }
        for (let i = 1; i <= daysInMonth; i++) {
            const isSelected =
                selectedDate.getDate() === i &&
                selectedDate.getMonth() === month &&
                selectedDate.getFullYear() === year;

            days.push(
                <TouchableOpacity
                    key={i}
                    style={[styles.calendarDay, isSelected && styles.calendarDaySelected]}
                    onPress={() => handleSelect(i)}
                >
                    <Text style={[styles.calendarDayText, { color: theme.ink }, isSelected && styles.calendarDayTextSelected]}>{i}</Text>
                </TouchableOpacity>
            );
        }
        return days;
    };

    return (
        <Modal animationType="fade" transparent={true} visible={visible} onRequestClose={onClose}>
            <View style={styles.modalOverlay}>
                <View style={[styles.modalContent, { height: 'auto', paddingBottom: 30, backgroundColor: theme.surface }]}>
                    <View style={styles.calendarHeader}>
                        <TouchableOpacity onPress={() => changeMonth(-1)} style={styles.navButton}><Text style={styles.navButtonText}>‹</Text></TouchableOpacity>
                        <Text style={[styles.monthTitle, { color: theme.ink }]}>{monthNames[viewDate.getMonth()]} {viewDate.getFullYear()}</Text>
                        <TouchableOpacity onPress={() => changeMonth(1)} style={styles.navButton}><Text style={styles.navButtonText}>›</Text></TouchableOpacity>
                    </View>
                    <View style={styles.weekDays}>
                        {['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((d, i) => <Text key={i} style={[styles.weekDayText, { color: theme.muted }]}>{d}</Text>)}
                    </View>
                    <View style={styles.daysGrid}>{renderCalendar()}</View>

                    <View style={styles.calendarActions}>
                        <TouchableOpacity style={[styles.actionButton, styles.cancelButton]} onPress={onClose}>
                            <Text style={styles.cancelButtonText}>Cancelar</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={[styles.actionButton, styles.confirmButton]} onPress={handleConfirm}>
                            <Text style={styles.confirmButtonText}>Guardar</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </View>
        </Modal>
    );
};

export default function SeriesAnimeScreen({ user, onBack, onNavigateDetail, onNavigateRegistry }) {
    const { theme } = useTheme();
    const styles = useMemo(() => makeStyles(theme), [theme]);
    const { confirm, informar, avisar } = useSheet();
    const [categories, setCategories] = useState([]);
    const [modalVisible, setModalVisible] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    const [editingId, setEditingId] = useState(null);

    // Form State
    const [name, setName] = useState('');
    const [type, setType] = useState('video');
    const [startDate, setStartDate] = useState(getLocalDateString());
    const [selectedDays, setSelectedDays] = useState({
        Monday: 0, Tuesday: 0, Wednesday: 0, Thursday: 0, Friday: 0, Saturday: 0, Sunday: 0
    });
    const [frequency, setFrequency] = useState('');
    const [seriesCount, setSeriesCount] = useState('');
    const [description, setDescription] = useState('');

    // Calendar State
    const [calendarVisible, setCalendarVisible] = useState(false);
    // Fase 7.4b: con registros (filas vivas de historial) la fecha de inicio queda fija.
    const [startDateLocked, setStartDateLocked] = useState(false);

    const fetchCategories = async () => {
        const result = await db.getEntertainmentCategories(user.id);
        if (result.success) {
            setCategories(result.categories);
        }
    };

    useEffect(() => {
        fetchCategories();
    }, []);
    // Recarga si la sync trae cambios del servidor (sin tocar formularios, filtros ni scroll).
    useSyncRefresh(() => fetchCategories());

    const openModal = (item = null) => {
        if (item) {
            setIsEditing(true);
            setStartDateLocked(!canEditStartDate(item));
            setEditingId(item.id);
            setName(item.name);
            setType(item.type);
            setStartDate(item.start_date || getLocalDateString());

            // Handle daily quotas (stored as JSON object)
            let days = { Monday: 0, Tuesday: 0, Wednesday: 0, Thursday: 0, Friday: 0, Saturday: 0, Sunday: 0 };
            try {
                const parsedDays = typeof item.days_of_week === 'string' ? JSON.parse(item.days_of_week) : item.days_of_week;
                if (Array.isArray(parsedDays)) {
                    // Migrate from old array format
                    parsedDays.forEach(d => { if (days.hasOwnProperty(d)) days[d] = 1; });
                } else if (parsedDays && typeof parsedDays === 'object') {
                    days = { ...days, ...parsedDays };
                }
            } catch (e) { console.error("Error parsing days", e); }
            setSelectedDays(days);

            setFrequency(String(item.frequency || ''));
            setSeriesCount(String(item.series_count || ''));
            setDescription(item.description || '');
        } else {
            setIsEditing(false);
            setStartDateLocked(false);
            setEditingId(null);
            setName('');
            setType('video');
            setStartDate(getLocalDateString());
            setSelectedDays({ Monday: 0, Tuesday: 0, Wednesday: 0, Thursday: 0, Friday: 0, Saturday: 0, Sunday: 0 });
            setFrequency('');
            setSeriesCount('');
            setDescription('');
        }
        setModalVisible(true);
    };

    const updateDayQuota = (dayKey, value) => {
        setSelectedDays(prev => ({
            ...prev,
            [dayKey]: parseInt(value) || 0
        }));
    };

    const toggleDay = (dayKey) => {
        if (type === 'video') return; // Should not be called for video in new UI
        
        // For reading, we treat selectedDays as a map where 1 is selected
        setSelectedDays(prev => ({
            ...prev,
            [dayKey]: prev[dayKey] ? 0 : 1
        }));
    };

    const handleSave = async () => {
        const validation = validateCategoryForm({ name, seriesCount });
        if (validation.error === 'nombre') {
            informar('Error', 'Por favor ingresa un nombre para la categoría.');
            return;
        }
        if (validation.error === 'limite') {
            informar('Error', 'El límite de series activas es obligatorio (mínimo 1).');
            return;
        }

        const data = {
            name,
            type,
            startDate,
            daysOfWeek: selectedDays,
            frequency: parseInt(frequency) || 0,
            seriesCount: validation.seriesCount,
            description
        };

        let result;
        if (isEditing) {
            result = await db.updateEntertainmentCategory(editingId, data);
        } else {
            result = await db.addEntertainmentCategory(user.id, data);
        }

        if (result.success) {
            setModalVisible(false);
            fetchCategories();
            avisar({ titulo: 'Éxito', mensaje: isEditing ? 'Actualizado correctamente' : 'Guardado correctamente' });
        } else {
            informar('Error', result.error || 'No se pudo guardar la información');
        }
    };

    const handleTogglePause = async (item) => {
        const todayStr = getLocalDateString();
        let result;
        if (item.is_paused) {
            // Para reanudar hoy, la pausa terminó ayer
            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);
            const yesterdayStr = getLocalDateString(yesterday);
            result = await db.resumeCategory(item.id, yesterdayStr);
        } else {
            result = await db.pauseCategory(item.id, todayStr);
        }

        if (result.success) {
            fetchCategories();
        } else {
            informar('Error', 'No se pudo cambiar el estado de pausa');
        }
    };

    // Fase 7.5 (D5, corrección): borrar la categoría borra sus series u obras vinculadas con su
    // progreso, y sus títulos vuelven a Pendiente sin vínculo; la confirmación lo dice (singular o
    // plural, serie u obra según el tipo). Sin vinculados, el texto de siempre.
    const handleDelete = async (id, type) => {
        const linked = await db.countLinkedTitlesInCategory(id);
        const n = linked && linked.success ? linked.count : 0;
        const base = '¿Estás seguro de que quieres eliminar esta categoría?';
        const una = type === 'reading' ? 'su obra vinculada' : 'su serie vinculada';
        const varias = type === 'reading' ? `sus ${n} obras vinculadas` : `sus ${n} series vinculadas`;
        const mensaje = n === 0 ? base
            : n === 1 ? `${base} Se borrará ${una} con todo su progreso y su título volverá a Pendiente, sin vínculo.`
            : `${base} Se borrarán ${varias} con todo su progreso y sus títulos volverán a Pendiente, sin vínculo.`;
        confirm({
            titulo: 'Eliminar',
            mensaje,
            acciones: [
                { clave: 'cancelar', texto: 'Cancelar', variante: 'cancelar' },
                { clave: 'eliminar', texto: 'Eliminar', variante: 'destructiva' },
            ],
        }).then(async (clave) => {
            if (clave !== 'eliminar') return;
            const result = await db.deleteEntertainmentCategory(id);
            if (result.success) fetchCategories();
        });
    };

    // isDatePaused removed
    // calculateBacklog removed

    const renderItem = ({ item }) => {
        // Parse quotas
        let quotas = {};
        try {
            quotas = typeof item.days_of_week === 'string' ? JSON.parse(item.days_of_week) : item.days_of_week;
            if (Array.isArray(quotas)) {
                // Legacy display
                const dayLabels = quotas.map(dKey => DAYS.find(d => d.key === dKey)?.label).join(', ');
                item._displayDays = dayLabels;
            } else {
                if (item.type === 'video') {
                    item._quotaBadges = DAYS.filter(d => quotas[d.key] > 0).map(d => ({ label: d.label, amount: quotas[d.key] }));
                } else {
                    item._displayDays = DAYS.filter(d => quotas[d.key] > 0).map(d => d.label).join(', ');
                }
            }
        } catch (e) { item._displayDays = 'No definido'; }

        const calc = calculateBacklog(item, item.totalWatched);

        return (
            <TouchableOpacity
                style={[styles.card, { backgroundColor: theme.surface }]}
                onPress={() => onNavigateDetail(item)}
            >
                <View style={styles.cardHeader}>
                    <View style={styles.cardIcon}>
                        <Text style={{ fontSize: 20 }}>{item.type === 'video' ? '🎬' : '📚'}</Text>
                    </View>
                    <View style={{ flex: 1, minWidth: 0, marginLeft: 12 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, minWidth: 0, flexWrap: 'wrap' }}>
                                <Text style={[styles.cardTitle, { color: theme.ink, flexShrink: 1, minWidth: 0 }]} numberOfLines={2} ellipsizeMode="tail">{item.name}</Text>
                                {item.is_paused && (
                                    <View style={styles.pausedBadge}>
                                        <Text style={styles.pausedBadgeText}>PAUSADO</Text>
                                    </View>
                                )}
                            </View>

                            <View style={styles.actionButtonsContainer}>
                                <TouchableOpacity
                                    style={styles.iconButton}
                                    onPress={(e) => {
                                        e.stopPropagation();
                                        openModal(item);
                                    }}
                                >
                                    <Text style={styles.iconButtonText}>✏️</Text>
                                </TouchableOpacity>

                                <TouchableOpacity
                                    style={styles.iconButton}
                                    onPress={(e) => {
                                        e.stopPropagation();
                                        handleTogglePause(item);
                                    }}
                                >
                                    <Text style={styles.iconButtonText}>{item.is_paused ? '▶️' : '⏸️'}</Text>
                                </TouchableOpacity>

                                <TouchableOpacity
                                    style={styles.iconButton}
                                    onPress={(e) => {
                                        e.stopPropagation();
                                        handleDelete(item.id, item.type);
                                    }}
                                >
                                    <Text style={styles.iconButtonText}>🗑️</Text>
                                </TouchableOpacity>
                            </View>
                        </View>

                        {/* Info Badges */}
                        <View style={styles.badgesContainer}>
                            <View style={[styles.badge, { backgroundColor: theme.soft }]}>
                                <Text style={styles.badgeIcon}>📅</Text>
                                <Text style={[styles.badgeText, { color: theme.accent }]} numberOfLines={1}>
                                    {item.start_date}
                                </Text>
                            </View>
                            
                            {item.type === 'video' && item._quotaBadges && item._quotaBadges.length > 0 ? (
                                <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 4, marginRight: 6, marginBottom: 6 }}>
                                    <View style={[styles.badge, { backgroundColor: theme.tones.verde.bg, marginRight: 0, marginBottom: 0 }]}>
                                        <Text style={styles.badgeIcon}>📺</Text>
                                        <Text style={[styles.badgeText, { color: theme.tones.verde.fg }]}>Cuotas:</Text>
                                    </View>
                                    {item._quotaBadges.map((qb, i) => (
                                        <View key={i} style={[styles.miniQuotaBadge, { backgroundColor: theme.soft }]}>
                                            <Text style={{ fontSize: 11, color: theme.accent, fontFamily: FONT.bold }}>{qb.label}: {qb.amount}</Text>
                                        </View>
                                    ))}
                                </View>
                            ) : (
                                <View style={[styles.badge, { backgroundColor: theme.tones.verde.bg }]}>
                                    <Text style={styles.badgeIcon}>{item.type === 'video' ? '📺' : '📆'}</Text>
                                    <Text style={[styles.badgeText, { color: theme.tones.verde.fg }]} numberOfLines={1}>
                                        {item.type === 'video' ? 'Cuotas:' : 'Días:'} {item._displayDays || 'No definido'}
                                    </Text>
                                </View>
                            )}

                            {/* Límite Viendo Badge */}
                            {(item.series_count !== null && item.series_count > 0) ? (
                                <View style={[styles.badge, { backgroundColor: theme.tones.naranja.bg }]}>
                                    <Text style={styles.badgeIcon}>👀</Text>
                                    <Text style={[styles.badgeText, { color: theme.tones.naranja.fg }]} numberOfLines={1}>
                                        Límite: {item.series_count}
                                    </Text>
                                </View>
                            ) : (
                                <View style={[styles.badge, { backgroundColor: theme.tones.naranja.bg }]}>
                                    <Text style={styles.badgeIcon}>👀</Text>
                                    <Text style={[styles.badgeText, { color: theme.tones.naranja.fg }]} numberOfLines={1}>
                                        Sin límite
                                    </Text>
                                </View>
                            )}

                            {/* Frecuencia Lectura Badge */}
                            {item.type === 'reading' && (
                                <View style={[styles.badge, { backgroundColor: theme.tones.morado.bg }]}>
                                    <Text style={styles.badgeIcon}>⏱️</Text>
                                    <Text style={[styles.badgeText, { color: theme.tones.morado.fg }]} numberOfLines={1}>
                                        {item.frequency < 0 ? `1 cada ${Math.abs(item.frequency)} d` : `${item.frequency} / día`}
                                    </Text>
                                </View>
                            )}
                        </View>

                        {/* Calculation Result */}
                        {calc && (
                            <View style={[styles.calcResult, { backgroundColor: calc.adelantoItems > 0 ? theme.aheadBg : (calc.diffDays <= 0 && calc.backlogItems <= 0) ? theme.okBg : theme.behindBg }]}>
                                <Text numberOfLines={1} ellipsizeMode="tail" style={[styles.calcText, (calc.diffDays <= 0 && calc.backlogItems <= 0 && calc.adelantoItems <= 0) && { color: theme.okFg, fontFamily: FONT.bold }, calc.adelantoItems > 0 && { color: theme.aheadFg, fontFamily: FONT.bold }]}>
                                    {calc.adelantoItems > 0
                                        ? `Adelantado: ${calc.adelantoDays} días, ${calc.adelantoItems} ${calc.unit}`
                                        : (calc.diffDays <= 0 && calc.backlogItems <= 0)
                                            ? '¡Estás al día! 🎉'
                                            : `Atraso: ${calc.diffDays} días, ${calc.backlogItems} ${calc.unit}`}
                                </Text>
                            </View>
                        )}
                    </View>
                </View>
            </TouchableOpacity>
        );
    };

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: theme.bg }]}>

            {/* Header */}
            <View style={[styles.header, { backgroundColor: theme.surface, borderBottomColor: theme.line }]}>
                <TouchableOpacity onPress={onBack} style={styles.backButton}>
                    <Text style={[styles.backButtonText, { color: theme.ink }]}>←</Text>
                </TouchableOpacity>
                <Text style={[styles.headerTitle, { color: theme.ink }]}>Mis Listas</Text>
                <TouchableOpacity onPress={() => openModal(null)} style={styles.addButton}>
                    <Text style={styles.addButtonText}>+</Text>
                </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={styles.scrollContent}>
                {/* VIDEO SECTION */}
                <View style={styles.sectionHeaderContainer}>
                    <Text style={[styles.sectionHeaderTitle, { color: theme.ink }]}>🎬 Video</Text>
                </View>
                {categories.filter(c => c.type === 'video').length > 0 ? (
                    categories.filter(c => c.type === 'video').map(item => (
                        <View key={item.id}>{renderItem({ item })}</View>
                    ))
                ) : (
                    <Text style={styles.emptySectionText}>No hay listas de video</Text>
                )}

                {/* READING SECTION */}
                <View style={[styles.sectionHeaderContainer, { marginTop: 25 }]}>
                    <Text style={[styles.sectionHeaderTitle, { color: theme.ink }]}>📚 Lectura</Text>
                </View>
                {categories.filter(c => c.type === 'reading').length > 0 ? (
                    categories.filter(c => c.type === 'reading').map(item => (
                        <View key={item.id}>{renderItem({ item })}</View>
                    ))
                ) : (
                    <Text style={styles.emptySectionText}>No hay listas de lectura</Text>
                )}

                <View style={{ height: 100 }} />
            </ScrollView>

            {/* Formulario de categoría (1.4.3, C3: hoja con teclado; ningún campo queda tapado) */}
            <HojaConTeclado visible={modalVisible} onClose={() => setModalVisible(false)}>
                    <View style={[styles.modalContent, { backgroundColor: theme.surface }]}>
                        <View style={styles.modalHeader}>
                            <Text style={[styles.modalTitle, { color: theme.ink }]}>
                                {isEditing ? 'Editar Categoría' : 'Nueva Categoría'}
                            </Text>
                            <TouchableOpacity onPress={() => setModalVisible(false)}>
                                <Text style={styles.closeText}>✕</Text>
                            </TouchableOpacity>
                        </View>

                        <ScrollDeHoja>
                            {/* Name */}
                            <Text style={[styles.label, { color: theme.ink }]}>Nombre</Text>
                            <TextInput
                                style={[styles.input, { backgroundColor: theme.raised, color: theme.ink, borderColor: theme.line }]}
                                placeholder="Ej. Anime 2024"
                                placeholderTextColor={theme.muted}
                                value={name}
                                onChangeText={setName}
                            />

                            {/* Type Selector */}
                            <Text style={[styles.label, { color: theme.ink }]}>Tipo</Text>
                            <View style={styles.typeContainer}>
                                <TouchableOpacity
                                    style={[styles.typeButton, type === 'video' && styles.typeButtonActive]}
                                    onPress={() => setType('video')}
                                >
                                    <Text style={[styles.typeText, type === 'video' && styles.typeTextActive]}>Video 🎬</Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                    style={[styles.typeButton, type === 'reading' && styles.typeButtonActive]}
                                    onPress={() => setType('reading')}
                                >
                                    <Text style={[styles.typeText, type === 'reading' && styles.typeTextActive]}>Lectura 📚</Text>
                                </TouchableOpacity>
                            </View>

                            {/* Start Date - Custom Calendar Trigger */}
                            <Text style={[styles.label, { color: theme.ink }]}>Fecha de Inicio</Text>
                            {startDateLocked ? (
                                <View style={[styles.dateButton, { backgroundColor: theme.raised, borderColor: theme.line }]}>
                                    <Text style={[styles.dateButtonText, { color: theme.muted }]}>📅 {startDate}</Text>
                                    <Text style={[styles.dateLockedText, { color: theme.muted }]}>La fecha de inicio no se puede cambiar porque ya hay registros.</Text>
                                </View>
                            ) : (
                                <TouchableOpacity
                                    style={[styles.dateButton, { backgroundColor: theme.raised, borderColor: theme.line }]}
                                    onPress={() => setCalendarVisible(true)}
                                >
                                    <Text style={[styles.dateButtonText, { color: theme.ink }]}>📅 {startDate || 'Seleccionar Fecha'}</Text>
                                </TouchableOpacity>
                            )}

                            {/* Days Selection logic based on type */}
                            {type === 'video' ? (
                                <>
                                    <Text style={[styles.label, { color: theme.ink }]}>Cuota por Día (Capítulos)</Text>
                                    <View style={styles.daysQuotasContainer}>
                                        {DAYS.map((day) => (
                                            <View key={day.key} style={styles.dayQuotaItem}>
                                                <Text style={[styles.dayLabelShort, { color: theme.ink }]}>{day.label}</Text>
                                                <TextInput
                                                    style={[styles.dayQuotaInput, { backgroundColor: theme.raised, color: theme.ink, borderColor: theme.line }]}
                                                    keyboardType="numeric"
                                                    value={String(selectedDays[day.key] || 0)}
                                                    onChangeText={(val) => updateDayQuota(day.key, val)}
                                                    selectTextOnFocus
                                                />
                                            </View>
                                        ))}
                                    </View>
                                </>
                            ) : (
                                <>
                                    <Text style={[styles.label, { color: theme.ink }]}>Días</Text>
                                    <View style={styles.daysContainer}>
                                        {DAYS.map((day) => (
                                            <TouchableOpacity
                                                key={day.key}
                                                style={[
                                                    styles.dayButton,
                                                    selectedDays[day.key] > 0 && styles.dayButtonActive
                                                ]}
                                                onPress={() => toggleDay(day.key)}
                                            >
                                                <Text style={[
                                                    styles.dayText,
                                                    { color: theme.ink },
                                                    selectedDays[day.key] > 0 && styles.dayTextActive
                                                ]}>
                                                    {day.label}
                                                </Text>
                                            </TouchableOpacity>
                                        ))}
                                    </View>
                                </>
                            )}

                            {/* Frequency (Only for Reading now or special cases) */}
                            {type === 'reading' && (
                                <View style={styles.row}>
                                    <View style={styles.halfInput}>
                                        <Text style={[styles.label, { color: theme.ink }]}>Frecuencia Lectura</Text>
                                        <TextInput
                                            style={[styles.input, { backgroundColor: theme.raised, color: theme.ink, borderColor: theme.line }]}
                                            placeholder="Ej: -3 (1 cada 3 días)"
                                            placeholderTextColor={theme.muted}
                                            keyboardType="numbers-and-punctuation"
                                            value={frequency}
                                            onChangeText={setFrequency}
                                        />
                                        <Text style={styles.hintText}>Usa negativo (ej -3) para leer cada X días.</Text>
                                    </View>
                                    <View style={styles.halfInput}>
                                        <Text style={[styles.label, { color: theme.ink }]}>Límite (Viendo)</Text>
                                        <TextInput
                                            style={[styles.input, { backgroundColor: theme.raised, color: theme.ink, borderColor: theme.line }]}
                                            placeholder="0"
                                            placeholderTextColor={theme.muted}
                                            keyboardType="numeric"
                                            value={seriesCount}
                                            onChangeText={setSeriesCount}
                                        />
                                    </View>
                                </View>
                            )}

                            {/* O1 (7.4a): obligatorio en video y en lectura, mínimo 1. */}
                            <View style={styles.row}>
                                <View style={styles.fullWidth}>
                                    <Text style={[styles.label, { color: theme.ink }]}>Límite Simultáneo (Viendo)</Text>
                                    <TextInput
                                        style={[styles.input, { backgroundColor: theme.raised, color: theme.ink, borderColor: theme.line }]}
                                        placeholder={type === 'video' ? 'Cuántas series puedes ver a la vez (mínimo 1)' : 'Cuántas obras puedes leer a la vez (mínimo 1)'}
                                        placeholderTextColor={theme.muted}
                                        keyboardType="numeric"
                                        value={seriesCount}
                                        onChangeText={setSeriesCount}
                                    />
                                </View>
                            </View>

                            {/* Description */}
                            <Text style={[styles.label, { color: theme.ink }]}>Descripción</Text>
                            <TextInput
                                style={[styles.input, styles.textArea, { backgroundColor: theme.raised, color: theme.ink, borderColor: theme.line }]}
                                placeholder="Notas..."
                                placeholderTextColor={theme.muted}
                                multiline
                                numberOfLines={3}
                                value={description}
                                onChangeText={setDescription}
                            />

                            {/* Save Button */}
                            <TouchableOpacity style={styles.saveButton} onPress={handleSave}>
                                <Text style={styles.saveButtonText}>
                                    {isEditing ? 'Actualizar' : 'Guardar'}
                                </Text>
                            </TouchableOpacity>
                            <View style={{ height: 20 }} />
                        </ScrollDeHoja>
                    </View>
            </HojaConTeclado>

            {/* Calendar Modal */}
            <CustomCalendar
                visible={calendarVisible}
                onClose={() => setCalendarVisible(false)}
                onSelectDate={setStartDate}
                initialDate={startDate}
            />
        </SafeAreaView>
    );
}

// Estilos en función del tema (dirección visual): ningún color fijo.
const makeStyles = (t) => StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: t.bg,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 20,
        paddingVertical: 15,
        backgroundColor: t.surface,
        borderBottomWidth: 1,
        borderBottomColor: t.line,
    },
    backButton: {
        padding: 5,
    },
    backButtonText: {
        fontSize: 24,
        color: t.ink,
    },
    headerTitle: {
        fontSize: 18,
        fontFamily: FONT.bold,
        color: t.ink,
    },
    addButton: {
        padding: 5,
        backgroundColor: t.soft,
        borderRadius: 20,
        width: 35,
        height: 35,
        alignItems: 'center',
        justifyContent: 'center',
    },
    addButtonText: {
        fontSize: 24,
        color: t.accent,
        lineHeight: 26,
    },
    listContent: {
        padding: 20,
    },
    card: {
        backgroundColor: t.surface,
        borderRadius: 15,
        padding: 15,
        marginBottom: 15,
        shadowColor: t.shadow,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.05,
        shadowRadius: 5,
        elevation: 2,
    },
    scrollContent: {
        padding: 20,
    },
    sectionHeaderContainer: {
        marginBottom: 10,
        borderBottomWidth: 1,
        borderBottomColor: t.line,
        paddingBottom: 5
    },
    sectionHeaderTitle: {
        fontSize: 18,
        fontFamily: FONT.bold,
        color: t.muted,
    },
    emptySectionText: {
        textAlign: 'center',
        color: t.muted,
        fontStyle: 'italic',
        marginBottom: 10,
        marginTop: 5
    },
    cardHeader: {
        flexDirection: 'row',
        alignItems: 'flex-start',
    },
    cardIcon: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: t.raised,
        justifyContent: 'center',
        alignItems: 'center',
    },
    cardTitle: {
        fontSize: 16,
        fontFamily: FONT.bold,
        color: t.ink,
    },
    cardSubtitle: {
        fontSize: 12,
        color: t.muted,
        marginTop: 2,
    },
    cardDesc: {
        marginTop: 10,
        fontSize: 12,
        color: t.muted,
        fontStyle: 'italic',
    },
    arrow: {
        fontSize: 20,
        color: t.muted,
    },
    emptyContainer: {
        alignItems: 'center',
        marginTop: 50,
    },
    emptyText: {
        fontSize: 16,
        color: t.muted,
        fontFamily: FONT.bold,
    },
    emptySubText: {
        fontSize: 14,
        color: t.muted,
        marginTop: 5,
    },
    modalOverlay: {
        flex: 1,
        backgroundColor: t.overlay,
        justifyContent: 'flex-end',
    },
    modalContent: {
        backgroundColor: t.surface,
        borderTopLeftRadius: 25,
        borderTopRightRadius: 25,
        padding: 20,
        flexShrink: 1, // dentro de HojaConTeclado: alto del contenido, sin pasar el área libre
    },
    modalHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 20,
        borderBottomWidth: 1,
        borderBottomColor: t.line,
        paddingBottom: 15,
    },
    modalTitle: {
        fontSize: 20,
        fontFamily: FONT.bold,
        color: t.ink,
    },
    closeText: {
        fontSize: 24,
        color: t.muted,
        padding: 5,
    },
    label: {
        fontSize: 14,
        fontFamily: FONT.semibold,
        color: t.muted,
        marginBottom: 8,
        marginTop: 10,
    },
    input: {
        backgroundColor: t.raised,
        padding: 12,
        borderRadius: 10,
        fontSize: 16,
        borderWidth: 1,
        borderColor: t.lineStrong,
        marginBottom: 5,
        color: t.ink
    },
    hintText: {
        fontSize: 11,
        color: t.muted,
        marginBottom: 10,
        marginLeft: 2,
    },
    typeContainer: {
        flexDirection: 'row',
        marginBottom: 10,
    },
    typeButton: {
        flex: 1,
        paddingVertical: 10,
        alignItems: 'center',
        backgroundColor: t.surface,
        borderWidth: 1,
        borderColor: t.lineStrong,
        marginHorizontal: 5,
        borderRadius: 10,
    },
    typeButtonActive: {
        backgroundColor: t.soft,
        borderColor: t.accent,
    },
    typeText: {
        fontSize: 14,
        color: t.muted,
    },
    typeTextActive: {
        color: t.accent,
        fontFamily: FONT.bold,
    },
    daysContainer: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginBottom: 15,
    },
    daysQuotasContainer: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 5,
        marginBottom: 15,
    },
    dayQuotaItem: {
        alignItems: 'center',
        width: '12%',
    },
    dayLabelShort: {
        fontSize: 12,
        fontFamily: FONT.bold,
        marginBottom: 5,
    },
    dayQuotaInput: {
        width: '100%',
        padding: 5,
        borderRadius: 8,
        borderWidth: 1,
        textAlign: 'center',
        fontSize: 14,
    },
    fullWidth: {
        flex: 1,
    },
    dayButton: {
        width: 35,
        height: 35,
        borderRadius: 17.5,
        backgroundColor: t.raised,
        justifyContent: 'center',
        alignItems: 'center',
    },
    dayButtonActive: {
        backgroundColor: t.accent,
    },
    dayText: {
        fontSize: 12,
        fontFamily: FONT.bold,
        color: t.muted,
    },
    dayTextActive: {
        color: t.onAccent,
    },
    row: {
        flexDirection: 'row',
        justifyContent: 'space-between',
    },
    halfInput: {
        width: '48%',
    },
    textArea: {
        height: 80,
        textAlignVertical: 'top',
    },
    saveButton: {
        backgroundColor: t.accent,
        paddingVertical: 15,
        borderRadius: 12,
        alignItems: 'center',
        marginTop: 20,
        shadowColor: t.shadow,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.2,
        shadowRadius: 5,
        elevation: 5,
    },
    saveButtonText: {
        color: t.onAccent,
        fontSize: 18,
        fontFamily: FONT.bold,
    },
    // Calendar Styles
    dateButton: {
        backgroundColor: t.raised,
        padding: 15,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: t.lineStrong,
        marginBottom: 10,
        alignItems: 'center',
    },
    dateLockedText: {
        fontSize: 12,
        marginTop: 4,
    },
    dateButtonText: {
        fontSize: 16,
        color: t.ink,
        fontFamily: FONT.medium,
    },
    calendarHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 20,
        marginTop: 10,
    },
    monthTitle: {
        fontSize: 18,
        fontFamily: FONT.bold,
        color: t.ink,
    },
    navButton: {
        padding: 10,
    },
    navButtonText: {
        fontSize: 24,
        color: t.accent,
    },
    weekDays: {
        flexDirection: 'row',
        justifyContent: 'space-around',
        marginBottom: 10,
    },
    weekDayText: {
        fontSize: 14,
        fontFamily: FONT.bold,
        color: t.muted,
        width: 30,
        textAlign: 'center',
    },
    daysGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
    },
    calendarDay: {
        width: '14.28%', // 100% / 7
        aspectRatio: 1,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 5,
    },
    calendarDayText: {
        fontSize: 16,
        color: t.ink,
    },
    calendarDaySelected: {
        backgroundColor: t.accent,
        borderRadius: 20,
    },
    calendarDayTextSelected: {
        color: t.onAccent,
        fontFamily: FONT.bold,
    },
    calendarDayToday: {
        borderWidth: 1,
        borderColor: t.accent,
        borderRadius: 20,
    },
    calendarDayTextToday: {
        color: t.accent,
        fontFamily: FONT.bold,
    },
    closeButton: {
        marginTop: 20,
        padding: 15,
        alignItems: 'center',
    },
    closeButtonText: {
        color: t.danger,
        fontSize: 16,
    },
    calendarActions: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginTop: 25,
        paddingHorizontal: 10,
    },
    actionButton: {
        paddingVertical: 12,
        paddingHorizontal: 30,
        borderRadius: 10,
    },
    cancelButton: {
        backgroundColor: t.raised,
        borderWidth: 1,
        borderColor: t.raised,
    },
    confirmButton: {
        backgroundColor: t.accent,
    },
    cancelButtonText: {
        color: t.ink,
        fontFamily: FONT.bold,
    },
    confirmButtonText: {
        color: t.onAccent,
        fontFamily: FONT.bold,
    },
    // New Card Styles
    badgesContainer: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        marginTop: 10,
    },
    badge: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 8,
        marginRight: 6,
        marginBottom: 6,
    },
    badgeIcon: {
        fontSize: 12,
    },
    badgeText: {
        fontSize: 12,
        fontFamily: FONT.semibold,
        marginLeft: 4,
    },
    miniQuotaBadge: {
        paddingHorizontal: 6,
        paddingVertical: 3,
        borderRadius: 8,
    },
    cardInfoRow: {
        fontSize: 13,
        color: t.muted,
        marginTop: 2,
    },
    calcResult: {
        marginTop: 5,
        backgroundColor: t.behindBg,
        padding: 5,
        borderRadius: 5,
        alignSelf: 'flex-start',
    },
    calcText: {
        color: t.behindFg,
        fontSize: 12,
        fontFamily: FONT.bold,
    },
    actionButtonsContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        marginLeft: 10,
    },
    iconButton: {
        padding: 6,
        marginLeft: 2,
    },
    iconButtonText: {
        fontSize: 18,
    },
    pausedBadge: {
        backgroundColor: t.behindFg,
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 4,
        marginLeft: 8,
    },
    pausedBadgeText: {
        color: t.onDanger,
        fontSize: 10,
        fontFamily: FONT.bold,
    },
});
