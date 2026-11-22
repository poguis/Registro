import React, { useState, useEffect, useMemo } from 'react';
import { View, StyleSheet, TouchableOpacity, Modal, ScrollView, SectionList, KeyboardAvoidingView, Platform } from 'react-native';
import { useSheet } from '../hooks/useSheet';
import { Text, TextInput } from '../components/AppText';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme, FONT, RADIUS } from '../contexts/ThemeContext';
import db from '../services/db';
import { useSyncRefresh } from '../sync/useSyncRefresh';
import { getUtcRange, parseDbTimestamp } from '../services/dateRange';

export default function DineroScreen({ user, onBack, onNavigate }) {
    const { theme } = useTheme();
    const styles = useMemo(() => makeStyles(theme), [theme]);
    const { informar } = useSheet();
    const [balance, setBalance] = useState(0);
    const [historyGroups, setHistoryGroups] = useState([]);
    const [expandedSections, setExpandedSections] = useState({}); // { "Title": true/false }
    const [dateFilter, setDateFilter] = useState('all'); // 'today', 'week', 'month', 'custom', 'all'
    const [customRange, setCustomRange] = useState({ start: new Date(), end: new Date() });
    const [showDatePicker, setShowDatePicker] = useState(false);

    // Modals
    const [showModal, setShowModal] = useState(false); // Manual Edit
    const [editMode, setEditMode] = useState(false);
    const [inputBalance, setInputBalance] = useState('');

    const [showTransModal, setShowTransModal] = useState(false); // Add/Sub Modal
    const [actionType, setActionType] = useState('add'); // 'add' | 'subtract'

    // Transaction Form
    const [transAmount, setTransAmount] = useState('');
    const [transDesc, setTransDesc] = useState('');

    // Category State
    const [transCategory, setTransCategory] = useState('');
    const [availableCategories, setAvailableCategories] = useState([]);
    const [filteredCategories, setFilteredCategories] = useState([]);
    const [showCatSuggestions, setShowCatSuggestions] = useState(false);

    // Linked Contact State
    const [linkedContacts, setLinkedContacts] = useState([]);
    const [selectedContactId, setSelectedContactId] = useState(null);
    const [isNewContact, setIsNewContact] = useState(false);
    const [contactName, setContactName] = useState('');

    useEffect(() => {
        loadData();
    }, [dateFilter]);
    // Recarga si la sync trae cambios del servidor (sin tocar formularios, filtros ni scroll).
    useSyncRefresh(() => loadData());

    const loadData = async () => {
        await loadBalance();
        await loadHistory();
        await loadCategories();
    };

    const loadBalance = async () => {
        const result = await db.getUserBalance(user.id);
        if (result.success) setBalance(result.balance);
    };

    const loadCategories = async () => {
        const result = await db.getDistinctCategories(user.id);
        if (result.success) {
            // "Me deben" and "Préstamos" are system categories, we always include them
            const system = ['Me deben', 'Préstamos'];
            const merged = Array.from(new Set([...system, ...result.categories]));
            setAvailableCategories(merged);
        }
    };

    const loadHistory = async () => {
        // Días locales → límites UTC (created_at está en UTC)
        const { startDate, endDate } = getUtcRange(dateFilter, new Date(), customRange);

        const result = await db.getBalanceHistory(user.id, startDate, endDate);
        if (result.success) {
            const groups = groupHistoryByDate(result.history);
            setHistoryGroups(groups);
        }
    };

    // Helper: Group by Date
    const groupHistoryByDate = (history) => {
        const groups = {};

        history.forEach(item => {
            // SQLite returns "YYYY-MM-DD HH:MM:SS" (UTC). Appending 'Z' forces UTC parsing.
            const dateObj = parseDbTimestamp(item.created_at);

            // Force Ecuador/GMT-5 Timezone
            const dateKey = dateObj.toLocaleDateString('es-ES', {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
                year: 'numeric',
                timeZone: 'America/Guayaquil'
            });

            // Capitalize first letter
            const finalKey = dateKey.charAt(0).toUpperCase() + dateKey.slice(1);

            if (!groups[finalKey]) {
                groups[finalKey] = { title: finalKey, data: [], total: 0 };
            }
            groups[finalKey].data.push(item);

            // For the daily total, we use the amount directly. 
            // Note: If we invert 'Me deben' logic, 'finalAmount' in executeTransaction already handles the sign.
            groups[finalKey].total += item.amount;
        });

        // Convert object to array
        return Object.values(groups);
    };

    const toggleSection = (title) => {
        setExpandedSections(prev => ({
            ...prev,
            [title]: !prev[title]
        }));
    };

    const handleUpdateBalance = async () => {
        const amount = parseFloat(inputBalance);
        if (isNaN(amount)) {
            informar('Error', 'Número inválido');
            return;
        }
        await db.updateUserBalance(user.id, amount);
        setBalance(amount);
        setShowModal(false);
        setEditMode(false);
    };

    // --- Transaction Logic ---
    const openTransactionModal = (type) => {
        setActionType(type);
        setTransAmount('');
        setTransDesc('');
        setTransCategory('');
        setFilteredCategories([]);
        setShowCatSuggestions(false);
        setSelectedContactId(null);
        setContactName('');
        setIsNewContact(false);
        setLinkedContacts([]);
        setShowTransModal(true);
    };

    const handleCategoryChange = (text) => {
        setTransCategory(text);
        setShowCatSuggestions(false);
        checkLinkedLogic(text);
    };

    const selectCategory = (cat) => {
        setTransCategory(cat);
        setShowCatSuggestions(false);
        checkLinkedLogic(cat);
    };

    const [isAddingCategory, setIsAddingCategory] = useState(false);
    const [newCatName, setNewCatName] = useState('');

    const handleAddCategory = async () => {
        if (!newCatName.trim()) return;
        const result = await db.addFinanceCategory(user.id, newCatName.trim());
        if (result.success) {
            await loadCategories();
            setTransCategory(newCatName.trim());
            setIsAddingCategory(false);
            setNewCatName('');
            checkLinkedLogic(newCatName.trim());
        }
    };

    const checkLinkedLogic = async (cat) => {
        // Only trigger layout change for specific keywords
        if (cat === 'Me deben' || cat === 'Préstamos') {
            // Restrict "Nuevo" for collections and repayments
            if ((actionType === 'add' && cat === 'Me deben') || (actionType === 'subtract' && cat === 'Préstamos')) {
                setIsNewContact(false);
            }
            await fetchLinkedContacts(cat);
        } else {
            setLinkedContacts([]);
        }
    };

    const fetchLinkedContacts = async (cat) => {
        let typeToFetch = null;
        if (actionType === 'add') {
            if (cat === 'Me deben') typeToFetch = 'loan';
            if (cat === 'Préstamos') typeToFetch = 'debt';
        } else {
            if (cat === 'Préstamos') typeToFetch = 'debt';
            if (cat === 'Me deben') typeToFetch = 'loan';
        }

        if (typeToFetch) {
            const result = await db.getFinanceData(user.id, typeToFetch);
            if (result.success) setLinkedContacts(result.data);
        }
    };

    const executeTransaction = async () => {
        if (!transAmount) { informar('Error', 'Falta el monto'); return; }
        const val = parseFloat(transAmount);
        if (isNaN(val) || val <= 0) { informar('Error', 'Monto inválido'); return; }
        if (!transCategory.trim()) { informar('Error', 'Falta categoría'); return; }

        let finalAmount = actionType === 'add' ? val : -val;

        // 1. Linked Logic (Debts/Loans)
        let linked = null;
        if (transCategory === 'Me deben' || transCategory === 'Préstamos') {
            let dbType = transCategory === 'Me deben' ? 'loan' : 'debt';
            let dbAmount = 0;

            // Logic strictly aligned with UI Buttons:
            // ADD (+) button -> Money IN to my wallet (+val)
            // SUBTRACT (-) button -> Money OUT from my wallet (-val)

            if (actionType === 'add') {
                if (transCategory === 'Me deben') {
                    // I'm getting money back from someone (Loan Collection)
                    if (!isNewContact) {
                        const contact = linkedContacts.find(x => x.id === selectedContactId);
                        if (contact && val > contact.total) {
                            informar('Error', `El monto ($${val}) supera lo que te deben ($${contact.total.toFixed(2)})`);
                            return;
                        }
                    }
                    dbAmount = isNewContact ? val : -val;
                } else {
                    // I'm borrowing money (Préstamos)
                    dbAmount = val;
                }
            } else {
                if (transCategory === 'Me deben') {
                    // I'm lending money to someone (Me deben)
                    dbAmount = val;
                } else {
                    // I'm paying my debt (Préstamos Repayment)
                    if (!isNewContact) {
                        const contact = linkedContacts.find(x => x.id === selectedContactId);
                        if (contact && val > contact.total) {
                            informar('Error', `El monto ($${val}) supera tu deuda actual ($${contact.total.toFixed(2)})`);
                            return;
                        }
                    }
                    dbAmount = isNewContact ? val : -val;
                }
            }

            let finalId = selectedContactId;
            let finalName = contactName;

            if (isNewContact) {
                if (!contactName.trim()) { informar('Error', 'Nombre obligatorio'); return; }
                finalId = null;
            } else {
                if (!finalId) { informar('Error', 'Selecciona persona'); return; }
                const c = linkedContacts.find(x => x.id === finalId);
                finalName = c ? c.name : '';
            }

            linked = { contactId: finalId, contactName: finalName, type: dbType, amount: dbAmount, description: transDesc || transCategory };
        }

        // 2 y 3. Deuda/préstamo vinculado + historial + saldo, en una sola transacción
        const res = await db.registerMoneyMovement(user.id, {
            amount: finalAmount,
            category: transCategory,
            description: transDesc,
            linked,
        });
        if (!res.success) {
            informar('Error', 'No se pudo registrar el movimiento. No se guardó ningún cambio.');
            return;
        }

        // Refresh
        setBalance(res.newBalance);
        setShowTransModal(false);
        loadHistory();
        loadCategories(); // In case new category added
    };

    // Render Items
    const renderHistoryItem = ({ item }) => {
        // Parse time from created_at (SQLite format: YYYY-MM-DD HH:MM:SS)
        const timeStr = parseDbTimestamp(item.created_at).toLocaleTimeString('es-ES', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: true,
            timeZone: 'America/Guayaquil'
        });

        return (
            <View style={styles.historyRow}>
                <View style={styles.historyLeft}>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <Text style={styles.histCat} numberOfLines={1} ellipsizeMode="tail">{item.category}</Text>
                        <Text style={styles.histTime} numberOfLines={1}> • {timeStr}</Text>
                    </View>
                    {item.description ? <Text style={styles.histDesc} numberOfLines={2} ellipsizeMode="tail">{item.description}</Text> : null}
                </View>
                <Text style={[styles.histAmount, item.amount >= 0 ? styles.green : styles.red]}>
                    {item.amount >= 0 ? '+' : ''}{item.amount.toFixed(2)}
                </Text>
            </View>
        );
    };

    const renderSectionHeader = ({ section: { title, total } }) => {
        const isExpanded = !!expandedSections[title];
        return (
            <TouchableOpacity style={styles.sectionHeader} onPress={() => toggleSection(title)} activeOpacity={0.7}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Text style={[styles.sectionTitle, { marginRight: 10 }]}>{isExpanded ? '▼' : '▶'}</Text>
                    <Text style={styles.sectionTitle} numberOfLines={1}>{title}</Text>
                </View>
                <Text style={[styles.sectionTotal, total >= 0 ? styles.green : styles.red]}>
                    {total >= 0 ? '+' : ''}{total.toFixed(2)}
                </Text>
            </TouchableOpacity>
        );
    };

    // Derived State for SectionList to handle expansion
    const visibleSections = React.useMemo(() => {
        return historyGroups.map(section => ({
            ...section,
            data: !!expandedSections[section.title] ? section.data : []
        }));
    }, [historyGroups, expandedSections]);

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: theme.bg }]}>

            {/* Header */}
            <View style={[styles.header, { backgroundColor: theme.surface, borderBottomWidth: 1, borderBottomColor: theme.line }]}>
                <TouchableOpacity onPress={onBack}>
                    <Text style={{ fontSize: 24, color: theme.ink }}>←</Text>
                </TouchableOpacity>

                <TouchableOpacity onPress={() => {
                    setInputBalance(balance.toString());
                    setEditMode(true);
                }}>
                    <Text style={[styles.labelSmall, { color: theme.muted }]}>Dinero Actual</Text>
                    <Text style={[styles.balanceSmall, { color: theme.ink }]}>${balance.toFixed(2)}</Text>
                </TouchableOpacity>

                <View style={{ flexDirection: 'row', gap: 15 }}>
                    <TouchableOpacity onPress={() => onNavigate('CARDS')}>
                        <Text style={{ fontSize: 22 }}>💳</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => onNavigate('SERVICIOS')}>
                        <Text style={{ fontSize: 22 }}>🔌</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => onNavigate('STATISTICS')}>
                        <Text style={{ fontSize: 22 }}>📊</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => onNavigate('DEUDAS_PRESTAMOS')}>
                        <Text style={{ fontSize: 22 }}>👥</Text>
                    </TouchableOpacity>
                </View>
            </View>

            <View style={styles.actionStrip}>
                <TouchableOpacity style={[styles.btnSmall, styles.btnIn]} onPress={() => openTransactionModal('add')}>
                    <Text style={[styles.btnTextSmall, { color: theme.tones.verde.fg }]}>+$ Ingreso</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.btnSmall, styles.btnOut]} onPress={() => openTransactionModal('subtract')}>
                    <Text style={[styles.btnTextSmall, { color: theme.tones.rojo.fg }]}>-$ Gasto</Text>
                </TouchableOpacity>
            </View>

            <View style={{ flex: 1, paddingHorizontal: 15 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                    <Text style={[styles.histTitle, { color: theme.ink, marginBottom: 0 }]}>Historial</Text>
                    <View style={{ flexDirection: 'row', gap: 5 }}>
                        {['today', 'week', 'month', 'custom', 'all'].map(f => (
                            <TouchableOpacity
                                key={f}
                                onPress={() => f === 'custom' ? setShowDatePicker(true) : setDateFilter(f)}
                                style={[
                                    styles.filterPill,
                                    { backgroundColor: dateFilter === f ? theme.accent : theme.raised }
                                ]}
                            >
                                <Text style={{
                                    fontSize: 10,
                                    color: dateFilter === f ? theme.onAccent : theme.muted,
                                    fontFamily: FONT.bold
                                }}>
                                    {f === 'today' ? 'Hoy' : f === 'week' ? 'Sem' : f === 'month' ? 'Mes' : f === 'custom' ? '📅' : 'Todo'}
                                </Text>
                            </TouchableOpacity>
                        ))}
                    </View>
                </View>
                <SectionList
                    sections={visibleSections}
                    keyExtractor={(item) => item.id.toString()}
                    stickySectionHeadersEnabled={false}
                    renderSectionHeader={({ section: { title, total } }) => {
                        const isExpanded = !!expandedSections[title];

                        return (
                            <TouchableOpacity
                                style={[styles.sectionHeader, { backgroundColor: theme.raised }]}
                                onPress={() => toggleSection(title)}
                            >
                                <Text style={[styles.sectionTitle, { color: theme.muted }]} numberOfLines={1}>
                                    {isExpanded ? '▼ ' : '▶ '} {title}
                                </Text>
                                <Text style={[styles.sectionTotal, { color: total >= 0 ? theme.money.ingreso : theme.money.gasto }]}>
                                    {total >= 0 ? '+' : ''}{total.toFixed(2)}
                                </Text>
                            </TouchableOpacity>
                        );
                    }}
                    renderItem={({ item, section }) => {
                        if (expandedSections[section.title] === false) return null;

                        // Format time from created_at
                        const timeStr = parseDbTimestamp(item.created_at).toLocaleTimeString('es-ES', {
                            hour: '2-digit',
                            minute: '2-digit',
                            hour12: true,
                            timeZone: 'America/Guayaquil'
                        });

                        return (
                            <View style={[styles.historyRow, { borderBottomColor: theme.line }]}>
                                <View style={styles.historyLeft}>
                                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                        <Text style={[styles.histCat, { color: theme.ink }]} numberOfLines={1} ellipsizeMode="tail">{item.category}</Text>
                                        <Text style={[styles.histTime, { color: theme.muted }]} numberOfLines={1}> • {timeStr}</Text>
                                    </View>
                                    {item.description ? <Text style={[styles.histDesc, { color: theme.muted }]} numberOfLines={2} ellipsizeMode="tail">{item.description}</Text> : null}
                                </View>
                                <Text style={[styles.histAmount, item.amount >= 0 ? styles.green : styles.red]}>
                                    {item.amount >= 0 ? '+' : ''}${item.amount.toFixed(2)}
                                </Text>
                            </View>
                        );
                    }}
                    ListEmptyComponent={<Text style={[styles.empty, { color: theme.muted }]}>No hay movimientos aún</Text>}
                    contentContainerStyle={{ paddingBottom: 20 }}
                />
            </View>

            {/* Transaction Modal */}
            <Modal visible={showTransModal} transparent animationType="slide" onRequestClose={() => setShowTransModal(false)}>
                <View style={[styles.overlay, { backgroundColor: theme.overlay }]}>
                    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={[styles.modalContent, { backgroundColor: theme.surface, maxHeight: '90%' }]}>
                        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ flexGrow: 1, paddingBottom: 20 }}>
                            <Text style={[styles.modalTitle, { color: theme.ink }]} numberOfLines={1}>{actionType === 'add' ? 'Nuevo Ingreso' : 'Nuevo Gasto'}</Text>

                        <TextInput
                            style={[styles.inputBig, { color: theme.ink, borderColor: theme.lineStrong }]}
                            autoFocus
                            placeholder="0.00"
                            placeholderTextColor={theme.muted}
                            keyboardType="numeric"
                            value={transAmount}
                            onChangeText={setTransAmount}
                        />

                        <View style={styles.catPickerWrapper}>
                            <Text style={[styles.label, { color: theme.muted, marginBottom: 10 }]}>Categoría:</Text>
                            <View style={styles.catGrid}>
                                {availableCategories.filter(cat => {
                                    const baseIngresos = ['Sueldo', 'Interés'];
                                    const baseGastos = ['Comida', 'Servicios', 'Cosas', 'Transporte', 'Videojuegos', 'Gasolina', 'Bebida', 'Interés'];
                                    const systemKeys = ['Me deben', 'Préstamos'];

                                    if (systemKeys.includes(cat)) return true;

                                    if (actionType === 'add') {
                                        // Es Ingreso: Ocultar si está solo en gastos
                                        if (baseGastos.includes(cat) && !baseIngresos.includes(cat)) return false;
                                        return true;
                                    } else {
                                        // Es Gasto: Ocultar si está solo en ingresos
                                        if (baseIngresos.includes(cat) && !baseGastos.includes(cat)) return false;
                                        return true;
                                    }
                                }).map(cat => (
                                    <TouchableOpacity
                                        key={cat}
                                        style={[
                                            styles.catPill,
                                            { backgroundColor: theme.raised },
                                            transCategory === cat && { backgroundColor: theme.accent, borderColor: theme.accent }
                                        ]}
                                        onPress={() => selectCategory(cat)}
                                    >
                                        <Text style={[styles.catPillText, { color: transCategory === cat ? theme.onAccent : theme.ink }]} numberOfLines={1} ellipsizeMode="tail">{cat}</Text>
                                    </TouchableOpacity>
                                ))}
                                <TouchableOpacity
                                    style={[styles.catPill, { backgroundColor: theme.tones.verde.bg, borderStyle: 'dashed', borderWidth: 1, borderColor: theme.tones.verde.fg }]}
                                    onPress={() => setIsAddingCategory(true)}
                                >
                                    <Text style={[styles.catPillText, { color: theme.tones.verde.fg, fontFamily: FONT.bold }]}>+ Nueva</Text>
                                </TouchableOpacity>
                            </View>
                        </View>

                        {isAddingCategory && (
                            <View style={styles.newCatRow}>
                                <TextInput
                                    style={[styles.inputSmall, { flex: 1, minWidth: 0, backgroundColor: theme.raised, color: theme.ink, borderColor: theme.lineStrong }]}
                                    placeholder="Nombre de categoría"
                                    placeholderTextColor={theme.muted}
                                    value={newCatName}
                                    onChangeText={setNewCatName}
                                    autoFocus
                                />
                                <TouchableOpacity style={[styles.addBtnSmall, { backgroundColor: theme.accent }]} onPress={handleAddCategory}>
                                    <Text style={{ color: theme.onAccent, fontFamily: FONT.bold }}>Añadir</Text>
                                </TouchableOpacity>
                                <TouchableOpacity style={[styles.cancelBtnSmall]} onPress={() => setIsAddingCategory(false)}>
                                    <Text style={{ color: theme.muted }}>✕</Text>
                                </TouchableOpacity>
                            </View>
                        )}

                        {(transCategory === 'Me deben' || transCategory === 'Préstamos') && (
                            <View style={[styles.linkedBox, { backgroundColor: theme.raised }]}>
                                <Text style={[styles.label, { color: theme.muted }]}>Vincular Contacto:</Text>
                                <View style={styles.btnsRow}>
                                    <TouchableOpacity
                                        style={[
                                            styles.tab,
                                            !isNewContact ? { backgroundColor: theme.accent, borderColor: theme.accent } : { backgroundColor: theme.surface, borderColor: theme.lineStrong }
                                        ]}
                                        onPress={() => setIsNewContact(false)}
                                    >
                                        <Text style={{ fontSize: 12, fontFamily: FONT.bold, color: !isNewContact ? theme.onAccent : theme.muted }}>Existente</Text>
                                    </TouchableOpacity>
                                    {!((actionType === 'add' && transCategory === 'Me deben') || (actionType === 'subtract' && transCategory === 'Préstamos')) && (
                                        <TouchableOpacity
                                            style={[
                                                styles.tab,
                                                isNewContact ? { backgroundColor: theme.accent, borderColor: theme.accent } : { backgroundColor: theme.surface, borderColor: theme.lineStrong }
                                            ]}
                                            onPress={() => setIsNewContact(true)}
                                        >
                                            <Text style={{ fontSize: 12, fontFamily: FONT.bold, color: isNewContact ? theme.onAccent : theme.muted }}>Nuevo</Text>
                                        </TouchableOpacity>
                                    )}
                                </View>

                                {isNewContact ? (
                                    <TextInput
                                        style={[styles.input, { marginTop: 10, backgroundColor: theme.surface, color: theme.ink, borderColor: theme.lineStrong }]}
                                        placeholder="Nombre del contacto"
                                        placeholderTextColor={theme.muted}
                                        value={contactName}
                                        onChangeText={setContactName}
                                    />
                                ) : (
                                    <View style={{ marginTop: 10 }}>
                                        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                                            <View style={{ flexDirection: 'row' }}>
                                                {linkedContacts.map(c => (
                                                    <TouchableOpacity
                                                        key={c.id}
                                                        style={[styles.pItem, selectedContactId === c.id && styles.pItemSel]}
                                                        onPress={() => setSelectedContactId(c.id)}
                                                    >
                                                        <Text style={{ fontSize: 13, color: theme.ink }} numberOfLines={1} ellipsizeMode="tail">{c.name}</Text>
                                                        <Text style={{ fontSize: 10, color: theme.muted }} numberOfLines={1}>Bal: ${c.total.toFixed(2)}</Text>
                                                    </TouchableOpacity>
                                                ))}
                                                {linkedContacts.length === 0 && <Text style={{ color: theme.muted, fontStyle: 'italic', fontSize: 12 }}>No hay contactos aún</Text>}
                                            </View>
                                        </ScrollView>

                                        {selectedContactId && (
                                            <View style={[styles.infoBox, { marginTop: 10 }]}>
                                                {(() => {
                                                    const contact = linkedContacts.find(c => c.id === selectedContactId);
                                                    const current = contact?.total || 0;
                                                    let msg = "";

                                                    if (actionType === 'add') {
                                                        if (transCategory === 'Me deben') {
                                                            msg = `COBRANDO. La deuda de ${contact?.name || 'la persona'} bajará (-), y tu dinero actual subirá (+).`;
                                                        }
                                                        if (transCategory === 'Préstamos') {
                                                            msg = `PIDIENDO PRESTADO. Tu deuda con ${contact?.name || 'la persona'} subirá (+), y tu dinero actual subirá (+).`;
                                                        }
                                                    } else {
                                                        if (transCategory === 'Me deben') {
                                                            msg = `PRESTANDO. La deuda de ${contact?.name || 'la persona'} subirá (+), y tu dinero actual bajará (-).`;
                                                        }
                                                        if (transCategory === 'Préstamos') {
                                                            msg = `PAGANDO DEUDA. Tu deuda con ${contact?.name || 'la persona'} bajará (-), y tu dinero actual bajará (-).`;
                                                        }
                                                    }

                                                    return (
                                                        <>
                                                            <Text style={[styles.infoTitle, { color: theme.accent }]}>Actual: ${current.toFixed(2)}</Text>
                                                            <Text style={[styles.infoMsg, { color: theme.accent }]}>{msg}</Text>
                                                        </>
                                                    );
                                                })()}
                                            </View>
                                        )}
                                    </View>
                                )}
                            </View>
                        )}

                        <TextInput
                            style={[styles.input, { backgroundColor: theme.raised, color: theme.ink, borderColor: theme.lineStrong }]}
                            placeholder="Descripción (Opcional)"
                            placeholderTextColor={theme.muted}
                            value={transDesc}
                            onChangeText={setTransDesc}
                        />

                        <View style={styles.btnsRow}>
                            <TouchableOpacity style={[styles.cancelBtn, { backgroundColor: theme.raised }]} onPress={() => setShowTransModal(false)}>
                                <Text style={{ color: theme.ink }}>Cancelar</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={[styles.saveBtn, actionType === 'add' ? styles.bgGreen : styles.bgRed]} onPress={executeTransaction}>
                                <Text style={{ color: theme.surface, fontFamily: FONT.bold }}>Guardar</Text>
                            </TouchableOpacity>
                        </View>

                        </ScrollView>
                    </KeyboardAvoidingView>
                </View>
            </Modal>

            {/* Manual Balance Edit Modal */}
            <Modal visible={editMode} transparent animationType="fade">
                <View style={[styles.overlay, { backgroundColor: theme.overlay }]}>
                    <View style={[styles.modalContent, { minHeight: 200, backgroundColor: theme.surface }]}>
                        <Text style={[styles.modalTitle, { color: theme.ink }]} numberOfLines={1}>Ajuste Manual</Text>
                        <TextInput
                            style={[styles.inputBig, { color: theme.ink, borderColor: theme.lineStrong }]}
                            value={inputBalance}
                            onChangeText={setInputBalance}
                            keyboardType="numeric"
                            placeholderTextColor={theme.muted}
                        />
                        <View style={styles.btnsRow}>
                            <TouchableOpacity style={[styles.cancelBtn, { backgroundColor: theme.raised }]} onPress={() => setEditMode(false)}>
                                <Text style={{ color: theme.ink }}>Cancelar</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={[styles.saveBtn, { backgroundColor: theme.ink }]} onPress={handleUpdateBalance}>
                                <Text style={{ color: theme.surface }}>Actualizar</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            </Modal>

            {/* Custom Date Picker Modal */}
            <Modal visible={showDatePicker} transparent animationType="fade">
                <View style={[styles.overlay, { backgroundColor: theme.overlay }]}>
                    <View style={[styles.modalContent, { backgroundColor: theme.surface }]}>
                        <Text style={[styles.modalTitle, { color: theme.ink }]} numberOfLines={1}>Seleccionar Rango</Text>

                        <View style={styles.datePickerContainer}>
                            <View style={styles.dateBlock}>
                                <Text style={[styles.dateLabel, { color: theme.muted }]}>Desde:</Text>
                                <View style={styles.dateInputsRow}>
                                    <TextInput
                                        style={[styles.dateInput, { backgroundColor: theme.raised, color: theme.ink }]}
                                        placeholder="Año"
                                        keyboardType="numeric"
                                        maxLength={4}
                                        value={customRange.start.getFullYear().toString()}
                                        onChangeText={(v) => {
                                            const d = new Date(customRange.start);
                                            d.setFullYear(parseInt(v) || now.getFullYear());
                                            setCustomRange(prev => ({ ...prev, start: d }));
                                        }}
                                    />
                                    <TextInput
                                        style={[styles.dateInput, { backgroundColor: theme.raised, color: theme.ink }]}
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
                                        style={[styles.dateInput, { backgroundColor: theme.raised, color: theme.ink }]}
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
                                <Text style={[styles.dateLabel, { color: theme.muted }]}>Hasta:</Text>
                                <View style={styles.dateInputsRow}>
                                    <TextInput
                                        style={[styles.dateInput, { backgroundColor: theme.raised, color: theme.ink }]}
                                        placeholder="Año"
                                        keyboardType="numeric"
                                        maxLength={4}
                                        value={customRange.end.getFullYear().toString()}
                                        onChangeText={(v) => {
                                            const d = new Date(customRange.end);
                                            d.setFullYear(parseInt(v) || now.getFullYear());
                                            setCustomRange(prev => ({ ...prev, end: d }));
                                        }}
                                    />
                                    <TextInput
                                        style={[styles.dateInput, { backgroundColor: theme.raised, color: theme.ink }]}
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
                                        style={[styles.dateInput, { backgroundColor: theme.raised, color: theme.ink }]}
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
                            <TouchableOpacity style={[styles.cancelBtn, { backgroundColor: theme.raised }]} onPress={() => setShowDatePicker(false)}>
                                <Text style={{ color: theme.ink }}>Cancelar</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={[styles.saveBtn, { backgroundColor: theme.accent }]} onPress={() => {
                                setDateFilter('custom');
                                setShowDatePicker(false);
                            }}>
                                <Text style={{ color: theme.onAccent, fontFamily: FONT.bold }}>Filtrar</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            </Modal>
        </SafeAreaView>
    );
}

