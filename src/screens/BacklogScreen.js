import React, { useState, useEffect, useMemo } from 'react';
import { View, StyleSheet, TouchableOpacity, FlatList, Modal, Dimensions, ScrollView } from 'react-native';
import { useSheet } from '../hooks/useSheet';
import { Text, TextInput } from '../components/AppText';
import { SafeAreaView } from 'react-native-safe-area-context';
import db from '../services/db';
import { useSyncRefresh } from '../sync/useSyncRefresh';
import { useTheme, FONT, RADIUS } from '../contexts/ThemeContext';
// Fase 7.5: vínculo con Series/Lectura (estado que mueve la serie, borrado en los dos lados) y
// subtipo de lectura.
import { nextManualStatus, needsFinishConfirm, isLinked, linkLabel, validateBacklogForm, SUBTYPE_LABELS } from '../entertainment/link';
// Fase 7.5b1: etiquetas por sección (E6–E8). La franquicia ya no se muestra, no se filtra ni se escribe.
import { parseTags, sortForDisplay, isTagFilterActive, deleteTagText, tagKey, TAG_ERROR_TEXTS } from '../entertainment/tags';
import EtiquetasCampo from '../components/EtiquetasCampo';
import EtiquetasFiltroHoja from '../components/EtiquetasFiltroHoja';
import EtiquetasGestionHoja from '../components/EtiquetasGestionHoja';
import HojaConTeclado, { ScrollDeHoja } from '../components/HojaConTeclado';

const { width } = Dimensions.get('window');

const FORM_VACIO = { title: '', year: '', format: '24 min', start_year: '', end_year: '', subtype: null, tags: [] };
const FILTRO_VACIO = { keys: [], none: false };

// Cada tipo tiene un tono del tema (theme.tones) como color de identidad.
const CATEGORIES = [
    { id: 'movie', label: 'Películas', icon: '🎬', tono: 'rojo' },
    { id: 'series', label: 'Series', icon: '📺', tono: 'verde' },
    { id: 'anime', label: 'Anime', icon: '🎋', tono: 'azul' },
    { id: 'reading', label: 'Lectura', icon: '📚', tono: 'naranja' },
];

const STATUS_TONES = {
    'Pendiente': 'pizarra',
    'Mirando': 'azul',
    'Terminado': 'verde',
    'Total': 'morado',
};

