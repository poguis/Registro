// Memoria de sesión de Pendiente (Fase 7.5b2a, F7). Módulo puro: sin React ni react-native, se
// prueba en Node (scripts/probar-fase7-5b2a.mjs).
//
// Recuerda tipo, estado y orden MIENTRAS LA APP ESTÁ ABIERTA (vive en la memoria del proceso de
// JS). Al cerrar la app vuelve al inicio. Nada se guarda en AsyncStorage ni en SQLite. La
// búsqueda, el año, el subtipo y las etiquetas no se recuerdan (P5, E8).

const TIPOS = ['movie', 'series', 'anime', 'reading'];
const ESTADOS = ['Pendiente', 'Mirando', 'Terminado', 'Total'];
const CAMPOS = ['created_at', 'year', 'title'];
const DIRECCIONES = ['asc', 'desc'];

const INICIAL = Object.freeze({ tipo: 'movie', estado: 'Pendiente', orden: Object.freeze({ field: 'created_at', dir: 'desc' }) });

let memoria = INICIAL;

export const leerMemoriaPendiente = () => memoria;

// Solo acepta valores válidos; lo demás se ignora (la memoria nunca queda en un estado inválido).
export function guardarMemoriaPendiente(parcial) {
    if (!parcial || typeof parcial !== 'object') return memoria;
    const siguiente = { ...memoria };
    if (TIPOS.includes(parcial.tipo)) siguiente.tipo = parcial.tipo;
    if (ESTADOS.includes(parcial.estado)) siguiente.estado = parcial.estado;
    const o = parcial.orden;
    if (o && CAMPOS.includes(o.field) && DIRECCIONES.includes(o.dir)) siguiente.orden = Object.freeze({ field: o.field, dir: o.dir });
    memoria = Object.freeze(siguiente);
    return memoria;
}

// Solo para las pruebas (equivale a cerrar y abrir la app).
export function reiniciarMemoriaPendiente() {
    memoria = INICIAL;
    return memoria;
}
