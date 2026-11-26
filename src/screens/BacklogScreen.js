import React, { useState, useEffect, useMemo, useRef } from 'react';
import { View, StyleSheet, TouchableOpacity, FlatList, Keyboard } from 'react-native';
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
import { parseTags, sortForDisplay, deleteTagText, tagKey, TAG_ERROR_TEXTS } from '../entertainment/tags';
// Fase 7.5b2a (O12): la lista se arma en memoria (filtros, búsqueda, año, orden y las 4 páginas).
import { STATUS_TABS, buildPages, availableYears, activeFilterCount, emptyText, normalizeSearch } from '../entertainment/backlogList';
import { leerMemoriaPendiente, guardarMemoriaPendiente } from '../hooks/memoriaPendiente';
import EtiquetasCampo from '../components/EtiquetasCampo';
import EtiquetasGestionHoja from '../components/EtiquetasGestionHoja';
import FiltrosPendienteHoja from '../components/FiltrosPendienteHoja';
import FilaTipos, { TIPOS } from '../components/FilaTipos';
import PaginadorEstados from '../components/PaginadorEstados';
import BuscarPendiente from '../components/BuscarPendiente';
import Icono from '../components/Icono';
import HojaConTeclado, { ScrollDeHoja } from '../components/HojaConTeclado';

const FORM_VACIO = { title: '', year: '', format: '24 min', start_year: '', end_year: '', subtype: null, tags: [] };
const FILTRO_VACIO = { keys: [], none: false };

const STATUS_TONES = {
    'Pendiente': 'pizarra',
    'Mirando': 'azul',
    'Terminado': 'verde',
    'Total': 'morado',
};

// Años del formulario: solo dígitos, hasta 4 (no cambia la validación: se guardan con parseInt).
const soloAnio = (text) => String(text || '').replace(/\D/g, '').slice(0, 4);

