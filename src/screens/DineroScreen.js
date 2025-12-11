import React, { useState, useEffect } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    Modal,
    TextInput,
    Alert
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import db from '../services/db';

export default function DineroScreen({ user, onBack, onNavigate }) {
    const [balance, setBalance] = useState(0);
    const [showModal, setShowModal] = useState(false);
    const [editMode, setEditMode] = useState(false);
    const [inputBalance, setInputBalance] = useState('');

    useEffect(() => {
        loadBalance();
    }, []);

    const loadBalance = async () => {
        const result = await db.getUserBalance(user.id);
        if (result.success) {
            setBalance(result.balance);
            // Show modal if balance is 0 (assuming first time or empty)
            // You can adjust this logic if 0 is a valid state to not show modal
            if (result.balance === 0) {
                setShowModal(true);
            }
        }
    };

    const handleUpdateBalance = async () => {
        const amount = parseFloat(inputBalance);
        if (isNaN(amount)) {
            Alert.alert('Error', 'Por favor ingresa un número válido');
            return;
        }

        const result = await db.updateUserBalance(user.id, amount);
        if (result.success) {
            setBalance(amount);
            setShowModal(false);
            setEditMode(false);
            setInputBalance('');
        } else {
            Alert.alert('Error', 'No se pudo actualizar el saldo');
        }
    };

    return (
        <SafeAreaView style={styles.container}>
            <StatusBar style="dark" />

            {/* Header */}
            <View style={styles.header}>
                <TouchableOpacity onPress={onBack} style={styles.backButton}>
                    <Text style={styles.backText}>← Volver</Text>
                </TouchableOpacity>
                <Text style={styles.title}>Mi Dinero</Text>
                <View style={{ width: 60 }} />
            </View>

            <View style={styles.content}>
                {/* Balance Card */}
                <View style={styles.balanceCard}>
                    <Text style={styles.balanceLabel}>Dinero Actual</Text>
                    <Text style={styles.balanceAmount}>${balance.toFixed(2)}</Text>
                    <TouchableOpacity
                        style={styles.editButton}
                        onPress={() => {
                            setInputBalance(balance.toString());
                            setEditMode(true);
                        }}
                    >
                        <Text style={styles.editButtonText}>Editar</Text>
                    </TouchableOpacity>
                </View>

                {/* Modules */}
                <TouchableOpacity
                    style={styles.moduleButton}
                    onPress={() => onNavigate('DEUDAS_PRESTAMOS')}
                >
                    <Text style={styles.icon}>💸</Text>
                    <View>
                        <Text style={styles.moduleTitle}>Deudas y Préstamos</Text>
                        <Text style={styles.moduleSub}>Gestionar lo que debo y me deben</Text>
                    </View>
                    <Text style={styles.arrow}>›</Text>
                </TouchableOpacity>
            </View>

            {/* Modal for Balance Input */}
            <Modal
                visible={showModal || editMode}
                transparent={true}
                animationType="slide"
            >
                <View style={styles.modalOverlay}>
                    <View style={styles.modalContent}>
                        <Text style={styles.modalTitle}>
                            {editMode ? 'Editar Dinero Actual' : '¡Bienvenido!'}
                        </Text>
                        <Text style={styles.modalSub}>
                            {editMode ? 'Ingresa el nuevo monto:' : '¿Cuánto dinero tienes actualmente?'}
                        </Text>

                        <TextInput
                            style={styles.input}
                            placeholder="0.00"
                            keyboardType="numeric"
                            value={inputBalance}
                            onChangeText={setInputBalance}
                            autoFocus
                        />

                        <View style={styles.modalButtons}>
                            {editMode && (
                                <TouchableOpacity
                                    style={[styles.modalBtn, styles.cancelBtn]}
                                    onPress={() => setEditMode(false)}
                                >
                                    <Text style={styles.cancelText}>Cancelar</Text>
                                </TouchableOpacity>
                            )}
                            <TouchableOpacity
                                style={[styles.modalBtn, styles.saveBtn]}
                                onPress={handleUpdateBalance}
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
    backButton: {
        padding: 10,
    },
    backText: {
        fontSize: 16,
        color: '#007AFF',
    },
    title: {
        fontSize: 18,
        fontWeight: 'bold',
    },
    content: {
        padding: 20,
    },
    balanceCard: {
        backgroundColor: '#fff',
        borderRadius: 20,
        padding: 30,
        alignItems: 'center',
        marginBottom: 30,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.05,
        shadowRadius: 10,
        elevation: 3,
    },
    balanceLabel: {
        fontSize: 16,
        color: '#888',
        marginBottom: 10,
    },
    balanceAmount: {
        fontSize: 42,
        fontWeight: 'bold',
        color: '#333',
        marginBottom: 20,
    },
    editButton: {
        backgroundColor: '#E3F2FD',
        paddingHorizontal: 20,
        paddingVertical: 8,
        borderRadius: 20,
    },
    editButtonText: {
        color: '#1976D2',
        fontWeight: '600',
    },
    moduleButton: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#fff',
        padding: 20,
        borderRadius: 15,
        marginBottom: 15,
        elevation: 2,
    },
    icon: {
        fontSize: 30,
        marginRight: 15,
    },
    moduleTitle: {
        fontSize: 16,
        fontWeight: 'bold',
        color: '#333',
    },
    moduleSub: {
        fontSize: 12,
        color: '#888',
    },
    arrow: {
        marginLeft: 'auto',
        fontSize: 24,
        color: '#ccc',
    },
    // Modal Styles
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.5)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    modalContent: {
        backgroundColor: '#fff',
        width: '85%',
        padding: 25,
        borderRadius: 20,
        alignItems: 'center',
    },
    modalTitle: {
        fontSize: 20,
        fontWeight: 'bold',
        marginBottom: 10,
    },
    modalSub: {
        color: '#666',
        marginBottom: 20,
    },
    input: {
        width: '100%',
        padding: 15,
        borderWidth: 1,
        borderColor: '#ddd',
        borderRadius: 10,
        fontSize: 18,
        textAlign: 'center',
        marginBottom: 20,
    },
    modalButtons: {
        flexDirection: 'row',
        width: '100%',
        justifyContent: 'space-between',
        gap: 10,
    },
    modalBtn: {
        flex: 1,
        padding: 15,
        borderRadius: 10,
        alignItems: 'center',
    },
    cancelBtn: {
        backgroundColor: '#f5f5f5',
    },
    saveBtn: {
        backgroundColor: '#4CAF50',
    },
    saveText: {
        color: '#fff',
        fontWeight: 'bold',
    },
    cancelText: {
        color: '#333',
    },
});
