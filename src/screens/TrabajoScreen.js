import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    Modal,
    TextInput,
    Alert,
    ScrollView,
    Dimensions
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useTheme } from '../contexts/ThemeContext';
import db from '../services/db';

const { width } = Dimensions.get('window');

// Helper to calculate status for a given date (Bidirectional)
const getStatusForDate = (date, startDateStr, cycle) => {
    const [y, m, d] = startDateStr.split('-').map(Number);
    const start = new Date(y, m - 1, d);
    start.setHours(0, 0, 0, 0);
    
    const target = new Date(date);
    target.setHours(0, 0, 0, 0);
    
    const diffTime = target - start;
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    
    const totalCycleDays = cycle.reduce((acc, curr) => acc + curr.days, 0);
    if (totalCycleDays === 0) return 'Error';
    
    // Bidirectional modulo
    let dayInCycle = ((diffDays % totalCycleDays) + totalCycleDays) % totalCycleDays;
    
    for (const phase of cycle) {
        if (dayInCycle < phase.days) {
            return phase.type;
        }
        dayInCycle -= phase.days;
    }
    return 'Error';
};

const CYCLE_TYPES = [
    { label: 'Día', value: 'dia', icon: '☀️', color: '#FFEB3B' },
    { label: 'Noche', value: 'noche', icon: '🌙', color: '#9C27B0' },
    { label: 'Libre', value: 'libre', icon: '✅', color: '#4CAF50' },
];

const MONTHS = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
];

const WEEKDAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

