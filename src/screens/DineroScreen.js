import React, { useState, useEffect } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    Modal,
    TextInput,
    Alert,
    ScrollView,
    SectionList,
    KeyboardAvoidingView,
    Platform
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useTheme } from '../contexts/ThemeContext';
import db from '../services/db';

export default function DineroScreen({ user, onBack, onNavigate }) {
    const { theme, isDarkMode } = useTheme();
    const [balance, setBalance] = useState(0);
    const [historyGroups, setHistoryGroups] = useState([]);
    const [expandedSections, setExpandedSections] = useState({}); // { "Title": true/false }

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
    }, []);

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
            // Ensure default linked categories are always present or handled logic wise
            // We can merge defaults with DB results
            const defaults = ['Me deben', 'Préstamos', 'Comida', 'Transporte', 'Sueldo'];
            const merged = Array.from(new Set([...defaults, ...result.categories]));
            setAvailableCategories(merged);
        }
    };

    const loadHistory = async () => {
        const result = await db.getBalanceHistory(user.id);
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
            const dateObj = new Date(item.created_at.replace(' ', 'T') + 'Z');

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
            Alert.alert('Error', 'Número inválido');
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

        // Filter suggestions
        if (text.length > 0) {
            const filtered = availableCategories.filter(c =>
                c.toLowerCase().includes(text.toLowerCase())
            );
            setFilteredCategories(filtered);
            setShowCatSuggestions(true);
        } else {
            setShowCatSuggestions(false);
        }

        // Logic for Linked Contacts (Trigger immediately if exact match)
        checkLinkedLogic(text);
    };

    const selectCategory = (cat) => {
        setTransCategory(cat);
        setShowCatSuggestions(false);
        checkLinkedLogic(cat);
    };

    const checkLinkedLogic = async (cat) => {
        // Only trigger layout change for specific keywords
        if (cat === 'Me deben' || cat === 'Préstamos') {
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
        if (!transAmount) { Alert.alert('Error', 'Falta el monto'); return; }
        const val = parseFloat(transAmount);
        if (isNaN(val) || val <= 0) { Alert.alert('Error', 'Monto inválido'); return; }
        if (!transCategory.trim()) { Alert.alert('Error', 'Falta categoría'); return; }

        let finalAmount = actionType === 'add' ? val : -val;
        let newBalance = balance + finalAmount;

        // 1. Linked Logic (Debts/Loans)
        let linkedSuccess = true;
        if (transCategory === 'Me deben' || transCategory === 'Préstamos') {
            let dbType = transCategory === 'Me deben' ? 'loan' : 'debt';
            let dbAmount = 0;

            // Logic strictly aligned with UI Buttons:
            // ADD (+) button -> Money IN to my wallet (+val)
            // SUBTRACT (-) button -> Money OUT from my wallet (-val)

            if (actionType === 'add') {
                if (transCategory === 'Me deben') {
                    // I'm getting money back from someone
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
                    // I'm paying my debt (Préstamos)
                    // If it's a new contact, we initialize the debt as positive (+)
                    dbAmount = isNewContact ? val : -val;
                }
            }

            let finalId = selectedContactId;
            let finalName = contactName;

            if (isNewContact) {
                if (!contactName.trim()) { Alert.alert('Error', 'Nombre obligatorio'); return; }
                finalId = null;
            } else {
                if (!finalId) { Alert.alert('Error', 'Selecciona persona'); return; }
                const c = linkedContacts.find(x => x.id === finalId);
                finalName = c ? c.name : '';
            }

            const res = await db.addTransaction(user.id, finalId, finalName, dbType, dbAmount, transDesc || transCategory);
            linkedSuccess = res.success;
        }

        if (!linkedSuccess) return;

        // 2. Add to History
        await db.addBalanceTransaction(user.id, finalAmount, transCategory, transDesc);

        // 3. Update Balance
        await db.updateUserBalance(user.id, newBalance);

        // Refresh
        setBalance(newBalance);
        setShowTransModal(false);
        loadHistory();
        loadCategories(); // In case new category added
    };

    // Render Items
    const renderHistoryItem = ({ item }) => {
        // Parse time from created_at (SQLite format: YYYY-MM-DD HH:MM:SS)
        const timeStr = new Date(item.created_at.replace(' ', 'T') + 'Z').toLocaleTimeString('es-ES', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: true,
            timeZone: 'America/Guayaquil'
        });

        return (
            <View style={styles.historyRow}>
                <View style={styles.historyLeft}>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <Text style={styles.histCat}>{item.category}</Text>
                        <Text style={styles.histTime}> • {timeStr}</Text>
                    </View>
                    {item.description ? <Text style={styles.histDesc}>{item.description}</Text> : null}
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
                    <Text style={styles.sectionTitle}>{title}</Text>
                </View>
                <Text style={[styles.sectionTotal, total >= 0 ? styles.green : styles.red]}>
                    {total >= 0 ? '+' : ''}{total.toFixed(2)}
                </Text>
            </TouchableOpacity>
        );
    };

    // Derived State for SectionList
    const visibleSections = React.useMemo(() => {
        return historyGroups.map(section => ({
            ...section,
            data: expandedSections[section.title] ? section.data : []
        }));
    }, [historyGroups, expandedSections]);

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
            <StatusBar style={isDarkMode ? "light" : "dark"} />

            {/* Header */}
            <View style={[styles.header, { backgroundColor: theme.header, borderBottomWidth: 1, borderBottomColor: theme.border }]}>
                <TouchableOpacity onPress={onBack}>
                    <Text style={{ fontSize: 24, color: theme.text }}>←</Text>
                </TouchableOpacity>

                <TouchableOpacity style={styles.compactBalance} onPress={() => {
                    setInputBalance(balance.toString());
                    setEditMode(true);
                }}>
                    <Text style={[styles.labelSmall, { color: theme.subText }]}>Dinero Actual</Text>
                    <Text style={[styles.balanceSmall, { color: theme.text }]}>${balance.toFixed(2)}</Text>
                </TouchableOpacity>

                <TouchableOpacity onPress={() => onNavigate('DEUDAS_PRESTAMOS')}>
                    <Text style={{ fontSize: 22 }}>👥</Text>
                </TouchableOpacity>
            </View>

            <View style={styles.actionStrip}>
                <TouchableOpacity style={[styles.btnSmall, styles.btnIn, isDarkMode && { backgroundColor: '#1b3320', borderColor: '#2e7d32' }]} onPress={() => openTransactionModal('add')}>
                    <Text style={[styles.btnTextSmall, { color: isDarkMode ? '#81c784' : '#2e7d32' }]}>+$ Ingreso</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.btnSmall, styles.btnOut, isDarkMode && { backgroundColor: '#331b1b', borderColor: '#c62828' }]} onPress={() => openTransactionModal('subtract')}>
                    <Text style={[styles.btnTextSmall, { color: isDarkMode ? '#e57373' : '#c62828' }]}>-$ Gasto</Text>
                </TouchableOpacity>
            </View>

            <View style={{ flex: 1, paddingHorizontal: 15 }}>
                <Text style={[styles.histTitle, { color: theme.text }]}>Historial</Text>
                <SectionList
                    sections={historyGroups}
                    keyExtractor={(item) => item.id.toString()}
                    stickySectionHeadersEnabled={false}
                    renderSectionHeader={({ section: { title, data } }) => {
                        const isExpanded = expandedSections[title] !== false;
                        const dayTotal = data.reduce((acc, curr) => acc + (curr.type === 'add' ? curr.amount : -curr.amount), 0);

                        return (
                            <TouchableOpacity
                                style={[styles.sectionHeader, { backgroundColor: theme.inputBackground }]}
                                onPress={() => toggleSection(title)}
                            >
                                <Text style={[styles.sectionTitle, { color: theme.subText }]}>
                                    {isExpanded ? '▼ ' : '▶ '} {title}
                                </Text>
                                <Text style={[styles.sectionTotal, { color: dayTotal >= 0 ? '#4CAF50' : '#F44336' }]}>
                                    {dayTotal >= 0 ? '+' : ''}{dayTotal.toFixed(2)}
                                </Text>
                            </TouchableOpacity>
                        );
                    }}
                    renderItem={({ item, section }) => {
                        if (expandedSections[section.title] === false) return null;
                        return (
                            <View style={[styles.historyRow, { borderBottomColor: theme.border }]}>
                                <View style={styles.historyLeft}>
                                    <Text style={[styles.histCat, { color: theme.text }]}>{item.category}</Text>
                                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                        <Text style={[styles.histTime, { color: theme.subText }]}>{item.time}</Text>
                                        {item.contact_id && (
                                            <TouchableOpacity onPress={() => onNavigate('DEUDAS_PRESTAMOS')} style={{ marginLeft: 8 }}>
                                                <Text style={{ fontSize: 11, color: theme.accent, fontWeight: 'bold' }}>• 👤 {item.contact_name}</Text>
                                            </TouchableOpacity>
                                        )}
                                    </View>
                                    {item.description ? <Text style={[styles.histDesc, { color: theme.subText }]}>{item.description}</Text> : null}
                                </View>
                                <Text style={[styles.histAmount, item.type === 'add' ? styles.green : styles.red]}>
                                    {item.type === 'add' ? '+' : '-'}${item.amount.toFixed(2)}
                                </Text>
                            </View>
                        );
                    }}
                    ListEmptyComponent={<Text style={[styles.empty, { color: theme.subText }]}>No hay movimientos aún</Text>}
                    contentContainerStyle={{ paddingBottom: 20 }}
                />
            </View>

            {/* Transaction Modal */}
            <Modal visible={showTransModal} transparent animationType="slide" onRequestClose={() => setShowTransModal(false)}>
                <View style={[styles.overlay, { backgroundColor: theme.modalOverlay }]}>
                    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={[styles.modalContent, { backgroundColor: theme.card }]}>
                        <Text style={[styles.modalTitle, { color: theme.text }]}>{actionType === 'add' ? 'Nuevo Ingreso' : 'Nuevo Gasto'}</Text>

                        <TextInput
                            style={[styles.inputBig, { color: theme.text, borderColor: theme.border }]}
                            autoFocus
                            placeholder="0.00"
                            placeholderTextColor={theme.subText}
                            keyboardType="numeric"
                            value={transAmount}
                            onChangeText={setTransAmount}
                        />

                        <View style={{ zIndex: 10 }}>
                            <TextInput
                                style={[styles.input, { backgroundColor: theme.inputBackground, color: theme.text, borderColor: theme.border }]}
                                placeholder="Categoría (Ej: Comida)"
                                placeholderTextColor={theme.subText}
                                value={transCategory}
                                onChangeText={handleCategoryChange}
                                onFocus={() => transCategory.length > 0 && setShowCatSuggestions(true)}
                                onBlur={() => setTimeout(() => setShowCatSuggestions(false), 200)}
                            />

                            {showCatSuggestions && filteredCategories.length > 0 && (
                                <View style={[styles.suggestionsBox, { backgroundColor: theme.card, borderColor: theme.border }]}>
                                    <ScrollView keyboardShouldPersistTaps="handled">
                                        {filteredCategories.map(cat => (
                                            <TouchableOpacity key={cat} style={[styles.suggItem, { borderBottomColor: theme.border }]} onPress={() => selectCategory(cat)}>
                                                <Text style={{ color: theme.text }}>{cat}</Text>
                                            </TouchableOpacity>
                                        ))}
                                    </ScrollView>
                                </View>
                            )}
                        </View>

                        {(transCategory === 'Me deben' || transCategory === 'Préstamos') && (
                            <View style={[styles.linkedBox, { backgroundColor: theme.inputBackground }]}>
                                <Text style={[styles.label, { color: theme.subText }]}>Vincular Contacto:</Text>
                                <View style={styles.btnsRow}>
                                    <TouchableOpacity style={[styles.tab, !isNewContact && styles.activeTab, !isNewContact && { backgroundColor: theme.border }]} onPress={() => setIsNewContact(false)}>
                                        <Text style={{ fontSize: 12, color: theme.text }}>Existente</Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity style={[styles.tab, isNewContact && styles.activeTab, isNewContact && { backgroundColor: theme.border }]} onPress={() => setIsNewContact(true)}>
                                        <Text style={{ fontSize: 12, color: theme.text }}>Nuevo</Text>
                                    </TouchableOpacity>
                                </View>

                                {isNewContact ? (
                                    <TextInput
                                        style={[styles.input, { marginTop: 10, backgroundColor: theme.card, color: theme.text, borderColor: theme.border }]}
                                        placeholder="Nombre del contacto"
                                        placeholderTextColor={theme.subText}
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
                                                        style={[styles.pItem, selectedContactId === c.id && styles.pItemSel, selectedContactId === c.id && { backgroundColor: theme.accent + '33' }]}
                                                        onPress={() => setSelectedContactId(c.id)}
                                                    >
                                                        <Text style={{ fontSize: 13, color: theme.text }}>{c.name}</Text>
                                                        <Text style={{ fontSize: 10, color: theme.subText }}>Bal: ${c.balance.toFixed(2)}</Text>
                                                    </TouchableOpacity>
                                                ))}
                                                {linkedContacts.length === 0 && <Text style={{ color: theme.subText, fontStyle: 'italic', fontSize: 12 }}>No hay contactos aún</Text>}
                                            </View>
                                        </ScrollView>

                                        {selectedContactId && (
                                            <View style={[styles.infoBox, { marginTop: 10, backgroundColor: isDarkMode ? '#1a237e' : '#E3F2FD' }]}>
                                                {(() => {
                                                    const contact = linkedContacts.find(c => c.id === selectedContactId);
                                                    const current = contact?.balance || 0;
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
                                                            <Text style={[styles.infoTitle, { color: theme.infoText }]}>Actual: ${current.toFixed(2)}</Text>
                                                            <Text style={[styles.infoMsg, { color: theme.infoText }]}>{msg}</Text>
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
                            style={[styles.input, { backgroundColor: theme.inputBackground, color: theme.text, borderColor: theme.border }]}
                            placeholder="Descripción (Opcional)"
                            placeholderTextColor={theme.subText}
                            value={transDesc}
                            onChangeText={setTransDesc}
                        />

                        <View style={styles.btnsRow}>
                            <TouchableOpacity style={[styles.cancelBtn, { backgroundColor: theme.inputBackground }]} onPress={() => setShowTransModal(false)}>
                                <Text style={{ color: theme.text }}>Cancelar</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={[styles.saveBtn, actionType === 'add' ? styles.bgGreen : styles.bgRed]} onPress={executeTransaction}>
                                <Text style={{ color: '#fff', fontWeight: 'bold' }}>Guardar</Text>
                            </TouchableOpacity>
                        </View>

                    </KeyboardAvoidingView>
                </View>
            </Modal>

            {/* Manual Balance Edit Modal */}
            <Modal visible={editMode} transparent animationType="fade">
                <View style={[styles.overlay, { backgroundColor: theme.modalOverlay }]}>
                    <View style={[styles.modalContent, { height: 200, backgroundColor: theme.card }]}>
                        <Text style={[styles.modalTitle, { color: theme.text }]}>Ajuste Manual</Text>
                        <TextInput
                            style={[styles.inputBig, { color: theme.text, borderColor: theme.border }]}
                            value={inputBalance}
                            onChangeText={setInputBalance}
                            keyboardType="numeric"
                            placeholderTextColor={theme.subText}
                        />
                        <View style={styles.btnsRow}>
                            <TouchableOpacity style={[styles.cancelBtn, { backgroundColor: theme.inputBackground }]} onPress={() => setEditMode(false)}>
                                <Text style={{ color: theme.text }}>Cancelar</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={[styles.saveBtn, { backgroundColor: theme.text }]} onPress={handleUpdateBalance}>
                                <Text style={{ color: theme.card }}>Actualizar</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            </Modal>

        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#F5F7FA' },
    header: {
        flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
        paddingHorizontal: 15, paddingVertical: 10, backgroundColor: '#fff'
    },
    compactBalance: { alignItems: 'center' },
    labelSmall: { fontSize: 12, color: '#888' },
    balanceSmall: { fontSize: 24, fontWeight: 'bold', color: '#333' },

    actionStrip: { flexDirection: 'row', gap: 10, padding: 15 },
    btnSmall: {
        flex: 1, padding: 12, borderRadius: 10,
        alignItems: 'center', justifyContent: 'center', elevation: 1
    },
    btnIn: { backgroundColor: '#E8F5E9', borderWidth: 1, borderColor: '#C8E6C9' },
    btnOut: { backgroundColor: '#FFEBEE', borderWidth: 1, borderColor: '#FFCDD2' },
    btnTextSmall: { fontWeight: 'bold', fontSize: 16, color: '#333' },

    histTitle: { fontSize: 18, fontWeight: 'bold', marginBottom: 10, color: '#444' },
    sectionHeader: {
        flexDirection: 'row', justifyContent: 'space-between',
        backgroundColor: '#f0f0f0', padding: 8, borderRadius: 5, marginTop: 10
    },
    sectionTitle: { fontWeight: 'bold', color: '#555', fontSize: 13 },
    sectionTotal: { fontWeight: 'bold', fontSize: 13 },

    historyRow: {
        flexDirection: 'row', justifyContent: 'space-between',
        paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#eee'
    },
    historyLeft: { flex: 1 },
    histCat: { fontSize: 15, fontWeight: 'bold', color: '#1A237E' },
    histTime: { fontSize: 12, color: '#7986CB', fontWeight: '500' },
    histDesc: { fontSize: 13, color: '#5C6BC0', marginTop: 2 },
    histAmount: { fontSize: 15, fontWeight: 'bold' },
    green: { color: '#4CAF50' },
    red: { color: '#F44336' },
    empty: { textAlign: 'center', marginTop: 20, color: '#aaa' },

    // Modal
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 20 },
    modalContent: { backgroundColor: '#fff', borderRadius: 15, padding: 20 },
    modalTitle: { fontSize: 18, fontWeight: 'bold', textAlign: 'center', marginBottom: 15, color: '#000' },
    inputBig: { fontSize: 30, textAlign: 'center', fontWeight: 'bold', marginBottom: 20, borderBottomWidth: 1, borderColor: '#eee', color: '#000' },
    input: { borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 10, marginBottom: 10, color: '#000' },

    suggestionsBox: {
        position: 'absolute', top: 50, left: 0, right: 0,
        backgroundColor: '#fff', borderWidth: 1, borderColor: '#eee',
        borderRadius: 8, elevation: 5, maxHeight: 150
    },
    suggItem: { padding: 10, borderBottomWidth: 1, borderBottomColor: '#f9f9f9' },

    linkedBox: { backgroundColor: '#f9f9f9', padding: 10, borderRadius: 8, marginBottom: 10 },
    label: { marginBottom: 5, color: '#666', fontSize: 12 },
    tab: { flex: 1, padding: 8, alignItems: 'center', borderRadius: 5, backgroundColor: '#eee', marginRight: 5 },
    activeTab: { backgroundColor: '#ddd' },
    pItem: { padding: 8, borderBottomWidth: 1, borderBottomColor: '#eee' },
    pItemSel: { backgroundColor: '#E3F2FD' },

    infoBox: { backgroundColor: '#E3F2FD', padding: 10, borderRadius: 8, borderLeftWidth: 4, borderLeftColor: '#2196F3' },
    infoTitle: { fontWeight: 'bold', color: '#1565C0', fontSize: 13, marginBottom: 2 },
    infoMsg: { color: '#0D47A1', fontSize: 12 },

    btnsRow: { flexDirection: 'row', gap: 10, marginTop: 10 },
    cancelBtn: { flex: 1, padding: 12, alignItems: 'center', backgroundColor: '#f5f5f5', borderRadius: 8 },
    saveBtn: { flex: 1, padding: 12, alignItems: 'center', borderRadius: 8 },
    bgGreen: { backgroundColor: '#4CAF50' },
    bgRed: { backgroundColor: '#F44336' },
});
