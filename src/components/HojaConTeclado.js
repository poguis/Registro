import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { View, Pressable, Keyboard, StyleSheet, ScrollView, FlatList } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../contexts/ThemeContext';
import { registrarHoja } from '../hooks/hojasAbiertas';
import { inputConFoco } from './AppText';

// Hoja con campos de texto (Fase 7.5b1, corrección 1.4.3): el teclado nunca tapa el campo con el
// foco. Es el ÚNICO mecanismo para los formularios y hojas con TextInput del módulo de
// entretenimiento; las pantallas no saben qué técnica usa.
//
// Por qué no es un Modal de React Native: en Android, con borde a borde (edgeToEdgeEnabled, Expo
// SDK 54), el Modal vive en su propia ventana (Dialog) a la que RN 0.81 le pone
// setDecorFitsSystemWindows(false) (ReactModalHostView.kt + WindowUtil.kt), así que el teclado ya
// no la redimensiona, y los eventos de teclado de RN se calculan en la ventana de la ACTIVIDAD
// (ReactRootView.checkForKeyboardEvents). Esta hoja se dibuja dentro del árbol de la pantalla, en
// la ventana de la actividad, donde esos eventos sí corresponden al teclado de sus campos.
//
// Técnica (sin KeyboardAvoidingView ni measureInWindow, que en RN 0.81 no son confiables con borde
// a borde):
//   - alto del teclado = e.endCoordinates.height de keyboardDidShow (en RN 0.81: insets del IME
//     menos la barra de navegación) y 0 en keyboardDidHide;
//   - debajo de la tarjeta, un relleno del color de la hoja: con el teclado cerrado mide
//     insets.bottom (la tarjeta llega detrás de la barra de navegación); abierto, alto + insets.bottom
//     (queda justo debajo del teclado: nada de doble espacio);
//   - arriba deja insets.top + 24, así una tarjeta alta nunca queda debajo de la barra de estado;
//   - el campo con el foco se lleva a la vista dentro del ScrollView / FlatList de la hoja
//     (useScrollConTeclado) con measureLayout relativo a su contenido y scrollTo.
// Cobertura: se monta como ÚLTIMO hijo de la vista raíz de la pantalla y ocupa toda la ventana con
// position absolute (StyleSheet.absoluteFill no se corre por el padding del SafeAreaView), por
// encima de todo con zIndex y elevation (el "+" de Pendiente tiene elevation 10).
// Atrás: no escucha hardwareBackPress; se apila en src/hooks/hojasAbiertas.js y App.js (el único
// listener) la cierra antes de navegar.

const ELEVACION = 30;
const MARGEN_ARRIBA = 24;
const MARGEN_FOCO = 24;

const ScrollCtx = createContext(null);

// Props para el ScrollView o la FlatList de la hoja: así la hoja puede llevar el campo con el foco
// a la vista. Tiene que usarse DENTRO de la hoja (lee su contexto); las pantallas usan
// ScrollDeHoja / ListaDeHoja, que lo hacen por ellas.
export function useScrollConTeclado() {
    const registrar = useContext(ScrollCtx);
    const estado = useRef({ alto: 0, y: 0 });
    const ref = useRef(null);
    useEffect(() => (registrar ? registrar({ ref, estado }) : undefined), [registrar]);
    return useMemo(() => ({
        ref,
        keyboardShouldPersistTaps: 'handled',
        scrollEventThrottle: 16,
        onLayout: (e) => { estado.current.alto = e.nativeEvent.layout.height; },
        onScroll: (e) => { estado.current.y = e.nativeEvent.contentOffset.y; },
    }), []);
}

// ScrollView y FlatList de una hoja (en lugar de los de react-native): encogen con la tarjeta y
// dejan a la hoja llevar el campo con el foco a la vista.
export function ScrollDeHoja({ style, ...props }) {
    const p = useScrollConTeclado();
    return <ScrollView {...p} {...props} style={[styles.scroll, style]} />;
}
export function ListaDeHoja({ style, ...props }) {
    const p = useScrollConTeclado();
    return <FlatList {...p} {...props} style={[styles.scroll, style]} />;
}