export default function TrabajoScreen({ user, onBack }) {
    const { theme, isDarkMode } = useTheme();
    const [people, setPeople] = useState([]);
    const [showModal, setShowModal] = useState(false);
    const [editingPerson, setEditingPerson] = useState(null);
    const [currentDate, setCurrentDate] = useState(new Date()); // For calendar navigation
    
    // Form State
    const [name, setName] = useState('');
    const [startDate, setStartDate] = useState(new Date().toISOString().split('T')[0]);
    const [cycle, setCycle] = useState([{ type: 'dia', days: 1 }]);

    useEffect(() => {
        loadPeople();
    }, []);

    const loadPeople = async () => {
        const res = await db.getWorkPeople(user.id);
        if (res.success) {
            setPeople(res.data.map(p => ({
                ...p,
                cycle: JSON.parse(p.cycle)
            })));
        }
    };

    const handleSave = async () => {
        if (!name.trim()) return Alert.alert('Error', 'El nombre es obligatorio');
        const cycleStr = JSON.stringify(cycle);
        let res = editingPerson 
            ? await db.updateWorkPerson(editingPerson.id, name, startDate, cycleStr)
            : await db.addWorkPerson(user.id, name, startDate, cycleStr);

        if (res.success) {
            setShowModal(false);
            resetForm();
            loadPeople();
        }
    };

    const resetForm = () => {
        setName('');
        setStartDate(new Date().toISOString().split('T')[0]);
        setCycle([{ type: 'dia', days: 1 }]);
        setEditingPerson(null);
    };

    const deletePerson = (id) => {
        Alert.alert('Eliminar', '¿Eliminar a esta persona?', [
            { text: 'Cancelar', style: 'cancel' },
            { text: 'Eliminar', style: 'destructive', onPress: async () => {
                await db.deleteWorkPerson(id);
                loadPeople();
            }}
        ]);
    };

    const movePerson = async (index, direction) => {
        const newPeople = [...people];
        const targetIndex = index + direction;
        if (targetIndex < 0 || targetIndex >= newPeople.length) return;

        // Swap local state
        const temp = newPeople[index];
        newPeople[index] = newPeople[targetIndex];
        newPeople[targetIndex] = temp;

        setPeople(newPeople);

        // Update in DB (persist both positions)
        await db.updateWorkPersonOrder(newPeople[index].id, index);
        await db.updateWorkPersonOrder(newPeople[targetIndex].id, targetIndex);
    };

    // Calendar Grid Logic
    const calendarDays = useMemo(() => {
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth();
        
        const firstDayOfMonth = new Date(year, month, 1);
        const lastDayOfMonth = new Date(year, month + 1, 0);
        
        // Days for the grid
        const days = [];
        
        // Padding for previous month (adjusting for Mon-Sun)
        let firstDayIndex = firstDayOfMonth.getDay(); 
        firstDayIndex = firstDayIndex === 0 ? 6 : firstDayIndex - 1; // Mon = 0, Sun = 6
        
        for (let i = firstDayIndex; i > 0; i--) {
            const d = new Date(year, month, 1 - i);
            days.push({ date: d, isCurrentMonth: false });
        }
        
        // Current month days
        for (let i = 1; i <= lastDayOfMonth.getDate(); i++) {
            const d = new Date(year, month, i);
            days.push({ date: d, isCurrentMonth: true });
        }
        
        // Padding for next month
        const remaining = 42 - days.length; // 6 rows
        for (let i = 1; i <= remaining; i++) {
            const d = new Date(year, month + 1, i);
            days.push({ date: d, isCurrentMonth: false });
        }
        
        return days;
    }, [currentDate]);

    const changeMonth = (offset) => {
        const next = new Date(currentDate.getFullYear(), currentDate.getMonth() + offset, 1);
        setCurrentDate(next);
    };

    const isToday = (date) => {
        const td = new Date();
        return date.getDate() === td.getDate() && 
               date.getMonth() === td.getMonth() && 
               date.getFullYear() === td.getFullYear();
    };

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
            <StatusBar style={isDarkMode ? "light" : "dark"} />
            
            <View style={[styles.header, { backgroundColor: theme.header, borderBottomColor: theme.border }]}>
                <TouchableOpacity onPress={onBack} style={styles.backButton}>
                    <Text style={{ fontSize: 24, color: theme.text }}>←</Text>
                </TouchableOpacity>
                <Text style={[styles.headerTitle, { color: theme.text }]}>Control de Turnos</Text>
                <TouchableOpacity onPress={() => setShowModal(true)} style={styles.addButton}>
                    <Text style={{ fontSize: 24, color: theme.accent }}>+</Text>
                </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
                {/* Calendar View */}
                <View style={styles.calendarContainer}>
                    <View style={styles.calendarHeader}>
                        <TouchableOpacity onPress={() => changeMonth(-1)}>
                            <Text style={[styles.navBtn, { color: theme.accent }]}>◀</Text>
                        </TouchableOpacity>
                        <View style={styles.monthContainer}>
                            <Text style={[styles.monthTitle, { color: theme.text }]}>
                                {MONTHS[currentDate.getMonth()]} {currentDate.getFullYear()}
                            </Text>
                            <TouchableOpacity onPress={() => setCurrentDate(new Date())} style={[styles.todayBtn, { backgroundColor: theme.accent + '20' }]}>
                                <Text style={[styles.todayBtnText, { color: theme.accent }]}>Hoy</Text>
                            </TouchableOpacity>
                        </View>
                        <TouchableOpacity onPress={() => changeMonth(1)}>
                            <Text style={[styles.navBtn, { color: theme.accent }]}>▶</Text>
                        </TouchableOpacity>
                    </View>

                    {/* Weekdays */}
                    <View style={styles.weekdaysRow}>
                        {WEEKDAYS.map(d => (
                            <Text key={d} style={[styles.weekdayText, { color: theme.subText }]}>{d}</Text>
                        ))}
                    </View>

                    {/* Grid */}
                    <View style={styles.calendarGrid}>
                        {calendarDays.map((item, index) => {
                            const statuses = people.map(p => ({
                                person: p.name,
                                status: getStatusForDate(item.date, p.start_date, p.cycle)
                            }));
                            
                            const freeCount = statuses.filter(s => s.status === 'libre').length;
                            const totalPeople = people.length;
                            
                            // Highlight logic
                            let highlightStyle = null;
                            if (totalPeople > 0) {
                                if (freeCount === totalPeople) {
                                    highlightStyle = { backgroundColor: '#4CAF5080' }; // All free: Strong Green
                                } else if (freeCount >= 2) {
                                    highlightStyle = { backgroundColor: '#FFD70060' }; // 2+ free: Golden
                                }
                            }
                            
                            const today = isToday(item.date);

                            return (
                                <View key={index} style={[
                                    styles.dayCell, 
                                    !item.isCurrentMonth && styles.dayCellOutside,
                                    today && { borderColor: theme.accent, borderWidth: 1 }
                                ]}>
                                    <View style={[styles.dayHeader, highlightStyle]}>
                                        <Text style={[
                                            styles.dayText, 
                                            { color: item.isCurrentMonth ? theme.text : theme.subText },
                                            today && { fontWeight: 'bold', color: theme.accent }
                                        ]}>
                                            {item.date.getDate()}
                                        </Text>
                                    </View>
                                    
                                    {/* Multi-person indicators */}
                                    <View style={styles.indicators}>
                                        {statuses.map((s, idx) => (
                                            <View 
                                                key={idx} 
                                                style={[styles.miniDot, { backgroundColor: CYCLE_TYPES.find(t => t.value === s.status)?.color || '#ccc' }]} 
                                            />
                                        ))}
                                    </View>
                                </View>
                            );
                        })}
                    </View>
                </View>

                {/* Legend */}
                <View style={styles.legend}>
                    {CYCLE_TYPES.map(t => (
                        <View key={t.value} style={styles.legendItem}>
                            <View style={[styles.legendDot, { backgroundColor: t.color }]} />
                            <Text style={[styles.legendText, { color: theme.subText }]}>{t.label}</Text>
                        </View>
                    ))}
                    <View style={styles.legendItem}>
                        <View style={[styles.legendDot, { backgroundColor: '#FFD700', borderRadius: 2 }]} />
                        <Text style={[styles.legendText, { color: theme.subText }]}>Parcial (2+ 🟢)</Text>
                    </View>
                    <View style={styles.legendItem}>
                        <View style={[styles.legendDot, { backgroundColor: '#4CAF50', borderRadius: 2 }]} />
                        <Text style={[styles.legendText, { color: theme.subText }]}>TODOS Libres 🎉</Text>
                    </View>
                </View>

                {/* People Management */}
                <View style={styles.managementSection}>
                    <Text style={[styles.sectionTitle, { color: theme.text }]}>Personas y Ciclos</Text>
                    {people.map((p, index) => (
                        <TouchableOpacity 
                            key={p.id} 
                            style={[styles.personCard, { backgroundColor: theme.card }]}
                            onPress={() => {
                                setEditingPerson(p);
                                setName(p.name);
                                setStartDate(p.start_date);
                                setCycle(p.cycle);
                                setShowModal(true);
                            }}
                        >
                            <View style={{ flex: 1 }}>
                                <Text style={[styles.pName, { color: theme.text }]}>{p.name}</Text>
                                <Text style={[styles.pCycle, { color: theme.subText }]}>
                                    {p.cycle.map(ph => `${ph.days}${ph.type.charAt(0)}`).join(' - ')}
                                </Text>
                            </View>
                            <View style={styles.cardActions}>
                                <View style={styles.orderCtrls}>
                                    <TouchableOpacity onPress={() => movePerson(index, -1)} style={styles.orderBtn}>
                                        <Text style={{ color: theme.accent }}>▲</Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity onPress={() => movePerson(index, 1)} style={styles.orderBtn}>
                                        <Text style={{ color: theme.accent }}>▼</Text>
                                    </TouchableOpacity>
                                </View>
                                <TouchableOpacity onPress={() => deletePerson(p.id)} style={styles.deleteBtn}>
                                    <Text style={{ fontSize: 18 }}>🗑️</Text>
                                </TouchableOpacity>
                            </View>
                        </TouchableOpacity>
                    ))}
                </View>
            </ScrollView>

            {/* Same Edit Modal Logic */}
            <Modal visible={showModal} transparent animationType="slide">
                <View style={[styles.modalOverlay, { backgroundColor: 'rgba(0,0,0,0.5)' }]}>
                    <View style={[styles.modalContent, { backgroundColor: theme.background }]}>
                        <Text style={[styles.modalTitle, { color: theme.text }]}>{editingPerson ? 'Editar Turno' : 'Añadir Persona'}</Text>
                        
                        <ScrollView style={{ maxHeight: 400 }}>
                            <TextInput
                                style={[styles.input, { backgroundColor: theme.inputBackground, color: theme.text, borderColor: theme.border }]}
                                placeholder="Nombre"
                                value={name}
                                onChangeText={setName}
                                placeholderTextColor={theme.subText}
                            />
                            
                            <Text style={styles.label}>Fecha inicio (YYYY-MM-DD):</Text>
                            <TextInput
                                style={[styles.input, { backgroundColor: theme.inputBackground, color: theme.text, borderColor: theme.border }]}
                                value={startDate}
                                onChangeText={setStartDate}
                            />

                            <View style={styles.cycleHeader}>
                                <Text style={styles.label}>Definir Ciclo:</Text>
                                <TouchableOpacity onPress={() => setCycle([...cycle, { type: 'dia', days: 1 }])}>
                                    <Text style={{ color: theme.accent, fontWeight: 'bold' }}>+ Fase</Text>
                                </TouchableOpacity>
                            </View>

                            {cycle.map((ph, i) => (
                                <View key={i} style={styles.phRow}>
                                    <View style={styles.typeSelector}>
                                        {CYCLE_TYPES.map(t => (
                                            <TouchableOpacity 
                                                key={t.value} 
                                                onPress={() => {
                                                    const nc = [...cycle];
                                                    nc[i].type = t.value;
                                                    setCycle(nc);
                                                }}
                                                style={[styles.typeBtn, ph.type === t.value && { backgroundColor: theme.accent }]}
                                            >
                                                <Text>{t.icon}</Text>
                                            </TouchableOpacity>
                                        ))}
                                    </View>
                                    <TextInput
                                        style={[styles.countInput, { backgroundColor: theme.inputBackground, color: theme.text, borderColor: theme.border }]}
                                        keyboardType="numeric"
                                        value={ph.days.toString()}
                                        onChangeText={v => {
                                            const nc = [...cycle];
                                            nc[i].days = parseInt(v) || 0;
                                            setCycle(nc);
                                        }}
                                    />
                                    <TouchableOpacity onPress={() => setCycle(cycle.filter((_, idx) => idx !== i))}>
                                        <Text style={{ color: 'red', fontSize: 18 }}>✕</Text>
                                    </TouchableOpacity>
                                </View>
                            ))}
                        </ScrollView>

                        <View style={styles.modalBtns}>
                            <TouchableOpacity style={styles.cancelBtn} onPress={() => { setShowModal(false); resetForm(); }}>
                                <Text style={{ color: theme.subText }}>Cancelar</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={[styles.saveBtn, { backgroundColor: theme.accent }]} onPress={handleSave}>
                                <Text style={{ color: '#fff', fontWeight: 'bold' }}>Guardar</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            </Modal>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 15, borderBottomWidth: 1 },
    headerTitle: { fontSize: 18, fontWeight: 'bold' },
    backButton: { width: 40 },
    addButton: { width: 40, alignItems: 'flex-end' },
    calendarContainer: { padding: 10 },
    calendarHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15, paddingHorizontal: 10 },
    monthContainer: { alignItems: 'center', gap: 4 },
    monthTitle: { fontSize: 18, fontWeight: 'bold' },
    todayBtn: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 10 },
    todayBtnText: { fontSize: 12, fontWeight: 'bold' },
    navBtn: { fontSize: 22, padding: 5 },
    weekdaysRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#eee', paddingBottom: 5 },
    weekdayText: { flex: 1, textAlign: 'center', fontSize: 12, fontWeight: 'bold' },
    calendarGrid: { flexDirection: 'row', flexWrap: 'wrap' },
    dayCell: { 
        width: (width - 20) / 7, 
        height: 65, 
        borderWidth: 0.5, 
        borderColor: '#eee', 
        alignItems: 'center', 
        paddingTop: 5 
    },
    dayCellOutside: { opacity: 0.3 },
    dayText: { fontSize: 14 },
    dayHeader: { width: '100%', alignItems: 'center' },
    indicators: { flexDirection: 'row', flexWrap: 'wrap', gap: 2, padding: 4, justifyContent: 'center' },
    miniDot: { width: 6, height: 6, borderRadius: 3 },
    legend: { flexDirection: 'row', flexWrap: 'wrap', padding: 15, gap: 15, justifyContent: 'center' },
    legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    legendDot: { width: 10, height: 10, borderRadius: 5 },
    legendText: { fontSize: 11 },
    managementSection: { padding: 15 },
    sectionTitle: { fontSize: 16, fontWeight: 'bold', marginBottom: 15 },
    personCard: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 15, borderRadius: 15, marginBottom: 10 },
    pName: { fontSize: 16, fontWeight: 'bold' },
    pCycle: { fontSize: 12, marginTop: 4 },
    cardActions: { flexDirection: 'row', alignItems: 'center', gap: 15 },
    orderCtrls: { flexDirection: 'row', gap: 5 },
    orderBtn: { padding: 5, backgroundColor: '#f0f0f0', borderRadius: 5 },
    deleteBtn: { padding: 5 },
    modalOverlay: { flex: 1, justifyContent: 'center', padding: 20 },
    modalContent: { borderRadius: 25, padding: 20 },
    modalTitle: { fontSize: 20, fontWeight: 'bold', marginBottom: 20 },
    input: { padding: 12, borderRadius: 12, borderWidth: 1, marginBottom: 15 },
    label: { fontSize: 14, marginBottom: 8 },
    cycleHeader: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 },
    phRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10 },
    typeSelector: { flexDirection: 'row', gap: 5 },
    typeBtn: { width: 35, height: 35, borderRadius: 8, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f0f0f0' },
    countInput: { width: 50, padding: 5, borderRadius: 8, borderWidth: 1, textAlign: 'center' },
    modalBtns: { flexDirection: 'row', gap: 10, marginTop: 30 },
    cancelBtn: { flex: 1, padding: 15, alignItems: 'center' },
    saveBtn: { flex: 1, padding: 15, borderRadius: 12, alignItems: 'center' },
});
