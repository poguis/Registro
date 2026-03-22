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
    KeyboardAvoidingView,
    Platform
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useTheme } from '../contexts/ThemeContext';
import db from '../services/db';

export default function CardsScreen({ user, onBack }) {
    const { theme, isDarkMode } = useTheme();
    const [cards, setCards] = useState([]);
    
    // Modal state
    const [showModal, setShowModal] = useState(false);
    const [editMode, setEditMode] = useState(false);
    const [editingId, setEditingId] = useState(null);

    // Form state
    const [cardType, setCardType] = useState('debit'); // 'debit' | 'credit'
    const [cardName, setCardName] = useState('');
    const [cutoffDate, setCutoffDate] = useState('');
    const [paymentDueDate, setPaymentDueDate] = useState('');
    const [limitAmount, setLimitAmount] = useState('');
    const [noLimit, setNoLimit] = useState(false);

    useEffect(() => {
        loadCards();
    }, []);

    const loadCards = async () => {
        const result = await db.getCards(user.id);
        if (result.success) {
            setCards(result.cards);
        }
    };

    const openAddModal = (type) => {
        setCardType(type);
        setCardName('');
        setCutoffDate('');
        setPaymentDueDate('');
        setLimitAmount('');
        setNoLimit(false);
        setEditMode(false);
        setEditingId(null);
        setShowModal(true);
    };

    const openEditModal = (card) => {
        setCardType(card.type);
        setCardName(card.name);
        setCutoffDate(card.cutoff_date ? card.cutoff_date.toString() : '');
        setPaymentDueDate(card.payment_due_date ? card.payment_due_date.toString() : '');
        
        if (card.type === 'credit') {
            if (card.limit_amount === null) {
                setNoLimit(true);
                setLimitAmount('');
            } else {
                setNoLimit(false);
                setLimitAmount(card.limit_amount.toString());
            }
        }
        
        setEditMode(true);
        setEditingId(card.id);
        setShowModal(true);
    };

    const handleSave = async () => {
        if (!cardName.trim()) {
            Alert.alert('Error', 'El nombre es obligatorio');
            return;
        }

        let data = {
            name: cardName.trim(),
            type: cardType,
        };

        if (cardType === 'credit') {
            const cutDate = parseInt(cutoffDate);
            const payDate = parseInt(paymentDueDate);
            
            if (isNaN(cutDate) || cutDate < 1 || cutDate > 31) {
                Alert.alert('Error', 'Día de corte inválido (1-31)');
                return;
            }
            if (isNaN(payDate) || payDate < 1 || payDate > 31) {
                Alert.alert('Error', 'Día límite de pago inválido (1-31)');
                return;
            }
            
            data.cutoff_date = cutDate;
            data.payment_due_date = payDate;
            
            if (noLimit) {
                data.limit_amount = null;
            } else {
                const limit = parseFloat(limitAmount);
                if (isNaN(limit) || limit < 0) {
                    Alert.alert('Error', 'Límite de crédito inválido');
                    return;
                }
                data.limit_amount = limit;
            }
        } else {
            // Ensure nulls for debit
            data.cutoff_date = null;
            data.payment_due_date = null;
            data.limit_amount = null;
        }

        let result;
        if (editMode) {
            result = await db.updateCard(editingId, data);
        } else {
            result = await db.addCard(user.id, data);
        }

        if (result.success) {
            setShowModal(false);
            loadCards();
        } else {
            Alert.alert('Error', result.error || 'No se pudo guardar la tarjeta');
        }
    };

    const handleDelete = (id) => {
        Alert.alert(
            'Eliminar Tarjeta',
            '¿Estás seguro de que deseas eliminar esta tarjeta?',
            [
                { text: 'Cancelar', style: 'cancel' },
                {
                    text: 'Eliminar',
                    style: 'destructive',
                    onPress: async () => {
                        const res = await db.deleteCard(id);
                        if (res.success) loadCards();
                    }
                }
            ]
        );
    };

    const renderCard = (card) => {
        const isCredit = card.type === 'credit';
        const cardColor = isCredit ? (isDarkMode ? '#311b92' : '#E8EAF6') : (isDarkMode ? '#004d40' : '#E0F2F1');
        const borderColor = isCredit ? '#3f51b5' : '#009688';
        const icon = isCredit ? '💳' : '🏦';

        return (
            <TouchableOpacity 
                key={card.id} 
                style={[styles.cardContainer, { backgroundColor: cardColor, borderColor: borderColor, borderWidth: 1 }]}
                onPress={() => openEditModal(card)}
                onLongPress={() => handleDelete(card.id)}
            >
                <View style={styles.cardHeader}>
                    <Text style={[styles.cardName, { color: isDarkMode ? '#fff' : '#000' }]}>{icon} {card.name}</Text>
                    <View style={[styles.typeBadge, { backgroundColor: borderColor }]}>
                        <Text style={styles.typeText}>{isCredit ? 'CRÉDITO' : 'DÉBITO'}</Text>
                    </View>
                </View>

                {isCredit && (
                    <View style={styles.creditDetails}>
                        <View style={styles.detailRow}>
                            <Text style={[styles.detailLabel, { color: isDarkMode ? '#b3e5fc' : '#5c6bc0' }]}>Día de corte:</Text>
                            <Text style={[styles.detailValue, { color: isDarkMode ? '#fff' : '#000' }]}>{card.cutoff_date}</Text>
                        </View>
                        <View style={styles.detailRow}>
                            <Text style={[styles.detailLabel, { color: isDarkMode ? '#b3e5fc' : '#5c6bc0' }]}>Día de pago:</Text>
                            <Text style={[styles.detailValue, { color: isDarkMode ? '#fff' : '#000' }]}>{card.payment_due_date}</Text>
                        </View>
                        <View style={styles.detailRow}>
                            <Text style={[styles.detailLabel, { color: isDarkMode ? '#b3e5fc' : '#5c6bc0' }]}>Límite:</Text>
                            <Text style={[styles.detailValue, { color: isDarkMode ? '#fff' : '#000', fontWeight: 'bold' }]}>
                                {card.limit_amount === null ? 'Sin Límite' : `$${card.limit_amount.toFixed(2)}`}
                            </Text>
                        </View>
                    </View>
                )}
            </TouchableOpacity>
        );
    };

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
            <StatusBar style={isDarkMode ? "light" : "dark"} />

            <View style={[styles.header, { backgroundColor: theme.header, borderBottomColor: theme.border }]}>
                <TouchableOpacity onPress={onBack} style={styles.backButton}>
                    <Text style={{ fontSize: 24, color: theme.text }}>←</Text>
                </TouchableOpacity>
                <Text style={[styles.headerTitle, { color: theme.text }]}>Mis Tarjetas</Text>
                <View style={{ width: 24 }} />
            </View>

            <View style={styles.actionStrip}>
                <TouchableOpacity 
                    style={[styles.actionBtn, { backgroundColor: isDarkMode ? '#004d40' : '#E0F2F1', borderColor: '#009688', borderWidth: 1 }]} 
                    onPress={() => openAddModal('debit')}
                >
                    <Text style={{ color: isDarkMode ? '#fff' : '#00695c', fontWeight: 'bold' }}>+ Nueva Débito</Text>
                </TouchableOpacity>
                <TouchableOpacity 
                    style={[styles.actionBtn, { backgroundColor: isDarkMode ? '#311b92' : '#E8EAF6', borderColor: '#3f51b5', borderWidth: 1 }]} 
                    onPress={() => openAddModal('credit')}
                >
                    <Text style={{ color: isDarkMode ? '#fff' : '#283593', fontWeight: 'bold' }}>+ Nueva Crédito</Text>
                </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={styles.listContainer}>
                {cards.length === 0 ? (
                    <Text style={[styles.emptyText, { color: theme.subText }]}>No tienes tarjetas registradas.</Text>
                ) : (
                    cards.map(renderCard)
                )}
            </ScrollView>

            <Modal visible={showModal} transparent animationType="slide" onRequestClose={() => setShowModal(false)}>
                <View style={[styles.overlay, { backgroundColor: theme.modalOverlay }]}>
                    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={[styles.modalContent, { backgroundColor: theme.card }]}>
                        <Text style={[styles.modalTitle, { color: theme.text }]}>
                            {editMode ? 'Editar Tarjeta' : `Añadir Tarjeta de ${cardType === 'credit' ? 'Crédito' : 'Débito'}`}
                        </Text>

                        <Text style={[styles.label, { color: theme.subText }]}>Nombre (Ej. Banco / Color):</Text>
                        <TextInput
                            style={[styles.input, { backgroundColor: theme.inputBackground, color: theme.text, borderColor: theme.border }]}
                            placeholder="Nombre de la tarjeta"
                            placeholderTextColor={theme.subText}
                            value={cardName}
                            onChangeText={setCardName}
                        />

                        {cardType === 'credit' && (
                            <>
                                <View style={styles.rowInputs}>
                                    <View style={{ flex: 1, marginRight: 5 }}>
                                        <Text style={[styles.label, { color: theme.subText }]}>Día de corte:</Text>
                                        <TextInput
                                            style={[styles.input, { backgroundColor: theme.inputBackground, color: theme.text, borderColor: theme.border }]}
                                            placeholder="1-31"
                                            placeholderTextColor={theme.subText}
                                            keyboardType="numeric"
                                            maxLength={2}
                                            value={cutoffDate}
                                            onChangeText={setCutoffDate}
                                        />
                                    </View>
                                    <View style={{ flex: 1, marginLeft: 5 }}>
                                        <Text style={[styles.label, { color: theme.subText }]}>Día pago:</Text>
                                        <TextInput
                                            style={[styles.input, { backgroundColor: theme.inputBackground, color: theme.text, borderColor: theme.border }]}
                                            placeholder="1-31"
                                            placeholderTextColor={theme.subText}
                                            keyboardType="numeric"
                                            maxLength={2}
                                            value={paymentDueDate}
                                            onChangeText={setPaymentDueDate}
                                        />
                                    </View>
                                </View>

                                <Text style={[styles.label, { color: theme.subText, marginTop: 10 }]}>Límite de Crédito:</Text>
                                <View style={styles.limitContainer}>
                                    <TextInput
                                        style={[styles.input, { flex: 1, backgroundColor: noLimit ? (isDarkMode ? '#333' : '#e0e0e0') : theme.inputBackground, color: theme.text, borderColor: theme.border }]}
                                        placeholder="Monto ($)"
                                        placeholderTextColor={theme.subText}
                                        keyboardType="numeric"
                                        value={limitAmount}
                                        onChangeText={setLimitAmount}
                                        editable={!noLimit}
                                    />
                                    <TouchableOpacity 
                                        style={[styles.noLimitBtn, noLimit ? { backgroundColor: theme.accent } : { backgroundColor: theme.inputBackground, borderColor: theme.border, borderWidth: 1 }]}
                                        onPress={() => setNoLimit(!noLimit)}
                                    >
                                        <Text style={{ color: noLimit ? '#fff' : theme.text, fontSize: 12 }}>Sin Límite</Text>
                                    </TouchableOpacity>
                                </View>
                            </>
                        )}

                        <View style={styles.btnsRow}>
                            <TouchableOpacity style={[styles.cancelBtn, { backgroundColor: theme.inputBackground }]} onPress={() => setShowModal(false)}>
                                <Text style={{ color: theme.text }}>Cancelar</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={[styles.saveBtn, { backgroundColor: theme.accent }]} onPress={handleSave}>
                                <Text style={{ color: '#fff', fontWeight: 'bold' }}>Guardar</Text>
                            </TouchableOpacity>
                        </View>
                    </KeyboardAvoidingView>
                </View>
            </Modal>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 15,
        paddingVertical: 15,
        borderBottomWidth: 1,
    },
    backButton: { padding: 5 },
    headerTitle: { fontSize: 20, fontWeight: 'bold' },
    actionStrip: {
        flexDirection: 'row',
        padding: 15,
        gap: 10,
    },
    actionBtn: {
        flex: 1,
        paddingVertical: 12,
        borderRadius: 10,
        alignItems: 'center',
        justifyContent: 'center',
    },
    listContainer: {
        paddingHorizontal: 15,
        paddingBottom: 30,
    },
    emptyText: {
        textAlign: 'center',
        marginTop: 40,
        fontStyle: 'italic',
    },
    cardContainer: {
        padding: 15,
        borderRadius: 15,
        marginBottom: 15,
        elevation: 2,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
    },
    cardHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    cardName: {
        fontSize: 18,
        fontWeight: 'bold',
    },
    typeBadge: {
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 5,
    },
    typeText: {
        color: '#fff',
        fontSize: 10,
        fontWeight: 'bold',
    },
    creditDetails: {
        marginTop: 15,
        paddingTop: 15,
        borderTopWidth: 1,
        borderTopColor: 'rgba(0,0,0,0.1)',
        gap: 8,
    },
    detailRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
    },
    detailLabel: {
        fontSize: 14,
    },
    detailValue: {
        fontSize: 14,
    },
    overlay: {
        flex: 1,
        justifyContent: 'flex-end',
    },
    modalContent: {
        padding: 20,
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        minHeight: 300,
    },
    modalTitle: {
        fontSize: 18,
        fontWeight: 'bold',
        marginBottom: 15,
        textAlign: 'center',
    },
    label: {
        fontSize: 14,
        marginBottom: 5,
        marginTop: 10,
    },
    input: {
        borderWidth: 1,
        borderRadius: 8,
        padding: 12,
        fontSize: 16,
    },
    rowInputs: {
        flexDirection: 'row',
        justifyContent: 'space-between',
    },
    limitContainer: {
        flexDirection: 'row',
        gap: 10,
    },
    noLimitBtn: {
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 15,
        borderRadius: 8,
    },
    btnsRow: {
        flexDirection: 'row',
        marginTop: 25,
        gap: 15,
    },
    cancelBtn: {
        flex: 1,
        padding: 15,
        borderRadius: 10,
        alignItems: 'center',
    },
    saveBtn: {
        flex: 1,
        padding: 15,
        borderRadius: 10,
        alignItems: 'center',
    },
});