// Lleva el campo con el foco a la vista dentro de un scroll registrado.
function llevarAlFoco({ ref, estado }) {
    const scroll = ref.current;
    const input = inputConFoco();
    if (!scroll || !input || typeof input.measureLayout !== 'function') return;
    const responder = typeof scroll.getInnerViewRef === 'function' ? scroll
        : (typeof scroll.getScrollResponder === 'function' ? scroll.getScrollResponder() : null);
    const interior = responder && typeof responder.getInnerViewRef === 'function' ? responder.getInnerViewRef() : null;
    if (!interior) return;
    input.measureLayout(interior, (x, y, w, h) => {
        const { alto, y: actual } = estado.current;
        if (!alto) return;
        let destino = null;
        if (y + h + MARGEN_FOCO > actual + alto) destino = y + h + MARGEN_FOCO - alto;
        else if (y - MARGEN_FOCO < actual) destino = Math.max(0, y - MARGEN_FOCO);
        if (destino === null) return;
        if (typeof scroll.scrollTo === 'function') scroll.scrollTo({ y: destino, animated: true });
        else if (typeof scroll.scrollToOffset === 'function') scroll.scrollToOffset({ offset: destino, animated: true });
    }, () => {});
}

// `centrada`: tarjeta centrada (formularios de serie y de obra) en vez de anclada abajo; el relleno
// de abajo es transparente (solo reserva el espacio del teclado y de la barra de navegación).
export default function HojaConTeclado({ visible, onClose, centrada = false, children }) {
    const { theme } = useTheme();
    const insets = useSafeAreaInsets();
    const [altoTeclado, setAltoTeclado] = useState(0);
    const scrolls = useRef(new Set());
    const cerrar = useRef(onClose);
    cerrar.current = onClose;

    // Atrás (App.js) y teclado, solo mientras está visible.
    useEffect(() => {
        if (!visible) return undefined;
        const quitar = registrarHoja(() => { if (cerrar.current) cerrar.current(); });
        const alMostrar = Keyboard.addListener('keyboardDidShow', (e) => {
            setAltoTeclado(Math.max(0, (e && e.endCoordinates && e.endCoordinates.height) || 0));
        });
        const alOcultar = Keyboard.addListener('keyboardDidHide', () => setAltoTeclado(0));
        return () => { quitar(); alMostrar.remove(); alOcultar.remove(); setAltoTeclado(0); };
    }, [visible]);

    // Con el teclado ya abierto y la tarjeta reacomodada, el campo con el foco a la vista.
    useEffect(() => {
        if (!visible || altoTeclado === 0) return undefined;
        const t = setTimeout(() => { for (const s of scrolls.current) llevarAlFoco(s); }, 60);
        return () => clearTimeout(t);
    }, [visible, altoTeclado]);

    const registrar = useCallback((s) => { scrolls.current.add(s); return () => scrolls.current.delete(s); }, []);

    if (!visible) return null;
    const relleno = altoTeclado > 0 ? altoTeclado + insets.bottom : insets.bottom;
    return (
        <ScrollCtx.Provider value={registrar}>
            <View style={[StyleSheet.absoluteFill, styles.capa]}>
                <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: theme.overlay }]} onPress={onClose} accessibilityLabel="Cerrar" />
                <View style={[styles.area, centrada && styles.areaCentrada, { paddingTop: insets.top + MARGEN_ARRIBA }]} pointerEvents="box-none">
                    <View style={styles.tarjeta}>{children}</View>
                </View>
                <View style={{ height: relleno, backgroundColor: centrada ? 'transparent' : theme.surface }} pointerEvents="none" />
            </View>
        </ScrollCtx.Provider>
    );
}

const styles = StyleSheet.create({
    capa: { zIndex: 1000, elevation: ELEVACION },
    area: { flex: 1, justifyContent: 'flex-end' },
    areaCentrada: { justifyContent: 'center', paddingHorizontal: 20, paddingBottom: 20 },
    tarjeta: { maxHeight: '100%', flexShrink: 1 },
    scroll: { flexShrink: 1 },
});
