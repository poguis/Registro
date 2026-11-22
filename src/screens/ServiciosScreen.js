import React, { useState, useEffect, useMemo } from 'react';
import { View, StyleSheet, TouchableOpacity, Modal, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { useSheet } from '../hooks/useSheet';
import { Text, TextInput } from '../components/AppText';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme, FONT, RADIUS } from '../contexts/ThemeContext';
import db from '../services/db';
import { useSyncRefresh } from '../sync/useSyncRefresh';

export default function ServiciosScreen({ user, onBack }) {
    const { theme } = useTheme();
    const { confirm, informar } = useSheet();
    const [services, setServices] = useState([]);
    const [expandedSections, setExpandedSections] = useState({ 'Activos': true, 'Inactivos': false });
    
    // Modal state
    const [showModal, setShowModal] = useState(false);
    const [editMode, setEditMode] = useState(false);
    const [currentId, setCurrentId] = useState(null);
    
    // Form state
    const [formName, setFormName] = useState('');
    const [formType, setFormType] = useState('Local'); // 'Local' | 'Internacional'
    const [formStatus, setFormStatus] = useState('Activo'); // 'Activo' | 'Inactivo'
    const [formBase, setFormBase] = useState('');
    const [formExtra, setFormExtra] = useState('');

    useEffect(() => {
        loadServices();
    }, []);
    // Recarga si la sync trae cambios del servidor (sin tocar formularios, filtros ni scroll).
    useSyncRefresh(() => loadServices());

    const loadServices = async () => {
        const result = await db.getServices(user.id);
        if (result.success) {
            setServices(result.services);
        }
    };

    const toggleSection = (section) => {
        setExpandedSections(prev => ({
            ...prev,
            [section]: !prev[section]
        }));
    };

    const openModal = (service = null) => {
        if (service) {
            setEditMode(true);
            setCurrentId(service.id);
            setFormName(service.name);
            setFormType(service.type);
            setFormStatus(service.status);
            setFormBase(service.original_value.toString());
            setFormExtra(service.additional_value ? service.additional_value.toString() : '');
        } else {
            setEditMode(false);
            setCurrentId(null);
            setFormName('');
            setFormType('Local');
            setFormStatus('Activo');
            setFormBase('');
            setFormExtra('');
        }
        setShowModal(true);
    };

    const handleSave = async () => {
        if (!formName.trim()) { informar('Error', 'Debe ingresar un nombre'); return; }
        const baseVal = parseFloat(formBase);
        if (isNaN(baseVal) || baseVal < 0) { informar('Error', 'Valor base inválido'); return; }

        let extraVal = 0;
        let finalTotal = 0;

        if (formType === 'Internacional') {
            const iva = baseVal * 0.15;
            const isd = baseVal * 0.05;
            finalTotal = baseVal + iva + isd;
            extraVal = 0; // For international, extra is implicit in taxes
        } else {
            if (formExtra.trim()) {
                extraVal = parseFloat(formExtra);
                if (isNaN(extraVal) || extraVal < 0) { informar('Error', 'Valor extra inválido'); return; }
            }
            finalTotal = baseVal + extraVal;
        }

        const data = {
            name: formName.trim(),
            type: formType,
            status: formStatus,
            originalValue: baseVal,
            additionalValue: extraVal,
            totalValue: finalTotal
        };

        let result;
        if (editMode && currentId) {
            result = await db.updateService(currentId, data);
        } else {
            result = await db.addService(user.id, data);
        }

        if (result.success) {
            setShowModal(false);
            loadServices();
        } else {
            informar('Error', 'Hubo un problema al guardar el servicio');
        }
    };

    const handleDelete = async (id) => {
        const clave = await confirm({
            titulo: 'Eliminar',
            mensaje: '¿Seguro que deseas eliminar este servicio?',
            acciones: [
                { clave: 'cancelar', texto: 'Cancelar', variante: 'cancelar' },
                { clave: 'eliminar', texto: 'Eliminar', variante: 'destructiva' },
            ],
        });
        if (clave !== 'eliminar') return;
        const res = await db.deleteService(id);
        if (res.success) loadServices();
    };

    const toggleStatus = async (id, currentStatus) => {
        const res = await db.toggleServiceStatus(id, currentStatus);
        if (res.success) loadServices();
    };

    const activeServices = useMemo(() => services.filter(s => s.status === 'Activo'), [services]);
    const inactiveServices = useMemo(() => services.filter(s => s.status === 'Inactivo'), [services]);

    const activeTotal = useMemo(() => activeServices.reduce((sum, s) => sum + s.total_value, 0), [activeServices]);
    const inactiveTotal = useMemo(() => inactiveServices.reduce((sum, s) => sum + s.total_value, 0), [inactiveServices]);

    const renderService = (item) => (
        <View key={item.id} style={[styles.serviceCard, { backgroundColor: theme.surface, borderColor: theme.line }]}>
            <View style={styles.serviceHeader}>
                <View style={{ flex: 1, minWidth: 0, marginRight: 10 }}>
                    <Text style={[styles.serviceName, { color: theme.ink }]} numberOfLines={2} ellipsizeMode="tail">{item.name}</Text>
                    <Text style={[styles.serviceType, { color: theme.muted }]} numberOfLines={1}>{item.type}</Text>
                </View>
                <View style={{ alignItems: 'flex-end', flexShrink: 0 }}>
                    <Text style={[styles.serviceTotal, { color: theme.ink }]}>${item.total_value.toFixed(2)}</Text>
                    <Text style={[styles.serviceBase, { color: theme.muted }]} numberOfLines={1}>
                        {item.type === 'Internacional' 
                            ? `B: $${item.original_value.toFixed(2)} + $${(item.original_value * 0.15).toFixed(2)} + $${(item.original_value * 0.05).toFixed(2)}` 
                            : `B: $${item.original_value.toFixed(2)} + $${item.additional_value.toFixed(2)}`}
                    </Text>
                </View>
            </View>
            
            <View style={[styles.serviceActions, { borderTopColor: theme.line, backgroundColor: theme.raised }]}>
                <TouchableOpacity 
                    style={[styles.actionBtn, { backgroundColor: item.status === 'Activo' ? theme.soft : theme.surface }]}
                    onPress={() => toggleStatus(item.id, item.status)}
                >
                    <Text style={[{ fontSize: 13, fontFamily: FONT.bold }, { color: item.status === 'Activo' ? theme.accent : theme.muted }]}>
                        {item.status === 'Activo' ? 'Pagando' : 'Inactivo'}
                    </Text>
                </TouchableOpacity>
                <View style={{ flexDirection: 'row', gap: 10 }}>
                    <TouchableOpacity style={styles.iconBtn} onPress={() => openModal(item)}>
                        <Text style={{ fontSize: 16 }}>✏️</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.iconBtn} onPress={() => handleDelete(item.id)}>
                        <Text style={{ fontSize: 16 }}>🗑️</Text>
                    </TouchableOpacity>
                </View>
            </View>
        </View>
    );

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: theme.bg }]}>

            {/* Header */}
            <View style={[styles.header, { backgroundColor: theme.surface, borderBottomColor: theme.line }]}>
                <TouchableOpacity onPress={onBack}>
                    <Text style={{ fontSize: 24, color: theme.ink }}>←</Text>
                </TouchableOpacity>
                
                <View style={{ alignItems: 'center' }}>
                    <Text style={[styles.title, { color: theme.muted }]}>Fijos Mes</Text>
                    <Text style={[styles.totalHeader, { color: theme.ink }]}>${activeTotal.toFixed(2)}</Text>
                </View>

                <View style={{ width: 24 }} />
            </View>

            <ScrollView style={{ flex: 1, padding: 15 }}>
                
                {/* Activos Section */}
                <View style={{ marginBottom: 20 }}>
                    <TouchableOpacity 
                        style={[styles.sectionHeader, { backgroundColor: theme.raised }]}
                        onPress={() => toggleSection('Activos')}
                    >
                        <Text style={[styles.sectionTitle, { color: theme.ink }]}>
                            {expandedSections['Activos'] ? '▼' : '▶'} Activos
                        </Text>
                        <Text style={{ color: theme.accent, fontFamily: FONT.bold }}>${activeTotal.toFixed(2)}</Text>
                    </TouchableOpacity>
                    
                    {expandedSections['Activos'] && (
                        <View style={styles.sectionContent}>
                            {activeServices.length > 0 ? (
                                activeServices.map(renderService)
                            ) : (
                                <Text style={[styles.emptyText, { color: theme.muted }]}>No hay servicios activos</Text>
                            )}
                        </View>
                    )}
                </View>

                {/* Inactivos Section */}
                <View style={{ marginBottom: 20 }}>
                    <TouchableOpacity 
                        style={[styles.sectionHeader, { backgroundColor: theme.raised }]}
                        onPress={() => toggleSection('Inactivos')}
                    >
                        <Text style={[styles.sectionTitle, { color: theme.muted }]}>
                            {expandedSections['Inactivos'] ? '▼' : '▶'} Inactivos
                        </Text>
                    </TouchableOpacity>
                    
                    {expandedSections['Inactivos'] && (
                        <View style={styles.sectionContent}>
                            {inactiveServices.length > 0 ? (
                                inactiveServices.map(renderService)
                            ) : (
                                <Text style={[styles.emptyText, { color: theme.muted }]}>No hay servicios inactivos</Text>
                            )}
                        </View>
                    )}
                </View>

                <View style={{ height: 80 }} />
            </ScrollView>

            <View style={[styles.fabContainer, { backgroundColor: theme.bg }]}>
                <TouchableOpacity style={[styles.fab, { backgroundColor: theme.ink }]} onPress={() => openModal()}>
                    <Text style={[styles.fabIcon, { color: theme.bg }]}>+ Nuevo Servicio</Text>
                </TouchableOpacity>
            </View>

            {/* Modal */}
            <Modal visible={showModal} transparent animationType="slide" onRequestClose={() => setShowModal(false)}>
                <View style={[styles.overlay, { backgroundColor: theme.overlay }]}>
                    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={[styles.modalContent, { backgroundColor: theme.surface }]}>
                        <ScrollView showsVerticalScrollIndicator={false}>
                            <Text style={[styles.modalTitle, { color: theme.ink }]}>
                                {editMode ? 'Editar Servicio' : 'Nuevo Servicio'}
                            </Text>

                            <Text style={[styles.label, { color: theme.ink }]}>Nombre del servicio</Text>
                            <TextInput
                                style={[styles.input, { backgroundColor: theme.raised, color: theme.ink, borderColor: theme.lineStrong }]}
                                placeholder="Ej: Netflix, Internet, Luz"
                                placeholderTextColor={theme.muted}
                                value={formName}
                                onChangeText={setFormName}
                            />

                            <Text style={[styles.label, { color: theme.ink }]}>Tipo de cobro</Text>
                            <View style={styles.typeRow}>
                                <TouchableOpacity 
                                    style={[styles.typeBtn, formType === 'Local' ? { backgroundColor: theme.accent } : { backgroundColor: theme.raised }]}
                                    onPress={() => setFormType('Local')}
                                >
                                    <Text style={{ color: formType === 'Local' ? theme.onAccent : theme.ink, fontFamily: FONT.bold }}>Nacional</Text>
                                </TouchableOpacity>
                                <TouchableOpacity 
                                    style={[styles.typeBtn, formType === 'Internacional' ? { backgroundColor: theme.accent } : { backgroundColor: theme.raised }]}
                                    onPress={() => setFormType('Internacional')}
                                >
                                    <Text style={{ color: formType === 'Internacional' ? theme.onAccent : theme.ink, fontFamily: FONT.bold }}>Internacional</Text>
                                </TouchableOpacity>
                            </View>

                            <Text style={[styles.label, { color: theme.ink }]}>Estado</Text>
                            <View style={styles.typeRow}>
                                <TouchableOpacity 
                                    style={[styles.typeBtn, formStatus === 'Activo' ? { backgroundColor: theme.accent } : { backgroundColor: theme.raised }]}
                                    onPress={() => setFormStatus('Activo')}
                                >
                                    <Text style={{ color: formStatus === 'Activo' ? theme.onAccent : theme.ink, fontFamily: FONT.bold }}>Activo</Text>
                                </TouchableOpacity>
                                <TouchableOpacity 
                                    style={[styles.typeBtn, formStatus === 'Inactivo' ? { backgroundColor: theme.tones.pizarra.bg, borderWidth: 1, borderColor: theme.tones.pizarra.fg } : { backgroundColor: theme.raised }]}
                                    onPress={() => setFormStatus('Inactivo')}
                                >
                                    <Text style={{ color: formStatus === 'Inactivo' ? theme.tones.pizarra.fg : theme.ink, fontFamily: FONT.bold }}>Inactivo</Text>
                                </TouchableOpacity>
                            </View>

                            <Text style={[styles.label, { color: theme.ink }]}>Valor Original ($)</Text>
                            <TextInput
                                style={[styles.input, { backgroundColor: theme.raised, color: theme.ink, borderColor: theme.lineStrong }]}
                                placeholder="0.00"
                                placeholderTextColor={theme.muted}
                                keyboardType="numeric"
                                value={formBase}
                                onChangeText={setFormBase}
                            />

                            {formType === 'Local' && (
                                <>
                                    <Text style={[styles.label, { color: theme.ink }]}>Recargo o Valor Extra ($) - Opcional</Text>
                                    <TextInput
                                        style={[styles.input, { backgroundColor: theme.raised, color: theme.ink, borderColor: theme.lineStrong }]}
                                        placeholder="Ej: 0.31"
                                        placeholderTextColor={theme.muted}
                                        keyboardType="numeric"
                                        value={formExtra}
                                        onChangeText={setFormExtra}
                                    />
                                </>
                            )}

                            {formType === 'Internacional' && (
                                <View style={[styles.infoBox, { backgroundColor: theme.soft, borderColor: theme.line }]}>
                                    <Text style={{ color: theme.muted, fontSize: 13, textAlign: 'center' }}>
                                        Se calculará automáticamente:{"\n"}
                                        + 15% IVA{"\n"}
                                        + 5% ISD
                                    </Text>
                                </View>
                            )}

                            <View style={[styles.calculatePreview, { backgroundColor: theme.raised }]}>
                                <Text style={{ color: theme.muted }}>Total aproximado a pagar:</Text>
                                {(() => {
                                    const bv = parseFloat(formBase) || 0;
                                    let t = 0;
                                    if(formType === 'Internacional') {
                                        t = bv + (bv * 0.15) + (bv * 0.05);
                                    } else {
                                        t = bv + (parseFloat(formExtra) || 0);
                                    }
                                    return <Text style={[styles.previewTotal, { color: theme.ink }]}>${t.toFixed(2)}</Text>;
                                })()}
                            </View>

                            <View style={styles.btnsRow}>
                                <TouchableOpacity style={[styles.cancelBtn, { backgroundColor: theme.raised }]} onPress={() => setShowModal(false)}>
                                    <Text style={{ color: theme.ink, fontFamily: FONT.bold }}>Cancelar</Text>
                                </TouchableOpacity>
                                <TouchableOpacity style={[styles.saveBtn, { backgroundColor: theme.accent }]} onPress={handleSave}>
                                    <Text style={{ color: theme.onAccent, fontFamily: FONT.bold }}>Guardar</Text>
                                </TouchableOpacity>
                            </View>
                        </ScrollView>
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
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 20,
        paddingBottom: 15,
        paddingTop: 10,
        borderBottomWidth: 1,
    },
    title: { fontSize: 13, fontFamily: FONT.semibold, textTransform: 'uppercase' },
    totalHeader: { fontSize: 26, fontFamily: FONT.bold },
    sectionHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        padding: 15,
        borderRadius: RADIUS.sm,
        alignItems: 'center'
    },
    sectionTitle: { fontSize: 16, fontFamily: FONT.bold },
    sectionContent: { paddingTop: 10 },
    emptyText: { textAlign: 'center', padding: 20, fontStyle: 'italic' },
    serviceCard: {
        borderWidth: 1,
        borderRadius: RADIUS.base,
        marginBottom: 10,
        overflow: 'hidden'
    },
    serviceHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        padding: 15,
        paddingBottom: 10
    },
    serviceName: { fontSize: 18, fontFamily: FONT.bold, marginBottom: 4 },
    serviceType: { fontSize: 12 },
    serviceTotal: { fontSize: 18, fontFamily: FONT.bold, marginBottom: 4 },
    serviceBase: { fontSize: 11 },
    serviceActions: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 10,
        borderTopWidth: 1,
    },
    actionBtn: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: RADIUS.sm, flexShrink: 0 },
    iconBtn: { padding: 6 },
    fabContainer: {
        position: 'absolute',
        bottom: 0, left: 0, right: 0,
        padding: 15,
        paddingBottom: Platform.OS === 'ios' ? 25 : 15,
        borderTopWidth: 1,
        borderTopColor: 'transparent'
    },
    fab: {
        padding: 16,
        minHeight: 52,
        borderRadius: RADIUS.sm,
        alignItems: 'center',
        justifyContent: 'center'
    },
    fabIcon: { fontSize: 16, fontFamily: FONT.bold },
    overlay: { flex: 1, justifyContent: 'flex-end' },
    modalContent: {
        borderTopLeftRadius: RADIUS.sheet,
        borderTopRightRadius: RADIUS.sheet,
        padding: 20,
        paddingBottom: 40,
        maxHeight: '90%'
    },
    modalTitle: { fontSize: 20, fontFamily: FONT.bold, marginBottom: 20, textAlign: 'center' },
    label: { fontSize: 13, fontFamily: FONT.semibold, marginBottom: 8, marginTop: 15 },
    input: {
        borderWidth: 1,
        borderRadius: RADIUS.sm,
        padding: 15,
        fontSize: 16
    },
    typeRow: { flexDirection: 'row', gap: 10 },
    typeBtn: { flex: 1, padding: 12, borderRadius: RADIUS.sm, alignItems: 'center' },
    infoBox: {
        marginTop: 10,
        padding: 12,
        borderRadius: 8,
        borderWidth: 1,
        alignItems: 'center'
    },
    calculatePreview: {
        marginTop: 20,
        marginBottom: 30,
        alignItems: 'center',
        padding: 15,
        borderRadius: RADIUS.sm,
    },
    previewTotal: { fontSize: 24, fontFamily: FONT.bold, marginTop: 5 },
    btnsRow: { flexDirection: 'row', gap: 15 },
    cancelBtn: { flex: 1, padding: 15, borderRadius: RADIUS.sm, alignItems: 'center', minHeight: 52, justifyContent: 'center' },
    saveBtn: { flex: 1, padding: 15, borderRadius: RADIUS.sm, alignItems: 'center', minHeight: 52, justifyContent: 'center' }
});
