// Pila de hojas con teclado abiertas (Fase 7.5b1, corrección 1.4.3). Módulo puro: sin React ni
// react-native, así se prueba en Node.
//
// Por qué existe: App.js es el ÚNICO que escucha el botón Atrás de Android (hardwareBackPress) y lo
// vuelve a registrar cada vez que cambia su handleBack (navegación, vista, confirm). Con dos
// listeners, "el último registrado gana" no estaría garantizado. En cambio, HojaConTeclado se
// apila aquí mientras está visible y App.js pregunta PRIMERO a esta pila: si hay una hoja abierta,
// Atrás la cierra y nunca navega.

const pila = [];

// Apila una hoja (cerrar = función que la cierra; HojaConTeclado pasa una que lee su onClose más
// reciente). Devuelve la función para quitarla.
export function registrarHoja(cerrar) {
    const entrada = { cerrar };
    pila.push(entrada);
    return () => {
        const i = pila.indexOf(entrada);
        if (i >= 0) pila.splice(i, 1);
    };
}

export const hayHojaAbierta = () => pila.length > 0;

// Cierra la hoja de arriba. Devuelve true si había una (App.js entonces no navega).
export function cerrarHojaAbierta() {
    const e = pila[pila.length - 1];
    if (!e) return false;
    try { e.cerrar(); } catch { /* la hoja decide; Atrás igual no navega */ }
    return true;
}