// Estilos en función del tema (dirección visual): ningún color fijo.
const makeStyles = (t) => StyleSheet.create({
    container: { flex: 1, backgroundColor: t.bg },
    header: {
        flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
        paddingHorizontal: 15, paddingVertical: 10, backgroundColor: t.surface
    },
    compactBalance: { alignItems: 'center' },
    labelSmall: { fontSize: 12, color: t.muted },
    balanceSmall: { fontSize: 24, fontFamily: FONT.bold, color: t.ink },

    actionStrip: { flexDirection: 'row', gap: 10, padding: 15 },
    btnSmall: {
        flex: 1, padding: 12, borderRadius: RADIUS.sm, minHeight: 48,
        alignItems: 'center', justifyContent: 'center'
    },
    // Ingreso = tono verde; gasto = tono rojo (fondo suave, borde y texto del tono).
    btnIn: { backgroundColor: t.tones.verde.bg, borderWidth: 1, borderColor: t.tones.verde.fg },
    btnOut: { backgroundColor: t.tones.rojo.bg, borderWidth: 1, borderColor: t.tones.rojo.fg },
    btnTextSmall: { fontFamily: FONT.bold, fontSize: 16, color: t.ink },

    histTitle: { fontSize: 18, fontFamily: FONT.bold, marginBottom: 10, color: t.ink },
    sectionHeader: {
        flexDirection: 'row', justifyContent: 'space-between',
        backgroundColor: t.raised, padding: 8, borderRadius: 5, marginTop: 10
    },
    sectionTitle: { fontFamily: FONT.bold, color: t.muted, fontSize: 13, flexShrink: 1, minWidth: 0, marginRight: 8 },
    sectionTotal: { fontFamily: FONT.bold, fontSize: 13, flexShrink: 0 },

    historyRow: {
        flexDirection: 'row', justifyContent: 'space-between',
        paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: t.line
    },
    historyLeft: { flex: 1, minWidth: 0, marginRight: 10 },
    histCat: { fontSize: 15, fontFamily: FONT.bold, color: t.ink, flexShrink: 1, minWidth: 0 },
    histTime: { fontSize: 12, color: t.muted, fontFamily: FONT.medium, flexShrink: 0 },
    histDesc: { fontSize: 13, color: t.muted, marginTop: 2 },
    histAmount: { fontSize: 15, fontFamily: FONT.bold, flexShrink: 0 },
    green: { color: t.money.ingreso },
    red: { color: t.money.gasto },
    empty: { textAlign: 'center', marginTop: 20, color: t.muted },

    // Modal
    overlay: { flex: 1, backgroundColor: t.overlay, justifyContent: 'center', padding: 20 },
    modalContent: { backgroundColor: t.surface, borderRadius: RADIUS.base, padding: 20 },
    modalTitle: { fontSize: 18, fontFamily: FONT.bold, textAlign: 'center', marginBottom: 15, color: t.ink },
    inputBig: { fontSize: 30, textAlign: 'center', fontFamily: FONT.bold, marginBottom: 20, borderBottomWidth: 1, borderColor: t.lineStrong, color: t.ink },
    input: { borderWidth: 1, borderColor: t.lineStrong, borderRadius: RADIUS.sm, padding: 10, marginBottom: 10, color: t.ink },

    linkedBox: { backgroundColor: t.raised, padding: 10, borderRadius: RADIUS.sm, marginBottom: 10 },
    label: { marginBottom: 5, color: t.muted, fontSize: 12 },
    tab: { flex: 1, padding: 8, alignItems: 'center', borderRadius: 5, borderWidth: 1, backgroundColor: t.raised, marginRight: 5 },
    activeTab: { backgroundColor: t.soft },
    pItem: { padding: 8, borderBottomWidth: 1, borderBottomColor: t.line, maxWidth: 200 },
    pItemSel: { backgroundColor: t.soft },

    infoBox: { backgroundColor: t.soft, padding: 10, borderRadius: RADIUS.sm, borderLeftWidth: 4, borderLeftColor: t.accent },
    infoTitle: { fontFamily: FONT.bold, color: t.accent, fontSize: 13, marginBottom: 2 },
    infoMsg: { color: t.accent, fontSize: 12 },

    btnsRow: { flexDirection: 'row', gap: 10, marginTop: 10 },
    catPickerWrapper: { marginVertical: 15 },
    catGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
    },
    catPill: {
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: RADIUS.sm,
        borderWidth: 1,
        borderColor: 'transparent',
        maxWidth: '100%'
    },
    catPillText: { fontSize: 13 },
    newCatRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        marginTop: 5,
        marginBottom: 15
    },
    inputSmall: {
        padding: 10,
        borderRadius: RADIUS.sm,
        borderWidth: 1,
        fontSize: 14
    },
    addBtnSmall: {
        paddingVertical: 10,
        paddingHorizontal: 15,
        borderRadius: RADIUS.sm,
        flexShrink: 0,
    },
    cancelBtnSmall: {
        padding: 10,
        flexShrink: 0,
    },
    cancelBtn: { flex: 1, padding: 12, alignItems: 'center', justifyContent: 'center', minHeight: 52, backgroundColor: t.raised, borderRadius: RADIUS.sm },
    saveBtn: { flex: 1, padding: 12, alignItems: 'center', justifyContent: 'center', minHeight: 52, borderRadius: RADIUS.sm },
    // Botón Guardar: fondo del color de dinero y texto en surface (mismo contraste que money sobre surface).
    bgGreen: { backgroundColor: t.money.ingreso },
    bgRed: { backgroundColor: t.money.gasto },
    filterPill: {
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: RADIUS.sm,
        borderWidth: 1,
        borderColor: 'transparent'
    },
    datePickerContainer: { paddingVertical: 10 },
    dateBlock: { width: '100%' },
    dateLabel: { fontSize: 13, fontFamily: FONT.bold, marginBottom: 5 },
    dateInputsRow: { flexDirection: 'row', gap: 10 },
    dateInput: {
        flex: 1,
        padding: 10,
        borderRadius: RADIUS.sm,
        textAlign: 'center',
        fontSize: 16,
        fontFamily: FONT.bold
    }
});