export default function BacklogScreen({ user, onBack }) {
    const { theme } = useTheme();
    const styles = useMemo(() => makeStyles(theme), [theme]);
    const { confirm, informar } = useSheet();
    const statusTone = (status) => theme.tones[STATUS_TONES[status]];
    // F7: tipo, estado y orden se recuerdan mientras la app está abierta (memoria de sesión).
    const memoria = useRef(leerMemoriaPendiente()).current;
    const [activeTab, setActiveTab] = useState(memoria.tipo);
    const [activeStatus, setActiveStatus] = useState(memoria.estado);
    const [orden, setOrden] = useState(memoria.orden);
    const [items, setItems] = useState([]); // todas las filas vivas de la sección (C-a)
    const [modalVisible, setModalVisible] = useState(false);
    const [filterModalVisible, setFilterModalVisible] = useState(false);
    const [editingItem, setEditingItem] = useState(null);
    const [activeSubtype, setActiveSubtype] = useState('Todos'); // Fase 7.5: filtro de Lectura
    // Fase 7.5b1: filtro por etiquetas (E8), catálogo (todas las secciones) y hoja de gestión.
    const [tagFilter, setTagFilter] = useState(FILTRO_VACIO);
    const [catalog, setCatalog] = useState([]);
    const [tagUsage, setTagUsage] = useState({});
    const [tagManagerVisible, setTagManagerVisible] = useState(false);
    // Fase 7.5b2a: año (P4) y búsqueda (F8.2; se mantiene al cambiar de sección, P5).
    const [yearFilter, setYearFilter] = useState(null);
    const [busqueda, setBusqueda] = useState('');
    const [buscando, setBuscando] = useState(false);
    const [teclado, setTeclado] = useState(0);
    const pedido = useRef(0);

    // Form state
    const [formData, setFormData] = useState(FORM_VACIO);

    useEffect(() => {
        loadItems();
    }, [activeTab]);
    // Recarga si la sync trae cambios del servidor (sin tocar formularios, filtros, página ni scroll).
    useSyncRefresh(() => loadItems());

    // E8 y P5: al cambiar de sección se limpian etiquetas, subtipo y año; la búsqueda se mantiene.
    useEffect(() => {
        setActiveSubtype('Todos');
        setTagFilter(FILTRO_VACIO);
        setYearFilter(null);
    }, [activeTab]);

    useEffect(() => {
        guardarMemoriaPendiente({ tipo: activeTab, estado: activeStatus, orden });
    }, [activeTab, activeStatus, orden]);

    // Con el teclado abierto (búsqueda), la página suma su alto al relleno inferior.
    useEffect(() => {
        const a = Keyboard.addListener('keyboardDidShow', (e) => setTeclado(Math.max(0, (e && e.endCoordinates && e.endCoordinates.height) || 0)));
        const b = Keyboard.addListener('keyboardDidHide', () => setTeclado(0));
        return () => { a.remove(); b.remove(); };
    }, []);

    // Una sola lectura por sección: todas las filas vivas, sin filtros (los aplica backlogList).
    const loadItems = async () => {
        const n = ++pedido.current;
        const tab = activeTab;
        const res = await db.getBacklogItems(user.id, tab, 'Total', 'created_at', 'DESC', null, 'Todos');
        if (res.success && n === pedido.current) {
            setItems(res.data);
        }
        const tagsRes = await db.getBacklogTags(user.id);
        if (tagsRes.success) {
            setCatalog(tagsRes.data);
        }
    };

    const filtros = useMemo(() => ({ subtype: activeSubtype, tags: tagFilter, year: yearFilter, search: busqueda }),
        [activeSubtype, tagFilter, yearFilter, busqueda]);
    const { pages, counts } = useMemo(() => buildPages(items, filtros, orden), [items, filtros, orden]);
    const anios = useMemo(() => availableYears(items), [items]);
    const nFiltros = activeFilterCount(filtros);
    const textoVacio = emptyText(filtros);

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
        }
        await loadItems();
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
        }
        await loadItems();
        await loadTagUsage();
        return true;
    };

    // P7: el tipo del formulario (al agregar, el elegido; al editar, el del título: no se edita).
    const handleAddItem = async () => {
        const formErrors = { titulo: 'El título es obligatorio', subtipo: 'Elige el subtipo: libro, cómic o manga.' };
        const tipo = editingItem ? editingItem.type : (formData.type || activeTab);
        const validation = validateBacklogForm({ type: tipo, title: formData.title, subtype: formData.subtype });
        if (validation.error) { informar('Error', formErrors[validation.error]); return; }

        const { type: _tipoForm, ...campos } = formData;
        const data = {
            ...campos,
            type: tipo,
            subtype: tipo === 'reading' ? formData.subtype : null,
            year: formData.year ? parseInt(formData.year) : null,
            start_year: formData.start_year ? parseInt(formData.start_year) : null,
            end_year: formData.end_year ? parseInt(formData.end_year) : null,
        };

        if (editingItem) {
            const res = await db.updateBacklogItem(editingItem.id, data);
            if (res.success) {
                // Editar no cambia el estado: la pantalla se queda en la pestaña actual.
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
                // Nuevo: a la sección del título y a Pendiente (P7).
                setModalVisible(false);
                setFormData(FORM_VACIO);
                setActiveStatus('Pendiente');
                if (tipo !== activeTab) setActiveTab(tipo);
                else loadItems();
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
            type: item.type,
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

    // Una página del paginador (F2/F3): la lista vertical del estado (se rehace en cada render; el
    // paginador no remonta la página, así que la lista conserva su scroll).
    const renderPagina = (estado) => (
        <FlatList
            data={pages[estado]}
            renderItem={renderItem}
            keyExtractor={item => item.id.toString()}
            contentContainerStyle={[styles.listContent, { paddingBottom: 100 + teclado }]}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={
                <View style={styles.emptyContainer}>
                    <Text style={[styles.emptyText, { color: theme.muted }]}>{textoVacio}</Text>
                </View>
            }
        />
    );

    const currentCat = TIPOS.find(c => c.id === activeTab);
    const formType = editingItem ? editingItem.type : (formData.type || activeTab);
    const formCat = TIPOS.find(c => c.id === formType);
    const hayBusqueda = normalizeSearch(busqueda) !== '';

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: theme.bg }]}>

            {/* Cabecera compacta (O12): título con sus acciones, tipos en una fila fija y estados */}
            <View style={[styles.header, { backgroundColor: theme.surface, borderBottomColor: theme.line }]}>
                <View style={styles.headerRow}>
                    <TouchableOpacity onPress={onBack} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel="Atrás">
                        <Icono nombre="atras" tamano={24} color={theme.ink} />
                    </TouchableOpacity>
                    {buscando ? (
                        <BuscarPendiente
                            value={busqueda}
                            onChange={setBusqueda}
                            onCerrar={() => { setBusqueda(''); setBuscando(false); }}
                        />
                    ) : (
                        <>
                            <Text style={[styles.headerTitle, { color: theme.ink }]} numberOfLines={1} ellipsizeMode="tail">Pendientes</Text>
                            <TouchableOpacity onPress={() => setBuscando(true)} style={[styles.iconBtn, hayBusqueda && { backgroundColor: theme.soft }]} accessibilityRole="button" accessibilityLabel="Buscar">
                                <Icono nombre="buscar" tamano={22} color={hayBusqueda ? theme.accent : theme.ink} />
                            </TouchableOpacity>
                            <TouchableOpacity onPress={() => setFilterModalVisible(true)} style={[styles.iconBtn, nFiltros > 0 && { backgroundColor: theme.soft }]} accessibilityRole="button" accessibilityLabel={nFiltros > 0 ? `Filtros, ${nFiltros} activos` : 'Filtros'}>
                                <Icono nombre="filtros" tamano={22} color={nFiltros > 0 ? theme.accent : theme.ink} />
                                {nFiltros > 0 && (
                                    <View style={[styles.badge, { backgroundColor: theme.accent }]}>
                                        <Text style={[styles.badgeText, { color: theme.onAccent }]}>{nFiltros}</Text>
                                    </View>
                                )}
                            </TouchableOpacity>
                            <TouchableOpacity onPress={openTagManager} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel="Etiquetas">
                                <Icono nombre="etiquetas" tamano={22} color={theme.ink} />
                            </TouchableOpacity>
                        </>
                    )}
                </View>

                <View style={styles.tiposRow}>
                    <FilaTipos value={activeTab} onChange={setActiveTab} />
                </View>

                {/* Estados: un toque o deslizar la lista (PaginadorEstados) */}
                <View style={styles.statusTabsContainer}>
                    {STATUS_TABS.map(status => (
                        <TouchableOpacity
                            key={status}
                            accessibilityRole="tab"
                            accessibilityState={{ selected: activeStatus === status }}
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
            </View>

            {/* Lista paginada por estado (F2/F3) */}
            <PaginadorEstados
                estados={STATUS_TABS}
                estado={activeStatus}
                onCambiar={setActiveStatus}
                renderPagina={renderPagina}
            />

            {/* Agregar (O8): ícono "plus" centrado en su botón */}
            <TouchableOpacity
                style={[styles.fab, { backgroundColor: theme.accent }]}
                accessibilityRole="button"
                accessibilityLabel="Agregar"
                onPress={() => {
                    setEditingItem(null);
                    setFormData({ ...FORM_VACIO, type: activeTab });
                    setModalVisible(true);
                }}
            >
                <Icono nombre="mas" tamano={28} color={theme.onAccent} />
            </TouchableOpacity>

            {/* Hoja "Filtros" (F8.1): subtipo, etiquetas, año y orden */}
            <FiltrosPendienteHoja
                visible={filterModalVisible}
                section={activeTab}
                sectionLabel={currentCat.label}
                catalog={catalog}
                years={anios}
                filtros={filtros}
                orden={orden}
                onAplicar={({ filtros: f, orden: o }) => {
                    setActiveSubtype(f.subtype);
                    setTagFilter(f.tags);
                    setYearFilter(f.year);
                    setOrden(o);
                    setFilterModalVisible(false);
                }}
                onClose={() => setFilterModalVisible(false)}
            />

            {/* Formulario (1.4.3: hoja con teclado, el campo con el foco nunca queda tapado) */}
            <HojaConTeclado visible={modalVisible} onClose={() => setModalVisible(false)}>
                    <View style={[styles.modalCard, { backgroundColor: theme.surface }]}>
                        <Text style={[styles.modalTitle, { color: theme.ink }]} numberOfLines={1} ellipsizeMode="tail">
                            {editingItem ? 'Editar' : 'Añadir'} {formCat.label}
                        </Text>

                        <ScrollDeHoja>
                            {/* P7: al agregar se elige (cambiarlo limpia subtipo y etiquetas); al editar, solo lectura */}
                            <Text style={[styles.inputLabel, styles.inputLabelPrimero, { color: theme.accent }]}>Tipo</Text>
                            <FilaTipos
                                value={formType}
                                disabled={!!editingItem}
                                compacta
                                onChange={(t) => { if (t !== formType) setFormData({ ...formData, type: t, subtype: null, tags: [] }); }}
                            />

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
                                section={formType}
                                selected={formData.tags}
                                onChange={(tags) => setFormData({ ...formData, tags })}
                                informar={informar}
                            />

                            {formType === 'movie' && (
                                <>
                                    <Text style={[styles.inputLabel, { color: theme.accent }]}>Año</Text>
                                    <TextInput
                                        style={[styles.input, { backgroundColor: theme.raised, color: theme.ink, borderColor: theme.lineStrong }]}
                                        value={formData.year}
                                        onChangeText={text => setFormData({ ...formData, year: soloAnio(text) })}
                                        placeholder="Ej: 1994"
                                        keyboardType="number-pad"
                                        maxLength={4}
                                        placeholderTextColor={theme.muted}
                                    />
                                </>
                            )}

                            {formType === 'series' && (
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
                                        onChangeText={text => setFormData({ ...formData, start_year: soloAnio(text) })}
                                        placeholder="Ej: 2020"
                                        keyboardType="number-pad"
                                        maxLength={4}
                                        placeholderTextColor={theme.muted}
                                    />
                                    <Text style={[styles.inputLabel, { color: theme.accent }]}>Año Fin (Omitir si sigue en emisión)</Text>
                                    <TextInput
                                        style={[styles.input, { backgroundColor: theme.raised, color: theme.ink, borderColor: theme.lineStrong }]}
                                        value={formData.end_year}
                                        onChangeText={text => setFormData({ ...formData, end_year: soloAnio(text) })}
                                        placeholder="Ej: 2024"
                                        keyboardType="number-pad"
                                        maxLength={4}
                                        placeholderTextColor={theme.muted}
                                    />
                                </>
                            )}

                            {formType === 'anime' && (
                                <>
                                    <Text style={[styles.inputLabel, { color: theme.accent }]}>Año Inicio</Text>
                                    <TextInput
                                        style={[styles.input, { backgroundColor: theme.raised, color: theme.ink, borderColor: theme.lineStrong }]}
                                        value={formData.start_year}
                                        onChangeText={text => setFormData({ ...formData, start_year: soloAnio(text) })}
                                        placeholder="Ej: 2020"
                                        keyboardType="number-pad"
                                        maxLength={4}
                                        placeholderTextColor={theme.muted}
                                    />
                                    <Text style={[styles.inputLabel, { color: theme.accent }]}>Año Fin</Text>
                                    <TextInput
                                        style={[styles.input, { backgroundColor: theme.raised, color: theme.ink, borderColor: theme.lineStrong }]}
                                        value={formData.end_year}
                                        onChangeText={text => setFormData({ ...formData, end_year: soloAnio(text) })}
                                        placeholder="Ej: 2024"
                                        keyboardType="number-pad"
                                        maxLength={4}
                                        placeholderTextColor={theme.muted}
                                    />
                                </>
                            )}

                            {formType === 'reading' && (
                                <>
                                    <Text style={[styles.inputLabel, { color: theme.accent }]}>Subtipo</Text>
                                    <View style={styles.formatContainer}>
                                        {Object.entries(SUBTYPE_LABELS).map(([clave, texto]) => (
                                            <TouchableOpacity
                                                key={clave}
                                                accessibilityRole="button"
                                                accessibilityState={{ selected: formData.subtype === clave }}
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
                                        onChangeText={text => setFormData({ ...formData, start_year: soloAnio(text) })}
                                        placeholder="Ej: 2020"
                                        keyboardType="number-pad"
                                        maxLength={4}
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

            {/* Fase 7.5b1: gestión de etiquetas (E6) */}
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
    // O12: cabecera compacta (~160 dp): fila del título, fila de tipos y pestañas de estado.
    header: {
        paddingHorizontal: 12,
        paddingTop: 6,
        paddingBottom: 10,
        borderBottomWidth: 1,
    },
    headerRow: { flexDirection: 'row', alignItems: 'center', minHeight: 48, gap: 4 },
    headerTitle: { fontSize: 20, fontFamily: FONT.bold, flex: 1, minWidth: 0, marginLeft: 4 },
    iconBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
    badge: { position: 'absolute', top: 2, right: 2, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center' },
    badgeText: { fontSize: 11, lineHeight: 14, fontFamily: FONT.bold, textAlign: 'center', includeFontPadding: false },
    tiposRow: { marginTop: 6 },
    statusTabsContainer: {
        flexDirection: 'row',
        gap: 8,
        marginTop: 8,
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
    // O8: el ícono (glifo cuadrado) queda centrado vertical y horizontalmente.
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
    emptyContainer: { alignItems: 'center', marginTop: 100 },
    emptyText: { fontSize: 16 },
    modalCard: {
        backgroundColor: t.surface,
        borderTopLeftRadius: RADIUS.sheet,
        borderTopRightRadius: RADIUS.sheet,
        padding: 30,
        flexShrink: 1, // 1.4.4 (D1): sin porcentaje; el alto máximo lo pone HojaConTeclado
    },
    modalTitle: { fontSize: 24, fontFamily: FONT.bold, marginBottom: 20 },
    inputLabel: { fontSize: 14, fontFamily: FONT.bold, marginBottom: 8, marginTop: 15 },
    inputLabelPrimero: { marginTop: 0 },
    input: { borderRadius: RADIUS.sm, padding: 15, borderWidth: 1, fontSize: 16 },
    // C1 (1.4.3): título multilínea, hasta 5 líneas visibles (5 × 22 + el relleno de 15 arriba y abajo).
    titleInput: { lineHeight: 22, maxHeight: 5 * 22 + 30, textAlignVertical: 'top' },
    formatContainer: { flexDirection: 'row', gap: 10, marginTop: 5 },
    formatOption: {
        flex: 1,
        minHeight: 48,
        padding: 12,
        borderRadius: 12,
        borderWidth: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
    formatText: { fontFamily: FONT.bold },
    modalButtons: { flexDirection: 'row', gap: 15, marginTop: 30 },
    modalButton: { flex: 1, padding: 18, borderRadius: RADIUS.sm, alignItems: 'center', minHeight: 52, justifyContent: 'center' },
    modalButtonText: { fontSize: 16, fontFamily: FONT.bold },
});
