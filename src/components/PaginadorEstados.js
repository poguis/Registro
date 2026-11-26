import React, { useCallback, useEffect, useRef } from 'react';
import { FlatList, View, useWindowDimensions } from 'react-native';

// Paginador de estados de Pendiente (Fase 7.5b2a, F2/F3): deslizar a izquierda o derecha cambia
// de pestaña (Pendiente / Mirando / Terminado / Total). React Native puro: una FlatList horizontal
// con pagingEnabled, una página por estado (cada una con su lista vertical, que dibuja la
// pantalla con renderPagina). Sin gesture-handler, pager-view ni PanResponder.
//
// - La pestaña se sincroniza al terminar el deslizamiento (onMomentumScrollEnd); un cambio desde
//   afuera (toque de pestaña, o "Pendiente" al agregar) hace scrollToIndex, solo si la página
//   visible es otra (sin ciclos).
// - Las 4 páginas quedan montadas: al deslizar ya hay contenido y cada lista conserva su scroll;
//   una recarga de useSyncRefresh solo cambia los datos (no remonta nada).
// - Atrás desde los bordes (navegación por gestos de Android): el sistema reserva esas franjas,
//   el gesto no llega aquí y termina en el único hardwareBackPress de App.js.

export default function PaginadorEstados({ estados, estado, onCambiar, renderPagina }) {
    const { width } = useWindowDimensions();
    const lista = useRef(null);
    const indice = Math.max(0, estados.indexOf(estado));
    const visible = useRef(indice);
    const anchoPrevio = useRef(width);

    useEffect(() => {
        const cambioAncho = anchoPrevio.current !== width;
        anchoPrevio.current = width;
        if (!lista.current) return;
        if (cambioAncho) {
            lista.current.scrollToIndex({ index: indice, animated: false });
            visible.current = indice;
            return;
        }
        if (visible.current === indice) return;
        visible.current = indice;
        lista.current.scrollToIndex({ index: indice, animated: true });
    }, [indice, width]);

    const alTerminar = useCallback((e) => {
        const x = e.nativeEvent.contentOffset.x;
        const i = Math.min(estados.length - 1, Math.max(0, Math.round(x / (width || 1))));
        visible.current = i;
        if (estados[i] !== estado) onCambiar(estados[i]);
    }, [estados, estado, onCambiar, width]);

    const getItemLayout = useCallback((_, index) => ({ length: width, offset: width * index, index }), [width]);

    return (
        <FlatList
            ref={lista}
            horizontal
            pagingEnabled
            data={estados}
            keyExtractor={(s) => s}
            renderItem={({ item }) => <View style={{ width, flex: 1 }}>{renderPagina(item)}</View>}
            extraData={renderPagina}
            getItemLayout={getItemLayout}
            initialScrollIndex={indice}
            onMomentumScrollEnd={alTerminar}
            showsHorizontalScrollIndicator={false}
            initialNumToRender={estados.length}
            windowSize={estados.length * 2 + 1}
            removeClippedSubviews={false}
            keyboardShouldPersistTaps="handled"
            style={{ flex: 1 }}
        />
    );
}
