import React, { createContext, useCallback, useMemo, useRef, useState } from 'react';
import BottomSheet from '../components/BottomSheet';
import Toast from '../components/Toast';

// Hojas inferiores y avisos de la app (O6, dirección visual). Reemplazan al diálogo del sistema.
//
//   const clave = await confirm({ titulo, mensaje, acciones: [{ clave, texto, variante }] });
//     variante: 'primaria' | 'secundaria' | 'destructiva' | 'cancelar'.
//     Devuelve la clave elegida. Atrás y el toque en el fondo:
//       - con una acción 'cancelar' → null (cancelado);
//       - sin ella (p. ej. una hoja de solo "OK") → la clave de su última acción (la misma que OK).
//     Las hojas se muestran de a una, en cola.
//   avisar({ titulo, mensaje }): aviso breve (hasta 2 líneas) que desaparece solo.

export const SheetContext = createContext(null);

let siguienteId = 0;

export function SheetProvider({ children }) {
    const [cola, setCola] = useState([]);
    const [aviso, setAviso] = useState(null);
    const colaRef = useRef([]);
    colaRef.current = cola;

    const confirm = useCallback((opciones) => new Promise((resolve) => {
        setCola((c) => [...c, { ...opciones, id: ++siguienteId, resolve }]);
    }), []);

    const cerrar = useCallback((clave) => {
        const actual = colaRef.current[0];
        if (!actual) return;
        setCola((c) => c.slice(1));
        actual.resolve(clave);
    }, []);

    const descartar = useCallback(() => {
        const actual = colaRef.current[0];
        if (!actual) return;
        const acciones = actual.acciones || [];
        const cancelar = acciones.find((a) => a.variante === 'cancelar');
        cerrar(cancelar ? null : (acciones.length ? acciones[acciones.length - 1].clave : null));
    }, [cerrar]);

    const avisar = useCallback(({ titulo, mensaje, accion, duracion } = {}) => {
        setAviso({ id: ++siguienteId, titulo, mensaje, accion, duracion });
    }, []);

    const ocultarAviso = useCallback((id) => {
        setAviso((a) => (a && a.id === id ? null : a));
    }, []);

    const value = useMemo(() => ({ confirm, avisar }), [confirm, avisar]);

    return (
        <SheetContext.Provider value={value}>
            {children}
            <Toast aviso={aviso} onOcultar={ocultarAviso} />
            <BottomSheet hoja={cola[0] || null} onElegir={cerrar} onDescartar={descartar} />
        </SheetContext.Provider>
    );
}

// Hoja informativa de solo "OK" (errores, avisos): mismos título y mensaje que el Alert de antes.
export const okSheet = (confirm, titulo, mensaje) =>
    confirm({ titulo, mensaje, acciones: [{ clave: 'ok', texto: 'OK', variante: 'primaria' }] });