export default function BacklogScreen({ user, onBack }) {
    const { theme } = useTheme();
    const styles = useMemo(() => makeStyles(theme), [theme]);
    const { confirm, informar } = useSheet();
    const statusTone = (status) => theme.tones[STATUS_TONES[status]];
    const [activeTab, setActiveTab] = useState('movie');
    const [activeStatus, setActiveStatus] = useState('Pendiente');
    const [items, setItems] = useState([]);
    const [counts, setCounts] = useState({ 'Pendiente': 0, 'Mirando': 0, 'Terminado': 0, 'Total': 0 });
    const [loading, setLoading] = useState(true);
    const [modalVisible, setModalVisible] = useState(false);
    const [filterModalVisible, setFilterModalVisible] = useState(false);
    const [editingItem, setEditingItem] = useState(null);
    const [activeSubtype, setActiveSubtype] = useState('Todos'); // Fase 7.5: filtro de la pestaña Lectura
    // Fase 7.5b1: filtro por etiquetas (E8), catálogo (todas las secciones) y hojas de filtro y gestión.
    const [tagFilter, setTagFilter] = useState(FILTRO_VACIO);
    const [catalog, setCatalog] = useState([]);
    const [tagUsage, setTagUsage] = useState({});
    const [tagFilterVisible, setTagFilterVisible] = useState(false);
    const [tagManagerVisible, setTagManagerVisible] = useState(false);

    // Sort states
    const [sortBy, setSortBy] = useState('created_at'); // 'title', 'year_start', 'created_at'
    const [order, setOrder] = useState('DESC'); // 'ASC', 'DESC'

    // Form state
    const [formData, setFormData] = useState(FORM_VACIO);

    useEffect(() => {
        loadItems();
    }, [activeTab, activeStatus, sortBy, order, tagFilter, activeSubtype]);
    // Recarga si la sync trae cambios del servidor (sin tocar formularios, filtros ni scroll).
    useSyncRefresh(() => loadItems());

    useEffect(() => {
        setActiveSubtype('Todos');
        setTagFilter(FILTRO_VACIO);
    }, [activeTab]);

    const loadItems = async () => {
        setLoading(true);
        // Load items
        const res = await db.getBacklogItems(user.id, activeTab, activeStatus, sortBy, order, tagFilter, activeSubtype);
        if (res.success) {
            setItems(res.data);
        }
        // Load counts
        const countsRes = await db.getBacklogCounts(user.id, activeTab, tagFilter, activeSubtype);
        if (countsRes.success) {
            setCounts(countsRes.counts);
        }
        const tagsRes = await db.getBacklogTags(user.id);
        if (tagsRes.success) {
            setCatalog(tagsRes.data);
        }
        setLoading(false);
    };

    const loadTagUsage = async () => {
        const res = await db.getBacklogTagUsage(user.id, activeTab);
        if (res.success) setTagUsage(res.usage);
    };

    const openTagManager = async () => {
        await loadTagUsage();
        setTagManagerVisible(true);
    };

    // Gestión de etiquetas (E6). Devuelven true si se aplicó el cambio.
    const handleCreateTag = async (name) => {
        const res = await db.createBacklogTag(user.id, activeTab, name);
        if (!res.success) { informar('Etiqueta', TAG_ERROR_TEXTS[res.code] || 'No se pudo crear la etiqueta.'); return false; }
        await loadItems();
        return true;
    };

    const handleRenameTag = async (tag, name) => {
        const res = await db.renameBacklogTag(tag.id, name);
        if (!res.success) { informar('Etiqueta', TAG_ERROR_TEXTS[res.code] || 'No se pudo renombrar la etiqueta.'); return false; }
        // El filtro sigue a la etiqueta renombrada (compara por clave).
        if (tagFilter.keys.includes(tag.name_key)) {
            setTagFilter({ ...tagFilter, keys: tagFilter.keys.map((k) => (k === tag.name_key ? tagKey(name) : k)) });
        } else {
            await loadItems();
        }
        await loadTagUsage();
        return true;
    };

    const handleDeleteTag = async (tag) => {
        const clave = await confirm({
            titulo: `Borrar «${tag.name}»`,
            mensaje: deleteTagText((tagUsage && tagUsage[tag.name_key]) || 0),
            acciones: [
                { clave: 'cancelar', texto: 'Cancelar', variante: 'cancelar' },
                { clave: 'borrar', texto: 'Borrar', variante: 'destructiva' },
            ],
        });
        if (clave !== 'borrar') return false;
        const res = await db.deleteBacklogTag(tag.id);
        if (!res.success) { informar('Etiqueta', 'No se pudo borrar la etiqueta.'); return false; }
        if (tagFilter.keys.includes(tag.name_key)) {
            setTagFilter({ ...tagFilter, keys: tagFilter.keys.filter((k) => k !== tag.name_key) });
        } else {
            await loadItems();
        }
        await loadTagUsage();
        return true;
    };

    const handleAddItem = async () => {
        const formErrors = { titulo: 'El título es obligatorio', subtipo: 'Elige el subtipo: libro, cómic o manga.' };
        const validation = validateBacklogForm({ type: activeTab, title: formData.title, subtype: formData.subtype });
        if (validation.error) { informar('Error', formErrors[validation.error]); return; }

        const data = {
            ...formData,
            type: activeTab,
            subtype: activeTab === 'reading' ? formData.subtype : null,
            year: formData.year ? parseInt(formData.year) : null,
            start_year: formData.start_year ? parseInt(formData.start_year) : null,
            end_year: formData.end_year ? parseInt(formData.end_year) : null,
        };

        if (editingItem) {
            const res = await db.updateBacklogItem(editingItem.id, data);
            if (res.success) {
                setModalVisible(false);
                setEditingItem(null);
                setFormData(FORM_VACIO);
                loadItems();
            } else {
                informar('Error', 'No se pudo actualizar');
            }
        } else {
            const res = await db.addBacklogItem(user.id, data);
            if (res.success) {
                setModalVisible(false);
                setFormData(FORM_VACIO);
                setActiveStatus('Pendiente');
                loadItems();
            } else {
                informar('Error', 'No se pudo guardar');
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
            subtype: item.subtype || null,
            tags: parseTags(item.tags),
        });
        setModalVisible(true);
    };

    // Fase 7.5 (D6): película, rota como siempre; serie/anime/lectura sin vínculo, Pendiente ↔
    // Terminado; vinculado, el estado lo mueve la serie (se avisa).
    const handleUpdateStatus = async (item) => {
        const nextStatus = nextManualStatus(item);
        if (!nextStatus) {
            const quien = item.type === 'reading' ? 'la obra' : 'la serie';
            informar('Vinculado', `El estado lo cambia ${quien} en «${item.linked_category_name || 'su categoría'}».`);
            return;
        }
        // D6 (corrección): pasar a Terminado una serie, anime o lectura sin vínculo se confirma antes.
        if (needsFinishConfirm(item)) {
            const clave = await confirm({
                titulo: 'Marcar como Terminado',
                mensaje: `¿Marcar «${item.title}» como Terminado?`,
                acciones: [
                    { clave: 'terminado', texto: 'Terminado', variante: 'primaria' },
                    { clave: 'cancelar', texto: 'Cancelar', variante: 'cancelar' },
                ],
            });
            if (clave !== 'terminado') return;
        }

        const res = await db.updateBacklogStatus(item.id, nextStatus);
        if (res.success) {
            loadItems();
        }
    };

    // Fase 7.5: un título vinculado se borra con su serie (y su progreso); la confirmación lo dice.
    const handleDeleteItem = (item) => {
        const id = item.id;
        const quien = item.type === 'reading' ? 'su obra' : 'su serie';
        confirm({
            titulo: 'Eliminar',
            mensaje: isLinked(item)
                ? `Se borrarán el título y ${quien} en «${item.linked_category_name || 'su categoría'}», con todo su progreso.`
                : '¿Estás seguro de que quieres eliminar este elemento?',
            acciones: [
                { clave: 'cancelar', texto: 'Cancelar', variante: 'cancelar' },
                { clave: 'eliminar', texto: 'Eliminar', variante: 'destructiva' },
            ],
        }).then(async (clave) => {
            if (clave !== 'eliminar') return;
            await db.deleteBacklogItem(id);
            loadItems();
        });
    };

    const renderItem = ({ item }) => (
        <TouchableOpacity 
            style={[styles.itemCard, { backgroundColor: theme.surface, borderColor: theme.line }]}
            onPress={() => handleUpdateStatus(item)}
            activeOpacity={0.7}
        >
            <View style={styles.cardMain}>
                <View style={styles.cardHeader}>
                    {/* C1 (1.4.3): en Pendiente el título se ve completo (sin límite de líneas). */}
                    <Text style={[styles.itemTitle, { color: theme.ink }]}>{item.title}</Text>
                    <View style={[
                        styles.statusDot, 
                        { backgroundColor: statusTone(item.status).fg }
                    ]} />
                </View>

                {isLinked(item) && (
                    <View style={styles.linkRow}>
                        <View style={[styles.linkChip, { backgroundColor: theme.soft }]}>
                            <Text style={[styles.linkChipText, { color: theme.accent }]} numberOfLines={1}>Vinculado</Text>
                        </View>
                        <Text style={[styles.linkText, { color: theme.muted }]} numberOfLines={1} ellipsizeMode="tail">
                            {linkLabel({ seriesStatus: item.linked_series_status, categoryName: item.linked_category_name })}
                        </Text>
                    </View>
                )}

                {parseTags(item.tags).length > 0 && (
                    <Text style={[styles.tagsLine, { color: theme.accent }]} numberOfLines={1} ellipsizeMode="tail">
                        🏷️ {sortForDisplay(parseTags(item.tags)).join(' · ')}
                    </Text>
                )}

                <View style={styles.cardFooter}>
                    <View style={styles.metadataContainer}>
                        {activeTab === 'movie' && item.year && (
                            <Text numberOfLines={1} style={[styles.itemSubtext, { color: theme.muted }]}>🎬 {item.year}</Text>
                        )}
                        {activeTab === 'series' && (
                            <>
                                <Text numberOfLines={1} style={[styles.itemSubtext, { color: theme.muted }]}>📺 {item.format}</Text>
                                {(item.start_year || item.end_year) && (
                                    <Text numberOfLines={1} style={[styles.itemSubtext, { color: theme.muted }]}>
                                        📅 {item.start_year || '?'}{item.end_year ? ` - ${item.end_year}` : '...'}
                                    </Text>
                                )}
                            </>
                        )}
                        {activeTab === 'anime' && (item.start_year || item.end_year) && (
                            <Text numberOfLines={1} style={[styles.itemSubtext, { color: theme.muted }]}>
                                🎋 {item.start_year || '?'}{item.end_year ? ` - ${item.end_year}` : '...'}
                            </Text>
                        )}
                        {activeTab === 'reading' && (
                            <Text numberOfLines={1} style={[styles.itemSubtext, { color: theme.muted }]}>{SUBTYPE_LABELS[item.subtype] || 'Sin subtipo'}</Text>
                        )}
                        {activeTab === 'reading' && item.start_year && (
                            <Text numberOfLines={1} style={[styles.itemSubtext, { color: theme.muted }]}>📚 {item.start_year}</Text>
                        )}
                        <Text numberOfLines={1} style={[styles.dateText, { color: theme.muted }]}>
                            ⏱️ {new Date(item.created_at).toLocaleDateString()}
                        </Text>
                    </View>

                    <View style={styles.cardIcons}>
                        <TouchableOpacity onPress={(e) => { e.stopPropagation(); handleEditPress(item); }} style={styles.miniActionBtn}>
                            <Text style={{ fontSize: 16 }}>✏️</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={(e) => { e.stopPropagation(); handleDeleteItem(item); }} style={styles.miniActionBtn}>
                            <Text style={{ fontSize: 16 }}>🗑️</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </View>
        </TouchableOpacity>
    );

    const currentCat = CATEGORIES.find(c => c.id === activeTab);

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: theme.bg }]}>

            {/* Header */}
            <View style={[styles.header, { backgroundColor: theme.surface }]}>
                <TouchableOpacity onPress={onBack} style={styles.backButton}>
                    <Text style={[styles.backIcon, { color: theme.ink }]}>←</Text>
                </TouchableOpacity>
                <Text style={[styles.headerTitle, { color: theme.ink }]}>Pendientes</Text>
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
                                { 
                                    backgroundColor: activeTab === cat.id ? theme.tones[cat.tono].bg : theme.surface, 
                                    borderColor: activeTab === cat.id ? theme.tones[cat.tono].fg : theme.lineStrong 
                                }
                            ]}
                            onPress={() => setActiveTab(cat.id)}
                        >
                            <Text style={styles.tabIcon}>{cat.icon}</Text>
                            <Text style={[
                                styles.tabLabel,
                                { color: activeTab === cat.id ? theme.tones[cat.tono].fg : theme.ink }
                            ]}>
                                {cat.label}
                            </Text>
                        </TouchableOpacity>
                    ))}
                </ScrollView>
            </View>

            {/* Fase 7.5b1: filtro por etiquetas (E8) y gestión (E6), en las 4 secciones */}
            <View style={styles.tagBar}>
                <TouchableOpacity
                    accessibilityRole="button"
                    style={[styles.tagBarBtn, {
                        backgroundColor: isTagFilterActive(tagFilter) ? theme.accent : theme.raised,
                        borderColor: isTagFilterActive(tagFilter) ? theme.accent : theme.lineStrong,
                    }]}
                    onPress={() => setTagFilterVisible(true)}
                >
                    <Text style={[styles.tagBarLabel, { color: isTagFilterActive(tagFilter) ? theme.onAccent : theme.ink }]} numberOfLines={1}>
                        {tagFilter.none ? 'Sin etiquetas' : tagFilter.keys.length > 0 ? `Filtrar (${tagFilter.keys.length})` : 'Filtrar'}
                    </Text>
                </TouchableOpacity>
                <TouchableOpacity
                    accessibilityRole="button"
                    style={[styles.tagBarBtn, { backgroundColor: theme.raised, borderColor: theme.lineStrong }]}
                    onPress={openTagManager}
                >
                    <Text style={[styles.tagBarLabel, { color: theme.ink }]} numberOfLines={1}>Etiquetas</Text>
                </TouchableOpacity>
            </View>

            {/* Fase 7.5: filtro de subtipo (Lectura) */}
            {activeTab === 'reading' && (
                <View style={[styles.tabsContainer, { paddingTop: 0, paddingBottom: 10 }]}>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.tabsScroll, { flexGrow: 1, justifyContent: 'center' }]}>
                        {['Todos', ...Object.keys(SUBTYPE_LABELS)].map(sub => (
                            <TouchableOpacity
                                key={sub}
                                style={[
                                    styles.subtypeTab,
                                    {
                                        backgroundColor: activeSubtype === sub ? theme.accent : theme.raised,
                                        borderColor: activeSubtype === sub ? theme.accent : theme.lineStrong
                                    }
                                ]}
                                onPress={() => setActiveSubtype(sub)}
                            >
                                <Text style={[styles.subtypeLabel, { color: activeSubtype === sub ? theme.onAccent : theme.ink }]}>
                                    {sub === 'Todos' ? 'Todos' : SUBTYPE_LABELS[sub]}
                                </Text>
                            </TouchableOpacity>
                        ))}
                    </ScrollView>
                </View>
            )}

            {/* Sub Tabs (Status) */}
            <View style={styles.statusTabsContainer}>
                {['Pendiente', 'Mirando', 'Terminado', 'Total'].map(status => (
                    <TouchableOpacity
                        key={status}
                        style={[
                            styles.statusTab,
                            { borderColor: statusTone(status).fg },
                            activeStatus === status && { backgroundColor: statusTone(status).bg }
                        ]}
                        onPress={() => setActiveStatus(status)}
                    >
                        <Text style={[
                            styles.statusTabLabel,
                            { color: statusTone(status).fg }
                        ]} numberOfLines={1}>
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
                        <Text style={[styles.emptyText, { color: theme.muted }]}>
                            No hay {currentCat.label.toLowerCase()} con estado {activeStatus.toLowerCase()}
                        </Text>
                    </View>
                }
            />

            {/* Add Button */}
            <TouchableOpacity
                style={[styles.fab, { backgroundColor: theme.accent }]}
                onPress={() => {
                    setEditingItem(null);
                    setFormData(FORM_VACIO);
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
                    <View style={[styles.filterCard, { backgroundColor: theme.surface }]}>
                        <Text style={[styles.modalTitle, { color: theme.ink }]}>Ordenar por</Text>

                        <View style={styles.filterOptions}>
                            <TouchableOpacity
                                style={[styles.filterOption, sortBy === 'title' && { backgroundColor: theme.accent, borderColor: theme.accent }]}
                                onPress={() => setSortBy('title')}
                            >
                                <Text style={[styles.filterOptionText, sortBy === 'title' && { color: theme.onAccent }]}>Título</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[styles.filterOption, sortBy === 'year_start' && { backgroundColor: theme.accent, borderColor: theme.accent }]}
                                onPress={() => setSortBy('year_start')}
                            >
                                <Text style={[styles.filterOptionText, sortBy === 'year_start' && { color: theme.onAccent }]}>Año</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[styles.filterOption, sortBy === 'created_at' && { backgroundColor: theme.accent, borderColor: theme.accent }]}
                                onPress={() => setSortBy('created_at')}
                            >
                                <Text style={[styles.filterOptionText, sortBy === 'created_at' && { color: theme.onAccent }]}>Fecha</Text>
                            </TouchableOpacity>
                        </View>

                        <Text style={[styles.modalTitle, { color: theme.ink, marginTop: 20 }]}>Dirección</Text>
                        <View style={styles.filterOptions}>
                            <TouchableOpacity
                                style={[styles.filterOption, order === 'ASC' && { backgroundColor: theme.accent, borderColor: theme.accent }]}
                                onPress={() => setOrder('ASC')}
                            >
                                <Text style={[styles.filterOptionText, order === 'ASC' && { color: theme.onAccent }]}>Ascendente</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[styles.filterOption, order === 'DESC' && { backgroundColor: theme.accent, borderColor: theme.accent }]}
                                onPress={() => setOrder('DESC')}
                            >
                                <Text style={[styles.filterOptionText, order === 'DESC' && { color: theme.onAccent }]}>Descendente</Text>
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

            {/* Formulario (1.4.3: hoja con teclado, el campo con el foco nunca queda tapado) */}
            <HojaConTeclado visible={modalVisible} onClose={() => setModalVisible(false)}>
                    <View style={[styles.modalCard, { backgroundColor: theme.surface }]}>
                        <Text style={[styles.modalTitle, { color: theme.ink }]} numberOfLines={1} ellipsizeMode="tail">
                            {editingItem ? 'Editar' : 'Añadir'} {currentCat.label}
                        </Text>

                        <ScrollDeHoja>
                            <Text style={[styles.inputLabel, { color: theme.accent }]}>Título</Text>
                            {/* C1 (1.4.3): multilínea, crece hasta 5 líneas y luego hace scroll interno; Enter
                                cierra el teclado y los saltos de línea pegados pasan a espacio. */}
                            <TextInput
                                style={[styles.input, styles.titleInput, { backgroundColor: theme.raised, color: theme.ink, borderColor: theme.lineStrong }]}
                                value={formData.title}
                                onChangeText={text => setFormData({ ...formData, title: text.replace(/\s*[\r\n]+\s*/g, ' ') })}
                                placeholder="Ingresa el título..."
                                placeholderTextColor={theme.muted}
                                multiline
                                submitBehavior="blurAndSubmit"
                                returnKeyType="done"
                            />

                            {/* Fase 7.5b1 (E7): etiquetas de la sección, nuevas y de otras secciones */}
                            <Text style={[styles.inputLabel, { color: theme.accent }]}>Etiquetas</Text>
                            <EtiquetasCampo
                                catalog={catalog}
                                section={activeTab}
                                selected={formData.tags}
                                onChange={(tags) => setFormData({ ...formData, tags })}
                                informar={informar}
                            />

                            {activeTab === 'movie' && (
                                <>
                                    <Text style={[styles.inputLabel, { color: theme.accent }]}>Año</Text>
                                    <TextInput
                                        style={[styles.input, { backgroundColor: theme.raised, color: theme.ink, borderColor: theme.lineStrong }]}
                                        value={formData.year}
                                        onChangeText={text => setFormData({ ...formData, year: text })}
                                        placeholder="Ej: 1994"
                                        keyboardType="numeric"
                                        placeholderTextColor={theme.muted}
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
                                                style={[
                                                    styles.formatOption, 
                                                    {
                                                        backgroundColor: formData.format === f ? theme.accent : theme.raised, 
                                                        borderColor: formData.format === f ? theme.accent : theme.lineStrong
                                                    }
                                                ]}
                                                onPress={() => setFormData({ ...formData, format: f })}
                                            >
                                                <Text style={[styles.formatText, { color: formData.format === f ? theme.onAccent : theme.ink }]}>{f}</Text>
                                            </TouchableOpacity>
                                        ))}
                                    </View>
                                    <Text style={[styles.inputLabel, { color: theme.accent }]}>Año Inicio</Text>
                                    <TextInput
                                        style={[styles.input, { backgroundColor: theme.raised, color: theme.ink, borderColor: theme.lineStrong }]}
                                        value={formData.start_year}
                                        onChangeText={text => setFormData({ ...formData, start_year: text })}
                                        placeholder="Ej: 2020"
                                        keyboardType="numeric"
                                        placeholderTextColor={theme.muted}
                                    />
                                    <Text style={[styles.inputLabel, { color: theme.accent }]}>Año Fin (Omitir si sigue en emisión)</Text>
                                    <TextInput
                                        style={[styles.input, { backgroundColor: theme.raised, color: theme.ink, borderColor: theme.lineStrong }]}
                                        value={formData.end_year}
                                        onChangeText={text => setFormData({ ...formData, end_year: text })}
                                        placeholder="Ej: 2024"
                                        keyboardType="numeric"
                                        placeholderTextColor={theme.muted}
                                    />
                                </>
                            )}

                            {activeTab === 'anime' && (
                                <>
                                    <Text style={[styles.inputLabel, { color: theme.accent }]}>Año Inicio</Text>
                                    <TextInput
                                        style={[styles.input, { backgroundColor: theme.raised, color: theme.ink, borderColor: theme.lineStrong }]}
                                        value={formData.start_year}
                                        onChangeText={text => setFormData({ ...formData, start_year: text })}
                                        placeholder="Ej: 2020"
                                        keyboardType="numeric"
                                        placeholderTextColor={theme.muted}
                                    />
                                    <Text style={[styles.inputLabel, { color: theme.accent }]}>Año Fin</Text>
                                    <TextInput
                                        style={[styles.input, { backgroundColor: theme.raised, color: theme.ink, borderColor: theme.lineStrong }]}
                                        value={formData.end_year}
                                        onChangeText={text => setFormData({ ...formData, end_year: text })}
                                        placeholder="Ej: 2024"
                                        keyboardType="numeric"
                                        placeholderTextColor={theme.muted}
                                    />
                                </>
                            )}

                            {activeTab === 'reading' && (
                                <>
                                    <Text style={[styles.inputLabel, { color: theme.accent }]}>Subtipo</Text>
                                    <View style={styles.formatContainer}>
                                        {Object.entries(SUBTYPE_LABELS).map(([clave, texto]) => (
                                            <TouchableOpacity
                                                key={clave}
                                                style={[
                                                    styles.formatOption,
                                                    {
                                                        backgroundColor: formData.subtype === clave ? theme.accent : theme.raised,
                                                        borderColor: formData.subtype === clave ? theme.accent : theme.lineStrong
                                                    }
                                                ]}
                                                onPress={() => setFormData({ ...formData, subtype: clave })}
                                            >
                                                <Text style={[styles.formatText, { color: formData.subtype === clave ? theme.onAccent : theme.ink }]}>{texto}</Text>
                                            </TouchableOpacity>
                                        ))}
                                    </View>
                                    <Text style={[styles.inputLabel, { color: theme.accent }]}>Año Inicio</Text>
                                    <TextInput
                                        style={[styles.input, { backgroundColor: theme.raised, color: theme.ink, borderColor: theme.lineStrong }]}
                                        value={formData.start_year}
                                        onChangeText={text => setFormData({ ...formData, start_year: text })}
                                        placeholder="Ej: 2020"
                                        keyboardType="numeric"
                                        placeholderTextColor={theme.muted}
                                    />
                                </>
                            )}
                        </ScrollDeHoja>

                        <View style={styles.modalButtons}>
                            <TouchableOpacity
                                style={[styles.modalButton, { backgroundColor: theme.raised }]}
                                onPress={() => setModalVisible(false)}
                            >
                                <Text style={[styles.modalButtonText, { color: theme.ink }]}>Cancelar</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[styles.modalButton, { backgroundColor: theme.accent }]}
                                onPress={handleAddItem}
                            >
                                <Text style={[styles.modalButtonText, { color: theme.onAccent }]}>
                                    {editingItem ? 'Actualizar' : 'Guardar'}
                                </Text>
                            </TouchableOpacity>
                        </View>
                    </View>
            </HojaConTeclado>

            {/* Fase 7.5b1: hojas de filtro (E8) y gestión (E6) de etiquetas */}
            <EtiquetasFiltroHoja
                visible={tagFilterVisible}
                catalog={catalog}
                section={activeTab}
                sectionLabel={currentCat.label}
                filter={tagFilter}
                onApply={(f) => { setTagFilter(f); setTagFilterVisible(false); }}
                onClose={() => setTagFilterVisible(false)}
            />
            <EtiquetasGestionHoja
                visible={tagManagerVisible}
                catalog={catalog}
                section={activeTab}
                sectionLabel={currentCat.label}
                usage={tagUsage}
                onCreate={handleCreateTag}
                onRename={handleRenameTag}
                onDelete={handleDeleteTag}
                onClose={() => setTagManagerVisible(false)}
            />
        </SafeAreaView>
    );
}

