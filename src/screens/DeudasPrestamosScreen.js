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
import db from '../services/db';

export default function DeudasPrestamosScreen({ user, onBack }) {
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
            // USING DATA (FILTERED) to ensure isolation
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

    const toggleExpand = (id) => {
        setExpandedContactId(expandedContactId === id ? null : id);
    };

    const renderContactCard = ({ item }) => {
        const isExpanded = expandedContactId === item.id;

        return (
            <View style={styles.card}>
                <TouchableOpacity
                    style={styles.cardHeader}
                    onPress={() => toggleExpand(item.id)}
                    activeOpacity={0.7}
                >
                    <View>
                        <Text style={styles.contactName}>{item.name}</Text>
                        <Text style={styles.transCount}>
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
                        <Text style={styles.expandIcon}>{isExpanded ? '▲' : '▼'}</Text>
                    </View>
                </TouchableOpacity>

                {isExpanded && (
                    <View style={styles.historyList}>
                        {item.transactions.map((t) => (
                            <View key={t.id} style={styles.transactionRow}>
                                <View style={{ flex: 1 }}>
                                    <Text style={styles.date}>
                                        {new Date(t.created_at).toLocaleDateString()}
                                    </Text>
                                    {t.description ? (
                                        <Text style={styles.desc}>{t.description}</Text>
                                    ) : null}
                                </View>
                                <Text style={styles.transAmount}>${t.amount.toFixed(2)}</Text>
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
        <SafeAreaView style={styles.container}>
            <StatusBar style="dark" />

            {/* Header */}
            <View style={styles.header}>
                <TouchableOpacity onPress={onBack} style={styles.backButton}>
                    <Text style={styles.backText}>← Volver</Text>
                </TouchableOpacity>
                <Text style={styles.title}>Deudas y Préstamos</Text>
                <TouchableOpacity onPress={handleAddStart} style={styles.addButton}>
                    <Text style={styles.addBtnText}>+</Text>
                </TouchableOpacity>
            </View>

            {/* Tabs */}
            <View style={styles.tabs}>
                <TouchableOpacity
                    style={[styles.tab, activeTab === 'deudas' && styles.activeTabDebt]}
                    onPress={() => setActiveTab('deudas')}
                >
                    <Text style={[styles.tabText, activeTab === 'deudas' && styles.activeTabText]}>
                        Deudas (Debo)
                    </Text>
                </TouchableOpacity>
                <TouchableOpacity
                    style={[styles.tab, activeTab === 'prestamos' && styles.activeTabLoan]}
                    onPress={() => setActiveTab('prestamos')}
                >
                    <Text style={[styles.tabText, activeTab === 'prestamos' && styles.activeTabText]}>
                        Préstamos (Me deben)
                    </Text>
                </TouchableOpacity>
            </View>

            <FlatList
                data={data}
                renderItem={renderContactCard}
                keyExtractor={item => item.id.toString()}
                contentContainerStyle={styles.listContent}
                ListEmptyComponent={
                    <Text style={styles.emptyText}>No hay registros.</Text>
                }
            />

            {/* Add Transaction Modal */}
            <Modal
                visible={showAddModal}
                animationType="slide"
                transparent={true}
            >
                <View style={styles.modalOverlay}>
                    <View style={styles.modalContent}>
                        <Text style={styles.modalTitle}>Agregar {activeTab === 'deudas' ? 'Deuda' : 'Préstamo'}</Text>

                        {/* Contact Selector */}
                        <View style={styles.switchRow}>
                            <TouchableOpacity
                                style={[styles.switchBtn, !isNewContact && styles.switchActive]}
                                onPress={() => setIsNewContact(false)}
                            >
                                <Text style={[styles.switchText, !isNewContact && styles.switchTextActive]}>Existente</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[styles.switchBtn, isNewContact && styles.switchActive]}
                                onPress={() => setIsNewContact(true)}
                            >
                                <Text style={[styles.switchText, isNewContact && styles.switchTextActive]}>Nuevo</Text>
                            </TouchableOpacity>
                        </View>

                        {isNewContact ? (
                            <TextInput
                                style={styles.input}
                                placeholder="Nombre Persona"
                                value={contactName}
                                onChangeText={setContactName}
                            />
                        ) : (
                            <View style={styles.pickerContainer}>
                                <Text style={styles.label}>Selecciona Persona:</Text>
                                <ScrollView style={{ maxHeight: 100 }}>
                                    {data.length === 0 ? (
                                        <Text style={styles.noContactText}>No hay personas registradas en esta categoría. Crea una nueva.</Text>
                                    ) : (
                                        data.map(c => (
                                            <TouchableOpacity
                                                key={c.id}
                                                style={[
                                                    styles.contactOption,
                                                    selectedContactId === c.id && styles.contactOptionSelected
                                                ]}
                                                onPress={() => setSelectedContactId(c.id)}
                                            >
                                                <Text style={selectedContactId === c.id ? styles.contactTextSelected : styles.contactText}>
                                                    {c.name}
                                                </Text>
                                            </TouchableOpacity>
                                        ))
                                    )}
                                </ScrollView>
                            </View>
                        )}

                        <TextInput
                            style={styles.input}
                            placeholder="Cantidad ($)"
                            keyboardType="numeric"
                            value={amount}
                            onChangeText={setAmount}
                        />

                        <TextInput
                            style={styles.input}
                            placeholder="Descripción (Opcional)"
                            value={description}
                            onChangeText={setDescription}
                        />

                        <View style={styles.modalButtons}>
                            <TouchableOpacity
                                style={[styles.modalBtn, styles.cancelBtn]}
                                onPress={() => setShowAddModal(false)}
                            >
                                <Text style={styles.cancelText}>Cancelar</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[styles.modalBtn, styles.saveBtn]}
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
        backgroundColor: '#F5F7FA',
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 20,
        backgroundColor: '#fff',
    },
    backButton: { padding: 5 },
    backText: { fontSize: 16, color: '#007AFF' },
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
    tab: { flex: 1, padding: 12, borderRadius: 10, alignItems: 'center' },
    activeTabDebt: { backgroundColor: '#FFF0F0', borderWidth: 1, borderColor: '#FF5252' },
    activeTabLoan: { backgroundColor: '#F0F9FF', borderWidth: 1, borderColor: '#2196F3' },
    tabText: { color: '#888', fontWeight: '600' },
    activeTabText: { color: '#333', fontWeight: 'bold' },

    listContent: { padding: 15 },
    card: {
        backgroundColor: '#fff',
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
    contactName: { fontSize: 16, fontWeight: 'bold', color: '#333' },
    transCount: { fontSize: 12, color: '#888' },
    totalAmount: { fontSize: 18, fontWeight: 'bold' },
    textDebt: { color: '#FF5252' },
    textLoan: { color: '#2196F3' },
    expandIcon: { fontSize: 12, color: '#ccc', marginTop: 5 },

    historyList: {
        backgroundColor: '#fafafa',
        borderTopWidth: 1,
        borderTopColor: '#eee',
        padding: 10,
    },
    transactionRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 10,
        borderBottomWidth: 1,
        borderBottomColor: '#eee',
    },
    date: { fontSize: 12, color: '#999', marginBottom: 2 },
    desc: { fontSize: 14, color: '#333' },
    transAmount: { fontSize: 15, fontWeight: 'bold', marginHorizontal: 10 },
    deleteBtn: { padding: 5 },
    deleteText: { fontSize: 16 },

    emptyText: { textAlign: 'center', marginTop: 30, color: '#aaa' },

    // Modal
    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' },
    modalContent: { backgroundColor: '#fff', width: '90%', padding: 20, borderRadius: 20 },
    modalTitle: { fontSize: 20, fontWeight: 'bold', marginBottom: 20, textAlign: 'center' },

    switchRow: { flexDirection: 'row', marginBottom: 15, borderWidth: 1, borderColor: '#eee', borderRadius: 8 },
    switchBtn: { flex: 1, padding: 10, alignItems: 'center' },
    switchActive: { backgroundColor: '#f0f0f0' },
    switchText: { color: '#888' },
    switchTextActive: { color: '#333', fontWeight: 'bold' },

    input: {
        borderWidth: 1, borderColor: '#eee', borderRadius: 8,
        padding: 12, marginBottom: 15, fontSize: 16
    },
    pickerContainer: {
        maxHeight: 150, borderWidth: 1, borderColor: '#eee', borderRadius: 8, marginBottom: 15, padding: 5
    },
    label: { fontSize: 12, color: '#888', marginBottom: 5, paddingLeft: 5 },
    contactOption: { padding: 10, borderBottomWidth: 1, borderBottomColor: '#f9f9f9' },
    contactOptionSelected: { backgroundColor: '#E3F2FD' },
    contactText: { color: '#333' },
    contactTextSelected: { color: '#1976D2', fontWeight: 'bold' },
    noContactText: { padding: 10, color: '#aaa', fontStyle: 'italic' },

    modalButtons: { flexDirection: 'row', gap: 10 },
    modalBtn: { flex: 1, padding: 15, borderRadius: 10, alignItems: 'center' },
    cancelBtn: { backgroundColor: '#f5f5f5' },
    saveBtn: { backgroundColor: '#2196F3' },
    cancelText: { color: '#333' },
    saveText: { color: '#fff', fontWeight: 'bold' },
});
