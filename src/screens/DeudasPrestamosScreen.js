import React, { useState, useEffect, useMemo } from 'react';
import { View, StyleSheet, TouchableOpacity, ScrollView, KeyboardAvoidingView, Platform, FlatList, Modal } from 'react-native';
import { useSheet } from '../hooks/useSheet';
import { Text, TextInput } from '../components/AppText';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme, FONT, RADIUS } from '../contexts/ThemeContext';
import db from '../services/db';
import { useSyncRefresh } from '../sync/useSyncRefresh';
import { parseDbTimestamp } from '../services/dateRange';

export default function DeudasPrestamosScreen({ user, onBack }) {
    const { theme } = useTheme();
    const styles = useMemo(() => makeStyles(theme), [theme]);
    const { confirm, informar } = useSheet();
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
    // Recarga si la sync trae cambios del servidor (sin tocar formularios, filtros ni scroll).
    useSyncRefresh(() => loadData());

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
            informar('Error', 'La cantidad es obligatoria');
            return;
        }

        let finalName = contactName;
        let finalId = selectedContactId;

        if (isNewContact) {
            if (!contactName.trim()) {
                informar('Error', 'El nombre es obligatorio');
                return;
            }
            finalId = null; // Let DB create it
        } else {
            if (!selectedContactId) {
                informar('Error', 'Selecciona una persona');
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
            informar('Error', result.error);
        }
    };

    const handleDelete = async (transactionId) => {
        const clave = await confirm({
            titulo: 'Confirmar',
            mensaje: '¿Estás seguro de eliminar este registro?',
            acciones: [
                { clave: 'cancelar', texto: 'Cancelar', variante: 'cancelar' },
                { clave: 'eliminar', texto: 'Eliminar', variante: 'destructiva' },
            ],
        });
        if (clave !== 'eliminar') return;
        await db.deleteTransaction(transactionId);
        loadData();
    };

    const renderContactCard = ({ item }) => {
        const isExpanded = expandedContactId === item.id;

        return (
            <View style={[styles.card, { backgroundColor: theme.surface }]}>
                <TouchableOpacity
                    style={styles.cardHeader}
                    onPress={() => setExpandedContactId(isExpanded ? null : item.id)}
                    activeOpacity={0.7}
                >
                    <View style={{ flex: 1, minWidth: 0, marginRight: 10 }}>
                        <Text style={[styles.contactName, { color: theme.ink }]} numberOfLines={2} ellipsizeMode="tail">{item.name}</Text>
                        <Text style={[styles.transCount, { color: theme.muted }]} numberOfLines={1}>
                            {item.transactions.length} registros
                        </Text>
                    </View>
                    <View style={{ alignItems: 'flex-end', flexShrink: 0 }}>
                        <Text style={[
                            styles.totalAmount,
                            activeTab === 'deudas' ? styles.textDebt : styles.textLoan
                        ]}>
                            ${item.total.toFixed(2)}
                        </Text>
                        <Text style={[styles.expandIcon, { color: theme.muted }]}>{isExpanded ? '▲' : '▼'}</Text>
                    </View>
                </TouchableOpacity>

                {isExpanded && (
                    <View style={[styles.historyList, { backgroundColor: theme.raised, borderTopColor: theme.line }]}>
                        {item.transactions.map((t) => (
                            <View key={t.id} style={[styles.transactionRow, { borderBottomColor: theme.line }]}>
                                <View style={{ flex: 1, minWidth: 0 }}>
                                    <Text style={[styles.date, { color: theme.muted }]} numberOfLines={1}>
                                        {parseDbTimestamp(t.created_at).toLocaleDateString('es-ES', { timeZone: 'America/Guayaquil' })} • {parseDbTimestamp(t.created_at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'America/Guayaquil' })}
                                    </Text>
                                    {t.description ? (
                                        <Text style={[styles.desc, { color: theme.ink }]} numberOfLines={2} ellipsizeMode="tail">{t.description}</Text>
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
        <SafeAreaView style={[styles.container, { backgroundColor: theme.bg }]}>

            {/* Header */}
            <View style={[styles.header, { backgroundColor: theme.surface, borderBottomWidth: 1, borderBottomColor: theme.line }]}>
                <TouchableOpacity onPress={onBack} style={styles.backButton}>
                    <Text style={[styles.backText, { color: theme.accent }]}>← Volver</Text>
                </TouchableOpacity>
                <Text style={[styles.title, { color: theme.ink }]} numberOfLines={1}>Deudas y Préstamos</Text>
                <TouchableOpacity onPress={handleAddStart} style={styles.addButton}>
                    <Text style={styles.addBtnText}>+</Text>
                </TouchableOpacity>
            </View>

            {/* Tabs */}
            <View style={styles.tabs}>
                <TouchableOpacity
                    style={[
                        styles.tab,
                        activeTab === 'deudas' && styles.activeTabDebt
                    ]}
                    onPress={() => setActiveTab('deudas')}
                >
                    <Text style={[styles.tabText, activeTab === 'deudas' && { color: theme.ink, fontFamily: FONT.bold }]}>
                        Préstamos
                    </Text>
                </TouchableOpacity>
                <TouchableOpacity
                    style={[
                        styles.tab,
                        activeTab === 'prestamos' && styles.activeTabLoan
                    ]}
                    onPress={() => setActiveTab('prestamos')}
                >
                    <Text style={[styles.tabText, activeTab === 'prestamos' && { color: theme.ink, fontFamily: FONT.bold }]}>
                        Me deben
                    </Text>
                </TouchableOpacity>
            </View>

            <FlatList
                data={data}
                renderItem={renderContactCard}
                keyExtractor={item => item.id.toString()}
                contentContainerStyle={styles.listContent}
                ListEmptyComponent={
                    <Text style={[styles.emptyText, { color: theme.muted }]}>No hay registros aún.</Text>
                }
            />

            {/* Add Transaction Modal */}
            <Modal
                visible={showAddModal}
                animationType="slide"
                transparent={true}
                onRequestClose={() => setShowAddModal(false)}
            >
                <View style={[styles.modalOverlay, { backgroundColor: theme.overlay }]}>
                    <View style={[styles.modalContent, { backgroundColor: theme.surface }]}>
                        <Text style={[styles.modalTitle, { color: theme.ink }]} numberOfLines={1}>
                            Agregar {activeTab === 'deudas' ? 'Préstamo' : 'Deuda'}
                        </Text>

                        {/* Contact Selector */}
                        <View style={[styles.switchRow, { borderColor: theme.lineStrong, backgroundColor: theme.raised }]}>
                            <TouchableOpacity
                                style={[
                                    styles.switchBtn,
                                    !isNewContact ? { backgroundColor: theme.accent } : null
                                ]}
                                onPress={() => setIsNewContact(false)}
                            >
                                <Text style={[
                                    styles.switchText,
                                    { color: !isNewContact ? theme.onAccent : theme.muted, fontFamily: !isNewContact ? FONT.bold : FONT.regular }
                                ]}>Existente</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[
                                    styles.switchBtn,
                                    isNewContact ? { backgroundColor: theme.accent } : null
                                ]}
                                onPress={() => setIsNewContact(true)}
                            >
                                <Text style={[
                                    styles.switchText,
                                    { color: isNewContact ? theme.onAccent : theme.muted, fontFamily: isNewContact ? FONT.bold : FONT.regular }
                                ]}>Nuevo</Text>
                            </TouchableOpacity>
                        </View>

                        {isNewContact ? (
                            <TextInput
                                style={[styles.input, { backgroundColor: theme.raised, color: theme.ink, borderColor: theme.lineStrong }]}
                                placeholder="Nombre Persona"
                                placeholderTextColor={theme.muted}
                                value={contactName}
                                onChangeText={setContactName}
                            />
                        ) : (
                            <View style={[styles.pickerContainer, { borderColor: theme.lineStrong }]}>
                                <Text style={[styles.label, { color: theme.muted }]}>Selecciona Persona:</Text>
                                <ScrollView style={{ maxHeight: 100 }}>
                                    {data.length === 0 ? (
                                        <Text style={[styles.noContactText, { color: theme.muted }]}>No hay personas registradas.</Text>
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
                                                <Text style={[
                                                    styles.contactText,
                                                    { color: theme.ink },
                                                    selectedContactId === c.id && { fontFamily: FONT.bold, color: theme.accent }
                                                ]} numberOfLines={1} ellipsizeMode="tail">
                                                    {c.name}
                                                </Text>
                                            </TouchableOpacity>
                                        ))
                                    )}
                                </ScrollView>
                            </View>
                        )}

                        <TextInput
                            style={[styles.input, { backgroundColor: theme.raised, color: theme.ink, borderColor: theme.lineStrong }]}
                            placeholder="Cantidad ($)"
                            placeholderTextColor={theme.muted}
                            keyboardType="numeric"
                            value={amount}
                            onChangeText={setAmount}
                        />

                        <TextInput
                            style={[styles.input, { backgroundColor: theme.raised, color: theme.ink, borderColor: theme.lineStrong }]}
                            placeholder="Descripción (Opcional)"
                            placeholderTextColor={theme.muted}
                            value={description}
                            onChangeText={setDescription}
                        />

                        <View style={styles.modalButtons}>
                            <TouchableOpacity
                                style={[styles.modalBtn, styles.cancelBtn, { backgroundColor: theme.raised }]}
                                onPress={() => setShowAddModal(false)}
                            >
                                <Text style={[styles.cancelText, { color: theme.ink }]}>Cancelar</Text>
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

// Estilos en función del tema (dirección visual): ningún color fijo.
const makeStyles = (t) => StyleSheet.create({
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
    title: { fontSize: 18, fontFamily: FONT.bold, flex: 1, minWidth: 0, textAlign: 'center', marginHorizontal: 8 },
    addButton: {
        backgroundColor: t.accent,
        width: 30, height: 30,
        borderRadius: 15,
        alignItems: 'center',
        justifyContent: 'center'
    },
    addBtnText: { color: t.onAccent, fontSize: 20, fontFamily: FONT.bold, marginTop: -2 },

    tabs: { flexDirection: 'row', padding: 15, gap: 10 },
    tab: { flex: 1, padding: 12, borderRadius: RADIUS.sm, alignItems: 'center', borderWidth: 1, borderColor: t.lineStrong },
    // Lo que debo = tono rojo; lo que me deben = tono azul.
    activeTabDebt: { backgroundColor: t.tones.rojo.bg, borderColor: t.tones.rojo.fg },
    activeTabLoan: { backgroundColor: t.tones.azul.bg, borderColor: t.tones.azul.fg },
    tabText: { color: t.muted },

    listContent: { padding: 15 },
    card: {
        borderRadius: RADIUS.base,
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
    contactName: { fontSize: 16, fontFamily: FONT.bold },
    transCount: { fontSize: 12 },
    totalAmount: { fontSize: 18, fontFamily: FONT.bold },
    textDebt: { color: t.tones.rojo.fg },
    textLoan: { color: t.tones.azul.fg },
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
    transAmount: { fontSize: 15, fontFamily: FONT.bold, marginHorizontal: 10, flexShrink: 0 },
    deleteBtn: { padding: 5, flexShrink: 0 },
    deleteText: { fontSize: 16 },

    emptyText: { textAlign: 'center', marginTop: 30 },

    modalOverlay: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    modalContent: { width: '90%', padding: 20, borderRadius: RADIUS.base },
    modalTitle: { fontSize: 20, fontFamily: FONT.bold, marginBottom: 20, textAlign: 'center' },

    switchRow: { flexDirection: 'row', marginBottom: 15, borderWidth: 1, borderRadius: RADIUS.sm, overflow: 'hidden' },
    switchBtn: { flex: 1, padding: 10, alignItems: 'center' },
    switchText: { color: t.muted },

    input: {
        borderWidth: 1, borderRadius: RADIUS.sm,
        padding: 12, marginBottom: 15, fontSize: 16
    },
    pickerContainer: {
        maxHeight: 150, borderWidth: 1, borderRadius: RADIUS.sm, marginBottom: 15, padding: 5
    },
    label: { fontSize: 12, marginBottom: 5, paddingLeft: 5 },
    contactOption: { padding: 10, borderBottomWidth: 1, borderBottomColor: t.line },
    contactOptionSelected: { backgroundColor: t.soft },
    contactText: { color: t.ink },
    noContactText: { padding: 10, fontStyle: 'italic' },

    modalButtons: { flexDirection: 'row', gap: 10 },
    modalBtn: { flex: 1, padding: 15, borderRadius: RADIUS.sm, alignItems: 'center', minHeight: 52, justifyContent: 'center' },
    cancelBtn: { backgroundColor: t.raised },
    saveBtn: { backgroundColor: t.accent },
    cancelText: { color: t.ink },
    saveText: { color: t.onAccent, fontFamily: FONT.bold },
});
