import React, { useState, useEffect, useMemo } from 'react';
import { View, StyleSheet, TouchableOpacity, ScrollView, Dimensions, Modal, FlatList } from 'react-native';
import { Text, TextInput } from '../components/AppText';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme, FONT, RADIUS } from '../contexts/ThemeContext';
import db from '../services/db';
import { useSyncRefresh } from '../sync/useSyncRefresh';
import { getUtcRange, parseDbTimestamp } from '../services/dateRange';

const { width } = Dimensions.get('window');

export default function StatisticsScreen({ user, onBack }) {
    const { theme } = useTheme();
    const styles = useMemo(() => makeStyles(theme), [theme]);
    // Ingreso y gasto: colores de dinero del tema; fondos suaves con los tonos verde y rojo.
    const ingreso = theme.money.ingreso, gasto = theme.money.gasto;
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
    // Recarga si la sync trae cambios del servidor (sin tocar formularios, filtros ni scroll).
    useSyncRefresh(() => loadStats());

    // Días locales → límites UTC (created_at está en UTC)
    const getDates = () => getUtcRange(period, new Date(), customRange);

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
        <SafeAreaView style={[styles.container, { backgroundColor: theme.bg }]}>

            <View style={[styles.header, { backgroundColor: theme.surface, borderBottomColor: theme.line }]}>
                <TouchableOpacity onPress={onBack}>
                    <Text style={{ fontSize: 24, color: theme.ink }}>←</Text>
                </TouchableOpacity>
                <Text style={[styles.headerTitle, { color: theme.ink }]} numberOfLines={1}>Reporte Financiero</Text>
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
                            { backgroundColor: period === p ? theme.accent : theme.raised }
                        ]}
                        onPress={() => setPeriod(p)}
                    >
                        <Text style={[
                            styles.periodText,
                            { color: period === p ? theme.onAccent : theme.muted }
                        ]}>
                            {p === 'today' ? 'Hoy' : p === 'week' ? 'Sem' : p === 'month' ? 'Mes' : p === 'year' ? 'Año' : 'Todo'}
                        </Text>
                    </TouchableOpacity>
                ))}
            </View>

            <ScrollView contentContainerStyle={{ padding: 15 }}>
                {/* Visual Summary Card - Premium Redesign */}
                <View style={[styles.summaryCard, { backgroundColor: theme.surface }]}>
                    <View style={styles.cardHeader}>
                        <View>
                            <Text style={[styles.summaryLabel, { color: theme.muted }]}>Balance Total</Text>
                            <Text style={[styles.balanceValue, { color: theme.ink }]}>
                                ${(totals.income - totals.expense).toFixed(2)}
                            </Text>
                        </View>
                        <View style={[styles.trendBadge, { backgroundColor: (totals.income - totals.expense) >= 0 ? theme.tones.verde.bg : theme.tones.rojo.bg }]}>
                            <Text style={{ color: (totals.income - totals.expense) >= 0 ? theme.tones.verde.fg : theme.tones.rojo.fg, fontFamily: FONT.bold, fontSize: 12 }}>
                                {(totals.income - totals.expense) >= 0 ? '↑ Ahorro' : '↓ Déficit'}
                            </Text>
                        </View>
                    </View>

                    <View style={styles.progressContainer}>
                        <View style={styles.progressHeader}>
                            <Text style={[styles.progressLabel, { color: theme.muted }]}>Uso del Ingreso (Gasto)</Text>
                            <Text style={[styles.progressPercent, { color: theme.ink }]}>
                                {Math.round((totals.expense / (totals.income || 1)) * 100)}%
                            </Text>
                        </View>
                        <View style={[styles.progressBarBase, { backgroundColor: theme.raised }]}>
                            <View style={[
                                styles.progressBarFill,
                                {
                                    width: `${Math.min((totals.expense / (totals.income || 1)) * 100, 100)}%`,
                                    backgroundColor: (totals.expense / (totals.income || 1)) > 0.8 ? gasto : theme.accent
                                }
                            ]} />
                        </View>
                    </View>

                    <View style={styles.cardFooter}>
                        <View style={styles.footerItem}>
                            <View style={[styles.dot, { backgroundColor: ingreso }]} />
                            <Text style={[styles.footerText, { color: theme.muted }]}>Ingresos: <Text style={{ color: theme.ink, fontFamily: FONT.bold }}>${totals.income.toFixed(0)}</Text></Text>
                        </View>
                        <View style={styles.footerItem}>
                            <View style={[styles.dot, { backgroundColor: gasto }]} />
                            <Text style={[styles.footerText, { color: theme.muted }]}>Gastos: <Text style={{ color: theme.ink, fontFamily: FONT.bold }}>${totals.expense.toFixed(0)}</Text></Text>
                        </View>
                    </View>
                </View>

                {/* Totals Summary Row */}
                <View style={styles.summaryRow}>
                    <View style={[styles.totalBox, { backgroundColor: theme.surface }]}>
                        <View style={[styles.iconCircle, { backgroundColor: theme.tones.verde.bg }]}>
                            <Text style={{ fontSize: 18 }}>💰</Text>
                        </View>
                        <Text style={[styles.totalLabel, { color: theme.muted }]}>Entradas</Text>
                        <Text numberOfLines={1} style={[styles.totalValue, { color: ingreso }]}>+${totals.income.toFixed(2)}</Text>
                    </View>
                    <View style={[styles.totalBox, { backgroundColor: theme.surface }]}>
                        <View style={[styles.iconCircle, { backgroundColor: theme.tones.rojo.bg }]}>
                            <Text style={{ fontSize: 18 }}>💸</Text>
                        </View>
                        <Text style={[styles.totalLabel, { color: theme.muted }]}>Salidas</Text>
                        <Text numberOfLines={1} style={[styles.totalValue, { color: gasto }]}>-${totals.expense.toFixed(2)}</Text>
                    </View>
                </View>

                {/* View Switcher */}
                <View style={[styles.switcher, { backgroundColor: theme.raised }]}>
                    <TouchableOpacity
                        style={[styles.switchBtn, viewType === 'expense' && { backgroundColor: theme.surface, elevation: 2 }]}
                        onPress={() => setViewType('expense')}
                    >
                        <Text style={[styles.switchText, { color: viewType === 'expense' ? theme.accent : theme.muted }]}>Gastos</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                        style={[styles.switchBtn, viewType === 'income' && { backgroundColor: theme.surface, elevation: 2 }]}
                        onPress={() => setViewType('income')}
                    >
                        <Text style={[styles.switchText, { color: viewType === 'income' ? theme.accent : theme.muted }]}>Ingresos</Text>
                    </TouchableOpacity>
                </View>

                <Text style={[styles.sectionTitle, { color: theme.ink }]}>
                    Distribución de {viewType === 'expense' ? 'Gastos' : 'Ingresos'}
                </Text>

                {filteredStats.map((item, index) => (
                    <TouchableOpacity
                        key={index}
                        style={[styles.statRow, { backgroundColor: theme.surface }]}
                        onPress={() => handleCategoryPress(item.category)}
                    >
                        <View style={styles.statInfo}>
                            <View style={styles.catInfo}>
                                <Text style={[styles.catName, { color: theme.ink }]} numberOfLines={1} ellipsizeMode="tail">{item.category}</Text>
                                <Text style={[styles.catCount, { color: theme.muted }]} numberOfLines={1}>{item.count} mov.</Text>
                            </View>
                            <Text style={[styles.catValue, { color: viewType === 'expense' ? gasto : ingreso }]}>
                                ${viewType === 'expense' ? item.expense.toFixed(2) : item.income.toFixed(2)}
                            </Text>
                        </View>
                        <View style={[styles.barContainer, { backgroundColor: theme.raised }]}>
                            <View
                                style={[
                                    styles.barFill,
                                    {
                                        width: `${((viewType === 'expense' ? item.expense : item.income) / maxVal) * 100}%`,
                                        backgroundColor: viewType === 'expense' ? gasto : ingreso
                                    }
                                ]}
                            />
                        </View>
                    </TouchableOpacity>
                ))}

                {filteredStats.length === 0 && (
                    <View style={styles.emptyContainer}>
                        <Text style={{ fontSize: 50, marginBottom: 10 }}>Empty</Text>
                        <Text style={[styles.empty, { color: theme.muted }]}>
                            No hay {viewType === 'expense' ? 'gastos' : 'ingresos'} en este periodo
                        </Text>
                    </View>
                )}
            </ScrollView>

            {/* Custom Date Picker Modal */}
            <Modal visible={showDatePicker} transparent animationType="slide">
                <View style={[styles.overlay, { backgroundColor: theme.overlay }]}>
                    <View style={[styles.modalContent, { backgroundColor: theme.surface }]}>
                        <Text style={[styles.modalTitle, { color: theme.ink }]} numberOfLines={1}>Rango de Informe</Text>

                        <View style={styles.datePickerContainer}>
                            <View style={styles.dateBlock}>
                                <Text style={[styles.dateLabel, { color: theme.muted }]}>Inicio:</Text>
                                <View style={styles.dateInputsRow}>
                                    <TextInput style={[styles.dateInput, { backgroundColor: theme.raised, color: theme.ink }]} keyboardType="numeric" maxLength={4} value={customRange.start.getFullYear().toString()} onChangeText={(v) => { const d = new Date(customRange.start); d.setFullYear(parseInt(v) || 2024); setCustomRange(p => ({ ...p, start: d })) }} />
                                    <TextInput style={[styles.dateInput, { backgroundColor: theme.raised, color: theme.ink }]} keyboardType="numeric" maxLength={2} value={(customRange.start.getMonth() + 1).toString()} onChangeText={(v) => { const d = new Date(customRange.start); d.setMonth((parseInt(v) || 1) - 1); setCustomRange(p => ({ ...p, start: d })) }} />
                                    <TextInput style={[styles.dateInput, { backgroundColor: theme.raised, color: theme.ink }]} keyboardType="numeric" maxLength={2} value={customRange.start.getDate().toString()} onChangeText={(v) => { const d = new Date(customRange.start); d.setDate(parseInt(v) || 1); setCustomRange(p => ({ ...p, start: d })) }} />
                                </View>
                            </View>

                            <View style={[styles.dateBlock, { marginTop: 20 }]}>
                                <Text style={[styles.dateLabel, { color: theme.muted }]}>Fin:</Text>
                                <View style={styles.dateInputsRow}>
                                    <TextInput style={[styles.dateInput, { backgroundColor: theme.raised, color: theme.ink }]} keyboardType="numeric" maxLength={4} value={customRange.end.getFullYear().toString()} onChangeText={(v) => { const d = new Date(customRange.end); d.setFullYear(parseInt(v) || 2024); setCustomRange(p => ({ ...p, end: d })) }} />
                                    <TextInput style={[styles.dateInput, { backgroundColor: theme.raised, color: theme.ink }]} keyboardType="numeric" maxLength={2} value={(customRange.end.getMonth() + 1).toString()} onChangeText={(v) => { const d = new Date(customRange.end); d.setMonth((parseInt(v) || 1) - 1); setCustomRange(p => ({ ...p, end: d })) }} />
                                    <TextInput style={[styles.dateInput, { backgroundColor: theme.raised, color: theme.ink }]} keyboardType="numeric" maxLength={2} value={customRange.end.getDate().toString()} onChangeText={(v) => { const d = new Date(customRange.end); d.setDate(parseInt(v) || 1); setCustomRange(p => ({ ...p, end: d })) }} />
                                </View>
                            </View>
                        </View>

                        <View style={styles.btnsRow}>
                            <TouchableOpacity style={[styles.cancelBtn, { backgroundColor: theme.raised }]} onPress={() => setShowDatePicker(false)}>
                                <Text style={{ color: theme.ink }}>Cerrar</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={[styles.saveBtn, { backgroundColor: theme.accent }]} onPress={() => { setPeriod('custom'); setShowDatePicker(false); }}>
                                <Text style={{ color: theme.onAccent, fontFamily: FONT.bold }}>Generar Informe</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            </Modal>

            {/* Category Details Modal */}
            <Modal visible={showCategoryModal} transparent animationType="slide">
                <View style={[styles.overlay, { backgroundColor: theme.overlay }]}>
                    <View style={[styles.modalContentFull, { backgroundColor: theme.bg }]}>
                        <View style={[styles.modalHeader, { borderBottomColor: theme.line }]}>
                            <Text style={[styles.modalHeaderTitle, { color: theme.ink }]} numberOfLines={1} ellipsizeMode="tail">{selectedCategory}</Text>
                            <TouchableOpacity onPress={() => setShowCategoryModal(false)}>
                                <Text style={{ fontSize: 24, color: theme.muted }}>✕</Text>
                            </TouchableOpacity>
                        </View>

                        <FlatList
                            data={categoryHistory}
                            keyExtractor={(item) => item.id.toString()}
                            contentContainerStyle={{ padding: 15 }}
                            renderItem={({ item }) => {
                                const dateObj = parseDbTimestamp(item.created_at);
                                const dateStr = dateObj.toLocaleDateString('es-ES', {
                                    day: 'numeric',
                                    month: 'short',
                                    timeZone: 'America/Guayaquil'
                                });
                                const timeStr = dateObj.toLocaleTimeString('es-ES', {
                                    hour: '2-digit',
                                    minute: '2-digit',
                                    hour12: true,
                                    timeZone: 'America/Guayaquil'
                                });

                                return (
                                    <View style={[styles.historyItem, { borderBottomColor: theme.line }]}>
                                        <View style={{ flex: 1, minWidth: 0, marginRight: 10 }}>
                                            <Text style={[styles.historyLabel, { color: theme.ink }]} numberOfLines={2} ellipsizeMode="tail">
                                                {item.description || selectedCategory}
                                            </Text>
                                            <Text style={[styles.historyDate, { color: theme.muted }]} numberOfLines={1}>{dateStr} • {timeStr}</Text>
                                        </View>
                                        <Text style={[styles.historyAmount, { color: item.amount > 0 ? ingreso : gasto, flexShrink: 0 }]}>
                                            {item.amount > 0 ? '+' : '-'}${Math.abs(item.amount).toFixed(2)}
                                        </Text>
                                    </View>
                                );
                            }}
                            ListEmptyComponent={<Text style={[styles.empty, { color: theme.muted, marginTop: 50 }]}>No hay movimientos registrados</Text>}
                        />
                    </View>
                </View>
            </Modal>
        </SafeAreaView>
    );
}

