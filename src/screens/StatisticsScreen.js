import React, { useState, useEffect } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    ScrollView,
    Dimensions,
    Modal,
    TextInput,
    FlatList
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
    const [viewType, setViewType] = useState('expense'); // 'income' or 'expense'
    const [totals, setTotals] = useState({ income: 0, expense: 0 });
    const [customRange, setCustomRange] = useState({ start: new Date(), end: new Date() });
    const [showDatePicker, setShowDatePicker] = useState(false);

    // Category Details
    const [selectedCategory, setSelectedCategory] = useState(null);
    const [categoryHistory, setCategoryHistory] = useState([]);
    const [showCategoryModal, setShowCategoryModal] = useState(false);

    useEffect(() => {
        loadStats();
    }, [period, customRange]);

    const getDates = () => {
        let startDate = null;
        let endDate = null;
        let now = new Date();
        const y = now.getFullYear();
        const m = String(now.getMonth() + 1).padStart(2, '0');
        const d = String(now.getDate()).padStart(2, '0');

        if (period === 'today') {
            startDate = `${y}-${m}-${d} 00:00:00`;
            endDate = `${y}-${m}-${d} 23:59:59`;
        } else if (period === 'week') {
            // Monday to Sunday of the current week
            const day = now.getDay();
            const diff = now.getDate() - day + (day === 0 ? -6 : 1);
            const monday = new Date(now.getFullYear(), now.getMonth(), diff);
            const sunday = new Date(monday);
            sunday.setDate(monday.getDate() + 6);
            
            startDate = `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')} 00:00:00`;
            endDate = `${sunday.getFullYear()}-${String(sunday.getMonth() + 1).padStart(2, '0')}-${String(sunday.getDate()).padStart(2, '0')} 23:59:59`;
        } else if (period === 'month') {
            // 1st to last day of the current month
            const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
            startDate = `${y}-${m}-01 00:00:00`;
            endDate = `${y}-${m}-${String(lastDay).padStart(2, '0')} 23:59:59`;
        } else if (period === 'year') {
            // Jan 1st to Dec 31st of the current year
            startDate = `${y}-01-01 00:00:00`;
            endDate = `${y}-12-31 23:59:59`;
        } else if (period === 'custom') {
            startDate = `${customRange.start.getFullYear()}-${String(customRange.start.getMonth() + 1).padStart(2, '0')}-${String(customRange.start.getDate()).padStart(2, '0')} 00:00:00`;
            endDate = `${customRange.end.getFullYear()}-${String(customRange.end.getMonth() + 1).padStart(2, '0')}-${String(customRange.end.getDate()).padStart(2, '0')} 23:59:59`;
        }
        return { startDate, endDate };
    };

    const loadStats = async () => {
        const { startDate, endDate } = getDates();
        const result = await db.getStatisticsData(user.id, startDate, endDate);
        if (result.success) {
            setStats(result.stats);
            const tIncome = result.stats.reduce((acc, curr) => acc + curr.income, 0);
            const tExpense = result.stats.reduce((acc, curr) => acc + curr.expense, 0);
            setTotals({ income: tIncome, expense: tExpense });
        }
    };

    const handleCategoryPress = async (category) => {
        const { startDate, endDate } = getDates();
        const result = await db.getCategoryHistory(user.id, category, startDate, endDate);
        if (result.success) {
            setSelectedCategory(category);
            setCategoryHistory(result.history);
            setShowCategoryModal(true);
        }
    };

    const filteredStats = stats.filter(s => viewType === 'expense' ? s.expense > 0 : s.income > 0)
        .sort((a, b) => viewType === 'expense' ? b.expense - a.expense : b.income - a.income);

    const maxVal = Math.max(...filteredStats.map(s => viewType === 'expense' ? s.expense : s.income), 1);

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
            <StatusBar style={isDarkMode ? "light" : "dark"} />

            <View style={[styles.header, { backgroundColor: theme.header, borderBottomColor: theme.border }]}>
                <TouchableOpacity onPress={onBack}>
                    <Text style={{ fontSize: 24, color: theme.text }}>←</Text>
                </TouchableOpacity>
                <Text style={[styles.headerTitle, { color: theme.text }]}>Reporte Financiero</Text>
                <TouchableOpacity onPress={() => setShowDatePicker(true)}>
                    <Text style={{ fontSize: 22 }}>📅</Text>
                </TouchableOpacity>
            </View>

            <View style={styles.periodSelector}>
                {['today', 'week', 'month', 'year', 'all'].map((p) => (
                    <TouchableOpacity
                        key={p}
                        style={[
                            styles.periodBtn,
                            { backgroundColor: period === p ? theme.accent : theme.inputBackground }
                        ]}
                        onPress={() => setPeriod(p)}
                    >
                        <Text style={[
                            styles.periodText,
                            { color: period === p ? '#fff' : theme.subText }
                        ]}>
                            {p === 'today' ? 'Hoy' : p === 'week' ? 'Sem' : p === 'month' ? 'Mes' : p === 'year' ? 'Año' : 'Todo'}
                        </Text>
                    </TouchableOpacity>
                ))}
            </View>

            <ScrollView contentContainerStyle={{ padding: 15 }}>
                {/* Visual Summary Card - Premium Redesign */}
                <View style={[styles.summaryCard, { backgroundColor: theme.card }]}>
                    <View style={styles.cardHeader}>
                        <View>
                            <Text style={[styles.summaryLabel, { color: theme.subText }]}>Balance Total</Text>
                            <Text style={[styles.balanceValue, { color: theme.text }]}>
                                ${(totals.income - totals.expense).toFixed(2)}
                            </Text>
                        </View>
                        <View style={[styles.trendBadge, { backgroundColor: (totals.income - totals.expense) >= 0 ? 'rgba(76, 175, 80, 0.1)' : 'rgba(244, 67, 54, 0.1)' }]}>
                            <Text style={{ color: (totals.income - totals.expense) >= 0 ? '#4CAF50' : '#F44336', fontWeight: 'bold', fontSize: 12 }}>
                                {(totals.income - totals.expense) >= 0 ? '↑ Ahorro' : '↓ Déficit'}
                            </Text>
                        </View>
                    </View>

                    <View style={styles.progressContainer}>
                        <View style={styles.progressHeader}>
                            <Text style={[styles.progressLabel, { color: theme.subText }]}>Uso del Ingreso (Gasto)</Text>
                            <Text style={[styles.progressPercent, { color: theme.text }]}>
                                {Math.round((totals.expense / (totals.income || 1)) * 100)}%
                            </Text>
                        </View>
                        <View style={[styles.progressBarBase, { backgroundColor: theme.inputBackground }]}>
                            <View style={[
                                styles.progressBarFill,
                                {
                                    width: `${Math.min((totals.expense / (totals.income || 1)) * 100, 100)}%`,
                                    backgroundColor: (totals.expense / (totals.income || 1)) > 0.8 ? '#F44336' : theme.accent
                                }
                            ]} />
                        </View>
                    </View>

                    <View style={styles.cardFooter}>
                        <View style={styles.footerItem}>
                            <View style={[styles.dot, { backgroundColor: '#4CAF50' }]} />
                            <Text style={[styles.footerText, { color: theme.subText }]}>Ingresos: <Text style={{ color: theme.text, fontWeight: 'bold' }}>${totals.income.toFixed(0)}</Text></Text>
                        </View>
                        <View style={styles.footerItem}>
                            <View style={[styles.dot, { backgroundColor: '#F44336' }]} />
                            <Text style={[styles.footerText, { color: theme.subText }]}>Gastos: <Text style={{ color: theme.text, fontWeight: 'bold' }}>${totals.expense.toFixed(0)}</Text></Text>
                        </View>
                    </View>
                </View>

                {/* Totals Summary Row */}
                <View style={styles.summaryRow}>
                    <View style={[styles.totalBox, { backgroundColor: theme.card }]}>
                        <View style={[styles.iconCircle, { backgroundColor: 'rgba(76, 175, 80, 0.1)' }]}>
                            <Text style={{ fontSize: 18 }}>💰</Text>
                        </View>
                        <Text style={[styles.totalLabel, { color: theme.subText }]}>Entradas</Text>
                        <Text style={[styles.totalValue, { color: '#4CAF50' }]}>+${totals.income.toFixed(2)}</Text>
                    </View>
                    <View style={[styles.totalBox, { backgroundColor: theme.card }]}>
                        <View style={[styles.iconCircle, { backgroundColor: 'rgba(244, 67, 54, 0.1)' }]}>
                            <Text style={{ fontSize: 18 }}>💸</Text>
                        </View>
                        <Text style={[styles.totalLabel, { color: theme.subText }]}>Salidas</Text>
                        <Text style={[styles.totalValue, { color: '#F44336' }]}>-${totals.expense.toFixed(2)}</Text>
                    </View>
                </View>

                {/* View Switcher */}
                <View style={[styles.switcher, { backgroundColor: theme.inputBackground }]}>
                    <TouchableOpacity
                        style={[styles.switchBtn, viewType === 'expense' && { backgroundColor: theme.card, elevation: 2 }]}
                        onPress={() => setViewType('expense')}
                    >
                        <Text style={[styles.switchText, { color: viewType === 'expense' ? theme.accent : theme.subText }]}>Gastos</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                        style={[styles.switchBtn, viewType === 'income' && { backgroundColor: theme.card, elevation: 2 }]}
                        onPress={() => setViewType('income')}
                    >
                        <Text style={[styles.switchText, { color: viewType === 'income' ? theme.accent : theme.subText }]}>Ingresos</Text>
                    </TouchableOpacity>
                </View>

                <Text style={[styles.sectionTitle, { color: theme.text }]}>
                    Distribución de {viewType === 'expense' ? 'Gastos' : 'Ingresos'}
                </Text>

                {filteredStats.map((item, index) => (
                    <TouchableOpacity
                        key={index}
                        style={[styles.statRow, { backgroundColor: theme.card }]}
                        onPress={() => handleCategoryPress(item.category)}
                    >
                        <View style={styles.statInfo}>
                            <View style={styles.catInfo}>
                                <Text style={[styles.catName, { color: theme.text }]}>{item.category}</Text>
                                <Text style={[styles.catCount, { color: theme.subText }]}>{item.count} mov.</Text>
                            </View>
                            <Text style={[styles.catValue, { color: viewType === 'expense' ? '#F44336' : '#4CAF50' }]}>
                                ${viewType === 'expense' ? item.expense.toFixed(2) : item.income.toFixed(2)}
                            </Text>
                        </View>
                        <View style={[styles.barContainer, { backgroundColor: theme.inputBackground }]}>
                            <View
                                style={[
                                    styles.barFill,
                                    {
                                        width: `${((viewType === 'expense' ? item.expense : item.income) / maxVal) * 100}%`,
                                        backgroundColor: viewType === 'expense' ? '#F44336' : '#4CAF50'
                                    }
                                ]}
                            />
                        </View>
                    </TouchableOpacity>
                ))}

                {filteredStats.length === 0 && (
                    <View style={styles.emptyContainer}>
                        <Text style={{ fontSize: 50, marginBottom: 10 }}>Empty</Text>
                        <Text style={[styles.empty, { color: theme.subText }]}>
                            No hay {viewType === 'expense' ? 'gastos' : 'ingresos'} en este periodo
                        </Text>
                    </View>
                )}
            </ScrollView>

            {/* Custom Date Picker Modal */}
            <Modal visible={showDatePicker} transparent animationType="slide">
                <View style={[styles.overlay, { backgroundColor: 'rgba(0,0,0,0.8)' }]}>
                    <View style={[styles.modalContent, { backgroundColor: theme.card }]}>
                        <Text style={[styles.modalTitle, { color: theme.text }]}>Rango de Informe</Text>

                        <View style={styles.datePickerContainer}>
                            <View style={styles.dateBlock}>
                                <Text style={[styles.dateLabel, { color: theme.subText }]}>Inicio:</Text>
                                <View style={styles.dateInputsRow}>
                                    <TextInput style={[styles.dateInput, { backgroundColor: theme.inputBackground, color: theme.text }]} keyboardType="numeric" maxLength={4} value={customRange.start.getFullYear().toString()} onChangeText={(v) => { const d = new Date(customRange.start); d.setFullYear(parseInt(v) || 2024); setCustomRange(p => ({ ...p, start: d })) }} />
                                    <TextInput style={[styles.dateInput, { backgroundColor: theme.inputBackground, color: theme.text }]} keyboardType="numeric" maxLength={2} value={(customRange.start.getMonth() + 1).toString()} onChangeText={(v) => { const d = new Date(customRange.start); d.setMonth((parseInt(v) || 1) - 1); setCustomRange(p => ({ ...p, start: d })) }} />
                                    <TextInput style={[styles.dateInput, { backgroundColor: theme.inputBackground, color: theme.text }]} keyboardType="numeric" maxLength={2} value={customRange.start.getDate().toString()} onChangeText={(v) => { const d = new Date(customRange.start); d.setDate(parseInt(v) || 1); setCustomRange(p => ({ ...p, start: d })) }} />
                                </View>
                            </View>

                            <View style={[styles.dateBlock, { marginTop: 20 }]}>
                                <Text style={[styles.dateLabel, { color: theme.subText }]}>Fin:</Text>
                                <View style={styles.dateInputsRow}>
                                    <TextInput style={[styles.dateInput, { backgroundColor: theme.inputBackground, color: theme.text }]} keyboardType="numeric" maxLength={4} value={customRange.end.getFullYear().toString()} onChangeText={(v) => { const d = new Date(customRange.end); d.setFullYear(parseInt(v) || 2024); setCustomRange(p => ({ ...p, end: d })) }} />
                                    <TextInput style={[styles.dateInput, { backgroundColor: theme.inputBackground, color: theme.text }]} keyboardType="numeric" maxLength={2} value={(customRange.end.getMonth() + 1).toString()} onChangeText={(v) => { const d = new Date(customRange.end); d.setMonth((parseInt(v) || 1) - 1); setCustomRange(p => ({ ...p, end: d })) }} />
                                    <TextInput style={[styles.dateInput, { backgroundColor: theme.inputBackground, color: theme.text }]} keyboardType="numeric" maxLength={2} value={customRange.end.getDate().toString()} onChangeText={(v) => { const d = new Date(customRange.end); d.setDate(parseInt(v) || 1); setCustomRange(p => ({ ...p, end: d })) }} />
                                </View>
                            </View>
                        </View>

                        <View style={styles.btnsRow}>
                            <TouchableOpacity style={[styles.cancelBtn, { backgroundColor: theme.inputBackground }]} onPress={() => setShowDatePicker(false)}>
                                <Text style={{ color: theme.text }}>Cerrar</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={[styles.saveBtn, { backgroundColor: theme.accent }]} onPress={() => { setPeriod('custom'); setShowDatePicker(false); }}>
                                <Text style={{ color: '#fff', fontWeight: 'bold' }}>Generar Informe</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            </Modal>

            {/* Category Details Modal */}
            <Modal visible={showCategoryModal} transparent animationType="slide">
                <View style={[styles.overlay, { backgroundColor: 'rgba(0,0,0,0.8)' }]}>
                    <View style={[styles.modalContentFull, { backgroundColor: theme.background }]}>
                        <View style={[styles.modalHeader, { borderBottomColor: theme.border }]}>
                            <Text style={[styles.modalHeaderTitle, { color: theme.text }]}>{selectedCategory}</Text>
                            <TouchableOpacity onPress={() => setShowCategoryModal(false)}>
                                <Text style={{ fontSize: 24, color: theme.subText }}>✕</Text>
                            </TouchableOpacity>
                        </View>

                        <FlatList
                            data={categoryHistory}
                            keyExtractor={(item) => item.id.toString()}
                            contentContainerStyle={{ padding: 15 }}
                            renderItem={({ item }) => {
                                // Format time from created_at
                                const timeStr = new Date(item.created_at.replace(' ', 'T') + 'Z').toLocaleTimeString('es-ES', {
                                    hour: '2-digit',
                                    minute: '2-digit',
                                    hour12: true,
                                    timeZone: 'America/Guayaquil'
                                });

                                return (
                                    <View style={[styles.historyItem, { borderBottomColor: theme.border }]}>
                                        <View>
                                            <Text style={[styles.historyLabel, { color: theme.text }]}>
                                                {item.description || selectedCategory}
                                            </Text>
                                            <Text style={[styles.historyDate, { color: theme.subText }]}>{timeStr}</Text>
                                        </View>
                                        <Text style={[styles.historyAmount, { color: item.amount > 0 ? '#4CAF50' : '#F44336' }]}>
                                            {item.amount > 0 ? '+' : '-'}${Math.abs(item.amount).toFixed(2)}
                                        </Text>
                                    </View>
                                );
                            }}
                            ListEmptyComponent={<Text style={[styles.empty, { color: theme.subText, marginTop: 50 }]}>No hay movimientos registrados</Text>}
                        />
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
        paddingVertical: 15,
        paddingHorizontal: 10,
        gap: 6,
        justifyContent: 'center'
    },
    periodBtn: {
        paddingHorizontal: 8,
        paddingVertical: 8,
        borderRadius: 20,
        minWidth: 55,
        alignItems: 'center'
    },
    periodText: { fontSize: 13, fontWeight: '600' },
    summaryCard: {
        padding: 25,
        borderRadius: 25,
        marginBottom: 20,
        elevation: 6,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.15,
        shadowRadius: 10,
    },
    cardHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: 20
    },
    trendBadge: {
        paddingHorizontal: 12,
        paddingVertical: 4,
        borderRadius: 12,
    },
    summaryLabel: { fontSize: 13, fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: 0.5 },
    balanceValue: { fontSize: 32, fontWeight: '900', marginTop: 4 },
    progressContainer: { marginBottom: 20 },
    progressHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 8
    },
    progressLabel: { fontSize: 12, fontWeight: '600' },
    progressPercent: { fontSize: 13, fontWeight: 'bold' },
    progressBarBase: { height: 10, borderRadius: 5, overflow: 'hidden' },
    progressBarFill: { height: '100%', borderRadius: 5 },
    cardFooter: {
        flexDirection: 'row',
        justifyContent: 'flex-start',
        gap: 20
    },
    footerItem: { flexDirection: 'row', alignItems: 'center' },
    dot: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },
    footerText: { fontSize: 12 },
    summaryRow: {
        flexDirection: 'row',
        gap: 12,
        marginBottom: 25
    },
    totalBox: {
        flex: 1,
        padding: 15,
        borderRadius: 18,
        elevation: 2,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.05,
        shadowRadius: 4,
        alignItems: 'center'
    },
    iconCircle: {
        width: 40,
        height: 40,
        borderRadius: 20,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 10
    },
    totalLabel: { fontSize: 11, fontWeight: 'bold', marginBottom: 4 },
    totalValue: { fontSize: 15, fontWeight: '900' },
    switcher: {
        flexDirection: 'row',
        padding: 5,
        borderRadius: 15,
        marginBottom: 25
    },
    switchBtn: {
        flex: 1,
        paddingVertical: 10,
        borderRadius: 10,
        alignItems: 'center'
    },
    switchText: { fontSize: 14, fontWeight: 'bold' },
    sectionTitle: { fontSize: 16, fontWeight: '900', marginBottom: 15, textTransform: 'uppercase', letterSpacing: 1 },
    statRow: {
        padding: 15,
        borderRadius: 15,
        marginBottom: 12,
        elevation: 1,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 2,
    },
    statInfo: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 10
    },
    catInfo: { flex: 1 },
    catName: { fontSize: 15, fontWeight: 'bold' },
    catCount: { fontSize: 11 },
    catValue: { fontSize: 16, fontWeight: '900' },
    barContainer: { height: 6, borderRadius: 3, overflow: 'hidden' },
    barFill: { height: '100%', borderRadius: 3 },
    emptyContainer: { alignItems: 'center', padding: 40, opacity: 0.5 },
    empty: { textAlign: 'center' },
    green: { color: '#4CAF50' },
    red: { color: '#F44336' },
    overlay: { flex: 1, justifyContent: 'center', padding: 20 },
    modalContent: { borderRadius: 25, padding: 25 },
    modalContentFull: { flex: 1, borderRadius: 25, overflow: 'hidden' },
    modalTitle: { fontSize: 22, fontWeight: 'bold', marginBottom: 20, textAlign: 'center' },
    modalHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 20,
        borderBottomWidth: 1
    },
    modalHeaderTitle: { fontSize: 20, fontWeight: 'bold' },
    historyItem: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: 15,
        borderBottomWidth: 1
    },
    historyLabel: { fontSize: 14, fontWeight: '600' },
    historyDate: { fontSize: 11 },
    historyAmount: { fontSize: 15, fontWeight: 'bold' },
    // Reuse date picker styles from DineroScreen logic
    datePickerContainer: { paddingVertical: 10 },
    dateBlock: { width: '100%' },
    dateLabel: { fontSize: 13, fontWeight: 'bold', marginBottom: 5 },
    dateInputsRow: { flexDirection: 'row', gap: 10 },
    dateInput: { flex: 1, padding: 12, borderRadius: 10, textAlign: 'center', fontSize: 16, fontWeight: 'bold' },
    btnsRow: { flexDirection: 'row', gap: 15, marginTop: 30 },
    cancelBtn: { flex: 1, padding: 12, alignItems: 'center', borderRadius: 10 },
    saveBtn: { flex: 2, padding: 12, alignItems: 'center', borderRadius: 10 }
});
