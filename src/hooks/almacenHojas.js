// Almacén de las hojas con teclado visibles (Fase 7.5b1, corrección 1.4.4). Módulo puro: sin React
// ni react-native, se prueba en Node (scripts/probar-fase7-5b1.mjs).
//
// HojaConTeclado (donde la usa la pantalla) no dibuja nada en su lugar: publica aquí sus props con
// un id ESTABLE y HojasHost (en la raíz de App.js, la ventana entera sin padding) las dibuja con
// key = ese id. Reglas:
//   - ponerHoja con un id que ya está actualiza la entrada EN SU LUGAR (mismo orden, misma key: el
//     contenido no se vuelve a montar, el campo con el foco lo conserva);
//   - una hoja nueva va al final (queda por encima) y se apila en hojasAbiertas (Atrás la cierra
//     con su onClose más reciente);
//   - quitarHoja (al ocultarla o al desmontar la pantalla) la saca de aquí y de hojasAbiertas: nunca
//     queda una hoja huérfana dibujada ni en la pila de Atrás.

import { registrarHoja } from './hojasAbiertas';

let entradas = [];
const desapilar = new Map();
const oyentes = new Set();

const avisar = () => { for (const f of [...oyentes]) f(); };

export function ponerHoja(id, props) {
    const i = entradas.findIndex((e) => e.id === id);
    if (i >= 0) {
        entradas = entradas.map((e, k) => (k === i ? { id, props } : e));
    } else {
        entradas = [...entradas, { id, props }];
        desapilar.set(id, registrarHoja(() => {
            const e = entradas.find((x) => x.id === id);
            if (e && typeof e.props.onClose === 'function') e.props.onClose();
        }));
    }
    avisar();
}

export function quitarHoja(id) {
    if (!entradas.some((e) => e.id === id)) return;
    entradas = entradas.filter((e) => e.id !== id);
    const q = desapilar.get(id);
    if (q) { q(); desapilar.delete(id); }
    avisar();
}

// Instantánea inmutable (cambia de identidad solo cuando cambia algo): sirve a useSyncExternalStore.
export const leerHojas = () => entradas;

export function suscribirHojas(fn) {
    oyentes.add(fn);
    return () => { oyentes.delete(fn); };
}
