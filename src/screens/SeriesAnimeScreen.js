import React, { useState, useEffect, useCallback } from 'react';
import {
    View,
    Text,
    TextInput,
    TouchableOpacity,
    StyleSheet,
    FlatList,
    Modal,
    Alert,
    KeyboardAvoidingView,
    Platform,
    ScrollView
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useTheme } from '../contexts/ThemeContext';
import db from '../services/db';
import { calculateBacklog, getLocalDateString } from '../services/backlogUtils';

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
                    <Text style={[styles.calendarDayText, { color: theme.text }, isSelected && styles.calendarDayTextSelected]}>{i}</Text>
                </TouchableOpacity>
            );
        }
        return days;
    };

    return (
        <Modal animationType="fade" transparent={true} visible={visible} onRequestClose={onClose}>
            <View style={styles.modalOverlay}>
                <View style={[styles.modalContent, { height: 'auto', paddingBottom: 30, backgroundColor: theme.card }]}>
                    <View style={styles.calendarHeader}>
                        <TouchableOpacity onPress={() => changeMonth(-1)} style={styles.navButton}><Text style={styles.navButtonText}>‹</Text></TouchableOpacity>
                        <Text style={[styles.monthTitle, { color: theme.text }]}>{monthNames[viewDate.getMonth()]} {viewDate.getFullYear()}</Text>
                        <TouchableOpacity onPress={() => changeMonth(1)} style={styles.navButton}><Text style={styles.navButtonText}>›</Text></TouchableOpacity>
                    </View>
                    <View style={styles.weekDays}>
                        {['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((d, i) => <Text key={i} style={[styles.weekDayText, { color: theme.subText }]}>{d}</Text>)}
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
    const { theme, isDarkMode } = useTheme();
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

    const fetchCategories = async () => {
        const result = await db.getEntertainmentCategories(user.id);
        if (result.success) {
            setCategories(result.categories);
        }
    };

    useEffect(() => {
        fetchCategories();
    }, []);

    const openModal = (item = null) => {
        if (item) {
            setIsEditing(true);
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
        if (!name.trim()) {
            Alert.alert('Error', 'Por favor ingresa un nombre para la categoría.');
            return;
        }

        const data = {
            name,
            type,
            startDate,
            daysOfWeek: selectedDays,
            frequency: parseInt(frequency) || 0,
            seriesCount: seriesCount === '' ? null : (parseInt(seriesCount) || 0),
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
            Alert.alert('Éxito', isEditing ? 'Actualizado correctamente' : 'Guardado correctamente');
        } else {
            Alert.alert('Error', result.error || 'No se pudo guardar la información');
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
            Alert.alert('Error', 'No se pudo cambiar el estado de pausa');
        }
    };

    const handleDelete = (id) => {
        Alert.alert(
            'Eliminar',
            '¿Estás seguro de que quieres eliminar esta categoría?',
            [
                { text: 'Cancelar', style: 'cancel' },
                {
                    text: 'Eliminar',
                    style: 'destructive',
                    onPress: async () => {
                        const result = await db.deleteEntertainmentCategory(id);
                        if (result.success) fetchCategories();
                    }
                }
            ]
        );
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
                style={[styles.card, { backgroundColor: theme.card }]}
                onPress={() => onNavigateDetail(item)}
            >
                <View style={styles.cardHeader}>
                    <View style={styles.cardIcon}>
                        <Text style={{ fontSize: 20 }}>{item.type === 'video' ? '🎬' : '📚'}</Text>
                    </View>
                    <View style={{ flex: 1, marginLeft: 12 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, flexWrap: 'wrap' }}>
                                <Text style={[styles.cardTitle, { color: theme.text }]}>{item.name}</Text>
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
                                        handleDelete(item.id);
                                    }}
                                >
                                    <Text style={styles.iconButtonText}>🗑️</Text>
                                </TouchableOpacity>
                            </View>
                        </View>

                        {/* Info Badges */}
                        <View style={styles.badgesContainer}>
                            <View style={[styles.badge, { backgroundColor: isDarkMode ? '#2C2C2E' : '#E3F2FD' }]}>
                                <Text style={styles.badgeIcon}>📅</Text>
                                <Text style={[styles.badgeText, { color: isDarkMode ? '#A0A0A0' : '#1565C0' }]}>
                                    {item.start_date}
                                </Text>
                            </View>
                            
                            {item.type === 'video' && item._quotaBadges && item._quotaBadges.length > 0 ? (
                                <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 4, marginRight: 6, marginBottom: 6 }}>
                                    <View style={[styles.badge, { backgroundColor: isDarkMode ? '#2C2C2E' : '#E8F5E9', marginRight: 0, marginBottom: 0 }]}>
                                        <Text style={styles.badgeIcon}>📺</Text>
                                        <Text style={[styles.badgeText, { color: isDarkMode ? '#A0A0A0' : '#2E7D32' }]}>Cuotas:</Text>
                                    </View>
                                    {item._quotaBadges.map((qb, i) => (
                                        <View key={i} style={[styles.miniQuotaBadge, { backgroundColor: theme.accent + '22' }]}>
                                            <Text style={{ fontSize: 11, color: theme.accent, fontWeight: 'bold' }}>{qb.label}: {qb.amount}</Text>
                                        </View>
                                    ))}
                                </View>
                            ) : (
                                <View style={[styles.badge, { backgroundColor: isDarkMode ? '#2C2C2E' : '#E8F5E9' }]}>
                                    <Text style={styles.badgeIcon}>{item.type === 'video' ? '📺' : '📆'}</Text>
                                    <Text style={[styles.badgeText, { color: isDarkMode ? '#A0A0A0' : '#2E7D32' }]}>
                                        {item.type === 'video' ? 'Cuotas:' : 'Días:'} {item._displayDays || 'No definido'}
                                    </Text>
                                </View>
                            )}

                            {/* Límite Viendo Badge */}
                            {(item.series_count !== null && item.series_count > 0) ? (
                                <View style={[styles.badge, { backgroundColor: isDarkMode ? '#2C2C2E' : '#FFF3E0' }]}>
                                    <Text style={styles.badgeIcon}>👀</Text>
                                    <Text style={[styles.badgeText, { color: isDarkMode ? '#A0A0A0' : '#EF6C00' }]}>
                                        Límite: {item.series_count}
                                    </Text>
                                </View>
                            ) : (
                                <View style={[styles.badge, { backgroundColor: isDarkMode ? '#2C2C2E' : '#FFF3E0' }]}>
                                    <Text style={styles.badgeIcon}>👀</Text>
                                    <Text style={[styles.badgeText, { color: isDarkMode ? '#A0A0A0' : '#EF6C00' }]}>
                                        Sin límite
                                    </Text>
                                </View>
                            )}

                            {/* Frecuencia Lectura Badge */}
                            {item.type === 'reading' && (
                                <View style={[styles.badge, { backgroundColor: isDarkMode ? '#2C2C2E' : '#F3E5F5' }]}>
                                    <Text style={styles.badgeIcon}>⏱️</Text>
                                    <Text style={[styles.badgeText, { color: isDarkMode ? '#A0A0A0' : '#7B1FA2' }]}>
                                        {item.frequency < 0 ? `1 cada ${Math.abs(item.frequency)} d` : `${item.frequency} / día`}
                                    </Text>
                                </View>
                            )}
                        </View>

                        {/* Calculation Result */}
                        {calc && (
                            <View style={[styles.calcResult, { backgroundColor: isDarkMode ? '#332b21' : (calc.adelantoItems > 0 ? '#E8F5E9' : '#FFF3E0') }]}>
                                <Text style={[styles.calcText, (calc.diffDays <= 0 && calc.backlogItems <= 0 && calc.adelantoItems <= 0) && { color: '#4CAF50', fontWeight: 'bold' }, calc.adelantoItems > 0 && { color: '#2E7D32', fontWeight: 'bold' }]}>
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
        <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
            <StatusBar style={isDarkMode ? "light" : "dark"} />

            {/* Header */}
            <View style={[styles.header, { backgroundColor: theme.header, borderBottomColor: theme.border }]}>
                <TouchableOpacity onPress={onBack} style={styles.backButton}>
                    <Text style={[styles.backButtonText, { color: theme.text }]}>←</Text>
                </TouchableOpacity>
                <Text style={[styles.headerTitle, { color: theme.text }]}>Mis Listas</Text>
                <TouchableOpacity onPress={() => openModal(null)} style={styles.addButton}>
                    <Text style={styles.addButtonText}>+</Text>
                </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={styles.scrollContent}>
                {/* VIDEO SECTION */}
                <View style={styles.sectionHeaderContainer}>
                    <Text style={[styles.sectionHeaderTitle, { color: theme.text }]}>🎬 Video</Text>
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
                    <Text style={[styles.sectionHeaderTitle, { color: theme.text }]}>📚 Lectura</Text>
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

            {/* Modal */}
            <Modal
                animationType="slide"
                transparent={true}
                visible={modalVisible}
                onRequestClose={() => setModalVisible(false)}
            >
                <View style={styles.modalOverlay}>
                    <View style={[styles.modalContent, { backgroundColor: theme.card }]}>
                        <View style={styles.modalHeader}>
                            <Text style={[styles.modalTitle, { color: theme.text }]}>
                                {isEditing ? 'Editar Categoría' : 'Nueva Categoría'}
                            </Text>
                            <TouchableOpacity onPress={() => setModalVisible(false)}>
                                <Text style={styles.closeText}>✕</Text>
                            </TouchableOpacity>
                        </View>

                        <ScrollView>
                            {/* Name */}
                            <Text style={[styles.label, { color: theme.text }]}>Nombre</Text>
                            <TextInput
                                style={[styles.input, { backgroundColor: theme.inputBackground, color: theme.text, borderColor: theme.border }]}
                                placeholder="Ej. Anime 2024"
                                placeholderTextColor={theme.subText}
                                value={name}
                                onChangeText={setName}
                            />

                            {/* Type Selector */}
                            <Text style={[styles.label, { color: theme.text }]}>Tipo</Text>
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
                            <Text style={[styles.label, { color: theme.text }]}>Fecha de Inicio</Text>
                            <TouchableOpacity
                                style={[styles.dateButton, { backgroundColor: theme.inputBackground, borderColor: theme.border }]}
                                onPress={() => setCalendarVisible(true)}
                            >
                                <Text style={[styles.dateButtonText, { color: theme.text }]}>📅 {startDate || 'Seleccionar Fecha'}</Text>
                            </TouchableOpacity>

                            {/* Days Selection logic based on type */}
                            {type === 'video' ? (
                                <>
                                    <Text style={[styles.label, { color: theme.text }]}>Cuota por Día (Capítulos)</Text>
                                    <View style={styles.daysQuotasContainer}>
                                        {DAYS.map((day) => (
                                            <View key={day.key} style={styles.dayQuotaItem}>
                                                <Text style={[styles.dayLabelShort, { color: theme.text }]}>{day.label}</Text>
                                                <TextInput
                                                    style={[styles.dayQuotaInput, { backgroundColor: theme.inputBackground, color: theme.text, borderColor: theme.border }]}
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
                                    <Text style={[styles.label, { color: theme.text }]}>Días</Text>
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
                                                    { color: theme.text },
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
                                        <Text style={[styles.label, { color: theme.text }]}>Frecuencia Lectura</Text>
                                        <TextInput
                                            style={[styles.input, { backgroundColor: theme.inputBackground, color: theme.text, borderColor: theme.border }]}
                                            placeholder="Ej: -3 (1 cada 3 días)"
                                            placeholderTextColor={theme.subText}
                                            keyboardType="numbers-and-punctuation"
                                            value={frequency}
                                            onChangeText={setFrequency}
                                        />
                                        <Text style={styles.hintText}>Usa negativo (ej -3) para leer cada X días.</Text>
                                    </View>
                                    <View style={styles.halfInput}>
                                        <Text style={[styles.label, { color: theme.text }]}>Límite (Viendo)</Text>
                                        <TextInput
                                            style={[styles.input, { backgroundColor: theme.inputBackground, color: theme.text, borderColor: theme.border }]}
                                            placeholder="0"
                                            placeholderTextColor={theme.subText}
                                            keyboardType="numeric"
                                            value={seriesCount}
                                            onChangeText={setSeriesCount}
                                        />
                                    </View>
                                </View>
                            )}

                            {type === 'video' && (
                                <View style={styles.row}>
                                    <View style={styles.fullWidth}>
                                        <Text style={[styles.label, { color: theme.text }]}>Límite Simultáneo (Viendo)</Text>
                                        <TextInput
                                            style={[styles.input, { backgroundColor: theme.inputBackground, color: theme.text, borderColor: theme.border }]}
                                            placeholder="Cuántas series puedes ver a la vez (0 = sin límite)"
                                            placeholderTextColor={theme.subText}
                                            keyboardType="numeric"
                                            value={seriesCount}
                                            onChangeText={setSeriesCount}
                                        />
                                    </View>
                                </View>
                            )}

                            {/* Description */}
                            <Text style={[styles.label, { color: theme.text }]}>Descripción</Text>
                            <TextInput
                                style={[styles.input, styles.textArea, { backgroundColor: theme.inputBackground, color: theme.text, borderColor: theme.border }]}
                                placeholder="Notas..."
                                placeholderTextColor={theme.subText}
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
                        </ScrollView>
                    </View>
                </View>
            </Modal>

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

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#F7F7F7',
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 20,
        paddingVertical: 15,
        backgroundColor: '#fff',
        borderBottomWidth: 1,
        borderBottomColor: '#eee',
    },
    backButton: {
        padding: 5,
    },
    backButtonText: {
        fontSize: 24,
        color: '#333',
    },
    headerTitle: {
        fontSize: 18,
        fontWeight: 'bold',
        color: '#333',
    },
    addButton: {
        padding: 5,
        backgroundColor: '#E3F2FD',
        borderRadius: 20,
        width: 35,
        height: 35,
        alignItems: 'center',
        justifyContent: 'center',
    },
    addButtonText: {
        fontSize: 24,
        color: '#2196F3',
        lineHeight: 26,
    },
    listContent: {
        padding: 20,
    },
    card: {
        backgroundColor: '#fff',
        borderRadius: 15,
        padding: 15,
        marginBottom: 15,
        shadowColor: '#000',
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
        borderBottomColor: '#eee',
        paddingBottom: 5
    },
    sectionHeaderTitle: {
        fontSize: 18,
        fontWeight: 'bold',
        color: '#555',
    },
    emptySectionText: {
        textAlign: 'center',
        color: '#999',
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
        backgroundColor: '#F5F5F5',
        justifyContent: 'center',
        alignItems: 'center',
    },
    cardTitle: {
        fontSize: 16,
        fontWeight: 'bold',
        color: '#333',
    },
    cardSubtitle: {
        fontSize: 12,
        color: '#888',
        marginTop: 2,
    },
    cardDesc: {
        marginTop: 10,
        fontSize: 12,
        color: '#666',
        fontStyle: 'italic',
    },
    arrow: {
        fontSize: 20,
        color: '#ccc',
    },
    emptyContainer: {
        alignItems: 'center',
        marginTop: 50,
    },
    emptyText: {
        fontSize: 16,
        color: '#888',
        fontWeight: 'bold',
    },
    emptySubText: {
        fontSize: 14,
        color: '#aaa',
        marginTop: 5,
    },
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.5)',
        justifyContent: 'flex-end',
    },
    modalContent: {
        backgroundColor: '#fff',
        borderTopLeftRadius: 25,
        borderTopRightRadius: 25,
        padding: 20,
        height: '90%',
    },
    modalHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 20,
        borderBottomWidth: 1,
        borderBottomColor: '#eee',
        paddingBottom: 15,
    },
    modalTitle: {
        fontSize: 20,
        fontWeight: 'bold',
        color: '#333',
    },
    closeText: {
        fontSize: 24,
        color: '#888',
        padding: 5,
    },
    label: {
        fontSize: 14,
        fontWeight: '600',
        color: '#555',
        marginBottom: 8,
        marginTop: 10,
    },
    input: {
        backgroundColor: '#F9F9F9',
        padding: 12,
        borderRadius: 10,
        fontSize: 16,
        borderWidth: 1,
        borderColor: '#eee',
        marginBottom: 5,
        color: '#333'
    },
    hintText: {
        fontSize: 11,
        color: '#999',
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
        backgroundColor: '#fff',
        borderWidth: 1,
        borderColor: '#ddd',
        marginHorizontal: 5,
        borderRadius: 10,
    },
    typeButtonActive: {
        backgroundColor: '#E3F2FD',
        borderColor: '#2196F3',
    },
    typeText: {
        fontSize: 14,
        color: '#555',
    },
    typeTextActive: {
        color: '#2196F3',
        fontWeight: 'bold',
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
        fontWeight: 'bold',
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
        backgroundColor: '#eee',
        justifyContent: 'center',
        alignItems: 'center',
    },
    dayButtonActive: {
        backgroundColor: '#2196F3',
    },
    dayText: {
        fontSize: 12,
        fontWeight: 'bold',
        color: '#555',
    },
    dayTextActive: {
        color: '#fff',
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
        backgroundColor: '#2196F3',
        paddingVertical: 15,
        borderRadius: 12,
        alignItems: 'center',
        marginTop: 20,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.2,
        shadowRadius: 5,
        elevation: 5,
    },
    saveButtonText: {
        color: '#fff',
        fontSize: 18,
        fontWeight: 'bold',
    },
    // Calendar Styles
    dateButton: {
        backgroundColor: '#F9F9F9',
        padding: 15,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#ddd',
        marginBottom: 10,
        alignItems: 'center',
    },
    dateButtonText: {
        fontSize: 16,
        color: '#333',
        fontWeight: '500',
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
        fontWeight: 'bold',
        color: '#333',
    },
    navButton: {
        padding: 10,
    },
    navButtonText: {
        fontSize: 24,
        color: '#2196F3',
    },
    weekDays: {
        flexDirection: 'row',
        justifyContent: 'space-around',
        marginBottom: 10,
    },
    weekDayText: {
        fontSize: 14,
        fontWeight: 'bold',
        color: '#888',
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
        color: '#333',
    },
    calendarDaySelected: {
        backgroundColor: '#2196F3',
        borderRadius: 20,
    },
    calendarDayTextSelected: {
        color: '#fff',
        fontWeight: 'bold',
    },
    calendarDayToday: {
        borderWidth: 1,
        borderColor: '#2196F3',
        borderRadius: 20,
    },
    calendarDayTextToday: {
        color: '#2196F3',
        fontWeight: 'bold',
    },
    closeButton: {
        marginTop: 20,
        padding: 15,
        alignItems: 'center',
    },
    closeButtonText: {
        color: '#FF5252',
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
        backgroundColor: '#FFF',
        borderWidth: 1,
        borderColor: '#ddd',
    },
    confirmButton: {
        backgroundColor: '#2196F3',
    },
    cancelButtonText: {
        color: '#666',
        fontWeight: 'bold',
    },
    confirmButtonText: {
        color: '#FFF',
        fontWeight: 'bold',
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
        fontWeight: '600',
        marginLeft: 4,
    },
    miniQuotaBadge: {
        paddingHorizontal: 6,
        paddingVertical: 3,
        borderRadius: 8,
    },
    cardInfoRow: {
        fontSize: 13,
        color: '#555',
        marginTop: 2,
    },
    calcResult: {
        marginTop: 5,
        backgroundColor: '#FFF3E0',
        padding: 5,
        borderRadius: 5,
        alignSelf: 'flex-start',
    },
    calcText: {
        color: '#EF6C00',
        fontSize: 12,
        fontWeight: 'bold',
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
        backgroundColor: '#FF5252',
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 4,
        marginLeft: 8,
    },
    pausedBadgeText: {
        color: '#fff',
        fontSize: 10,
        fontWeight: 'bold',
    },
});
