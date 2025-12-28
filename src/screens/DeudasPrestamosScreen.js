import React, { useState, useEffect } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    TextInput,
    ScrollView,
    Alert,
    KeyboardAvoidingView,
    Platform,
    FlatList,
    Modal
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useTheme } from '../contexts/ThemeContext';
import db from '../services/db';

export default function DeudasPrestamosScreen({ user, onBack }) {
    const { theme, isDarkMode } = useTheme();
    const [activeTab, setActiveTab] = useState('deudas'); // 'deudas' | 'prestamos'
    const [data, setData] = useState([]);

    // Form State
    const [showAddModal, setShowAddModal] = useState(false);
    const [isNewContact, setIsNewContact] = useState(false);

    const [selectedContactId, setSelectedContactId] = useState(null); // For picker
    const [contactName, setContactName] = useState(''); // For new contact

    const [amount, setAmount] = useState('');
    const [description, setDescription] = useState('');

    // Expanded View State (which contact's details are shown)
    const [expandedContactId, setExpandedContactId] = useState(null);

    useEffect(() => {
        loadData();
    }, [activeTab]);

    const loadData = async () => {
        const type = activeTab === 'deudas' ? 'debt' : 'loan';
        const result = await db.getFinanceData(user.id, type);
        if (result.success) {
            setData(result.data);
        }
    };

    const handleAddStart = () => {
        setAmount('');
        setDescription('');
        setSelectedContactId(null);
        setContactName('');
        setIsNewContact(false);
        setShowAddModal(true);
    };

    const handleSave = async () => {
        if (!amount) {
            Alert.alert('Error', 'La cantidad es obligatoria');
            return;
        }

        let finalName = contactName;
        let finalId = selectedContactId;

        if (isNewContact) {
            if (!contactName.trim()) {
                Alert.alert('Error', 'El nombre es obligatorio');
                return;
            }
            finalId = null; // Let DB create it
        } else {
            if (!selectedContactId) {
                Alert.alert('Error', 'Selecciona una persona');
                return;
            }
            // Find name for consistency
            const c = data.find(x => x.id === selectedContactId);
            finalName = c ? c.name : '';
        }

        const type = activeTab === 'deudas' ? 'debt' : 'loan';

        const result = await db.addTransaction(
            user.id,
            finalId,
            finalName,
            type,
            parseFloat(amount),
            description
        );

        if (result.success) {
            setShowAddModal(false);
            loadData();
        } else {
            Alert.alert('Error', result.error);
        }
    };

    const handleDelete = async (transactionId) => {
        Alert.alert(
            'Confirmar',
            '¿Estás seguro de eliminar este registro?',
            [
                { text: 'Cancelar', style: 'cancel' },
                {
                    text: 'Eliminar',
                    style: 'destructive',
                    onPress: async () => {
                        await db.deleteTransaction(transactionId);
                        loadData();
                    }
                }
            ]
        );
    };

    const renderContactCard = ({ item }) => {
        const isExpanded = expandedContactId === item.id;

        return (
            <View style={[styles.card, { backgroundColor: theme.card }]}>
                <TouchableOpacity
                    style={styles.cardHeader}
                    onPress={() => setExpandedContactId(isExpanded ? null : item.id)}
                    activeOpacity={0.7}
                >
                    <View>
                        <Text style={[styles.contactName, { color: theme.text }]}>{item.name}</Text>
                        <Text style={[styles.transCount, { color: theme.subText }]}>
                            {item.transactions.length} registros
                        </Text>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                        <Text style={[
                            styles.totalAmount,
                            activeTab === 'deudas' ? styles.textDebt : styles.textLoan
                        ]}>
                            ${item.total.toFixed(2)}
                        </Text>
                        <Text style={[styles.expandIcon, { color: theme.subText }]}>{isExpanded ? '▲' : '▼'}</Text>
                    </View>
                </TouchableOpacity>

                {isExpanded && (
                    <View style={[styles.historyList, { backgroundColor: theme.inputBackground, borderTopColor: theme.border }]}>
                        {item.transactions.map((t) => (
                            <View key={t.id} style={[styles.transactionRow, { borderBottomColor: theme.border }]}>
                                <View style={{ flex: 1 }}>
                                    <Text style={[styles.date, { color: theme.subText }]}>
                                        {new Date(t.created_at.replace(' ', 'T') + 'Z').toLocaleDateString('es-ES', { timeZone: 'America/Guayaquil' })} • {new Date(t.created_at.replace(' ', 'T') + 'Z').toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'America/Guayaquil' })}
                                    </Text>
                                    {t.description ? (
                                        <Text style={[styles.desc, { color: theme.text }]}>{t.description}</Text>
                                    ) : null}
                                </View>
                                <Text style={[styles.transAmount, activeTab === 'deudas' ? styles.textDebt : styles.textLoan]}>
                                    ${t.amount.toFixed(2)}
                                </Text>
                                <TouchableOpacity
                                    style={styles.deleteBtn}
                                    onPress={() => handleDelete(t.id)}
                                >
                                    <Text style={styles.deleteText}>🗑️</Text>
                                </TouchableOpacity>
                            </View>
                        ))}
                    </View>
                )}
            </View>
        );
    };

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
            <StatusBar style={isDarkMode ? "light" : "dark"} />

            {/* Header */}
            <View style={[styles.header, { backgroundColor: theme.header, borderBottomWidth: 1, borderBottomColor: theme.border }]}>
                <TouchableOpacity onPress={onBack} style={styles.backButton}>
                    <Text style={[styles.backText, { color: theme.accent }]}>← Volver</Text>
                </TouchableOpacity>
                <Text style={[styles.title, { color: theme.text }]}>Deudas y Préstamos</Text>
                <TouchableOpacity onPress={handleAddStart} style={styles.addButton}>
                    <Text style={styles.addBtnText}>+</Text>
                </TouchableOpacity>
            </View>

            {/* Tabs */}
            <View style={styles.tabs}>
                <TouchableOpacity
                    style={[
                        styles.tab,
                        activeTab === 'deudas' && styles.activeTabDebt,
                        activeTab === 'deudas' && isDarkMode && { backgroundColor: '#331b1b', borderColor: '#c62828' }
                    ]}
                    onPress={() => setActiveTab('deudas')}
                >
                    <Text style={[styles.tabText, activeTab === 'deudas' && { color: theme.text, fontWeight: 'bold' }]}>
                        Me deben
                    </Text>
                </TouchableOpacity>
                <TouchableOpacity
                    style={[
                        styles.tab,
                        activeTab === 'prestamos' && styles.activeTabLoan,
                        activeTab === 'prestamos' && isDarkMode && { backgroundColor: '#1b2c33', borderColor: '#2196f3' }
                    ]}
                    onPress={() => setActiveTab('prestamos')}
                >
                    <Text style={[styles.tabText, activeTab === 'prestamos' && { color: theme.text, fontWeight: 'bold' }]}>
                        Préstamos
                    </Text>
                </TouchableOpacity>
            </View>

            <FlatList
                data={data}
                renderItem={renderContactCard}
                keyExtractor={item => item.id.toString()}
                contentContainerStyle={styles.listContent}
                ListEmptyComponent={
                    <Text style={[styles.emptyText, { color: theme.subText }]}>No hay registros aún.</Text>
                }
            />

            {/* Add Transaction Modal */}
            <Modal
                visible={showAddModal}
                animationType="slide"
                transparent={true}
                onRequestClose={() => setShowAddModal(false)}
            >
                <View style={[styles.modalOverlay, { backgroundColor: theme.modalOverlay }]}>
                    <View style={[styles.modalContent, { backgroundColor: theme.card }]}>
                        <Text style={[styles.modalTitle, { color: theme.text }]}>
                            Agregar {activeTab === 'deudas' ? 'Deuda' : 'Préstamo'}
                        </Text>

                        {/* Contact Selector */}
                        <View style={[styles.switchRow, { borderColor: theme.border }]}>
                            <TouchableOpacity
                                style={[styles.switchBtn, !isNewContact && styles.switchActive, !isNewContact && { backgroundColor: theme.border }]}
                                onPress={() => setIsNewContact(false)}
                            >
                                <Text style={[styles.switchText, !isNewContact && { color: theme.text, fontWeight: 'bold' }]}>Existente</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[styles.switchBtn, isNewContact && styles.switchActive, isNewContact && { backgroundColor: theme.border }]}
                                onPress={() => setIsNewContact(true)}
                            >
                                <Text style={[styles.switchText, isNewContact && { color: theme.text, fontWeight: 'bold' }]}>Nuevo</Text>
                            </TouchableOpacity>
                        </View>

                        {isNewContact ? (
                            <TextInput
                                style={[styles.input, { backgroundColor: theme.inputBackground, color: theme.text, borderColor: theme.border }]}
                                placeholder="Nombre Persona"
                                placeholderTextColor={theme.subText}
                                value={contactName}
                                onChangeText={setContactName}
                            />
                        ) : (
                            <View style={[styles.pickerContainer, { borderColor: theme.border }]}>
                                <Text style={[styles.label, { color: theme.subText }]}>Selecciona Persona:</Text>
                                <ScrollView style={{ maxHeight: 100 }}>
                                    {data.length === 0 ? (
                                        <Text style={[styles.noContactText, { color: theme.subText }]}>No hay personas registradas.</Text>
                                    ) : (
                                        data.map(c => (
                                            <TouchableOpacity
                                                key={c.id}
                                                style={[
                                                    styles.contactOption,
                                                    selectedContactId === c.id && styles.contactOptionSelected,
                                                    selectedContactId === c.id && { backgroundColor: theme.accent + '33' }
                                                ]}
                                                onPress={() => setSelectedContactId(c.id)}
                                            >
                                                <Text style={[
                                                    styles.contactText,
                                                    { color: theme.text },
                                                    selectedContactId === c.id && { fontWeight: 'bold', color: theme.accent }
                                                ]}>
                                                    {c.name}
                                                </Text>
                                            </TouchableOpacity>
                                        ))
                                    )}
                                </ScrollView>
                            </View>
                        )}

                        <TextInput
                            style={[styles.input, { backgroundColor: theme.inputBackground, color: theme.text, borderColor: theme.border }]}
                            placeholder="Cantidad ($)"
                            placeholderTextColor={theme.subText}
                            keyboardType="numeric"
                            value={amount}
                            onChangeText={setAmount}
                        />

                        <TextInput
                            style={[styles.input, { backgroundColor: theme.inputBackground, color: theme.text, borderColor: theme.border }]}
                            placeholder="Descripción (Opcional)"
                            placeholderTextColor={theme.subText}
                            value={description}
                            onChangeText={setDescription}
                        />

                        <View style={styles.modalButtons}>
                            <TouchableOpacity
                                style={[styles.modalBtn, styles.cancelBtn, { backgroundColor: theme.inputBackground }]}
                                onPress={() => setShowAddModal(false)}
                            >
                                <Text style={[styles.cancelText, { color: theme.text }]}>Cancelar</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[styles.modalBtn, styles.saveBtn, { backgroundColor: theme.accent }]}
                                onPress={handleSave}
                            >
                                <Text style={styles.saveText}>Guardar</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            </Modal>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 20,
    },
    backButton: { padding: 5 },
    backText: { fontSize: 16 },
    title: { fontSize: 18, fontWeight: 'bold' },
    addButton: {
        backgroundColor: '#007AFF',
        width: 30, height: 30,
        borderRadius: 15,
        alignItems: 'center',
        justifyContent: 'center'
    },
    addBtnText: { color: '#fff', fontSize: 20, fontWeight: 'bold', marginTop: -2 },

    tabs: { flexDirection: 'row', padding: 15, gap: 10 },
    tab: { flex: 1, padding: 12, borderRadius: 10, alignItems: 'center', borderWidth: 1, borderColor: '#eee' },
    activeTabDebt: { backgroundColor: '#FFF0F0', borderColor: '#FF5252' },
    activeTabLoan: { backgroundColor: '#F0F9FF', borderColor: '#2196F3' },
    tabText: { color: '#888' },

    listContent: { padding: 15 },
    card: {
        borderRadius: 15,
        marginBottom: 15,
        overflow: 'hidden',
        elevation: 2,
    },
    cardHeader: {
        padding: 15,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    contactName: { fontSize: 16, fontWeight: 'bold' },
    transCount: { fontSize: 12 },
    totalAmount: { fontSize: 18, fontWeight: 'bold' },
    textDebt: { color: '#FF5252' },
    textLoan: { color: '#2196F3' },
    expandIcon: { fontSize: 12, marginTop: 5 },

    historyList: {
        borderTopWidth: 1,
        padding: 10,
    },
    transactionRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 10,
        borderBottomWidth: 1,
    },
    date: { fontSize: 12, marginBottom: 2 },
    desc: { fontSize: 14 },
    transAmount: { fontSize: 15, fontWeight: 'bold', marginHorizontal: 10 },
    deleteBtn: { padding: 5 },
    deleteText: { fontSize: 16 },

    emptyText: { textAlign: 'center', marginTop: 30 },

    modalOverlay: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    modalContent: { width: '90%', padding: 20, borderRadius: 20 },
    modalTitle: { fontSize: 20, fontWeight: 'bold', marginBottom: 20, textAlign: 'center' },

    switchRow: { flexDirection: 'row', marginBottom: 15, borderWidth: 1, borderRadius: 8 },
    switchBtn: { flex: 1, padding: 10, alignItems: 'center' },
    switchActive: { backgroundColor: '#f0f0f0' },
    switchText: { color: '#888' },

    input: {
        borderWidth: 1, borderRadius: 8,
        padding: 12, marginBottom: 15, fontSize: 16
    },
    pickerContainer: {
        maxHeight: 150, borderWidth: 1, borderRadius: 8, marginBottom: 15, padding: 5
    },
    label: { fontSize: 12, marginBottom: 5, paddingLeft: 5 },
    contactOption: { padding: 10, borderBottomWidth: 1, borderBottomColor: '#f9f9f9' },
    contactOptionSelected: { backgroundColor: '#E3F2FD' },
    contactText: { color: '#333' },
    noContactText: { padding: 10, fontStyle: 'italic' },

    modalButtons: { flexDirection: 'row', gap: 10 },
    modalBtn: { flex: 1, padding: 15, borderRadius: 10, alignItems: 'center' },
    cancelBtn: { backgroundColor: '#f5f5f5' },
    saveBtn: { backgroundColor: '#2196F3' },
    cancelText: { color: '#333' },
    saveText: { color: '#fff', fontWeight: 'bold' },
});
