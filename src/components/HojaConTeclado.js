import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { View, Pressable, Keyboard, StyleSheet, ScrollView, FlatList } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../contexts/ThemeContext';
import { ponerHoja, quitarHoja, leerHojas, suscribirHojas } from '../hooks/almacenHojas';
import { alturaHoja } from './alturaHoja';
import { inputConFoco } from './AppText';

// Hoja con campos de texto (Fase 7.5b1; correcciones 1.4.3 y 1.4.4): el teclado nunca tapa el campo
// con el foco. Es el ÚNICO mecanismo para los formularios y hojas con TextInput del módulo de
// entretenimiento; las pantallas lo usan igual que antes (<HojaConTeclado visible onClose
// [centrada]>) y no saben qué técnica usa.
//
// Por qué no es un Modal de React Native (1.4.3): en Android, con borde a borde (Expo SDK 54), el
// Modal vive en su propia ventana (Dialog) con setDecorFitsSystemWindows(false), el teclado no la
// redimensiona y los eventos de teclado de RN 0.81 se calculan en la ventana de la ACTIVIDAD.
//
// Dónde se dibuja (1.4.4, D2): HojaConTeclado no dibuja nada donde la usa la pantalla; publica sus
// props en src/hooks/almacenHojas.js (id estable, en useLayoutEffect) y HojasHost, último hijo de
// la View raíz de App.js (la ventana entera, SIN padding), la dibuja. Así cubre también la barra de
// estado y llega al borde inferior aunque la pantalla use SafeAreaView (el padding de ese
// SafeAreaView ya no deja una franja), y queda por encima de todo el contenido de la pantalla (el
// "+" incluido); el aviso y las hojas de confirmación se dibujan después (SheetContext).
//
// Alturas (1.4.4, D1): alturaHoja (función pura, src/components/alturaHoja.js) da el tope de
// arriba, el relleno de abajo y el alto máximo de la tarjeta en dp (85 % de la ventana con el
// teclado cerrado, el área libre con el teclado abierto). La tarjeta mide lo que su contenido hasta
// ese máximo y después su lista hace scroll; las tarjetas de las pantallas no llevan porcentajes ni
// altos fijos (un porcentaje contra un padre que mide su contenido la achicaba: era D1).
//
// Teclado: alto = e.endCoordinates.height de keyboardDidShow (en RN 0.81, IME menos la barra de
// navegación) y 0 en keyboardDidHide; sin KeyboardAvoidingView ni measureInWindow. El campo con el
// foco se lleva a la vista dentro de ScrollDeHoja / ListaDeHoja con measureLayout relativo al
// contenido del scroll. Atrás: el almacén apila cada hoja en hojasAbiertas y App.js (el único
// listener de hardwareBackPress) la cierra antes de navegar.

const MARGEN_FOCO = 24;
let siguienteId = 0;

const ScrollCtx = createContext(null);

// Props para el ScrollView o la FlatList de la hoja (deben usarse DENTRO de la hoja: leen su
// contexto); las pantallas usan ScrollDeHoja / ListaDeHoja, que lo hacen por ellas.
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

// ScrollView y FlatList de una hoja: encogen con la tarjeta (sin alto fijo) y dejan a la hoja
// llevar el campo con el foco a la vista.
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

// Lo que usan las pantallas. No dibuja nada aquí: publica sus props en el almacén con un id estable
// (mientras está visible) y HojasHost las dibuja. La publicación va en useLayoutEffect, así el
// anfitrión se actualiza en el mismo commit, antes de pintar (al escribir, sin retraso).
export default function HojaConTeclado({ visible, onClose, centrada = false, children }) {
    const id = useRef(null);
    if (id.current === null) id.current = `hoja-${++siguienteId}`;
    useLayoutEffect(() => {
        if (visible) ponerHoja(id.current, { onClose, centrada, children });
        else quitarHoja(id.current);
    });
    // Al desmontar la pantalla con la hoja abierta: fuera del almacén y de la pila de Atrás.
    useLayoutEffect(() => () => quitarHoja(id.current), []);
    return null;
}

// Anfitrión: último hijo de la View raíz de App.js. Dibuja las hojas visibles con key = su id
// estable. Hasta tener su alto (onLayout) no dibuja ninguna tarjeta: nunca con alto 0.
export function HojasHost() {
    const hojas = useSyncExternalStore(suscribirHojas, leerHojas, leerHojas);
    const [ventana, setVentana] = useState(0);
    return (
        <View style={[StyleSheet.absoluteFill, styles.anfitrion]} pointerEvents="box-none" onLayout={(e) => setVentana(e.nativeEvent.layout.height)}>
            {ventana > 0 ? hojas.map((h) => <CapaHoja key={h.id} ventana={ventana} {...h.props} />) : null}
        </View>
    );
}

// Una hoja dibujada en el anfitrión: fondo, tarjeta con su alto máximo y relleno de abajo.
function CapaHoja({ ventana, onClose, centrada, children }) {
    const { theme } = useTheme();
    const insets = useSafeAreaInsets();
    const [altoTeclado, setAltoTeclado] = useState(0);
    const scrolls = useRef(new Set());

    useEffect(() => {
        const alMostrar = Keyboard.addListener('keyboardDidShow', (e) => {
            setAltoTeclado(Math.max(0, (e && e.endCoordinates && e.endCoordinates.height) || 0));
        });
        const alOcultar = Keyboard.addListener('keyboardDidHide', () => setAltoTeclado(0));
        return () => { alMostrar.remove(); alOcultar.remove(); };
    }, []);

    // Con el teclado ya abierto y la tarjeta reacomodada, el campo con el foco a la vista.
    useEffect(() => {
        if (altoTeclado === 0) return undefined;
        const t = setTimeout(() => { for (const s of scrolls.current) llevarAlFoco(s); }, 60);
        return () => clearTimeout(t);
    }, [altoTeclado]);

    const registrar = useCallback((s) => { scrolls.current.add(s); return () => scrolls.current.delete(s); }, []);
    const { tope, relleno, maxAlto } = alturaHoja({ ventana, insets, teclado: altoTeclado, variante: centrada ? 'centrada' : 'inferior' });

    return (
        <ScrollCtx.Provider value={registrar}>
            <View style={StyleSheet.absoluteFill}>
                <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: theme.overlay }]} onPress={onClose} accessibilityLabel="Cerrar" />
                <View style={[styles.area, centrada && styles.areaCentrada, { paddingTop: tope }]} pointerEvents="box-none">
                    <View style={[styles.tarjeta, { maxHeight: maxAlto }]}>{children}</View>
                </View>
                <View style={{ height: relleno, backgroundColor: centrada ? 'transparent' : theme.surface }} pointerEvents="none" />
            </View>
        </ScrollCtx.Provider>
    );
}

const styles = StyleSheet.create({
    anfitrion: { zIndex: 1000, elevation: 30 },
    area: { flex: 1, justifyContent: 'flex-end' },
    areaCentrada: { justifyContent: 'center', paddingHorizontal: 20, paddingBottom: 20 },
    tarjeta: { flexShrink: 1 },
    scroll: { flexShrink: 1 },
});
