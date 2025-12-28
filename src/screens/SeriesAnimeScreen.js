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
    const [startDate, setStartDate] = useState(new Date().toISOString().split('T')[0]);
    const [selectedDays, setSelectedDays] = useState([]);
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
            setStartDate(item.start_date || new Date().toISOString().split('T')[0]);

            // Handle array of days if it comes as JSON string or array
            let days = [];
            try {
                days = typeof item.days_of_week === 'string' ? JSON.parse(item.days_of_week) : item.days_of_week;
            } catch (e) { days = []; }
            setSelectedDays(days || []);

            setFrequency(String(item.frequency || ''));
            setSeriesCount(String(item.series_count || ''));
            setDescription(item.description || '');
        } else {
            setIsEditing(false);
            setEditingId(null);
            setName('');
            setType('video');
            setStartDate(new Date().toISOString().split('T')[0]);
            setSelectedDays([]);
            setFrequency('');
            setSeriesCount('');
            setDescription('');
        }
        setModalVisible(true);
    };

    const toggleDay = (dayKey) => {
        if (selectedDays.includes(dayKey)) {
            setSelectedDays(selectedDays.filter(d => d !== dayKey));
        } else {
            setSelectedDays([...selectedDays, dayKey]);
        }
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
            seriesCount: parseInt(seriesCount) || 0,
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

    const calculateBacklog = (startStr, freq, daysOfWeek, totalWatched = 0, type = 'video') => {
        if (!startStr || !freq) return null;

        let daysArray = [];
        try {
            daysArray = typeof daysOfWeek === 'string' ? JSON.parse(daysOfWeek) : daysOfWeek;
        } catch (e) { daysArray = []; }

        if (!daysArray || daysArray.length === 0) return null;

        const now = new Date();
        now.setHours(0, 0, 0, 0);

        const [y, m, d] = startStr.split('-').map(Number);
        const start = new Date(y, m - 1, d);

        if (start > now) return { diffDays: 0, backlogItems: 0, unit: '' };

        let validDaysPassed = 0;
        let current = new Date(start);

        while (current <= now) {
            const dayIndex = current.getDay();
            const dayMap = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
            const dayName = dayMap[dayIndex];

            if (daysArray.includes(dayName)) {
                validDaysPassed++;
            }
            current.setDate(current.getDate() + 1);
        }

        let targetItems = 0;

        if (freq > 0) {
            // Lógica normal: X items por día
            targetItems = validDaysPassed * freq;
        } else if (freq < 0) {
            // Lógica Lectura (inversa): 1 item cada X días
            // Usamos Math.floor para que el item solo "venza" cuando se cumple el ciclo completo
            // Ej: Freq -3. Día 1, 2 = 0 items. Día 3 = 1 item.
            const daysPerItem = Math.abs(freq);
            targetItems = Math.floor(validDaysPassed / daysPerItem);
        }

        let backlogItems = targetItems - totalWatched;
        if (backlogItems < 0) backlogItems = 0;

        // Days of Atraso calculation
        let daysAtraso = 0;
        if (freq > 0) {
            daysAtraso = Math.ceil(backlogItems / freq);
        } else if (freq < 0) {
            // Si debo 2 tomos, y leo 1 cada 3 días, necesito 6 días para ponerme al día.
            daysAtraso = backlogItems * Math.abs(freq);
        }

        let unitLabel = 'Items';
        if (type === 'video') unitLabel = 'Caps';
        if (type === 'reading') unitLabel = 'Tomos';

        return { diffDays: daysAtraso, backlogItems, unit: unitLabel };
    };

    const renderItem = ({ item }) => {
        // Parse days
        let days = [];
        try {
            days = typeof item.days_of_week === 'string' ? JSON.parse(item.days_of_week) : item.days_of_week;
        } catch (e) { days = []; }

        // Get day labels
        const dayLabels = days.map(dKey => {
            const dayObj = DAYS.find(d => d.key === dKey);
            return dayObj ? dayObj.label : '';
        }).join(', ');

        const calc = calculateBacklog(item.start_date, item.frequency, item.days_of_week, item.totalWatched, item.type);

        return (
            <TouchableOpacity
                style={[styles.card, { backgroundColor: theme.card }]}
                onPress={() => onNavigateDetail(item)}
            >
                <View style={styles.cardHeader}>
                    <View style={styles.cardIcon}>
                        <Text style={{ fontSize: 20 }}>{item.type === 'video' ? '🎬' : '📚'}</Text>
                    </View>
                    <View style={{ flex: 1, marginLeft: 10 }}>
                        <Text style={[styles.cardTitle, { color: theme.text }]}>{item.name}</Text>

                        {/* Info Rows */}
                        <Text style={[styles.cardInfoRow, { color: theme.subText }]}>📅 Inicio: {item.start_date}</Text>
                        <Text style={[styles.cardInfoRow, { color: theme.subText }]}>📆 Días: {dayLabels || 'No definido'}</Text>
                        <Text style={[styles.cardInfoRow, { color: theme.subText }]}>
                            ⏱️ Frecuencia: {item.frequency < 0 ? `1 cada ${Math.abs(item.frequency)} días` : `${item.frequency} / día`}
                        </Text>

                        {/* Calculation Result */}
                        {calc && (
                            <View style={[styles.calcResult, { backgroundColor: isDarkMode ? '#332b21' : '#FFF3E0' }]}>
                                <Text style={[styles.calcText, (calc.diffDays <= 0 && calc.backlogItems <= 0) && { color: '#4CAF50', fontWeight: 'bold' }]}>
                                    {(calc.diffDays <= 0 && calc.backlogItems <= 0)
                                        ? '¡Estás al día! 🎉'
                                        : `Atraso: ${calc.diffDays} días, ${calc.backlogItems} ${calc.unit}`}
                                </Text>
                            </View>
                        )}
                    </View>

                    <View style={styles.actionButtonsContainer}>
                        {/* Edit Button */}
                        <TouchableOpacity
                            style={styles.iconButton}
                            onPress={(e) => {
                                e.stopPropagation();
                                openModal(item);
                            }}
                        >
                            <Text style={styles.iconButtonText}>✏️</Text>
                        </TouchableOpacity>

                        {/* Delete Button */}
                        <TouchableOpacity
                            style={[styles.iconButton, { marginLeft: 10 }]}
                            onPress={(e) => {
                                e.stopPropagation();
                                handleDelete(item.id);
                            }}
                        >
                            <Text style={styles.iconButtonText}>🗑️</Text>
                        </TouchableOpacity>
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

                            {/* Days of Week */}
                            <Text style={[styles.label, { color: theme.text }]}>Días</Text>
                            <View style={styles.daysContainer}>
                                {DAYS.map((day) => (
                                    <TouchableOpacity
                                        key={day.key}
                                        style={[
                                            styles.dayButton,
                                            selectedDays.includes(day.key) && styles.dayButtonActive
                                        ]}
                                        onPress={() => toggleDay(day.key)}
                                    >
                                        <Text style={[
                                            styles.dayText,
                                            { color: theme.text },
                                            selectedDays.includes(day.key) && styles.dayTextActive
                                        ]}>
                                            {day.label}
                                        </Text>
                                    </TouchableOpacity>
                                ))}
                            </View>

                            {/* Frequency & Count Row */}
                            <View style={styles.row}>
                                <View style={styles.halfInput}>
                                    <Text style={[styles.label, { color: theme.text }]}>Frecuencia</Text>
                                    <TextInput
                                        style={[styles.input, { backgroundColor: theme.inputBackground, color: theme.text, borderColor: theme.border }]}
                                        placeholder={type === 'reading' ? "Ej: -3 (1/3 días)" : "Ej: 2 (2/día)"}
                                        placeholderTextColor={theme.subText}
                                        keyboardType="numbers-and-punctuation"
                                        value={frequency}
                                        onChangeText={setFrequency}
                                    />
                                </View>
                                <View style={styles.halfInput}>
                                    <Text style={styles.label}>{type === 'reading' ? 'Tomos' : 'Series'}</Text>
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
        alignItems: 'center',
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
        alignItems: 'center',
        justifyContent: 'space-between',
        height: 70, // Distribute space
        marginLeft: 5,
    },
    iconButton: {
        padding: 5,
    },
    iconButtonText: {
        fontSize: 20,
    },
});
