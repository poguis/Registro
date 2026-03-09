import React, { useState, useEffect } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    ScrollView,
    Dimensions,
    Modal,
    TextInput
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useTheme } from '../contexts/ThemeContext';
import db from '../services/db';

const { width } = Dimensions.get('window');

export default function StatisticsScreen({ user, onBack }) {
    const { theme, isDarkMode } = useTheme();
    const [stats, setStats] = useState([]);
    const [period, setPeriod] = useState('month'); // 'week', 'month', 'year', 'custom', 'all'
    const [totals, setTotals] = useState({ income: 0, expense: 0 });
    const [customRange, setCustomRange] = useState({ start: new Date(), end: new Date() });
    const [showDatePicker, setShowDatePicker] = useState(false);

    useEffect(() => {
        loadStats();
    }, [period]);

    const loadStats = async () => {
        let startDate = null;
        let endDate = null;
        let now = new Date();

        const y = now.getFullYear();
        const m = String(now.getMonth() + 1).padStart(2, '0');
        const d = String(now.getDate()).padStart(2, '0');

        if (period === 'week') {
            const day = now.getDay();
            const diff = now.getDate() - day + (day === 0 ? -6 : 1);
            const monday = new Date(now.setDate(diff));
            const my = monday.getFullYear();
            const mm = String(monday.getMonth() + 1).padStart(2, '0');
            const md = String(monday.getDate()).padStart(2, '0');
            startDate = `${my}-${mm}-${md} 00:00:00`;
        } else if (period === 'month') {
            startDate = `${y}-${m}-01 00:00:00`;
        } else if (period === 'year') {
            startDate = `${y}-01-01 00:00:00`;
        } else if (period === 'custom') {
            const sy = customRange.start.getFullYear();
            const sm = String(customRange.start.getMonth() + 1).padStart(2, '0');
            const sd = String(customRange.start.getDate()).padStart(2, '0');
            const ey = customRange.end.getFullYear();
            const em = String(customRange.end.getMonth() + 1).padStart(2, '0');
            const ed = String(customRange.end.getDate()).padStart(2, '0');
            startDate = `${sy}-${sm}-${sd} 00:00:00`;
            endDate = `${ey}-${em}-${ed} 23:59:59`;
        }

        const result = await db.getStatisticsData(user.id, startDate, endDate);
        if (result.success) {
            setStats(result.stats);
            const tIncome = result.stats.reduce((acc, curr) => acc + curr.income, 0);
            const tExpense = result.stats.reduce((acc, curr) => acc + curr.expense, 0);
            setTotals({ income: tIncome, expense: tExpense });
        }
    };

    const maxExpense = Math.max(...stats.map(s => s.expense), 1);

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
            <StatusBar style={isDarkMode ? "light" : "dark"} />

            <View style={[styles.header, { backgroundColor: theme.header, borderBottomColor: theme.border }]}>
                <TouchableOpacity onPress={onBack}>
                    <Text style={{ fontSize: 24, color: theme.text }}>←</Text>
                </TouchableOpacity>
                <Text style={[styles.headerTitle, { color: theme.text }]}>Estadísticas</Text>
                <View style={{ width: 24 }} />
            </View>

            <View style={styles.periodSelector}>
                {['week', 'month', 'year', 'custom', 'all'].map((p) => (
                    <TouchableOpacity
                        key={p}
                        style={[
                            styles.periodBtn,
                            period === p && { backgroundColor: theme.accent }
                        ]}
                        onPress={() => p === 'custom' ? setShowDatePicker(true) : setPeriod(p)}
                    >
                        <Text style={[
                            styles.periodText,
                            { color: period === p ? '#fff' : theme.subText }
                        ]}>
                            {p === 'week' ? 'Sem' : p === 'month' ? 'Mes' : p === 'year' ? 'Año' : p === 'custom' ? '📅' : 'Todo'}
                        </Text>
                    </TouchableOpacity>
                ))}
            </View>

            <ScrollView contentContainerStyle={{ padding: 20 }}>
                <View style={[styles.summaryCard, { backgroundColor: theme.card }]}>
                    <View style={styles.summaryItem}>
                        <Text style={[styles.summaryLabel, { color: theme.subText }]}>Ingresos</Text>
                        <Text style={[styles.summaryValue, styles.green]}>${totals.income.toFixed(2)}</Text>
                    </View>
                    <View style={[styles.divider, { backgroundColor: theme.border }]} />
                    <View style={styles.summaryItem}>
                        <Text style={[styles.summaryLabel, { color: theme.subText }]}>Gastos</Text>
                        <Text style={[styles.summaryValue, styles.red]}>${totals.expense.toFixed(2)}</Text>
                    </View>
                </View>

                <Text style={[styles.sectionTitle, { color: theme.text }]}>Distribución de Gastos</Text>

                {stats.filter(s => s.expense > 0).map((item, index) => (
                    <View key={index} style={styles.statRow}>
                        <View style={styles.statInfo}>
                            <Text style={[styles.catName, { color: theme.text }]}>{item.category}</Text>
                            <Text style={[styles.catValue, { color: theme.subText }]}>${item.expense.toFixed(2)}</Text>
                        </View>
                        <View style={[styles.barContainer, { backgroundColor: theme.inputBackground }]}>
                            <View
                                style={[
                                    styles.barFill,
                                    {
                                        width: `${(item.expense / maxExpense) * 100}%`,
                                        backgroundColor: theme.accent
                                    }
                                ]}
                            />
                        </View>
                    </View>
                ))}

                {stats.filter(s => s.expense > 0).length === 0 && (
                    <Text style={[styles.empty, { color: theme.subText }]}>No hay gastos registrados en este periodo</Text>
                )}
            </ScrollView>

            {/* Custom Date Picker Modal */}
            <Modal visible={showDatePicker} transparent animationType="fade">
                <View style={[styles.overlay, { backgroundColor: 'rgba(0,0,0,0.7)' }]}>
                    <View style={[styles.modalContent, { backgroundColor: theme.card }]}>
                        <Text style={[styles.modalTitle, { color: theme.text }]}>Seleccionar Rango</Text>

                        <View style={styles.datePickerContainer}>
                            <View style={styles.dateBlock}>
                                <Text style={[styles.dateLabel, { color: theme.subText }]}>Desde:</Text>
                                <View style={styles.dateInputsRow}>
                                    <TextInput
                                        style={[styles.dateInput, { backgroundColor: theme.inputBackground, color: theme.text }]}
                                        placeholder="Año"
                                        keyboardType="numeric"
                                        maxLength={4}
                                        value={customRange.start.getFullYear().toString()}
                                        onChangeText={(v) => {
                                            const d = new Date(customRange.start);
                                            d.setFullYear(parseInt(v) || new Date().getFullYear());
                                            setCustomRange(prev => ({ ...prev, start: d }));
                                        }}
                                    />
                                    <TextInput
                                        style={[styles.dateInput, { backgroundColor: theme.inputBackground, color: theme.text }]}
                                        placeholder="Mes"
                                        keyboardType="numeric"
                                        maxLength={2}
                                        value={(customRange.start.getMonth() + 1).toString()}
                                        onChangeText={(v) => {
                                            const d = new Date(customRange.start);
                                            d.setMonth((parseInt(v) || 1) - 1);
                                            setCustomRange(prev => ({ ...prev, start: d }));
                                        }}
                                    />
                                    <TextInput
                                        style={[styles.dateInput, { backgroundColor: theme.inputBackground, color: theme.text }]}
                                        placeholder="Día"
                                        keyboardType="numeric"
                                        maxLength={2}
                                        value={customRange.start.getDate().toString()}
                                        onChangeText={(v) => {
                                            const d = new Date(customRange.start);
                                            d.setDate(parseInt(v) || 1);
                                            setCustomRange(prev => ({ ...prev, start: d }));
                                        }}
                                    />
                                </View>
                            </View>

                            <View style={[styles.dateBlock, { marginTop: 20 }]}>
                                <Text style={[styles.dateLabel, { color: theme.subText }]}>Hasta:</Text>
                                <View style={styles.dateInputsRow}>
                                    <TextInput
                                        style={[styles.dateInput, { backgroundColor: theme.inputBackground, color: theme.text }]}
                                        placeholder="Año"
                                        keyboardType="numeric"
                                        maxLength={4}
                                        value={customRange.end.getFullYear().toString()}
                                        onChangeText={(v) => {
                                            const d = new Date(customRange.end);
                                            d.setFullYear(parseInt(v) || new Date().getFullYear());
                                            setCustomRange(prev => ({ ...prev, end: d }));
                                        }}
                                    />
                                    <TextInput
                                        style={[styles.dateInput, { backgroundColor: theme.inputBackground, color: theme.text }]}
                                        placeholder="Mes"
                                        keyboardType="numeric"
                                        maxLength={2}
                                        value={(customRange.end.getMonth() + 1).toString()}
                                        onChangeText={(v) => {
                                            const d = new Date(customRange.end);
                                            d.setMonth((parseInt(v) || 1) - 1);
                                            setCustomRange(prev => ({ ...prev, end: d }));
                                        }}
                                    />
                                    <TextInput
                                        style={[styles.dateInput, { backgroundColor: theme.inputBackground, color: theme.text }]}
                                        placeholder="Día"
                                        keyboardType="numeric"
                                        maxLength={2}
                                        value={customRange.end.getDate().toString()}
                                        onChangeText={(v) => {
                                            const d = new Date(customRange.end);
                                            d.setDate(parseInt(v) || 1);
                                            setCustomRange(prev => ({ ...prev, end: d }));
                                        }}
                                    />
                                </View>
                            </View>
                        </View>

                        <View style={styles.btnsRow}>
                            <TouchableOpacity style={[styles.cancelBtn, { backgroundColor: theme.inputBackground }]} onPress={() => setShowDatePicker(false)}>
                                <Text style={{ color: theme.text }}>Cancelar</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={[styles.saveBtn, { backgroundColor: theme.accent }]} onPress={() => {
                                setPeriod('custom');
                                setShowDatePicker(false);
                            }}>
                                <Text style={{ color: '#fff', fontWeight: 'bold' }}>Filtrar</Text>
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
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 15,
        borderBottomWidth: 1,
    },
    headerTitle: { fontSize: 18, fontWeight: 'bold' },
    periodSelector: {
        flexDirection: 'row',
        padding: 10,
        gap: 10,
        justifyContent: 'center'
    },
    periodBtn: {
        paddingHorizontal: 15,
        paddingVertical: 8,
        borderRadius: 20,
        backgroundColor: '#eee',
    },
    periodText: { fontSize: 14, fontWeight: '600' },
    summaryCard: {
        flexDirection: 'row',
        padding: 20,
        borderRadius: 15,
        marginBottom: 25,
        elevation: 2,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
    },
    summaryItem: { flex: 1, alignItems: 'center' },
    summaryLabel: { fontSize: 13, marginBottom: 5 },
    summaryValue: { fontSize: 20, fontWeight: 'bold' },
    divider: { width: 1, height: '100%', marginHorizontal: 10 },
    sectionTitle: { fontSize: 16, fontWeight: 'bold', marginBottom: 15 },
    statRow: { marginBottom: 15 },
    statInfo: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginBottom: 5
    },
    catName: { fontSize: 14, fontWeight: '500' },
    catValue: { fontSize: 14 },
    barContainer: {
        height: 10,
        borderRadius: 5,
        overflow: 'hidden'
    },
    barFill: { height: '100%', borderRadius: 5 },
    green: { color: '#4CAF50' },
    red: { color: '#F44336' },
    empty: { textAlign: 'center', marginTop: 40, opacity: 0.6 },
    overlay: {
        flex: 1,
        justifyContent: 'center',
        padding: 20,
    },
    modalContent: {
        borderRadius: 20,
        padding: 25,
        elevation: 5,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 4,
    },
    modalTitle: {
        fontSize: 20,
        fontWeight: 'bold',
        marginBottom: 20,
        textAlign: 'center'
    },
    datePickerContainer: { paddingVertical: 10 },
    dateBlock: { width: '100%' },
    dateLabel: { fontSize: 13, fontWeight: 'bold', marginBottom: 5 },
    dateInputsRow: { flexDirection: 'row', gap: 10 },
    dateInput: {
        flex: 1,
        padding: 10,
        borderRadius: 8,
        textAlign: 'center',
        fontSize: 16,
        fontWeight: 'bold'
    },
    btnsRow: {
        flexDirection: 'row',
        gap: 15,
        marginTop: 30
    },
    cancelBtn: {
        flex: 1,
        padding: 12,
        alignItems: 'center',
        borderRadius: 8
    },
    saveBtn: {
        flex: 2,
        padding: 12,
        alignItems: 'center',
        borderRadius: 8
    }
});
