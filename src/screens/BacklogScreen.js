import React, { useState, useEffect } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    FlatList,
    Modal,
    TextInput,
    Alert,
    Dimensions,
    ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import db from '../services/db';
import { useTheme } from '../contexts/ThemeContext';

const { width } = Dimensions.get('window');

const CATEGORIES = [
    { id: 'movie', label: 'Películas', icon: '🎬', color: '#E94560' },
    { id: 'series', label: 'Series', icon: '📺', color: '#4CAF50' },
    { id: 'anime', label: 'Anime', icon: '🎋', color: '#2196F3' },
    { id: 'reading', label: 'Lectura', icon: '📚', color: '#FF9800' },
];

const STATUS_COLORS = {
    'Pendiente': '#9E9E9E',
    'Mirando': '#2196F3',
    'Terminado': '#4CAF50',
    'Total': '#673AB7',
};

export default function BacklogScreen({ user, onBack }) {
    const { theme, isDarkMode } = useTheme();
    const [activeTab, setActiveTab] = useState('movie');
    const [activeStatus, setActiveStatus] = useState('Pendiente');
    const [items, setItems] = useState([]);
    const [counts, setCounts] = useState({ 'Pendiente': 0, 'Mirando': 0, 'Terminado': 0, 'Total': 0 });
    const [loading, setLoading] = useState(true);
    const [modalVisible, setModalVisible] = useState(false);
    const [filterModalVisible, setFilterModalVisible] = useState(false);
    const [editingItem, setEditingItem] = useState(null);

    // Sort states
    const [sortBy, setSortBy] = useState('title'); // 'title', 'year_start'
    const [order, setOrder] = useState('ASC'); // 'ASC', 'DESC'

    // Form state
    const [formData, setFormData] = useState({
        title: '',
        year: '',
        format: '24 min',
        start_year: '',
        end_year: '',
    });

    useEffect(() => {
        loadItems();
    }, [activeTab, activeStatus, sortBy, order]);

    const loadItems = async () => {
        setLoading(true);
        // Load items
        const res = await db.getBacklogItems(user.id, activeTab, activeStatus, sortBy, order);
        if (res.success) {
            setItems(res.data);
        }
        // Load counts
        const countsRes = await db.getBacklogCounts(user.id, activeTab);
        if (countsRes.success) {
            setCounts(countsRes.counts);
        }
        setLoading(false);
    };

    const handleAddItem = async () => {
        if (!formData.title.trim()) {
            Alert.alert('Error', 'El título es obligatorio');
            return;
        }

        const data = {
            ...formData,
            type: activeTab,
            year: formData.year ? parseInt(formData.year) : null,
            start_year: formData.start_year ? parseInt(formData.start_year) : null,
            end_year: formData.end_year ? parseInt(formData.end_year) : null,
        };

        if (editingItem) {
            const res = await db.updateBacklogItem(editingItem.id, data);
            if (res.success) {
                setModalVisible(false);
                setEditingItem(null);
                setFormData({ title: '', year: '', format: '24 min', start_year: '', end_year: '' });
                loadItems();
            } else {
                Alert.alert('Error', 'No se pudo actualizar');
            }
        } else {
            const res = await db.addBacklogItem(user.id, data);
            if (res.success) {
                setModalVisible(false);
                setFormData({ title: '', year: '', format: '24 min', start_year: '', end_year: '' });
                setActiveStatus('Pendiente');
                loadItems();
            } else {
                Alert.alert('Error', 'No se pudo guardar');
            }
        }
    };

    const handleEditPress = (item) => {
        setEditingItem(item);
        setFormData({
            title: item.title,
            year: item.year ? item.year.toString() : '',
            format: item.format || '24 min',
            start_year: item.start_year ? item.start_year.toString() : '',
            end_year: item.end_year ? item.end_year.toString() : '',
        });
        setModalVisible(true);
    };

    const handleUpdateStatus = async (item) => {
        const statuses = ['Pendiente', 'Mirando', 'Terminado'];
        const currentIndex = statuses.indexOf(item.status);
        const nextStatus = statuses[(currentIndex + 1) % statuses.length];

        const res = await db.updateBacklogStatus(item.id, nextStatus);
        if (res.success) {
            loadItems();
        }
    };

    const handleDeleteItem = (id) => {
        Alert.alert(
            'Eliminar',
            '¿Estás seguro de que quieres eliminar este elemento?',
            [
                { text: 'Cancelar', style: 'cancel' },
                {
                    text: 'Eliminar',
                    style: 'destructive',
                    onPress: async () => {
                        await db.deleteBacklogItem(id);
                        loadItems();
                    }
                }
            ]
        );
    };

    const renderItem = ({ item }) => (
        <View style={[styles.itemCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
            {/* Title Row - Full Width */}
            <View style={{ marginBottom: 12 }}>
                <Text style={[styles.itemTitle, { color: theme.text }]}>{item.title}</Text>
            </View>

            {/* Bottom Row: Status/Details (Left) and Actions (Right) */}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' }}>

                {/* Left Side: Status & Metadata */}
                <View style={{ flex: 1, marginRight: 10 }}>
                    {/* Status Badge */}
                    <View style={{ flexDirection: 'row', marginBottom: 6 }}>
                        <TouchableOpacity
                            onPress={() => handleUpdateStatus(item)}
                            style={[
                                styles.statusBadge,
                                {
                                    backgroundColor: STATUS_COLORS[item.status] + '20',
                                    borderColor: STATUS_COLORS[item.status]
                                }
                            ]}
                        >
                            <Text style={[styles.statusText, { color: STATUS_COLORS[item.status] }]}>
                                {item.status}
                            </Text>
                        </TouchableOpacity>
                    </View>

                    {/* Metadata Details */}
                    <View style={styles.itemDetails}>
                        {activeTab === 'movie' && item.year && (
                            <Text style={[styles.itemSubtext, { color: theme.subText }]}>Año: {item.year}</Text>
                        )}
                        {activeTab === 'series' && (
                            <>
                                <Text style={[styles.itemSubtext, { color: theme.subText }]}>{item.format}</Text>
                                {(item.start_year || item.end_year) && (
                                    <Text style={[styles.itemSubtext, { color: theme.subText }]}>
                                        {item.start_year || '?'}{item.end_year ? ` - ${item.end_year}` : '...'}
                                    </Text>
                                )}
                            </>
                        )}
                        {activeTab === 'anime' && (item.start_year || item.end_year) && (
                            <Text style={[styles.itemSubtext, { color: theme.subText }]}>
                                {item.start_year || '?'}{item.end_year ? ` - ${item.end_year}` : '...'}
                            </Text>
                        )}
                        {activeTab === 'reading' && item.start_year && (
                            <Text style={[styles.itemSubtext, { color: theme.subText }]}>Inicio: {item.start_year}</Text>
                        )}
                    </View>
                </View>

                {/* Right Side: Actions */}
                <View style={styles.itemActions}>
                    <TouchableOpacity onPress={() => handleEditPress(item)} style={styles.actionBtn}>
                        <Text style={{ fontSize: 18 }}>✏️</Text>
                    </TouchableOpacity>

                    <TouchableOpacity onPress={() => handleDeleteItem(item.id)} style={styles.actionBtn}>
                        <Text style={{ fontSize: 18 }}>🗑️</Text>
                    </TouchableOpacity>
                </View>
            </View>
        </View>
    );

    const currentCat = CATEGORIES.find(c => c.id === activeTab);

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
            <StatusBar style={isDarkMode ? "light" : "dark"} />

            {/* Header */}
            <View style={[styles.header, { backgroundColor: theme.header }]}>
                <TouchableOpacity onPress={onBack} style={styles.backButton}>
                    <Text style={[styles.backIcon, { color: theme.text }]}>←</Text>
                </TouchableOpacity>
                <Text style={[styles.headerTitle, { color: theme.text }]}>Pendientes</Text>
                <TouchableOpacity onPress={() => setFilterModalVisible(true)} style={styles.filterButton}>
                    <Text style={{ fontSize: 22 }}>⚖️</Text>
                </TouchableOpacity>
            </View>

            {/* Main Tabs (Categories) */}
            <View style={styles.tabsContainer}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabsScroll}>
                    {CATEGORIES.map(cat => (
                        <TouchableOpacity
                            key={cat.id}
                            style={[
                                styles.tab,
                                activeTab === cat.id && { backgroundColor: cat.color, borderColor: cat.color }
                            ]}
                            onPress={() => setActiveTab(cat.id)}
                        >
                            <Text style={styles.tabIcon}>{cat.icon}</Text>
                            <Text style={[
                                styles.tabLabel,
                                { color: activeTab === cat.id ? '#fff' : theme.text }
                            ]}>
                                {cat.label}
                            </Text>
                        </TouchableOpacity>
                    ))}
                </ScrollView>
            </View>

            {/* Sub Tabs (Status) */}
            <View style={styles.statusTabsContainer}>
                {['Pendiente', 'Mirando', 'Terminado', 'Total'].map(status => (
                    <TouchableOpacity
                        key={status}
                        style={[
                            styles.statusTab,
                            { borderColor: STATUS_COLORS[status] },
                            activeStatus === status && { backgroundColor: STATUS_COLORS[status] }
                        ]}
                        onPress={() => setActiveStatus(status)}
                    >
                        <Text style={[
                            styles.statusTabLabel,
                            { color: STATUS_COLORS[status] },
                            activeStatus === status && { color: '#fff' }
                        ]}>
                            {status} ({counts[status] || 0})
                        </Text>
                    </TouchableOpacity>
                ))}
            </View>

            {/* List */}
            <FlatList
                data={items}
                renderItem={renderItem}
                keyExtractor={item => item.id.toString()}
                contentContainerStyle={styles.listContent}
                ListEmptyComponent={
                    <View style={styles.emptyContainer}>
                        <Text style={[styles.emptyText, { color: theme.subText }]}>
                            No hay {currentCat.label.toLowerCase()} con estado {activeStatus.toLowerCase()}
                        </Text>
                    </View>
                }
            />

            {/* Add Button */}
            <TouchableOpacity
                style={[styles.fab, { backgroundColor: currentCat.color }]}
                onPress={() => {
                    setEditingItem(null);
                    setFormData({ title: '', year: '', format: '24 min', start_year: '', end_year: '' });
                    setModalVisible(true);
                }}
            >
                <Text style={styles.fabIcon}>+</Text>
            </TouchableOpacity>

            {/* Filter Modal */}
            <Modal
                visible={filterModalVisible}
                transparent
                animationType="fade"
                onRequestClose={() => setFilterModalVisible(false)}
            >
                <View style={styles.modalOverlay}>
                    <View style={[styles.filterCard, { backgroundColor: theme.card }]}>
                        <Text style={[styles.modalTitle, { color: theme.text }]}>Ordenar por</Text>

                        <View style={styles.filterOptions}>
                            <TouchableOpacity
                                style={[styles.filterOption, sortBy === 'title' && { backgroundColor: theme.accent }]}
                                onPress={() => setSortBy('title')}
                            >
                                <Text style={[styles.filterOptionText, sortBy === 'title' && { color: '#fff' }]}>Título</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[styles.filterOption, sortBy === 'year_start' && { backgroundColor: theme.accent }]}
                                onPress={() => setSortBy('year_start')}
                            >
                                <Text style={[styles.filterOptionText, sortBy === 'year_start' && { color: '#fff' }]}>Año</Text>
                            </TouchableOpacity>
                        </View>

                        <Text style={[styles.modalTitle, { color: theme.text, marginTop: 20 }]}>Dirección</Text>
                        <View style={styles.filterOptions}>
                            <TouchableOpacity
                                style={[styles.filterOption, order === 'ASC' && { backgroundColor: theme.accent }]}
                                onPress={() => setOrder('ASC')}
                            >
                                <Text style={[styles.filterOptionText, order === 'ASC' && { color: '#fff' }]}>Ascendente</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[styles.filterOption, order === 'DESC' && { backgroundColor: theme.accent }]}
                                onPress={() => setOrder('DESC')}
                            >
                                <Text style={[styles.filterOptionText, order === 'DESC' && { color: '#fff' }]}>Descendente</Text>
                            </TouchableOpacity>
                        </View>

                        <TouchableOpacity
                            style={[styles.closeBtn, { backgroundColor: theme.accent }]}
                            onPress={() => setFilterModalVisible(false)}
                        >
                            <Text style={styles.closeBtnText}>Aplicar</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </Modal>

            {/* Add Modal */}
            <Modal
                visible={modalVisible}
                animationType="slide"
                transparent
                onRequestClose={() => setModalVisible(false)}
            >
                <View style={styles.modalOverlay}>
                    <View style={[styles.modalCard, { backgroundColor: theme.card }]}>
                        <Text style={[styles.modalTitle, { color: theme.text }]}>
                            {editingItem ? 'Editar' : 'Añadir'} {currentCat.label}
                        </Text>

                        <ScrollView>
                            <Text style={[styles.inputLabel, { color: theme.accent }]}>Título</Text>
                            <TextInput
                                style={[styles.input, { backgroundColor: theme.inputBackground, color: theme.text, borderColor: theme.border }]}
                                value={formData.title}
                                onChangeText={text => setFormData({ ...formData, title: text })}
                                placeholder="Ingresa el título..."
                                placeholderTextColor={theme.subText}
                            />

                            {activeTab === 'movie' && (
                                <>
                                    <Text style={[styles.inputLabel, { color: theme.accent }]}>Año</Text>
                                    <TextInput
                                        style={[styles.input, { backgroundColor: theme.inputBackground, color: theme.text, borderColor: theme.border }]}
                                        value={formData.year}
                                        onChangeText={text => setFormData({ ...formData, year: text })}
                                        placeholder="Ej: 1994"
                                        keyboardType="numeric"
                                        placeholderTextColor={theme.subText}
                                    />
                                </>
                            )}

                            {activeTab === 'series' && (
                                <>
                                    <Text style={[styles.inputLabel, { color: theme.accent }]}>Formato</Text>
                                    <View style={styles.formatContainer}>
                                        {['24 min', '40 min'].map(f => (
                                            <TouchableOpacity
                                                key={f}
                                                style={[styles.formatOption, formData.format === f && { backgroundColor: theme.accent }]}
                                                onPress={() => setFormData({ ...formData, format: f })}
                                            >
                                                <Text style={[styles.formatText, formData.format === f && { color: '#fff' }]}>{f}</Text>
                                            </TouchableOpacity>
                                        ))}
                                    </View>
                                    <Text style={[styles.inputLabel, { color: theme.accent }]}>Año Inicio</Text>
                                    <TextInput
                                        style={[styles.input, { backgroundColor: theme.inputBackground, color: theme.text, borderColor: theme.border }]}
                                        value={formData.start_year}
                                        onChangeText={text => setFormData({ ...formData, start_year: text })}
                                        placeholder="Ej: 2020"
                                        keyboardType="numeric"
                                        placeholderTextColor={theme.subText}
                                    />
                                    <Text style={[styles.inputLabel, { color: theme.accent }]}>Año Fin (Omitir si sigue en emisión)</Text>
                                    <TextInput
                                        style={[styles.input, { backgroundColor: theme.inputBackground, color: theme.text, borderColor: theme.border }]}
                                        value={formData.end_year}
                                        onChangeText={text => setFormData({ ...formData, end_year: text })}
                                        placeholder="Ej: 2024"
                                        keyboardType="numeric"
                                        placeholderTextColor={theme.subText}
                                    />
                                </>
                            )}

                            {activeTab === 'anime' && (
                                <>
                                    <Text style={[styles.inputLabel, { color: theme.accent }]}>Año Inicio</Text>
                                    <TextInput
                                        style={[styles.input, { backgroundColor: theme.inputBackground, color: theme.text, borderColor: theme.border }]}
                                        value={formData.start_year}
                                        onChangeText={text => setFormData({ ...formData, start_year: text })}
                                        placeholder="Ej: 2020"
                                        keyboardType="numeric"
                                        placeholderTextColor={theme.subText}
                                    />
                                    <Text style={[styles.inputLabel, { color: theme.accent }]}>Año Fin</Text>
                                    <TextInput
                                        style={[styles.input, { backgroundColor: theme.inputBackground, color: theme.text, borderColor: theme.border }]}
                                        value={formData.end_year}
                                        onChangeText={text => setFormData({ ...formData, end_year: text })}
                                        placeholder="Ej: 2024"
                                        keyboardType="numeric"
                                        placeholderTextColor={theme.subText}
                                    />
                                </>
                            )}

                            {activeTab === 'reading' && (
                                <>
                                    <Text style={[styles.inputLabel, { color: theme.accent }]}>Año Inicio</Text>
                                    <TextInput
                                        style={[styles.input, { backgroundColor: theme.inputBackground, color: theme.text, borderColor: theme.border }]}
                                        value={formData.start_year}
                                        onChangeText={text => setFormData({ ...formData, start_year: text })}
                                        placeholder="Ej: 2020"
                                        keyboardType="numeric"
                                        placeholderTextColor={theme.subText}
                                    />
                                </>
                            )}
                        </ScrollView>

                        <View style={styles.modalButtons}>
                            <TouchableOpacity
                                style={[styles.modalButton, { backgroundColor: theme.inputBackground }]}
                                onPress={() => setModalVisible(false)}
                            >
                                <Text style={[styles.modalButtonText, { color: theme.text }]}>Cancelar</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[styles.modalButton, { backgroundColor: currentCat.color }]}
                                onPress={handleAddItem}
                            >
                                <Text style={[styles.modalButtonText, { color: '#fff' }]}>
                                    {editingItem ? 'Actualizar' : 'Guardar'}
                                </Text>
                            </TouchableOpacity>
                        </View>
                    </View>
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
        padding: 20,
        borderBottomLeftRadius: 30,
        borderBottomRightRadius: 30,
        elevation: 5,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 10,
    },
    backButton: { width: 40, height: 40, justifyContent: 'center' },
    backIcon: { fontSize: 24, fontWeight: 'bold' },
    headerTitle: { fontSize: 22, fontWeight: 'bold' },
    filterButton: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center' },
    tabsContainer: { paddingVertical: 10 },
    tabsScroll: { paddingHorizontal: 15 },
    statusTabsContainer: {
        flexDirection: 'row',
        paddingHorizontal: 15,
        gap: 10,
        marginBottom: 10,
    },
    statusTab: {
        flex: 1,
        paddingVertical: 8,
        borderRadius: 12,
        borderWidth: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
    statusTabLabel: {
        fontSize: 11,
        fontWeight: 'bold',
    },
    tab: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderRadius: 20,
        marginRight: 10,
        borderWidth: 1,
        borderColor: '#eee',
        backgroundColor: '#fff',
    },
    tabIcon: { fontSize: 18, marginRight: 8 },
    tabLabel: { fontSize: 14, fontWeight: 'bold' },
    listContent: { padding: 15, paddingBottom: 100 },
    itemCard: {
        padding: 15,
        borderRadius: 20,
        marginBottom: 12,
        borderWidth: 1,
        elevation: 3,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.05,
        shadowRadius: 5,
    },
    itemHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    itemTitle: { fontSize: 18, fontWeight: 'bold', marginBottom: 4 },
    itemDetails: { flexDirection: 'row', flexWrap: 'wrap' },
    itemSubtext: { fontSize: 13, marginRight: 15, marginTop: 2 },
    itemActions: { flexDirection: 'row', alignItems: 'center' },
    statusBadge: {
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 12,
        borderWidth: 1,
        marginRight: 8,
    },
    statusText: { fontSize: 11, fontWeight: 'bold' },
    actionBtn: { padding: 8 },
    fab: {
        position: 'absolute',
        bottom: 30,
        right: 30,
        width: 60,
        height: 60,
        borderRadius: 30,
        justifyContent: 'center',
        alignItems: 'center',
        elevation: 10,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 5 },
        shadowOpacity: 0.3,
        shadowRadius: 10,
    },
    fabIcon: { fontSize: 32, color: '#fff', fontWeight: '300' },
    emptyContainer: { alignItems: 'center', marginTop: 100 },
    emptyText: { fontSize: 16 },
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.5)',
        justifyContent: 'flex-end',
    },
    modalCard: {
        backgroundColor: '#fff',
        borderTopLeftRadius: 30,
        borderTopRightRadius: 30,
        padding: 30,
        maxHeight: '80%',
    },
    filterCard: {
        backgroundColor: '#fff',
        borderTopLeftRadius: 30,
        borderTopRightRadius: 30,
        padding: 30,
    },
    modalTitle: { fontSize: 24, fontWeight: 'bold', marginBottom: 20 },
    inputLabel: { fontSize: 14, fontWeight: 'bold', marginBottom: 8, marginTop: 15 },
    input: { borderRadius: 15, padding: 15, borderWidth: 1, fontSize: 16 },
    formatContainer: { flexDirection: 'row', gap: 10, marginTop: 5 },
    formatOption: {
        flex: 1,
        padding: 12,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#ddd',
        alignItems: 'center',
    },
    formatText: { fontWeight: 'bold', color: '#666' },
    modalButtons: { flexDirection: 'row', gap: 15, marginTop: 30 },
    modalButton: { flex: 1, padding: 18, borderRadius: 15, alignItems: 'center' },
    modalButtonText: { fontSize: 16, fontWeight: 'bold' },
    filterOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    filterOption: {
        paddingHorizontal: 15,
        paddingVertical: 10,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#ddd',
    },
    filterOptionText: { fontWeight: '600', color: '#666' },
    closeBtn: { marginTop: 30, padding: 18, borderRadius: 15, alignItems: 'center' },
    closeBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
});