// Estilos en función del tema (dirección visual): ningún color fijo.
const makeStyles = (t) => StyleSheet.create({
    container: { flex: 1 },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: 20,
        borderBottomLeftRadius: 30,
        borderBottomRightRadius: 30,
        elevation: 5,
        shadowColor: t.shadow,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 10,
    },
    backButton: { width: 40, height: 40, justifyContent: 'center' },
    backIcon: { fontSize: 24, fontFamily: FONT.bold },
    headerTitle: { fontSize: 22, fontFamily: FONT.bold, flex: 1, textAlign: 'center' },
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
        minWidth: 0,
        paddingVertical: 8,
        borderRadius: 12,
        borderWidth: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
    statusTabLabel: {
        fontSize: 11,
        fontFamily: FONT.bold,
    },
    tab: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderRadius: 20,
        marginRight: 10,
        borderWidth: 1,
    },
    tabIcon: { fontSize: 18, marginRight: 8 },
    tabLabel: { fontSize: 14, fontFamily: FONT.bold },
    // Chips del filtro de subtipo (Lectura).
    subtypeTab: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderRadius: 20,
        marginRight: 10,
        borderWidth: 1,
    },
    subtypeLabel: { fontSize: 12, fontFamily: FONT.bold },
    // Fase 7.5b1: barra de etiquetas (filtro y gestión) y línea de etiquetas de cada fila.
    tagBar: { flexDirection: 'row', gap: 10, paddingHorizontal: 15, paddingBottom: 10 },
    tagBarBtn: { flex: 1, minWidth: 0, minHeight: 40, borderRadius: 20, borderWidth: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
    tagBarLabel: { fontSize: 13, fontFamily: FONT.bold, textAlign: 'center', textAlignVertical: 'center', includeFontPadding: false },
    tagsLine: { fontSize: 12, fontFamily: FONT.semibold, marginBottom: 8 },
    listContent: { padding: 15, paddingBottom: 100 },
    itemCard: {
        borderRadius: RADIUS.base,
        marginBottom: 10,
        borderWidth: 1,
        overflow: 'hidden',
    },
    cardMain: {
        padding: 12,
    },
    cardHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start', // C1: con el título completo, el punto de estado queda arriba
        marginBottom: 8,
    },
    itemTitle: {
        fontSize: 16,
        fontFamily: FONT.bold,
        flex: 1,
        minWidth: 0,
        marginRight: 10,
    },
    // Fase 7.5: chip "Vinculado" y estado detallado del título vinculado.
    linkRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
    linkChip: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: RADIUS.sm, flexShrink: 0 },
    linkChipText: { fontFamily: FONT.semibold, fontSize: 11 },
    linkText: { flex: 1, minWidth: 0, fontSize: 12 },
    statusDot: {
        width: 10,
        height: 10,
        borderRadius: 5,
        flexShrink: 0,
        marginTop: 6, // alineado con la primera línea del título
    },
    cardFooter: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    metadataContainer: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        flex: 1,
        minWidth: 0,
        alignItems: 'center',
    },
    itemSubtext: {
        fontSize: 12,
        marginRight: 12,
    },
    dateText: {
        fontSize: 11,
        fontStyle: 'italic',
    },
    cardIcons: {
        flexDirection: 'row',
        gap: 8,
        flexShrink: 0,
    },
    miniActionBtn: {
        padding: 4,
    },
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
        shadowColor: t.shadow,
        shadowOffset: { width: 0, height: 5 },
        shadowOpacity: 0.3,
        shadowRadius: 10,
    },
    fabIcon: { fontSize: 32, color: t.onAccent, fontFamily: FONT.regular },
    emptyContainer: { alignItems: 'center', marginTop: 100 },
    emptyText: { fontSize: 16 },
    modalOverlay: {
        flex: 1,
        backgroundColor: t.overlay,
        justifyContent: 'flex-end',
    },
    modalCard: {
        backgroundColor: t.surface,
        borderTopLeftRadius: RADIUS.sheet,
        borderTopRightRadius: RADIUS.sheet,
        padding: 30,
        flexShrink: 1, // 1.4.4 (D1): sin porcentaje; el alto máximo lo pone HojaConTeclado
    },
    filterCard: {
        backgroundColor: t.surface,
        borderTopLeftRadius: RADIUS.sheet,
        borderTopRightRadius: RADIUS.sheet,
        padding: 30,
    },
    modalTitle: { fontSize: 24, fontFamily: FONT.bold, marginBottom: 20 },
    inputLabel: { fontSize: 14, fontFamily: FONT.bold, marginBottom: 8, marginTop: 15 },
    input: { borderRadius: RADIUS.sm, padding: 15, borderWidth: 1, fontSize: 16 },
    // C1 (1.4.3): título multilínea, hasta 5 líneas visibles (5 × 22 + el relleno de 15 arriba y abajo).
    titleInput: { lineHeight: 22, maxHeight: 5 * 22 + 30, textAlignVertical: 'top' },
    formatContainer: { flexDirection: 'row', gap: 10, marginTop: 5 },
    formatOption: {
        flex: 1,
        padding: 12,
        borderRadius: 12,
        borderWidth: 1,
        alignItems: 'center',
    },
    formatText: { fontFamily: FONT.bold },
    modalButtons: { flexDirection: 'row', gap: 15, marginTop: 30 },
    modalButton: { flex: 1, padding: 18, borderRadius: RADIUS.sm, alignItems: 'center', minHeight: 52, justifyContent: 'center' },
    modalButtonText: { fontSize: 16, fontFamily: FONT.bold },
    filterOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    filterOption: {
        paddingHorizontal: 15,
        paddingVertical: 10,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: t.lineStrong,
    },
    filterOptionText: { fontFamily: FONT.semibold, color: t.muted },
    closeBtn: { marginTop: 30, padding: 18, borderRadius: RADIUS.sm, alignItems: 'center', minHeight: 52, justifyContent: 'center' },
    closeBtnText: { color: t.onAccent, fontFamily: FONT.bold, fontSize: 16 },
});