// Estilos en función del tema (dirección visual): ningún color fijo.
const makeStyles = (t) => StyleSheet.create({
    container: { flex: 1 },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 15,
        borderBottomWidth: 1,
    },
    headerTitle: { fontSize: 18, fontFamily: FONT.bold },
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
    periodText: { fontSize: 13, fontFamily: FONT.semibold },
    summaryCard: {
        padding: 25,
        borderRadius: 25,
        marginBottom: 20,
        elevation: 6,
        shadowColor: t.shadow,
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
    summaryLabel: { fontSize: 13, fontFamily: FONT.bold, textTransform: 'uppercase', letterSpacing: 0.5 },
    balanceValue: { fontSize: 32, fontFamily: FONT.bold, marginTop: 4 },
    progressContainer: { marginBottom: 20 },
    progressHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 8
    },
    progressLabel: { fontSize: 12, fontFamily: FONT.semibold },
    progressPercent: { fontSize: 13, fontFamily: FONT.bold },
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
        shadowColor: t.shadow,
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
    totalLabel: { fontSize: 11, fontFamily: FONT.bold, marginBottom: 4 },
    totalValue: { fontSize: 15, fontFamily: FONT.bold },
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
    switchText: { fontSize: 14, fontFamily: FONT.bold },
    sectionTitle: { fontSize: 16, fontFamily: FONT.bold, marginBottom: 15, textTransform: 'uppercase', letterSpacing: 1 },
    statRow: {
        padding: 15,
        borderRadius: 15,
        marginBottom: 12,
        elevation: 1,
        shadowColor: t.shadow,
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
    catInfo: { flex: 1, minWidth: 0, marginRight: 10 },
    catName: { fontSize: 15, fontFamily: FONT.bold },
    catCount: { fontSize: 11 },
    catValue: { fontSize: 16, fontFamily: FONT.bold },
    barContainer: { height: 6, borderRadius: 3, overflow: 'hidden' },
    barFill: { height: '100%', borderRadius: 3 },
    emptyContainer: { alignItems: 'center', padding: 40, opacity: 0.5 },
    empty: { textAlign: 'center' },
    green: { color: t.money.ingreso },
    red: { color: t.money.gasto },
    overlay: { flex: 1, justifyContent: 'center', padding: 20 },
    modalContent: { borderRadius: RADIUS.base, padding: 25 },
    modalContentFull: { flex: 1, borderRadius: RADIUS.base, overflow: 'hidden' },
    modalTitle: { fontSize: 22, fontFamily: FONT.bold, marginBottom: 20, textAlign: 'center' },
    modalHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 20,
        borderBottomWidth: 1
    },
    modalHeaderTitle: { fontSize: 20, fontFamily: FONT.bold, flex: 1, minWidth: 0, marginRight: 10 },
    historyItem: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: 15,
        borderBottomWidth: 1
    },
    historyLabel: { fontSize: 14, fontFamily: FONT.semibold },
    historyDate: { fontSize: 11 },
    historyAmount: { fontSize: 15, fontFamily: FONT.bold },
    // Reuse date picker styles from DineroScreen logic
    datePickerContainer: { paddingVertical: 10 },
    dateBlock: { width: '100%' },
    dateLabel: { fontSize: 13, fontFamily: FONT.bold, marginBottom: 5 },
    dateInputsRow: { flexDirection: 'row', gap: 10 },
    dateInput: { flex: 1, padding: 12, borderRadius: RADIUS.sm, textAlign: 'center', fontSize: 16, fontFamily: FONT.bold },
    btnsRow: { flexDirection: 'row', gap: 15, marginTop: 30 },
    cancelBtn: { flex: 1, padding: 12, alignItems: 'center', justifyContent: 'center', minHeight: 52, borderRadius: RADIUS.sm },
    saveBtn: { flex: 2, padding: 12, alignItems: 'center', justifyContent: 'center', minHeight: 52, borderRadius: RADIUS.sm }
});
