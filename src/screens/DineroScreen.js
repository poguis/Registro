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
import db from '../services/db';

export default function DineroScreen({ user, onBack, onNavigate }) {
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

            // Logic matrix
            if (actionType === 'add') {
                if (transCategory === 'Me deben') dbAmount = -val; // Payback
                if (transCategory === 'Préstamos') dbAmount = val; // Borrow
            } else {
                if (transCategory === 'Préstamos') dbAmount = -val; // Pay debt
                if (transCategory === 'Me deben') dbAmount = val; // Lend
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
    const renderHistoryItem = ({ item }) => (
        <View style={styles.historyRow}>
            <View style={styles.historyLeft}>
                <Text style={styles.histCat}>{item.category}</Text>
                {item.description ? <Text style={styles.histDesc}>{item.description}</Text> : null}
            </View>
            <Text style={[styles.histAmount, item.amount >= 0 ? styles.green : styles.red]}>
                {item.amount >= 0 ? '+' : ''}{item.amount.toFixed(2)}
            </Text>
        </View>
    );

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
        <SafeAreaView style={styles.container}>
            <StatusBar style="dark" />

            {/* Compact Header */}
            <View style={styles.header}>
                <TouchableOpacity onPress={onBack} style={{ padding: 5 }}>
                    <Text style={{ fontSize: 16, color: '#007AFF' }}>← Volver</Text>
                </TouchableOpacity>

                <View style={styles.compactBalance}>
                    <Text style={styles.labelSmall}>Dinero Actual</Text>
                    <TouchableOpacity onPress={() => { setInputBalance(balance.toString()); setEditMode(true); }}>
                        <Text style={styles.balanceSmall}>${balance.toFixed(2)}</Text>
                    </TouchableOpacity>
                </View>

                {/* Module Link (Icon Only) */}
                <TouchableOpacity onPress={() => onNavigate('DEUDAS_PRESTAMOS')} style={{ padding: 5 }}>
                    <Text style={{ fontSize: 24 }}>💸</Text>
                </TouchableOpacity>
            </View>

            {/* Action Buttons (Horizontal Strip) */}
            <View style={styles.actionStrip}>
                <TouchableOpacity style={[styles.btnSmall, styles.btnIn]} onPress={() => openTransactionModal('add')}>
                    <Text style={styles.btnTextSmall}>+ Agregar</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.btnSmall, styles.btnOut]} onPress={() => openTransactionModal('subtract')}>
                    <Text style={styles.btnTextSmall}>- Quitar</Text>
                </TouchableOpacity>
            </View>

            {/* History List */}
            <View style={{ flex: 1, backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, marginTop: 10, padding: 15 }}>
                <Text style={styles.histTitle}>Historial de Movimientos</Text>
                <SectionList
                    sections={visibleSections}
                    keyExtractor={(item) => item.id.toString()}
                    renderItem={renderHistoryItem}
                    renderSectionHeader={renderSectionHeader}
                    contentContainerStyle={{ paddingBottom: 20 }}
                    ListEmptyComponent={<Text style={styles.empty}>No hay movimientos aún.</Text>}
                    extraData={expandedSections} // Force update when state changes
                />
            </View>

            {/* Transaction Modal */}
            <Modal visible={showTransModal} transparent animationType="slide">
                <View style={styles.overlay}>
                    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.modalContent}>
                        <Text style={styles.modalTitle}>{actionType === 'add' ? 'Ingresar Dinero' : 'Retirar Dinero'}</Text>

                        {/* Amount */}
                        <TextInput
                            style={styles.inputBig}
                            placeholder="$0.00"
                            keyboardType="numeric"
                            value={transAmount}
                            onChangeText={setTransAmount}
                        />

                        {/* Category with Suggestions */}
                        <View style={{ zIndex: 1000, width: '100%', marginBottom: 10 }}>
                            <TextInput
                                style={styles.input}
                                placeholder="Categoría (ej. Comida, Sueldo)"
                                value={transCategory}
                                onChangeText={handleCategoryChange}
                            />
                            {showCatSuggestions && filteredCategories.length > 0 && (
                                <View style={styles.suggestionsBox}>
                                    {filteredCategories.map(cat => (
                                        <TouchableOpacity key={cat} style={styles.suggItem} onPress={() => selectCategory(cat)}>
                                            <Text>{cat}</Text>
                                        </TouchableOpacity>
                                    ))}
                                </View>
                            )}
                        </View>

                        {/* Linked Person */}
                        {(linkedContacts.length > 0 || transCategory === 'Me deben' || transCategory === 'Préstamos') && (
                            <View style={styles.linkedBox}>
                                <Text style={styles.label}>Persona asociada:</Text>
                                <View style={{ flexDirection: 'row', marginBottom: 5 }}>
                                    <TouchableOpacity onPress={() => setIsNewContact(false)} style={[styles.tab, !isNewContact && styles.activeTab]}>
                                        <Text>Existente</Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity onPress={() => setIsNewContact(true)} style={[styles.tab, isNewContact && styles.activeTab]}>
                                        <Text>Nuevo</Text>
                                    </TouchableOpacity>
                                </View>
                                {isNewContact ? (
                                    <TextInput style={styles.input} placeholder="Nombre" value={contactName} onChangeText={setContactName} />
                                ) : (
                                    <View>
                                        <ScrollView style={{ height: 80, borderWidth: 1, borderColor: '#eee', borderRadius: 8, marginBottom: 10 }}>
                                            {linkedContacts.map(c => (
                                                <TouchableOpacity
                                                    key={c.id}
                                                    style={[styles.pItem, selectedContactId === c.id && styles.pItemSel]}
                                                    onPress={() => setSelectedContactId(c.id)}
                                                >
                                                    <Text style={selectedContactId === c.id ? { fontWeight: 'bold', color: '#1976D2' } : { color: '#333' }}>
                                                        {c.name} (${c.total.toFixed(2)})
                                                    </Text>
                                                </TouchableOpacity>
                                            ))}
                                        </ScrollView>

                                        {selectedContactId && (
                                            <View style={styles.infoBox}>
                                                {(() => {
                                                    const contact = linkedContacts.find(c => c.id === selectedContactId);
                                                    const current = contact ? contact.total : 0;

                                                    let msg = '';
                                                    // Logic Matrix
                                                    if (actionType === 'add') {
                                                        if (transCategory === 'Me deben') msg = `Te pagan. La deuda de ${contact?.name} bajará.`;
                                                        if (transCategory === 'Préstamos') msg = `Pides prestado. Tu deuda con ${contact?.name} subirá.`;
                                                    } else {
                                                        if (transCategory === 'Préstamos') msg = `Pagas. Tu deuda con ${contact?.name} bajará.`;
                                                        if (transCategory === 'Me deben') msg = `Prestas. La deuda de ${contact?.name} subirá.`;
                                                    }

                                                    return (
                                                        <>
                                                            <Text style={styles.infoTitle}>Actual: ${current.toFixed(2)}</Text>
                                                            <Text style={styles.infoMsg}>{msg}</Text>
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
                            style={styles.input}
                            placeholder="Descripción (Opcional)"
                            value={transDesc}
                            onChangeText={setTransDesc}
                        />

                        <View style={styles.btnsRow}>
                            <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowTransModal(false)}>
                                <Text>Cancelar</Text>
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
                <View style={styles.overlay}>
                    <View style={[styles.modalContent, { height: 200 }]}>
                        <Text style={styles.modalTitle}>Ajuste Manual</Text>
                        <TextInput
                            style={styles.inputBig}
                            value={inputBalance}
                            onChangeText={setInputBalance}
                            keyboardType="numeric"
                        />
                        <View style={styles.btnsRow}>
                            <TouchableOpacity style={styles.cancelBtn} onPress={() => setEditMode(false)}>
                                <Text>Cancelar</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={[styles.saveBtn, { backgroundColor: '#333' }]} onPress={handleUpdateBalance}>
                                <Text style={{ color: '#fff' }}>Actualizar</Text>
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
    histCat: { fontSize: 15, fontWeight: '500', color: '#333' },
    histDesc: { fontSize: 13, color: '#888' },
    histAmount: { fontSize: 15, fontWeight: 'bold' },
    green: { color: '#4CAF50' },
    red: { color: '#F44336' },
    empty: { textAlign: 'center', marginTop: 20, color: '#aaa' },

    // Modal
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 20 },
    modalContent: { backgroundColor: '#fff', borderRadius: 15, padding: 20 },
    modalTitle: { fontSize: 18, fontWeight: 'bold', textAlign: 'center', marginBottom: 15 },
    inputBig: { fontSize: 30, textAlign: 'center', fontWeight: 'bold', marginBottom: 20, borderBottomWidth: 1, borderColor: '#eee' },
    input: { borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 10, marginBottom: 10 },

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
